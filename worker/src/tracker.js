// Per-airport tracker tick: poll live ADS-B + METAR, run Naventra's engine,
// lock/grade/learn against real landings, persist to D1. Shares the exact
// engine + grading code with the browser (../../src/engine/*).

import { AIRPORTS } from '../../src/data/airports.js';
import { allocateRunways, annotateAircraft, inferActiveArrivals, departureEnd, ON_FIELD_NM } from '../../src/engine/atc.js';
import { octantOf } from '../../src/engine/octant.js';
import { classifyLandingRunway, gradeItems } from '../../src/engine/grading.js';
import { etaCorrectionSec, ETA_OUTLIER_MS } from '../../src/engine/etaModel.js';
import { observeDepartures, flowWeights, makeDeparturePlanner, learnDeparture, emptyDepModel } from '../../src/engine/departures.js';
import { trainedModel } from './modelSource.js';
import {
  loadModel, priorFromModel, recordLandingIntoModel, etaBiasSec,
  loadOpen, upsertOpenStmt, deleteOpenStmt, recordLandingStmt, bumpStatsStmt, saveModelStmt,
  recordSampleStmt, arrRate1h, loadConfig, saveConfigStmt,
} from './store.js';
import { lockFeatures, decodeWx } from './features.js';

export const TRACKED = ['KJFK', 'KLAX', 'EGLL'];
const RADIUS_NM = 60;

function normalize(raw, now) {
  if (raw.lat == null || raw.lon == null) return null;
  const alt = raw.alt_baro === 'ground' ? 0 : raw.alt_baro;
  return {
    id: raw.hex,
    callsign: (raw.flight || '').trim() || raw.r || raw.hex.toUpperCase(),
    reg: raw.r || null, type: raw.t || null,
    lat: raw.lat, lon: raw.lon,
    altFt: typeof alt === 'number' ? alt : null,
    gs: raw.gs ?? 0, track: raw.track ?? raw.true_heading ?? 0,
    vs: raw.baro_rate ?? raw.geom_rate ?? 0,
    squawk: raw.squawk || null, category: raw.category || null,
    onGround: raw.alt_baro === 'ground',
    seenAt: now - (raw.seen_pos ?? raw.seen ?? 0) * 1000,
  };
}

// Free, keyless ADS-B aggregators returning readsb JSON ({ ac: [...] }). Their
// terms, as checked 2026-10 — keep this list honest if they change again:
//  - adsb.lol : no key today (feeder keys planned), dynamic load-based limits,
//               data licensed ODbL 1.0. Serves Cloudflare Workers most minutes.
//  - adsb.fi  : public endpoints 1 request/second, personal non-commercial use,
//               must cite adsb.fi with a link. Point query is /api/v3/lat/…/dist/….
//               It returns 403 to Cloudflare Workers (a deliberate block), so the
//               worker only re-probes it every few hours — the browser console
//               still uses it through the site's own relay.
// airplanes.live was removed: it closed its public API to non-feeders (Aug 2026).
// adsb.lol rate-limits per IP, and Cloudflare's shared egress IPs are usually
// saturated there by other apps (Oct 2026: data in only 27 of 73 hours). So the
// tracker reaches adsb.lol through the site's own relay — the same path every
// visitor's browser uses — at the same rate and with the same identifying UA,
// falling back to a direct call. adsb.fi is NOT relayed: its 403 is a deliberate
// block on Workers, which we respect rather than route around.
// Etiquette: identify ourselves, keep our adsb.lol requests ≥1.1s apart even
// across the three hubs in a tick, honour Retry-After, back off on repeated
// 429s. If every source fails the tick is skipped (no bad data written) and the
// log names each source's status.
export const UA = 'Naventra/1.0 (+https://naventra.rianfernando.com; non-commercial portfolio)';
const RELAY = 'https://naventra.rianfernando.com/proxy/adsblol';
const ADSB_SOURCES = [
  { key: 'relay→adsb.lol', upstream: 'adsb.lol', url: (lat, lon, r) => `${RELAY}/v2/point/${lat}/${lon}/${r}` },
  { key: 'api.adsb.lol', upstream: 'adsb.lol', url: (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}` },
  { key: 'opendata.adsb.fi', upstream: 'adsb.fi', url: (lat, lon, r) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${r}` },
];
const BLOCKED_REPROBE_MS = 6 * 3600 * 1000; // after a 403, try again in 6 h
const nextSlot = new Map();  // upstream -> earliest ms our next request may start
const coolUntil = new Map(); // source key -> ms until which we leave it alone
const strikes = new Map();   // source key -> consecutive 429s (drives the backoff)

// Reserve the next request slot for a host synchronously, so the three hubs'
// concurrent fetches queue ≥gapMs apart instead of bursting.
async function pace(host, gapMs = 1100) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, at + gapMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

// How long to leave a source alone after a 429: the server's Retry-After when
// it sends one, else 20s doubling per consecutive 429 (20s, 40s, 80s, max 2 min
// — adsb.lol's limit is load-based and recovers quickly).
export function rateLimitCooldownMs(retryAfterHeader, consecutive429s) {
  const ra = Number(retryAfterHeader);
  if (ra > 0) return Math.min(ra, 600) * 1000;
  return Math.min(20000 * 2 ** Math.max(0, consecutive429s - 1), 120000);
}

async function fetchTraffic(airport) {
  const lat = airport.lat.toFixed(4), lon = airport.lon.toFixed(4);
  const errs = [];
  for (const src of ADSB_SOURCES) {
    const until = coolUntil.get(src.key) || 0;
    if (until > Date.now()) { errs.push(`${src.key} backing off ${Math.round((until - Date.now()) / 1000)}s`); continue; }
    try {
      await pace(src.upstream);
      // Re-check after waiting our turn: a hub queued behind a request that just
      // got 429 must not send its own request into the same limit.
      if ((coolUntil.get(src.key) || 0) > Date.now()) { errs.push(`${src.key} backing off`); continue; }
      const res = await fetch(src.url(lat, lon, RADIUS_NM), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429) {
        const n = (strikes.get(src.key) || 0) + 1;
        strikes.set(src.key, n);
        const ra = res.headers.get('Retry-After');
        coolUntil.set(src.key, Date.now() + rateLimitCooldownMs(ra, n));
        const why = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140);
        errs.push(`${src.key} 429${ra ? ` retry-after=${ra}` : ''} (#${n}) ${why}`.trim());
        continue;
      }
      if (res.status === 403) {
        // A deliberate block (adsb.fi blocks Workers) — respect it, re-probe later.
        coolUntil.set(src.key, Date.now() + BLOCKED_REPROBE_MS);
        errs.push(`${src.key} 403 blocked`);
        continue;
      }
      if (!res.ok) { errs.push(`${src.key} ${res.status}`); continue; }
      const data = await res.json();
      strikes.set(src.key, 0);
      const now = Date.now();
      const list = (data.ac || data.aircraft || []).map((a) => normalize(a, now)).filter(Boolean);
      list.source = src.key;
      return list;
    } catch (e) { errs.push(`${src.key} ${e.message}`); }
  }
  throw new Error(`adsb: ${errs.join('; ')}`);
}

async function fetchWx(icao) {
  try {
    // aviationweather.gov asks callers to set a custom User-Agent (≤100 req/min;
    // we make 3/min).
    const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : null;
    return decodeWx(m); // full decoded weather (windDir/windKt + gust/vis/ceiling/cat/temp/qnh)
  } catch { return null; }
}

// Arrivals graded in this isolate in the last half hour. A flight taxiing in
// after landing looks exactly like one taxiing out, so without this every
// arrival was also locked as a "departure" that could never be graded — pure
// D1 write churn. Best effort: a fresh isolate just forgets.
const recentlyLanded = new Map(); // `${icao}:${id}` -> landed ts
const LANDED_MEMORY_MS = 30 * 60000;

// One airport, one tick. Returns { graded, locked } counts.
export async function tickAirport(env, icao) {
  const airport = AIRPORTS[icao];
  const now = Date.now();
  for (const [k, ts] of recentlyLanded) if (now - ts > LANDED_MEMORY_MS) recentlyLanded.delete(k);

  const [tracks, wx, model, open, arrRate, cfgState, etaModel] = await Promise.all([
    fetchTraffic(airport), fetchWx(icao), loadModel(env.DB, icao), loadOpen(env.DB, icao), arrRate1h(env.DB, icao, now),
    loadConfig(env.DB, icao), trainedModel(UA),
  ]);

  // Departure predictions share the predictions table with 'dep:'-prefixed ids.
  const openDep = new Map();
  for (const [id, o] of [...open]) {
    if (id.startsWith('dep:')) { openDep.set(id, o); open.delete(id); }
  }

  const priorFn = priorFromModel(model);
  const depModel = model.rwy.dep || (model.rwy.dep = emptyDepModel());
  const live = tracks.filter((t) => t.altFt == null || t.altFt < 60000);
  // Two passes: wind base config, then re-allocate to the configuration read
  // off traffic — aircraft on final for arrivals, climb-outs for departures
  // (matches how the field is really operating).
  const baseRwys = allocateRunways(airport, wx || {});
  let annotated = annotateAircraft(live, airport, baseRwys, {}, priorFn);
  const obsNow = inferActiveArrivals(annotated, airport);
  // Sticky config across the 1-min cron: hold the last observed configuration
  // through quiet ticks (real configs are stable for hours) rather than reverting
  // to the wind guess when nothing happens to be on final that minute.
  let observed = obsNow;
  let cfg = cfgState ? { ...cfgState } : null; // { ends, ts, dep }
  let cfgDirty = false;
  if (obsNow.size) {
    const ends = [...obsNow.keys()];
    const prev = cfgState?.ends || [];
    const changed = ends.length !== prev.length || ends.some((e) => !prev.includes(e));
    // Only persist the sticky config on a real change, or at most every ~10 min to
    // refresh its timestamp — not every active tick (that was ~1 write/min/hub).
    if (changed || !cfgState || now - cfgState.ts > 10 * 60000) { cfg = { ...(cfg || {}), ends, ts: now }; cfgDirty = true; }
  } else if (cfgState?.ends?.length && now - cfgState.ts < 25 * 60000) {
    observed = new Map(cfgState.ends.map((e) => [e, 1]));
  }
  // Departure flow: every climb-out seen in the last 45 min, kept with the
  // config row (written only when a new departure is seen).
  const { flow, added } = observeDepartures(cfgState?.dep, annotated, airport, now);
  if (added) { cfg = { ends: [], ts: 0, ...(cfg || {}), dep: flow }; cfgDirty = true; }
  const depW = flowWeights(flow, now);
  const rwys = observed.size || depW.size ? allocateRunways(airport, wx || {}, observed.size ? observed : null, depW) : baseRwys;
  annotated = annotateAircraft(live, airport, rwys, {}, priorFn, makeDeparturePlanner(airport, depW, depModel));
  const arrEnds = rwys.filter((r) => r.role.includes('ARR')).map((r) => r.activeEnd);
  const depEnds = rwys.filter((r) => r.role.includes('DEP')).map((r) => r.activeEnd);

  const inboundCount = annotated.filter((a) => a.phase === 'ARRIVAL' || a.phase === 'APPROACH' || a.phase === 'FINAL').length;
  const sectorCount = annotated.length;
  const byId = new Map(annotated.map((a) => [a.id, a]));

  // ---- departures: lock while taxiing, grade on climb-out -----------------
  // The locked plan keeps every expert's call (departures.js), so each graded
  // departure scores them all and the best one at this airport takes over.
  const depGrades = [];              // graded departures (entries)
  const depUpserts = new Map();
  const depDeletes = new Set();
  for (const ac of annotated) {
    const did = 'dep:' + ac.id;
    const d = openDep.get(did);
    if (!d) {
      if (wx && ac.phase === 'GROUND' && ac.depPlan?.end && ac.distNm <= ON_FIELD_NM && ac.gs > 5 && ac.gs < 60 && !open.has(ac.id)
          && !recentlyLanded.has(`${icao}:${ac.id}`)) {
        const p = ac.depPlan;
        const rec = {
          id: did, callsign: ac.callsign, lockTs: now, lockOct: 0, predRunway: p.end, rawEtaTs: now, predEtaTs: now, lastSeen: now,
          sample: { moved: now },
          features: { by: p.by, ctx: p.ctx, cell: p.cell, picks: p.picks },
        };
        openDep.set(did, rec);
        depUpserts.set(did, rec);
      }
      continue;
    }
    const actual = departureEnd(ac, airport);
    if (actual) {
      depDeletes.add(did);
      const plan = d.features;
      depGrades.push({ icao, iata: airport.iata, ts: now, callsign: d.callsign,
        items: [{ cat: 'deprwy', predicted: d.predRunway, actual, ok: actual === d.predRunway, ...(plan?.by ? { by: plan.by } : {}) }] });
      if (plan?.picks) learnDeparture(depModel, plan, actual);
      continue;
    }
    const prevSeen = d.lastSeen;
    const st = d.sample || { moved: d.lockTs };
    const prevMoved = st.moved;
    if (ac.gs >= 3) st.moved = now;
    d.sample = st;
    if (ac.phase === 'GROUND' && ac.gs < 3 && now - st.moved > 20 * 60000) {
      // Stationary for 20 min: parked (a taxi-in arrival at its stand, or a
      // return to the gate). Queues at the hold short creep forward well within
      // that, so long JFK lines are no longer dropped after 10 minutes.
      depDeletes.add(did);
    } else if (now - d.lockTs > 90 * 60000) {
      depDeletes.add(did); // never seen climbing out
    } else if (now - prevSeen >= 150000 || (ac.gs >= 3 && now - prevMoved > 5 * 60000)) {
      // Refresh at most every 2.5 min (or when it starts moving again) instead
      // of every tick — departure records were the tracker's largest writer.
      d.lastSeen = now;
      depUpserts.set(did, d);
    }
  }
  for (const [did, d] of openDep) {
    if (!byId.has(did.slice(4)) && now - d.lastSeen > 10 * 60000) depDeletes.add(did);
  }

  // Accumulate writes so the batch never contains duplicate primary keys:
  const landingEntries = [];             // one INSERT each
  const samples = [];                    // labeled training rows
  const statDelta = new Map();           // cat -> { n, correct }  (one upsert each)
  const openUpserts = new Map();         // id -> record           (last write wins)
  const openDeletes = new Set();         // id
  let graded = 0, locked = 0;

  const finalize = (o, landedTs) => {
    recentlyLanded.set(`${icao}:${o.id}`, now);
    const actualRunway = o.sample ? classifyLandingRunway(o.sample, airport) : null;
    if (o.sample) {
      recordLandingIntoModel(model, o.lockOct, actualRunway, (landedTs - o.rawEtaTs) / 1000);
      const items = gradeItems(
        { predRunway: o.predRunway, predEtaTs: o.predEtaTs, rawEtaTs: o.rawEtaTs, sampleSeq: o.sample.seq },
        actualRunway, landedTs, arrEnds
      );
      landingEntries.push({ icao, iata: airport.iata, ts: landedTs, callsign: o.callsign, items });
      for (const it of items) {
        const d = statDelta.get(it.cat) || { n: 0, correct: 0 };
        d.n += 1; d.correct += it.ok ? 1 : 0;
        statDelta.set(it.cat, d);
      }
      // Labeled training row: the lock-time features + the observed outcome.
      if (o.features) {
        const runwayOk = actualRunway ? actualRunway === o.predRunway : null;
        const etaErrSec = Math.round((landedTs - o.rawEtaTs) / 1000);
        samples.push({
          icao, iata: airport.iata, ts: landedTs, callsign: o.callsign,
          actualRunway, runwayOk, etaErrSec,
          features: o.features,
          outcome: {
            actual_runway: actualRunway,
            runway_ok: actualRunway ? (runwayOk ? 1 : 0) : null,
            config_ok: actualRunway ? (arrEnds.includes(actualRunway) ? 1 : 0) : null,
            eta_err_sec: etaErrSec,
            eta_ok: Math.abs(landedTs - o.rawEtaTs) > ETA_OUTLIER_MS ? null : (Math.abs(landedTs - o.predEtaTs) <= 150000 ? 1 : 0),
            seq_at_land: o.sample.seq ?? null,
            seq_ok: o.sample.seq === 1 ? 1 : 0,
            land_ts: landedTs,
          },
        });
      }
      graded++;
    }
    openDeletes.add(o.id);
  };

  // Aircraft currently in view.
  for (const ac of annotated) {
    const o = open.get(ac.id);

    if (!o) {
      // Lock when the flight commits to approach (needs live weather config).
      if (wx && (ac.phase === 'APPROACH' || (ac.phase === 'FINAL' && ac.distNm > 4)) &&
          ac.runway && ac.etaMin != null && ac.distNm > 3.5 && ac.distNm < 26) {
        const rawEtaTs = now + ac.etaMin * 60000;
        const features = lockFeatures(ac, airport, {
          wx, rwys, arrEnds, depEnds, inbound: inboundCount, sector: sectorCount,
          arrRate1h: arrRate, predRunway: ac.runway, predEtaTs: rawEtaTs,
        });
        // Graded ETA = raw + trained-model correction (adopted airports), else the
        // online bias. rawEtaTs is kept for training so the model always learns
        // the full error (no feedback loop). See src/engine/etaModel.js.
        const corr = etaCorrectionSec(etaModel, icao, features);
        const predEtaTs = rawEtaTs + (corr != null ? corr : etaBiasSec(model)) * 1000;
        features.pred_eta_ts = predEtaTs;
        const rec = {
          id: ac.id, callsign: ac.callsign, lockTs: now, lockOct: octantOf(ac.brgFromField),
          predRunway: ac.runway, rawEtaTs, predEtaTs,
          lastSeen: now, sample: null, features,
        };
        open.set(ac.id, rec);
        openUpserts.set(ac.id, rec);
        locked++;
      }
      continue;
    }

    const prevSeen = o.lastSeen;
    const prevSample = o.sample;
    o.lastSeen = now;
    if (!ac.onGround && ac.agl != null && ac.agl < 4000 && ac.gs > 60) {
      o.sample = { lat: ac.lat, lon: ac.lon, track: ac.track, agl: ac.agl, distNm: ac.distNm, seq: ac.seqRwy ?? o.sample?.seq ?? null };
    }

    if (ac.onGround || (ac.agl != null && ac.agl < 120 && ac.gs < 90)) {
      finalize(o, now);
    } else if (o.sample && ac.vs > 700 && ac.distNm > o.sample.distNm + 0.4 && ac.agl > o.sample.agl + 250) {
      openDeletes.add(ac.id); // go-around → void
    } else {
      // Throttle refresh writes: always persist near the runway (where the drop-out
      // landing heuristic needs a fresh last_seen) or when the tracked sample moved;
      // otherwise persist at most every ~2.5 min for far/high approaches. Cuts most
      // of the per-minute open-prediction write volume without hurting accuracy.
      const lowClose = o.sample && o.sample.agl < 2500 && o.sample.distNm < 6;
      if (lowClose || o.sample !== prevSample || now - prevSeen >= 150000) {
        openUpserts.set(ac.id, o); // refresh last_seen/sample
      }
    }
  }

  // Open predictions whose aircraft dropped out of the feed — landed below
  // coverage on short final if last seen low & close; else eventually expire.
  for (const [id, o] of open) {
    if (byId.has(id)) continue;
    const age = now - o.lastSeen;
    if (age > 90000 && o.sample && o.sample.agl < 2000 && o.sample.distNm < 5) {
      finalize(o, o.lastSeen + 30000);
    } else if (age > 15 * 60000) {
      openDeletes.add(id);
    }
  }

  for (const g of depGrades) {
    landingEntries.push(g);
    const dd = statDelta.get('deprwy') || { n: 0, correct: 0 };
    dd.n += 1; dd.correct += g.items[0].ok ? 1 : 0;
    statDelta.set('deprwy', dd);
    graded++;
  }

  // Keep the model's running training-row counter in step with the samples we're
  // about to insert, so the scorecard can read the count from the model table
  // instead of scanning samples (see store.js / migration 003).
  if (samples.length) model.samples = (model.samples || 0) + samples.length;

  // Build the batch with no duplicate primary keys.
  const stmts = [];
  for (const entry of landingEntries) stmts.push(recordLandingStmt(env.DB, entry));
  for (const s of samples) stmts.push(recordSampleStmt(env.DB, s));
  for (const [cat, d] of statDelta) stmts.push(bumpStatsStmt(env.DB, icao, cat, d.n, d.correct));
  for (const id of openDeletes) { openUpserts.delete(id); stmts.push(deleteOpenStmt(env.DB, id)); }
  for (const id of depDeletes) { depUpserts.delete(id); stmts.push(deleteOpenStmt(env.DB, id)); }
  for (const rec of openUpserts.values()) stmts.push(upsertOpenStmt(env.DB, icao, rec));
  for (const rec of depUpserts.values()) stmts.push(upsertOpenStmt(env.DB, icao, rec));
  // The model only changes when a landing was graded this tick, so don't rewrite
  // it every idle minute (that was ~1 write/min/hub of pure churn).
  if (graded > 0) stmts.push(saveModelStmt(env.DB, model));
  if (cfgDirty) stmts.push(saveConfigStmt(env.DB, icao, cfg));

  if (stmts.length) await env.DB.batch(stmts);
  return {
    icao, graded, locked, samples: samples.length, tracked: annotated.length, source: tracks.source || null,
    // What the traffic shows the field is using right now (for /api/health).
    config: { arr: arrEnds, dep: [...depW.keys()] },
  };
}

// Per-airport tracker tick: poll live ADS-B + METAR, run Naventra's engine,
// lock/grade/learn against real landings, persist to D1. Shares the exact
// engine + grading code with the browser (../../src/engine/*).

import { AIRPORTS } from '../../src/data/airports.js';
import { allocateRunways, annotateAircraft, inferActiveArrivals, departureEnd } from '../../src/engine/atc.js';
import { octantOf } from '../../src/engine/octant.js';
import { classifyLandingRunway, gradeItems } from '../../src/engine/grading.js';
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

// Free, keyless ADS-B aggregators that share the /v2/point/{lat}/{lon}/{radius}
// response shape ({ ac: [...] }). Cloudflare's shared egress IPs get rate-limited
// (429) by any single source, so we fail over across all of them and rotate the
// start point each minute to spread load. If every source is down we surface the
// last error and the tick is skipped (no bad data written).
const ADSB_SOURCES = [
  (lat, lon, r) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
  (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  (lat, lon, r) => `https://opendata.adsb.fi/api/v2/point/${lat}/${lon}/${r}`,
];

async function fetchTraffic(airport) {
  const lat = airport.lat.toFixed(4), lon = airport.lon.toFixed(4);
  const n = ADSB_SOURCES.length;
  const start = Math.floor(Date.now() / 60000) % n; // rotate primary by the minute
  let lastErr = 'no source';
  for (let i = 0; i < n; i++) {
    const build = ADSB_SOURCES[(start + i) % n];
    try {
      const res = await fetch(build(lat, lon, RADIUS_NM), {
        headers: { 'User-Agent': 'naventra-tracker/1.0', Accept: 'application/json' },
      });
      if (!res.ok) { lastErr = `adsb ${res.status}`; continue; }
      const data = await res.json();
      const now = Date.now();
      return (data.ac || data.aircraft || []).map((a) => normalize(a, now)).filter(Boolean);
    } catch (e) { lastErr = `adsb ${e.message}`; }
  }
  throw new Error(lastErr);
}

async function fetchWx(icao) {
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`);
    if (!res.ok) return null;
    const arr = await res.json();
    const m = Array.isArray(arr) ? arr[0] : null;
    return decodeWx(m); // full decoded weather (windDir/windKt + gust/vis/ceiling/cat/temp/qnh)
  } catch { return null; }
}

// One airport, one tick. Returns { graded, locked } counts.
export async function tickAirport(env, icao) {
  const airport = AIRPORTS[icao];
  const now = Date.now();

  const [tracks, wx, model, open, arrRate, cfgState] = await Promise.all([
    fetchTraffic(airport), fetchWx(icao), loadModel(env.DB, icao), loadOpen(env.DB, icao), arrRate1h(env.DB, icao, now),
    loadConfig(env.DB, icao),
  ]);

  // Departure predictions share the predictions table with 'dep:'-prefixed ids.
  const openDep = new Map();
  for (const [id, o] of [...open]) {
    if (id.startsWith('dep:')) { openDep.set(id, o); open.delete(id); }
  }

  const priorFn = priorFromModel(model);
  const live = tracks.filter((t) => t.altFt == null || t.altFt < 60000);
  // Two passes: wind base config, then re-allocate to the configuration read
  // off aircraft actually on final (matches how the field is really operating).
  const baseRwys = allocateRunways(airport, wx || {});
  let annotated = annotateAircraft(live, airport, baseRwys, {}, priorFn);
  const obsNow = inferActiveArrivals(annotated, airport);
  // Sticky config across the 1-min cron: hold the last observed configuration
  // through quiet ticks (real configs are stable for hours) rather than reverting
  // to the wind guess when nothing happens to be on final that minute.
  let observed = obsNow;
  let cfgToSave = null;
  if (obsNow.size) {
    cfgToSave = { ends: [...obsNow.keys()], ts: now };
  } else if (cfgState && now - cfgState.ts < 25 * 60000) {
    observed = new Map(cfgState.ends.map((e) => [e, 1]));
  }
  const rwys = observed.size ? allocateRunways(airport, wx || {}, observed) : baseRwys;
  if (observed.size) annotated = annotateAircraft(live, airport, rwys, {}, priorFn);
  const arrEnds = rwys.filter((r) => r.role.includes('ARR')).map((r) => r.activeEnd);
  const depEnds = rwys.filter((r) => r.role.includes('DEP')).map((r) => r.activeEnd);

  const inboundCount = annotated.filter((a) => a.phase === 'ARRIVAL' || a.phase === 'APPROACH' || a.phase === 'FINAL').length;
  const sectorCount = annotated.length;
  const byId = new Map(annotated.map((a) => [a.id, a]));

  // ---- departures: lock while taxiing, grade on climb-out -----------------
  const depGrades = [];              // graded departures (entries)
  const depUpserts = new Map();
  const depDeletes = new Set();
  for (const ac of annotated) {
    const did = 'dep:' + ac.id;
    const d = openDep.get(did);
    if (!d) {
      if (wx && ac.phase === 'GROUND' && ac.runway && ac.gs > 5 && ac.gs < 60 && !open.has(ac.id)) {
        const rec = { id: did, callsign: ac.callsign, lockTs: now, lockOct: 0, predRunway: ac.runway, rawEtaTs: now, predEtaTs: now, lastSeen: now, sample: null, features: null };
        openDep.set(did, rec);
        depUpserts.set(did, rec);
      }
      continue;
    }
    d.lastSeen = now;
    const actual = departureEnd(ac, airport);
    if (actual) {
      depDeletes.add(did);
      depGrades.push({ icao, iata: airport.iata, ts: now, callsign: d.callsign,
        items: [{ cat: 'deprwy', predicted: d.predRunway, actual, ok: actual === d.predRunway }] });
    } else if (ac.phase === 'GROUND' && ac.gs < 3 && now - d.lockTs > 10 * 60000) {
      depDeletes.add(did); // returned to stand, never departed
    } else {
      depUpserts.set(did, d);
    }
  }
  for (const [did, d] of openDep) {
    if (!byId.has(did.slice(4)) && now - d.lastSeen > 6 * 60000) depDeletes.add(did);
  }

  // Accumulate writes so the batch never contains duplicate primary keys:
  const landingEntries = [];             // one INSERT each
  const samples = [];                    // labeled training rows
  const statDelta = new Map();           // cat -> { n, correct }  (one upsert each)
  const openUpserts = new Map();         // id -> record           (last write wins)
  const openDeletes = new Set();         // id
  let graded = 0, locked = 0;

  const finalize = (o, landedTs) => {
    const actualRunway = o.sample ? classifyLandingRunway(o.sample, airport) : null;
    if (o.sample) {
      recordLandingIntoModel(model, o.lockOct, actualRunway, (landedTs - o.rawEtaTs) / 1000);
      const items = gradeItems(
        { predRunway: o.predRunway, predEtaTs: o.predEtaTs, sampleSeq: o.sample.seq },
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
            eta_ok: Math.abs(landedTs - o.predEtaTs) <= 150000 ? 1 : 0,
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
        const predEtaTs = rawEtaTs + etaBiasSec(model) * 1000;
        const features = lockFeatures(ac, airport, {
          wx, rwys, arrEnds, depEnds, inbound: inboundCount, sector: sectorCount,
          arrRate1h: arrRate, predRunway: ac.runway, predEtaTs,
        });
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

    o.lastSeen = now;
    if (!ac.onGround && ac.agl != null && ac.agl < 4000 && ac.gs > 60) {
      o.sample = { lat: ac.lat, lon: ac.lon, track: ac.track, agl: ac.agl, distNm: ac.distNm, seq: ac.seqRwy ?? o.sample?.seq ?? null };
    }

    if (ac.onGround || (ac.agl != null && ac.agl < 120 && ac.gs < 90)) {
      finalize(o, now);
    } else if (o.sample && ac.vs > 700 && ac.distNm > o.sample.distNm + 0.4 && ac.agl > o.sample.agl + 250) {
      openDeletes.add(ac.id); // go-around → void
    } else {
      openUpserts.set(ac.id, o); // refresh last_seen/sample
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

  // Build the batch with no duplicate primary keys.
  const stmts = [];
  for (const entry of landingEntries) stmts.push(recordLandingStmt(env.DB, entry));
  for (const s of samples) stmts.push(recordSampleStmt(env.DB, s));
  for (const [cat, d] of statDelta) stmts.push(bumpStatsStmt(env.DB, icao, cat, d.n, d.correct));
  for (const id of openDeletes) { openUpserts.delete(id); stmts.push(deleteOpenStmt(env.DB, id)); }
  for (const id of depDeletes) { depUpserts.delete(id); stmts.push(deleteOpenStmt(env.DB, id)); }
  for (const rec of openUpserts.values()) stmts.push(upsertOpenStmt(env.DB, icao, rec));
  for (const rec of depUpserts.values()) stmts.push(upsertOpenStmt(env.DB, icao, rec));
  stmts.push(saveModelStmt(env.DB, model));
  if (cfgToSave) stmts.push(saveConfigStmt(env.DB, icao, cfgToSave));

  if (stmts.length) await env.DB.batch(stmts);
  return { icao, graded, locked, samples: samples.length, tracked: annotated.length };
}

// Per-airport tracker tick: poll live ADS-B + METAR, run Naventra's engine,
// lock/grade/learn against real landings, persist to D1. Shares the exact
// engine + grading code with the browser (../../src/engine/*).

import { AIRPORTS } from '../../src/data/airports.js';
import { allocateRunways, annotateAircraft, inferActiveArrivals } from '../../src/engine/atc.js';
import { octantOf } from '../../src/engine/octant.js';
import { classifyLandingRunway, gradeItems } from '../../src/engine/grading.js';
import {
  loadModel, priorFromModel, recordLandingIntoModel, etaBiasSec,
  loadOpen, upsertOpenStmt, deleteOpenStmt, recordLandingStmt, bumpStatsStmt, saveModelStmt,
  recordSampleStmt, arrRate1h,
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

async function fetchTraffic(airport) {
  const url = `https://api.airplanes.live/v2/point/${airport.lat.toFixed(4)}/${airport.lon.toFixed(4)}/${RADIUS_NM}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'naventra-tracker/1.0' } });
  if (!res.ok) throw new Error(`adsb ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  return (data.ac || data.aircraft || []).map((a) => normalize(a, now)).filter(Boolean);
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

  const [tracks, wx, model, open, arrRate] = await Promise.all([
    fetchTraffic(airport), fetchWx(icao), loadModel(env.DB, icao), loadOpen(env.DB, icao), arrRate1h(env.DB, icao, now),
  ]);

  const priorFn = priorFromModel(model);
  const live = tracks.filter((t) => t.altFt == null || t.altFt < 60000);
  // Two passes: wind base config, then re-allocate to the configuration read
  // off aircraft actually on final (matches how the field is really operating).
  const baseRwys = allocateRunways(airport, wx || {});
  let annotated = annotateAircraft(live, airport, baseRwys, {}, priorFn);
  const observed = inferActiveArrivals(annotated, airport);
  const rwys = observed.size ? allocateRunways(airport, wx || {}, observed) : baseRwys;
  if (observed.size) annotated = annotateAircraft(live, airport, rwys, {}, priorFn);
  const arrEnds = rwys.filter((r) => r.role.includes('ARR')).map((r) => r.activeEnd);
  const depEnds = rwys.filter((r) => r.role.includes('DEP')).map((r) => r.activeEnd);

  const inboundCount = annotated.filter((a) => a.phase === 'ARRIVAL' || a.phase === 'APPROACH' || a.phase === 'FINAL').length;
  const sectorCount = annotated.length;
  const byId = new Map(annotated.map((a) => [a.id, a]));
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

  // Build the batch with no duplicate primary keys.
  const stmts = [];
  for (const entry of landingEntries) stmts.push(recordLandingStmt(env.DB, entry));
  for (const s of samples) stmts.push(recordSampleStmt(env.DB, s));
  for (const [cat, d] of statDelta) stmts.push(bumpStatsStmt(env.DB, icao, cat, d.n, d.correct));
  for (const id of openDeletes) { openUpserts.delete(id); stmts.push(deleteOpenStmt(env.DB, id)); }
  for (const rec of openUpserts.values()) stmts.push(upsertOpenStmt(env.DB, icao, rec));
  stmts.push(saveModelStmt(env.DB, model));

  if (stmts.length) await env.DB.batch(stmts);
  return { icao, graded, locked, samples: samples.length, tracked: annotated.length };
}

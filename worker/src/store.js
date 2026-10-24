// D1 persistence for the always-on tracker.
import { CATEGORIES } from '../../src/engine/grading.js';
import { updateEtaBias, etaBiasFrom } from '../../src/engine/etaModel.js';

export async function loadModel(db, icao) {
  const row = await db.prepare('SELECT * FROM model WHERE icao=?').bind(icao).first();
  if (!row) return { icao, rwy: {}, eta: { ema: 0, n: 0 }, landings: 0, samples: 0 };
  return {
    icao,
    rwy: JSON.parse(row.rwy_json || '{}'),
    eta: { ema: row.eta_ema, n: row.eta_n },
    landings: row.landings,
    // Running per-airport training-row counter, so the scorecard never has to
    // COUNT(*) the (large, ever-growing) samples table. See migration 003.
    samples: row.samples || 0,
  };
}

export function saveModelStmt(db, m) {
  return db.prepare(
    `INSERT INTO model (icao, rwy_json, eta_ema, eta_n, landings, samples, updated_ts)
     VALUES (?1,?2,?3,?4,?5,?6,?7)
     ON CONFLICT(icao) DO UPDATE SET rwy_json=?2, eta_ema=?3, eta_n=?4, landings=?5, samples=?6, updated_ts=?7`
  ).bind(m.icao, JSON.stringify(m.rwy), m.eta.ema, m.eta.n, m.landings, m.samples || 0, Date.now());
}

// Learned model params for the frontend (so the live console uses global priors),
// plus each hub's observed departure flow so a fresh console knows which
// runways are launching traffic without waiting to see a climb-out itself.
export async function getModels(db) {
  const { results } = await db.prepare('SELECT icao, rwy_json, eta_ema, eta_n, landings FROM model').all();
  const out = {};
  for (const r of results) {
    out[r.icao] = { rwy: JSON.parse(r.rwy_json || '{}'), eta: { ema: r.eta_ema, n: r.eta_n }, landings: r.landings };
  }
  const cfgs = (await db.prepare("SELECT icao, data_json FROM state WHERE icao LIKE 'cfg:%'").all()).results;
  for (const c of cfgs) {
    const icao = c.icao.slice(4);
    try {
      const cfg = JSON.parse(c.data_json);
      if (out[icao] && Array.isArray(cfg.dep)) out[icao].depFlow = cfg.dep;
    } catch { /* ignore a bad row */ }
  }
  return out;
}

// Learned P(end | octant), smoothed — mirrors src/engine/learning.js.
export function priorFromModel(model) {
  return (_icao, oct, end) => {
    const bucket = model.rwy[oct];
    if (!bucket) return 0;
    const total = Object.values(bucket).reduce((a, b) => a + b, 0);
    if (total < 2) return 0;
    return (bucket[end] || 0) / (total + 2);
  };
}

// Per-octant memory: once a bucket passes this many landings its counts halve,
// so the prior tracks the last few hundred landings from that direction rather
// than every landing ever — seasonal configurations and new habits win out
// instead of being outvoted by months of old data.
const PRIOR_CAP = 400;

export function recordLandingIntoModel(model, oct, end, etaErrSec) {
  if (end != null) {
    const b = (model.rwy[oct] = model.rwy[oct] || {});
    b[end] = (b[end] || 0) + 1;
    if (Object.values(b).reduce((x, y) => x + y, 0) > PRIOR_CAP) {
      for (const e of Object.keys(b)) {
        b[e] = Math.floor(b[e] / 2);
        if (!b[e]) delete b[e];
      }
    }
  }
  updateEtaBias(model.eta, etaErrSec); // robust online bias — see etaModel.js
  model.landings += 1;
}

export function etaBiasSec(model) {
  return etaBiasFrom(model.eta);
}

// ---- open (locked, not yet graded) predictions ------------------------------
// All of an airport's open predictions live in ONE row of the state table
// (`open:<icao>`, JSON { arr: {id: rec}, dep: {id: rec} }), written at most once
// per tick. They used to be one D1 row each, refreshed every few minutes —
// ~63k rows written a day, which on 2026-10-24 pushed the account past D1's
// free 100k/day write limit and stopped the tracker until midnight UTC.
// Returns { state, raw } (raw = the stored JSON, to skip unchanged writes).
export async function loadOpenState(db, icao) {
  const row = await db.prepare('SELECT data_json FROM state WHERE icao=?').bind(`open:${icao}`).first();
  if (!row) return null;
  try { return { state: JSON.parse(row.data_json), raw: row.data_json }; } catch { return null; }
}

export function saveOpenStateStmt(db, icao, json) {
  return db.prepare(
    `INSERT INTO state (icao, data_json, updated_ts) VALUES (?1,?2,?3)
     ON CONFLICT(icao) DO UPDATE SET data_json=?2, updated_ts=?3`
  ).bind(`open:${icao}`, json, Date.now());
}

// One-time migration: the old per-row predictions for this airport.
export function clearLegacyOpenStmt(db, icao) {
  return db.prepare('DELETE FROM predictions WHERE icao=?').bind(icao);
}

export async function loadOpen(db, icao) {
  const { results } = await db.prepare('SELECT * FROM predictions WHERE icao=?').bind(icao).all();
  const map = new Map();
  for (const r of results) {
    map.set(r.id, {
      id: r.id, callsign: r.callsign, lockTs: r.lock_ts, lockOct: r.lock_oct,
      predRunway: r.pred_runway, rawEtaTs: r.raw_eta_ts, predEtaTs: r.pred_eta_ts,
      lastSeen: r.last_seen, sample: r.sample_json ? JSON.parse(r.sample_json) : null,
      features: r.features_json ? JSON.parse(r.features_json) : null,
    });
  }
  return map;
}


// Append one labeled training row.
export function recordSampleStmt(db, s) {
  return db.prepare(
    `INSERT INTO samples (icao, iata, ts, callsign, actual_runway, runway_ok, eta_err_sec, features_json, outcome_json)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(s.icao, s.iata, s.ts, s.callsign, s.actualRunway, s.runwayOk ? 1 : 0, s.etaErrSec,
    JSON.stringify(s.features || {}), JSON.stringify(s.outcome || {}));
}

// Sticky observed runway configuration, kept in the state table.
export async function loadConfig(db, icao) {
  const row = await db.prepare('SELECT data_json FROM state WHERE icao=?').bind(`cfg:${icao}`).first();
  if (!row) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}

export function saveConfigStmt(db, icao, cfg) {
  return db.prepare(
    `INSERT INTO state (icao, data_json, updated_ts) VALUES (?1,?2,?3)
     ON CONFLICT(icao) DO UPDATE SET data_json=?2, updated_ts=?3`
  ).bind(`cfg:${icao}`, JSON.stringify(cfg), Date.now());
}

export async function datasetCount(db) {
  // samples.id is AUTOINCREMENT and rows are never deleted, so MAX(id) == total
  // rows but reads a single index entry instead of scanning the whole table.
  const row = await db.prepare('SELECT MAX(id) k FROM samples').first();
  return row?.k || 0;
}

// Landings graded in the last hour at this airport (a live arrival-rate feature).
export async function arrRate1h(db, icao, now) {
  const row = await db.prepare('SELECT COUNT(*) k FROM samples WHERE icao=? AND ts > ?')
    .bind(icao, now - 3600000).first();
  return row?.k || 0;
}

// Stream the training set as JSONL: one flat object per graded landing, newest
// first. Pages walk back through the whole history by row id: pass the
// smallest `id` of one page as `before` for the next (a primary-key range, so a
// page reads only its own rows). Returns { rows, nextBefore }.
export async function datasetRows(db, icao, limit, before = null) {
  const cursor = before && before > 0 ? before : Number.MAX_SAFE_INTEGER;
  const q = icao
    ? db.prepare('SELECT * FROM samples WHERE icao=? AND id<? ORDER BY id DESC LIMIT ?').bind(icao, cursor, limit)
    : db.prepare('SELECT * FROM samples WHERE id<? ORDER BY id DESC LIMIT ?').bind(cursor, limit);
  const { results } = await q.all();
  const rows = results.map((r) => JSON.stringify({
    id: r.id, icao: r.icao, iata: r.iata, ts: r.ts, callsign: r.callsign,
    ...JSON.parse(r.features_json),
    ...JSON.parse(r.outcome_json),
  }));
  const nextBefore = results.length === limit ? results[results.length - 1].id : null;
  return { rows, nextBefore };
}

// Tracker heartbeat: the outcome of the last cron tick per hub, kept as one
// small row so /api/health can report data freshness (and a free uptime
// monitor can alert on a stalled feed instead of it going unnoticed).
const TICK_KEY = 'tick:last';

export async function loadTickState(db) {
  const row = await db.prepare('SELECT data_json FROM state WHERE icao=?').bind(TICK_KEY).first();
  if (!row) return null;
  try { return JSON.parse(row.data_json); } catch { return null; }
}

export function saveTickStmt(db, tick) {
  return saveStateStmt(db, TICK_KEY, tick);
}

// Generic small JSON rows in the state table (heartbeat, alert state).
export const ALERT_KEY = 'alert:state';

export async function loadStates(db, keys) {
  const marks = keys.map((_, i) => `?${i + 1}`).join(',');
  const { results } = await db.prepare(`SELECT icao, data_json FROM state WHERE icao IN (${marks})`).bind(...keys).all();
  const out = {};
  for (const r of results) {
    try { out[r.icao] = JSON.parse(r.data_json); } catch { /* ignore a bad row */ }
  }
  return out;
}

export function saveStateStmt(db, key, obj) {
  return db.prepare(
    `INSERT INTO state (icao, data_json, updated_ts) VALUES (?1,?2,?3)
     ON CONFLICT(icao) DO UPDATE SET data_json=?2, updated_ts=?3`
  ).bind(key, JSON.stringify(obj), Date.now());
}

export function recordLandingStmt(db, entry) {
  const correct = entry.items.filter((i) => i.ok).length;
  return db.prepare(
    'INSERT INTO landings (icao, iata, ts, callsign, items_json, correct, total) VALUES (?1,?2,?3,?4,?5,?6,?7)'
  ).bind(entry.icao, entry.iata, entry.ts, entry.callsign, JSON.stringify(entry.items), correct, entry.items.length);
}

// One additive upsert per (icao, cat). Callers must aggregate deltas first so a
// batch never contains two writes to the same stats row (that trips D1).
export function bumpStatsStmt(db, icao, cat, dn, dc) {
  return db.prepare(
    `INSERT INTO stats (icao, cat, n, correct) VALUES (?1,?2,?3,?4)
     ON CONFLICT(icao, cat) DO UPDATE SET n=n+?3, correct=correct+?4`
  ).bind(icao, cat, dn, dc);
}

// Global scorecard for the API (one airport or all).
export async function getScorecard(db, icao) {
  const statsRows = icao
    ? (await db.prepare('SELECT cat, SUM(n) n, SUM(correct) c FROM stats WHERE icao=? GROUP BY cat').bind(icao).all()).results
    : (await db.prepare('SELECT cat, SUM(n) n, SUM(correct) c FROM stats GROUP BY cat').all()).results;

  const byCat = {};
  let totalN = 0, totalC = 0;
  for (const [cat, label] of CATEGORIES) {
    const row = statsRows.find((r) => r.cat === cat);
    const n = row ? row.n : 0, c = row ? row.c : 0;
    byCat[cat] = { label, n, pct: n ? Math.round((c / n) * 100) : null };
    totalN += n; totalC += c;
  }

  // Open predictions now live in one JSON row per hub; each tick's heartbeat
  // records how many there are, so read the count from there.
  const tick = await loadTickState(db);
  const hubs = tick?.hubs || {};
  const counted = Object.values(hubs).filter((h) => typeof h?.open === 'number');
  let openCount = icao ? hubs[icao]?.open : (counted.length ? counted.reduce((a, h) => a + h.open, 0) : undefined);
  if (typeof openCount !== 'number') {
    // Heartbeat from before the one-row change: count the legacy rows.
    const row = icao
      ? await db.prepare('SELECT COUNT(*) k FROM predictions WHERE icao=?').bind(icao).first()
      : await db.prepare('SELECT COUNT(*) k FROM predictions').first();
    openCount = row?.k || 0;
  }

  // Pull landings + the training-row count from the tiny model table (one row per
  // hub) so the scorecard never scans the large samples table on the hot path.
  // Defensive: if migration 003 (the model.samples column) hasn't been applied
  // yet, fall back to a cheap MAX(id) so the scorecard still serves rather than
  // 500-ing the homepage.
  let learned = 0, sampleTotal = 0;
  try {
    const m = icao
      ? await db.prepare('SELECT SUM(landings) l, SUM(samples) s FROM model WHERE icao=?').bind(icao).first()
      : await db.prepare('SELECT SUM(landings) l, SUM(samples) s FROM model').first();
    learned = m?.l || 0; sampleTotal = m?.s || 0;
  } catch {
    const m = icao
      ? await db.prepare('SELECT SUM(landings) l FROM model WHERE icao=?').bind(icao).first()
      : await db.prepare('SELECT SUM(landings) l FROM model').first();
    learned = m?.l || 0;
    const sc = await db.prepare('SELECT MAX(id) k FROM samples').first();
    sampleTotal = sc?.k || 0;
  }

  const recentRows = icao
    ? (await db.prepare('SELECT * FROM landings WHERE icao=? ORDER BY ts DESC LIMIT 20').bind(icao).all()).results
    : (await db.prepare('SELECT * FROM landings ORDER BY ts DESC LIMIT 20').all()).results;


  // Trailing-24h accuracy — shows current model quality without the drag of
  // months of historical grades in the all-time number.
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const r24 = icao
    ? await db.prepare('SELECT SUM(correct) c, SUM(total) t FROM landings WHERE icao=? AND ts>?').bind(icao, dayAgo).first()
    : await db.prepare('SELECT SUM(correct) c, SUM(total) t FROM landings WHERE ts>?').bind(dayAgo).first();

  return {
    allTime: { n: totalN, pct: totalN ? Math.round((totalC / totalN) * 100) : null, byCat },
    openCount,
    learned,
    samples: sampleTotal,
    recent24: r24 && r24.t ? { n: r24.t, pct: Math.round((r24.c / r24.t) * 100) } : null,
    recent: recentRows.map((r) => ({
      ts: r.ts, callsign: r.callsign, airport: r.iata, live: true, items: JSON.parse(r.items_json),
    })),
  };
}

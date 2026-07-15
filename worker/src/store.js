// D1 persistence for the always-on tracker.
import { CATEGORIES } from '../../src/engine/grading.js';

export async function loadModel(db, icao) {
  const row = await db.prepare('SELECT * FROM model WHERE icao=?').bind(icao).first();
  if (!row) return { icao, rwy: {}, eta: { ema: 0, n: 0 }, landings: 0 };
  return {
    icao,
    rwy: JSON.parse(row.rwy_json || '{}'),
    eta: { ema: row.eta_ema, n: row.eta_n },
    landings: row.landings,
  };
}

export function saveModelStmt(db, m) {
  return db.prepare(
    `INSERT INTO model (icao, rwy_json, eta_ema, eta_n, landings, updated_ts)
     VALUES (?1,?2,?3,?4,?5,?6)
     ON CONFLICT(icao) DO UPDATE SET rwy_json=?2, eta_ema=?3, eta_n=?4, landings=?5, updated_ts=?6`
  ).bind(m.icao, JSON.stringify(m.rwy), m.eta.ema, m.eta.n, m.landings, Date.now());
}

// Learned model params for the frontend (so the live console uses global priors).
export async function getModels(db) {
  const { results } = await db.prepare('SELECT icao, rwy_json, eta_ema, eta_n, landings FROM model').all();
  const out = {};
  for (const r of results) {
    out[r.icao] = { rwy: JSON.parse(r.rwy_json || '{}'), eta: { ema: r.eta_ema, n: r.eta_n }, landings: r.landings };
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

export function recordLandingIntoModel(model, oct, end, etaErrSec) {
  if (end != null) {
    model.rwy[oct] = model.rwy[oct] || {};
    model.rwy[oct][end] = (model.rwy[oct][end] || 0) + 1;
  }
  model.eta.ema = model.eta.n === 0 ? etaErrSec : model.eta.ema * 0.75 + etaErrSec * 0.25;
  model.eta.n += 1;
  model.landings += 1;
}

export function etaBiasSec(model) {
  return model.eta.n >= 3 ? Math.max(-240, Math.min(240, model.eta.ema)) : 0;
}

export async function loadOpen(db, icao) {
  const { results } = await db.prepare('SELECT * FROM predictions WHERE icao=?').bind(icao).all();
  const map = new Map();
  for (const r of results) {
    map.set(r.id, {
      id: r.id, callsign: r.callsign, lockTs: r.lock_ts, lockOct: r.lock_oct,
      predRunway: r.pred_runway, rawEtaTs: r.raw_eta_ts, predEtaTs: r.pred_eta_ts,
      lastSeen: r.last_seen, sample: r.sample_json ? JSON.parse(r.sample_json) : null,
    });
  }
  return map;
}

export function upsertOpenStmt(db, icao, o) {
  return db.prepare(
    `INSERT INTO predictions (id, icao, callsign, lock_ts, lock_oct, pred_runway, raw_eta_ts, pred_eta_ts, last_seen, sample_json)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
     ON CONFLICT(id) DO UPDATE SET last_seen=?9, sample_json=?10`
  ).bind(o.id, icao, o.callsign, o.lockTs, o.lockOct, o.predRunway, o.rawEtaTs, o.predEtaTs, o.lastSeen, o.sample ? JSON.stringify(o.sample) : null);
}

export function deleteOpenStmt(db, id) {
  return db.prepare('DELETE FROM predictions WHERE id=?').bind(id);
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

  const openRow = icao
    ? await db.prepare('SELECT COUNT(*) k FROM predictions WHERE icao=?').bind(icao).first()
    : await db.prepare('SELECT COUNT(*) k FROM predictions').first();

  const modelRow = icao
    ? await db.prepare('SELECT SUM(landings) l FROM model WHERE icao=?').bind(icao).first()
    : await db.prepare('SELECT SUM(landings) l FROM model').first();

  const recentRows = icao
    ? (await db.prepare('SELECT * FROM landings WHERE icao=? ORDER BY ts DESC LIMIT 20').bind(icao).all()).results
    : (await db.prepare('SELECT * FROM landings ORDER BY ts DESC LIMIT 20').all()).results;

  return {
    allTime: { n: totalN, pct: totalN ? Math.round((totalC / totalN) * 100) : null, byCat },
    openCount: openRow?.k || 0,
    learned: modelRow?.l || 0,
    recent: recentRows.map((r) => ({
      ts: r.ts, callsign: r.callsign, airport: r.iata, live: true, items: JSON.parse(r.items_json),
    })),
  };
}

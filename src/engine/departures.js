// Departure-runway prediction, shared by the 24/7 tracker and the browser.
//
// A flight is locked onto a departure runway when it starts to taxi and graded
// when it climbs out (atc.js departureEnd). The old plan dealt departures
// round-robin across every runway the wind allocator hadn't given to arrivals —
// at JFK in south-west flow that meant 22R plus both crossing runways, so it was
// right 26% of the time. Replayed over 18,880 graded departures (Jul–Oct 2026)
// with an honest 25-minute taxi lag, simply following the observed departure
// flow scores JFK 81%, Heathrow 89%, LAX 43% (LAX runs two departure runways at
// once, so position on the field has to pick between them).
//
// Three predictors ("experts") name a runway for every taxiing flight:
//   flow    — the departure runway the airport is actually using (recent
//             climb-outs, recency-weighted, 45-minute window)
//   near    — of the runways in use, the one whose strip is nearest the flight
//             (north vs south complex at LAX)
//   learned — of the runways in use, the one flights starting from this spot on
//             the field have actually used (counts per 0.3-nm cell)
// Each graded departure scores every expert that made a call. The live
// prediction comes from the expert with the best recent accuracy in the same
// situation at that airport, so the choice keeps up with configuration and
// seasonal changes without anyone re-tuning it.

import { toLocalNm } from '../lib/geo.js';
import { stripOffsets, departureEnd } from './atc.js';

export const FLOW_WINDOW_MS = 45 * 60 * 1000;
const FLOW_HALF_LIFE_MS = 20 * 60 * 1000;
const FLOW_MAX = 80;
const CELL_NM = 0.3;
const CELL_CAP = 60;      // per-cell memory: counts halve past this (forgets old habits)
const DECAY = 0.99;       // expert scores: ~100-departure memory per situation
const MIN_EVIDENCE = 25;  // graded calls before an expert can take over the default
const SWITCH_MARGIN = 0.02;
const NM_PER_FT = 1 / 6076.12;
export const EXPERTS = ['flow', 'learned', 'near']; // default priority, best first

// ------------------------------------------------------------ observed flow ---

// Add this tick's climb-outs to the flow log ([id, end, ts] tuples, compact so
// the tracker can persist it) and drop entries older than the window.
export function observeDepartures(flow, annotated, airport, now) {
  const kept = (flow || []).filter((f) => now - f[2] <= FLOW_WINDOW_MS);
  const seen = new Set(kept.map((f) => f[0]));
  let added = 0;
  for (const a of annotated) {
    if (a.phase !== 'DEPARTURE' || seen.has(a.id)) continue;
    const end = departureEnd(a, airport);
    if (end) { kept.push([a.id, end, now]); seen.add(a.id); added++; }
  }
  return { flow: kept.slice(-FLOW_MAX), added };
}

// Recency-weighted use of each departure runway end in the window.
export function flowWeights(flow, now) {
  const w = new Map();
  for (const [, end, ts] of flow || []) {
    const age = now - ts;
    if (age < 0 || age > FLOW_WINDOW_MS) continue;
    w.set(end, (w.get(end) || 0) + 0.5 ** (age / FLOW_HALF_LIFE_MS));
  }
  return w;
}

// ----------------------------------------------------------------- geometry ---

const thrCache = new Map();

// Start-of-takeoff-roll point for each runway end, in local nm from the field
// reference (runway midpoints come from OurAirports thresholds), with the far
// end so the strip itself can be measured against.
export function thresholds(airport) {
  let m = thrCache.get(airport.icao);
  if (m) return m;
  m = new Map();
  const offsets = stripOffsets(airport);
  for (const rwy of airport.runways) {
    const mid = offsets.get(rwy.id) || { offX: 0, offY: 0 };
    const half = (rwy.lenFt * NM_PER_FT) / 2;
    const pts = rwy.ends.map((_, e) => {
      const h = ((rwy.trueHdg + e * 180) % 360) * (Math.PI / 180);
      return { x: mid.offX - half * Math.sin(h), y: mid.offY - half * Math.cos(h) };
    });
    rwy.ends.forEach((end, e) => m.set(end, { ...pts[e], far: pts[1 - e] }));
  }
  thrCache.set(airport.icao, m);
  return m;
}

// Distance from p to the runway strip (segment threshold→far end), plus a small
// pull toward the threshold so two ends of one strip aren't a tie.
function stripDist(p, t) {
  const dx = t.far.x - t.x, dy = t.far.y - t.y;
  const len2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - t.x) * dx + (p.y - t.y) * dy) / len2));
  return Math.hypot(p.x - (t.x + u * dx), p.y - (t.y + u * dy)) + 0.02 * Math.hypot(p.x - t.x, p.y - t.y);
}

export function cellOf(ac, airport) {
  const p = toLocalNm(airport.lat, airport.lon, ac.lat, ac.lon);
  return `${Math.round(p.x / CELL_NM)},${Math.round(p.y / CELL_NM)}`;
}

// ------------------------------------------------------------------ experts ---

export function emptyDepModel() {
  return { experts: {}, cells: {} };
}

// The situation an expert is judged in: whether the departure flow was known
// and whether the learned cell had an opinion. Experts are only ever compared
// on the same kind of call.
function contextKey(hasFlow, hasLearned) {
  return `${hasFlow ? 'F' : '-'}${hasLearned ? 'L' : '-'}`;
}

function argBest(cands, score) {
  let best = null, bestS = -Infinity;
  for (const c of cands) {
    const s = score(c);
    if (s > bestS) { best = c; bestS = s; }
  }
  return best;
}

// Returns a planner (ac, runways) -> { end, by, picks, ctx, cell } | null.
// `weights` is flowWeights(); `depModel` the learned state (may be null).
export function makeDeparturePlanner(airport, weights, depModel) {
  const thr = thresholds(airport);
  const flowEnds = [...(weights || new Map()).keys()];
  return (ac, runways) => {
    const cands = flowEnds.length
      ? flowEnds
      : runways.filter((r) => r.role.includes('DEP')).map((r) => r.activeEnd);
    if (!cands.length) return null;
    const p = toLocalNm(airport.lat, airport.lon, ac.lat, ac.lon);
    const dist = (e) => {
      const t = thr.get(e);
      return t ? stripDist(p, t) : 99;
    };
    const near = argBest(cands, (e) => -dist(e));
    // Weight first; nearest breaks a tie.
    const flow = flowEnds.length ? argBest(cands, (e) => (weights.get(e) || 0) * 1000 - dist(e)) : null;
    const cell = cellOf(ac, airport);
    const bucket = depModel?.cells?.[cell];
    let learned = null;
    if (bucket) {
      const total = cands.reduce((s, e) => s + (bucket[e] || 0), 0);
      if (total >= 3) learned = argBest(cands, (e) => (bucket[e] || 0) * 1000 - dist(e));
    }
    const picks = { flow, learned, near };
    const ctx = contextKey(!!flow, !!learned);
    const by = chooseExpert(picks, depModel?.experts?.[ctx]);
    return { end: picks[by], by, picks, ctx, cell };
  };
}

// Default priority until an alternative has proven itself better on enough
// graded calls in this situation.
export function chooseExpert(picks, scores) {
  const avail = EXPERTS.filter((k) => picks[k]);
  if (!avail.length) return null;
  const acc = (k) => {
    const s = scores?.[k];
    return s && s.n >= MIN_EVIDENCE ? s.ok / s.n : null;
  };
  let best = avail[0];
  for (const k of avail.slice(1)) {
    const a = acc(k), b = acc(best);
    if (a != null && b != null && a > b + SWITCH_MARGIN) best = k;
  }
  return best;
}

// Learn from one graded departure: score every expert that made a call (in the
// situation it was made in) and count the runway used from that cell.
export function learnDeparture(depModel, plan, actual) {
  if (!depModel || !plan?.picks || !actual) return;
  const ctx = (depModel.experts[plan.ctx] = depModel.experts[plan.ctx] || {});
  for (const k of EXPERTS) {
    const pick = plan.picks[k];
    if (!pick) continue;
    const s = ctx[k] || { n: 0, ok: 0 };
    s.n = s.n * DECAY + 1;
    s.ok = s.ok * DECAY + (pick === actual ? 1 : 0);
    s.n = +s.n.toFixed(3); s.ok = +s.ok.toFixed(3);
    ctx[k] = s;
  }
  if (plan.cell) {
    const b = (depModel.cells[plan.cell] = depModel.cells[plan.cell] || {});
    b[actual] = (b[actual] || 0) + 1;
    const total = Object.values(b).reduce((x, y) => x + y, 0);
    if (total > CELL_CAP) {
      for (const e of Object.keys(b)) {
        b[e] = Math.floor(b[e] / 2);
        if (!b[e]) delete b[e];
      }
    }
  }
}

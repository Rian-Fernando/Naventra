// Learned airspace: which parts of the sky around an airport feed ITS runways.
//
// Geometry (neighbors.js) recognises another airport's traffic once it is on
// that airport's final or lifting off its runway. Before that — on a downwind
// leg past JFK, or being vectored at 3,000 ft — a LaGuardia arrival looks like
// any other inbound. But terminal traffic flows are fixed. In a backtest over
// the tracker's history (trained on the weeks before 6 Nov 2026, tested on the
// two weeks after), 92% of the flights it had locked as JFK arrivals that then
// landed elsewhere were, at the moment of lock, in a part of the sky where at
// most 3% of locked flights had ever landed at JFK — and only 0.09% of JFK's
// own arrivals were. (LAX: 81% / 0.05%.)
//
// So the tracker counts, per region — 30° of bearing × 4 nm × 1,500 ft — where
// the flights it followed through that region actually came down, and while a
// flight is in a region that almost never feeds this airport's runways it is
// left out of the arrival sequence. Every region a flight passes through on its
// way in counts (not just where it was first locked): the exclusion applies
// wherever a flight is, so the statistic has to describe the same thing.
//
// It keeps itself honest twice over:
//   - flights left out are still locked and followed to touchdown, so a region
//     that starts feeding our runways (a configuration change) is back in the
//     sequence after a couple of landings;
//   - every lock is scored on whether it would have been left out, and the
//     exclusion only switches on while fewer than 1 in 200 of the flights that
//     really landed here would have been.

export const OWN_MIN_N = 30;        // locks seen in a region before it can exclude
export const OWN_MAX_HOME = 0.03;   // …and at most this share of them landed here
export const OWN_GATE_MIN = 100;    // landings here scored before the switch can turn on
export const OWN_GATE_MAX = 0.005;  // …and at most this share of them would have been left out
const CELL_CAP = 300;               // per-region memory: counts halve past this
const GATE_CAP = 2000;              // gate memory: the last couple of thousand outcomes

const r2 = (x) => Math.round(x * 100) / 100;

// The grid it learns on: 30° of bearing from the field × 4 nm × 1,500 ft. Coarse
// enough that each region a flow passes through fills up within a day or two;
// fine enough to keep LaGuardia's downwind leg apart from JFK's own arrivals.
export function regionKey(brgFromField, distNm, aglFt) {
  const s = Math.floor((((brgFromField % 360) + 360) % 360) / 30);   // 0–11
  const d = Math.min(Math.floor(Math.max(0, distNm) / 4), 6);        // 0–6 (24 nm+)
  const a = Math.min(Math.floor(Math.max(0, aglFt) / 1500), 5);      // 0–5 (7,500 ft+)
  return `${s}.${d}.${a}`;
}

// Region of a lock from its recorded features (worker/src/features.js).
export function regionOfFeatures(f) {
  if (!f || f.brg == null || f.dist_nm == null) return null;
  return regionKey(f.brg, f.dist_nm, f.agl_ft ?? 0);
}

export function emptyOwn() {
  // cells: region → [landed here, landed elsewhere, { icao: count }]
  // gate: outcomes of every lock, split by whether it fell in an excluding region
  return { cells: {}, gate: { here: 0, hereEx: 0, away: 0, awayEx: 0 } };
}

// What one region says right now: null unless it has the evidence to exclude.
export function ownVerdict(own, key) {
  const c = own?.cells?.[key];
  if (!c) return null;
  const n = c[0] + c[1];
  if (n < OWN_MIN_N || c[0] / n > OWN_MAX_HOME) return null;
  let guess = null, best = 0;
  for (const [icao, k] of Object.entries(c[2] || {})) if (k > best) { best = k; guess = icao; }
  return { pHere: r2(c[0] / n), n: Math.round(n), guess: best >= 0.6 * c[1] ? guess : null };
}

// Is the exclusion switched on? Only while it has scored itself on enough
// landings here and almost none of them would have been left out.
export function ownEnabled(own) {
  const g = own?.gate;
  return !!g && g.here >= OWN_GATE_MIN && g.hereEx / g.here <= OWN_GATE_MAX;
}

// Learn from one followed flight's outcome. `keys`: the regions it passed
// through on its way in; `landedAt`: 'here', the ICAO of the airport it was
// seen at, or null (came down somewhere we couldn't name); `excluded`: whether
// it was in a region that would have left it out at any point.
// Every outcome is scored, even a flight that only ever flew our own final (no
// regions): the switch is judged on all landings here.
export function learnOwn(own, keys, landedAt, excluded) {
  if (!own) return;
  const list = [...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))];
  const here = landedAt === 'here';
  const g = own.gate || (own.gate = { here: 0, hereEx: 0, away: 0, awayEx: 0 });
  if (here) { g.here += 1; if (excluded) g.hereEx += 1; } else { g.away += 1; if (excluded) g.awayEx += 1; }
  if (g.here + g.away > GATE_CAP) for (const k of Object.keys(g)) g[k] = r2(g[k] / 2);
  for (const key of list) {
    const c = (own.cells[key] = own.cells[key] || [0, 0, {}]);
    if (here) c[0] += 1;
    else { c[1] += 1; if (landedAt) c[2][landedAt] = (c[2][landedAt] || 0) + 1; }
    if (c[0] + c[1] > CELL_CAP) {
      c[0] = r2(c[0] / 2); c[1] = r2(c[1] / 2);
      for (const k of Object.keys(c[2])) c[2][k] = r2(c[2][k] / 2);
    }
  }
}

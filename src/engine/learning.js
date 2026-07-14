// Online learning from graded outcomes. Every verified LIVE landing feeds
// back into the predictor, so Naventra measurably improves with watch time:
//
//  - Runway priors: P(runway end | approach octant), Laplace-smoothed counts
//    learned per airport. Blended into the geometric runway score, they encode
//    the facility's habits (e.g. "traffic from the north-east usually gets
//    22L") that pure geometry can't see from 16nm out.
//  - ETA bias: an exponential moving average of signed touchdown-time error,
//    subtracted from future ETA locks (systematic under/over-estimation of
//    approach time is airport-specific).
//
// Everything is stored locally (localStorage) — no external model, no API.

const KEY = 'nv-learning-v1';
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* denied/full */ }
}

function apStats(icao) {
  const db = load();
  if (!db[icao]) db[icao] = { rwy: {}, eta: { ema: 0, n: 0 }, landings: 0 };
  return db[icao];
}

// Approach direction bucketed into 8 sectors (N, NE, E, …).
export function octantOf(brgFromField) {
  return Math.floor((((brgFromField % 360) + 360) % 360 + 22.5) / 45) % 8;
}

// Smoothed P(end | octant) in [0, 1]; 0 when nothing learned yet.
export function runwayPrior(icao, oct, end) {
  const bucket = apStats(icao).rwy[oct];
  if (!bucket) return 0;
  const total = Object.values(bucket).reduce((a, b) => a + b, 0);
  if (total < 2) return 0; // too little evidence to bias the geometry
  return (bucket[end] || 0) / (total + 2);
}

export function recordLanding(icao, oct, end) {
  const s = apStats(icao);
  s.rwy[oct] = s.rwy[oct] || {};
  s.rwy[oct][end] = (s.rwy[oct][end] || 0) + 1;
  s.landings++;
  save();
}

export function recordEtaError(icao, errSec) {
  const e = apStats(icao).eta;
  e.ema = e.n === 0 ? errSec : e.ema * 0.75 + errSec * 0.25;
  e.n++;
  save();
}

// Correction (seconds) to add to raw ETA estimates; engages after 3 samples.
export function etaBiasSec(icao) {
  const e = apStats(icao).eta;
  return e.n >= 3 ? Math.max(-240, Math.min(240, e.ema)) : 0;
}

export function learnedLandings(icao) {
  return apStats(icao).landings;
}

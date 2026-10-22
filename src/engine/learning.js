// Online learning from graded outcomes. Every verified LIVE landing feeds
// back into the predictor, so Naventra measurably improves with watch time:
//
//  - Runway priors: P(runway end | approach octant), Laplace-smoothed counts
//    learned per airport. Blended into the geometric runway score, they encode
//    the facility's habits (e.g. "traffic from the north-east usually gets
//    22L") that pure geometry can't see from 16nm out.
//  - ETA bias: a robust moving average of signed touchdown-time error (each
//    error clipped to ±120 s first), added to future ETA locks — systematic
//    under/over-estimation of approach time is airport-specific.
//
// Everything is stored locally (localStorage) — no external model, no API.

import { octantOf } from './octant.js';
import { updateEtaBias, etaBiasFrom } from './etaModel.js';
export { octantOf };

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

// Same robust online bias as the 24/7 tracker (clipped errors, slow average).
export function recordEtaError(icao, errSec) {
  updateEtaBias(apStats(icao).eta, errSec);
  save();
}

// Correction (seconds) to add to raw ETA estimates; engages after 3 samples.
export function etaBiasSec(icao) {
  return etaBiasFrom(apStats(icao).eta);
}

export function learnedLandings(icao) {
  return apStats(icao).landings;
}

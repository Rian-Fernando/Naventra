// Serving side of the trained touchdown-ETA model (scripts/train_model.py). Pure
// functions — the model JSON is imported at the call sites (browser + worker), so
// this file has no import assertion issues and stays unit-testable.
//
// The engine's straight-line ETA lands early (flights hold / get vectored). The
// model predicts that error in seconds from lock-time features; we add it to the
// raw ETA to get the graded prediction, while STILL recording the raw error for
// training — so retraining always sees the full bias and the correction can't
// oscillate to zero.

// MUST mirror scripts/train_model.py::eta_feat exactly (same order & scaling).
export function etaVec(f) {
  const g = (v) => (v == null ? 0 : Number(v));
  const hl = g(f.hour_local) * Math.PI / 12;
  return [
    g(f.dist_nm) / 16, g(f.gs_kt) / 200, g(f.head_kt) / 20, g(f.arr_rate_1h) / 60,
    g(f.inbound_count) / 50, g(f.sector_count) / 200,
    (f.wake === 'H' || f.wake === 'J') ? 1 : 0,
    (f.flt_cat === 'IFR' || f.flt_cat === 'LIFR') ? 1 : 0,
    Math.sin(hl), Math.cos(hl), 1,
  ];
}

// Predicted ETA error (seconds) to ADD to the raw ETA, or null when the airport
// has no adopted ETA model (then callers fall back to the online bias). Clamped
// so one bad feature can't produce a wild prediction.
export function etaCorrectionSec(model, icao, features) {
  const e = model?.airports?.[icao]?.eta;
  if (!e || !e.adopt || !Array.isArray(e.W)) return null;
  const x = etaVec(features);
  let s = 0;
  for (let i = 0; i < x.length && i < e.W.length; i++) s += x[i] * (e.W[i] || 0);
  return Math.max(-600, Math.min(900, s));
}

// A landing this far from the raw prediction is a go-around / diversion / extreme
// hold — not a clean ETA test, so its ETA is not graded (matches training's cap).
export const ETA_OUTLIER_MS = 1800 * 1000;

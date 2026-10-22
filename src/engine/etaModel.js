// Serving side of the trained touchdown-ETA model (scripts/train_model.py). Pure
// functions — the model JSON is imported at the call sites (browser + worker), so
// this file has no import assertion issues and stays unit-testable.
//
// The engine's straight-line ETA lands early (flights hold / get vectored). The
// model predicts that error in seconds from lock-time features; we add it to the
// raw ETA to get the graded prediction, while STILL recording the raw error for
// training — so retraining always sees the full bias and the correction can't
// oscillate to zero.

// UTC day of year, 1..366 (matches Python's tm_yday on a UTC datetime).
export function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}

// MUST mirror scripts/train_model.py::eta_feat exactly (same order & scaling).
// The two season inputs come after `bias` so a model trained before they
// existed (11 weights) still lines up; the trainer keeps their weights at zero
// until the data spans about a year.
export function etaVec(f) {
  const g = (v) => (v == null ? 0 : Number(v));
  const hl = g(f.hour_local) * Math.PI / 12;
  const dy = 2 * Math.PI * (f.doy ?? dayOfYear(new Date(f.pred_eta_ts ?? Date.now()))) / 365.25;
  return [
    g(f.dist_nm) / 16, g(f.gs_kt) / 200, g(f.head_kt) / 20, g(f.arr_rate_1h) / 60,
    g(f.inbound_count) / 50, g(f.sector_count) / 200,
    (f.wake === 'H' || f.wake === 'J') ? 1 : 0,
    (f.flt_cat === 'IFR' || f.flt_cat === 'LIFR') ? 1 : 0,
    Math.sin(hl), Math.cos(hl), 1,
    Math.sin(dy), Math.cos(dy),
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

// ---- online ETA bias (used wherever no trained model is adopted) -----------
// An exponential moving average of each landing's ETA error (s), with every
// error clipped to ±ETA_BIAS_CLIP_S before it goes in. Holding patterns and long
// vectors produce errors of 10–30 min; unclipped (the old α 0.25 average), a few
// of them dragged the bias to its +240 s limit about a third of the time and the
// graded ETA did worse than no correction at all. Replaying Jul–Oct 2026, ETAs
// within ±2.5 min: old 40.7% (last 21 days) / 44.3% (summer); no correction
// 60.5% / 53.7%; this 66.0% / 57.2%. Mirrored by scripts/train_model.py.
export const ETA_BIAS_CLIP_S = 120;
export const ETA_BIAS_ALPHA = 0.1;

export function updateEtaBias(eta, errSec) {
  const x = Math.max(-ETA_BIAS_CLIP_S, Math.min(ETA_BIAS_CLIP_S, errSec));
  // A stored value outside the clip can only come from the old estimator:
  // start again from this landing instead of averaging it down slowly.
  const fresh = eta.n === 0 || Math.abs(eta.ema) > ETA_BIAS_CLIP_S;
  eta.ema = fresh ? x : eta.ema * (1 - ETA_BIAS_ALPHA) + x * ETA_BIAS_ALPHA;
  eta.n += 1;
  return eta;
}

// Correction (s) to add to a raw ETA; engages after 3 landings.
export function etaBiasFrom(eta) {
  return eta && eta.n >= 3 ? Math.max(-ETA_BIAS_CLIP_S, Math.min(ETA_BIAS_CLIP_S, eta.ema)) : 0;
}

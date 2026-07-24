// Airport Acceptance Rate (AAR) — how many arrivals per hour the field can
// accept. This is the TRACON's core capacity metric. Real AARs are declared by
// the facility; ours is a transparent physics estimate that responds correctly
// to the three things that actually move it: runway config, wake mix and weather.
//
//   rate per runway  ≈ final-approach speed ÷ mean required in-trail spacing
//   AAR              ≈ rate × effective arrival streams × weather factor
//
// A stream of heavies at 6 nm yields ~23/hr; mediums at 3 nm ~47/hr — so the
// wake mix (from engine/wake.js) directly drives capacity.

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Lowest broken/overcast layer = the ceiling (ft); missing = clear sky.
function ceilingOf(w) {
  const bases = (w?.clouds || [])
    .filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.code || c.cover))
    .map((c) => c.baseFt).filter((b) => typeof b === 'number');
  return bases.length ? Math.min(...bases) : null;
}
function visSmOf(w) {
  const s = String(w?.visib ?? '10');
  if (s.includes('+')) return 10;
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : 10; }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 10 : n;
}

// Operational approach category from ceiling + visibility — the real driver of
// capacity loss. Below CAT I, Low-Visibility Procedures protect the ILS critical
// area (wider spacing) and the acceptance rate drops sharply.
function approachCategory(ceilingFt, visSm) {
  const c = ceilingFt ?? 9999;
  const v = visSm ?? 10;
  if (c < 200 || v < 0.5) return { cat: 'CAT III', lvp: true, factor: 0.5 };
  if (c < 500 || v < 1) return { cat: 'CAT II', lvp: true, factor: 0.68 };
  if (c < 1000 || v < 3) return { cat: 'CAT I', lvp: false, factor: 0.85 };
  if (c < 3000 || v < 5) return { cat: 'MVFR', lvp: false, factor: 0.94 };
  return { cat: 'VMC', lvp: false, factor: 1.0 };
}

export function computeCapacity(annotated, runways, weather, arrHr = 0) {
  const arrRwys = runways.filter((r) => r.role.includes('ARR'));
  const nRwy = Math.max(1, arrRwys.length);
  const inbound = annotated.filter((a) => a.phase === 'ARRIVAL' || a.phase === 'APPROACH' || a.phase === 'FINAL');

  // final-approach speed from real traffic on final, else a nominal 140 kt
  const fs = annotated
    .filter((a) => (a.phase === 'FINAL' || a.phase === 'APPROACH') && a.gs > 80 && a.gs < 210)
    .map((a) => a.gs);
  const finalSpeedKt = Math.round(mean(fs) ?? 140);

  // mean required spacing from the wake mix actually inbound (followers carry
  // reqSpacingNm), else a mixed-fleet default
  const sp = inbound.map((a) => a.reqSpacingNm).filter((x) => x != null);
  const meanSpacingNm = +(mean(sp) ?? 4).toFixed(1);

  // Approach category from live ceiling + visibility drives the weather factor.
  const app = approachCategory(ceilingOf(weather), visSmOf(weather));
  const wxCat = app.cat;
  const weatherFactor = app.factor;
  // Low-visibility procedures widen final spacing (ILS sensitive-area protection).
  const effSpacingNm = Math.max(meanSpacingNm, app.lvp ? (app.cat === 'CAT III' ? 6 : 5) : 0, 2.5);

  // Additional parallel runways add capacity, but dependent/interleaved ops mean
  // it's not a clean multiple — each extra runway adds ~0.65 of a stream.
  const streams = 1 + (nRwy - 1) * 0.65;
  const perRunwayRate = finalSpeedKt / effSpacingNm;
  const aar = Math.round(streams * perRunwayRate * weatherFactor);

  // flow: recent measured landing rate vs capacity
  const utilization = aar > 0 ? arrHr / aar : 0;
  const status = utilization >= 0.9 ? 'SATURATED' : utilization >= 0.7 ? 'BUSY' : 'NOMINAL';

  // rough delay: arrivals queued beyond ~15 min of capacity have to wait
  const capacity15 = (aar / 60) * 15;
  const delayMin = inbound.length > capacity15
    ? Math.round(((inbound.length - capacity15) / Math.max(1, aar)) * 60)
    : 0;

  // Airport Departure Rate (ADR) — the same idea, time-based. Departure interval
  // comes from the wake-on-departure mix (≥60 s runway occupancy). Runways that
  // also take arrivals (DEP+ARR) share their slots, so they add only ~half a
  // departure stream.
  const depRwys = runways.filter((r) => r.role.includes('DEP'));
  const departures = annotated.filter((a) => a.phase === 'DEPARTURE');
  const gaps = departures.map((a) => a.reqDepGapSec).filter((x) => x != null);
  const meanDepGapSec = Math.round(mean(gaps) ?? 75);
  const dedicated = depRwys.filter((r) => r.role === 'DEP').length;
  const depStreams = Math.max(1, dedicated + (depRwys.length - dedicated) * 0.5);
  const adr = Math.round(depStreams * (3600 / Math.max(60, meanDepGapSec)) * weatherFactor);

  return {
    aar, perRunwayRate: Math.round(perRunwayRate), arrRwyCount: nRwy,
    meanSpacingNm, effSpacingNm: +effSpacingNm.toFixed(1), finalSpeedKt, weatherFactor, wxCat,
    approachCat: app.cat, lvp: app.lvp,
    inbound: inbound.length, arrHr,
    utilization, utilPct: Math.round(utilization * 100), status, delayMin,
    adr, meanDepGapSec, depRwyCount: depRwys.length,
  };
}

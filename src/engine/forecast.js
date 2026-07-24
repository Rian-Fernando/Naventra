// Forecast reasoning — pure functions over decoded TAF periods. Projects the
// runway configuration and a disruption-risk estimate for each future period by
// running the same wind-based allocator the live console uses.
//
// The risk score is a transparent heuristic MODEL derived from forecast weather
// (crosswind, gusts, visibility, ceiling) — NOT a feed of real airline
// cancellations (those aren't available from free sources). It answers "how
// operationally stressed will this airport be?", which is what drives real
// delays and cancellations.
import { allocateRunways } from './atc.js';
import { approachCategory } from './capacity.js';

// Minimum crosswind achievable across the arrival runways for a given wind.
function operativeCrosswind(airport, windDir, windKt) {
  const strips = allocateRunways(airport, { windDir, windKt });
  const arr = strips.filter((s) => s.role.includes('ARR'));
  const ends = arr.map((s) => s.activeEnd);
  const xwind = arr.length ? Math.min(...arr.map((s) => Math.abs(s.cross))) : 0;
  return { ends, xwind };
}

export function disruptionRisk(airport, period) {
  const { windDir, windKt, gustKt, visibSm, ceilingFt } = period;
  const { xwind } = operativeCrosswind(airport, windDir, windKt);
  const gust = Math.max(gustKt || 0, windKt || 0);
  let score = 0;
  const reasons = [];

  if (xwind >= 25) { score += 45; reasons.push(`crosswind ${Math.round(xwind)}kt`); }
  else if (xwind >= 18) { score += 26; reasons.push(`crosswind ${Math.round(xwind)}kt`); }
  else if (xwind >= 12) { score += 10; }

  if (gust >= 40) { score += 26; reasons.push(`gusts ${Math.round(gust)}kt`); }
  else if (gust >= 30) { score += 13; reasons.push(`gusts ${Math.round(gust)}kt`); }

  if (visibSm != null) {
    if (visibSm < 1) { score += 34; reasons.push(`vis ${visibSm}sm`); }
    else if (visibSm < 3) { score += 18; reasons.push(`vis ${visibSm}sm`); }
  }

  if (ceilingFt != null) {
    if (ceilingFt < 500) { score += 30; reasons.push(`ceiling ${ceilingFt}ft`); }
    else if (ceilingFt < 1000) { score += 15; reasons.push(`ceiling ${ceilingFt}ft`); }
  }

  const pct = Math.min(95, score);
  const level = pct >= 55 ? 'HIGH' : pct >= 28 ? 'MODERATE' : 'LOW';
  return { pct, level, reasons, xwind: Math.round(xwind) };
}

// One summary row per forecast period: projected config, approach category (and
// the capacity that implies), disruption risk, and whether the runway config or
// approach category changes vs the previous period.
export function buildOutlook(airport, periods) {
  let prevLabel = null;
  let prevCat = null;
  return periods.map((p) => {
    const { ends } = operativeCrosswind(airport, p.windDir, p.windKt);
    const config = ends.join(' / ') || '—';
    const risk = disruptionRisk(airport, p);
    const app = approachCategory(p.ceilingFt, p.visibSm);
    const flip = prevLabel != null && config !== prevLabel;
    const catDrop = prevCat != null && app.factor < prevCat;
    prevLabel = config;
    prevCat = app.factor;
    return {
      ...p, config, arrEnds: ends, risk, flip,
      appCat: app.cat, lvp: app.lvp, capacityPct: Math.round(app.factor * 100), catDrop,
    };
  });
}

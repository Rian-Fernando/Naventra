// Pure ground-truth grading, shared by the browser tracker and the Cloudflare
// always-on tracker so both grade landings identically.

import { toLocalNm, angleDiff } from '../lib/geo.js';
import { stripOffsets } from './atc.js';

export const CATEGORIES = [
  ['runway', 'Runway end'],
  ['config', 'Active config'],
  ['eta', 'Touchdown ETA'],
  ['sequence', 'Landing order'],
];

export const ETA_TOLERANCE_MS = 150 * 1000; // ±2.5 min counts as a hit

// Which runway end did the aircraft actually line up with? Judged from its last
// airborne sample: track alignment + cross-track distance to each end's
// centerline. Returns null when nothing matches convincingly (kept ungraded —
// an honest scorecard doesn't guess its own ground truth).
export function classifyLandingRunway(sample, airport) {
  const p = toLocalNm(airport.lat, airport.lon, sample.lat, sample.lon);
  const offsets = stripOffsets(airport);
  let best = null;
  let bestScore = Infinity;
  for (const rwy of airport.runways) {
    const off = offsets.get(rwy.id) || { offX: 0, offY: 0 };
    const px = p.x - off.offX;
    const py = p.y - off.offY;
    for (let e = 0; e < 2; e++) {
      const hdg = (rwy.trueHdg + e * 180) % 360;
      const align = angleDiff(sample.track, hdg);
      if (align > 38) continue;
      const dirX = Math.sin(hdg * Math.PI / 180);
      const dirY = Math.cos(hdg * Math.PI / 180);
      const cross = Math.abs(px * dirY - py * dirX);
      const along = px * dirX + py * dirY; // >0 means already past the field
      if (cross > 1.1 || along > 0.8) continue;
      const score = align * 0.05 + cross;
      if (score < bestScore) { bestScore = score; best = rwy.ends[e]; }
    }
  }
  return best;
}

// Grade a locked prediction against the observed landing. Returns the graded
// items array (used by both the browser and the D1 tracker).
export function gradeItems({ predRunway, predEtaTs, sampleSeq }, actualRunway, landedTs, arrEndsNow) {
  const items = [];
  if (actualRunway) {
    items.push({ cat: 'runway', predicted: predRunway, actual: actualRunway, ok: actualRunway === predRunway });
    if (arrEndsNow) {
      items.push({ cat: 'config', predicted: 'in ARR set', actual: actualRunway, ok: arrEndsNow.includes(actualRunway) });
    }
  }
  const etaErrMs = landedTs - predEtaTs;
  items.push({
    cat: 'eta',
    predicted: new Date(predEtaTs).toISOString().slice(11, 16) + 'Z',
    actual: `${etaErrMs >= 0 ? '+' : '−'}${Math.round(Math.abs(etaErrMs) / 1000)}s`,
    ok: Math.abs(etaErrMs) <= ETA_TOLERANCE_MS,
  });
  if (sampleSeq != null) {
    items.push({ cat: 'sequence', predicted: '#1 on runway', actual: `was #${sampleSeq}`, ok: sampleSeq === 1 });
  }
  return items;
}

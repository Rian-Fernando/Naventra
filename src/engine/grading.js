// Pure ground-truth grading, shared by the browser tracker and the Cloudflare
// always-on tracker so both grade landings identically.

import { toLocalNm, angleDiff, distNm } from '../lib/geo.js';
import { stripOffsets, fieldRadiusNm } from './atc.js';
import { thresholds } from './departures.js';

export const CATEGORIES = [
  ['runway', 'Arrival runway'],
  ['config', 'Active config'],
  ['eta', 'Touchdown ETA'],
  ['sequence', 'Landing order'],
  ['deprwy', 'Departure runway'],
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

// Did it come down here? Seen on the ground (or rolling out) inside this
// airport's movement area — not at LaGuardia nine miles away. Until Nov 2026
// any touchdown in radar range counted, so Newark's and LaGuardia's arrivals
// were graded as JFK landings; now a flight that lands anywhere else voids its
// prediction instead.
export function onOurField(ac, airport) {
  if (ac?.lat == null) return false;
  const d = ac.distNm ?? distNm(ac.lat, ac.lon, airport.lat, airport.lon);
  return d <= fieldRadiusNm(airport) && !ac.otherField;
}

// Where an arrival sits in its runway's landing queue right now: position,
// runway and the flights ahead of it (ids). Taken with every airborne sample so
// the last one before touchdown is what the landing order is judged on.
export function queueSnapshot(ac, queues) {
  if (ac.seqRwy == null || !ac.runway) return null;
  const q = queues.get(ac.runway) || [];
  return { seq: ac.seqRwy, rwy: ac.runway, ahead: q.slice(0, ac.seqRwy - 1) };
}

// Per-runway landing queues (ids, next to land first) for queueSnapshot.
export function landingQueues(annotated) {
  const queues = new Map();
  for (const a of annotated) {
    if (a.seqRwy == null || !a.runway) continue;
    if (!queues.has(a.runway)) queues.set(a.runway, []);
    queues.get(a.runway)[a.seqRwy - 1] = a.id;
  }
  for (const [k, q] of queues) queues.set(k, q.filter(Boolean));
  return queues;
}

// Landing order, judged the way a tracker that looks every ten seconds — or
// every two minutes — actually can. At the last look before touchdown we had
// `ahead` in front of this flight on runway `rwy`. The call held if it landed
// on that runway, every flight we had ahead of it was down first or gone (a
// go-around or a diversion isn't ours to call), and nothing else landed on that
// runway in between. The old rule — "it was #1 at the last look" — marked a
// flight wrong whenever the one ahead of it landed between two polls.
//   log          recent touchdowns here, this sweep's included: [{ id, rwy, ts }]
//   stillInbound (id, rwy) → true while that flight is still approaching rwy
// Returns a graded item, or null when there's nothing to judge.
export function gradeOrder(id, sample, actualRunway, landedTs, log, stillInbound) {
  if (!sample || sample.seq == null || !Array.isArray(sample.ahead) || !actualRunway) return null;
  const SLACK = 5000; // touchdown estimates are good to a few seconds
  const predicted = sample.seq === 1 ? `next on ${sample.rwy}` : `#${sample.seq} on ${sample.rwy}`;
  if (sample.rwy !== actualRunway) return { cat: 'sequence', predicted, actual: `landed on ${actualRunway}`, ok: false };
  const ahead = new Set(sample.ahead);
  let passed = 0;
  for (const a of ahead) {
    const l = log.find((x) => x.id === a);
    if (l ? l.ts > landedTs + SLACK : stillInbound(a, actualRunway)) passed++;
  }
  const cut = log.filter((l) => l.id !== id && l.rwy === actualRunway && !ahead.has(l.id)
    && l.ts > (sample.ts ?? 0) && l.ts < landedTs - SLACK).length;
  const actual = passed && cut ? `passed ${passed}, ${cut} landed first`
    : passed ? `landed ahead of ${passed} we had in front`
      : cut ? `${cut} other${cut > 1 ? 's' : ''} landed first`
        : 'in order';
  return { cat: 'sequence', predicted, actual, ok: !passed && !cut };
}

// Grade a locked prediction against the observed landing. Returns the graded
// items array (used by both the browser and the D1 tracker). `order` is the
// landing-order item from gradeOrder (or null).
export function gradeItems({ predRunway, predEtaTs, rawEtaTs, order }, actualRunway, landedTs, arrEndsNow) {
  const items = [];
  if (actualRunway) {
    items.push({ cat: 'runway', predicted: predRunway, actual: actualRunway, ok: actualRunway === predRunway });
    if (arrEndsNow) {
      items.push({ cat: 'config', predicted: 'in ARR set', actual: actualRunway, ok: arrEndsNow.includes(actualRunway) });
    }
  }
  // A landing >30 min off the raw estimate is a go-around / diversion / extreme
  // hold, not a clean ETA test — don't grade the ETA (it isn't a miss).
  const etaOutlier = rawEtaTs != null && Math.abs(landedTs - rawEtaTs) > 1800 * 1000;
  if (!etaOutlier) {
    const etaErrMs = landedTs - predEtaTs;
    items.push({
      cat: 'eta',
      predicted: new Date(predEtaTs).toISOString().slice(11, 16) + 'Z',
      actual: `${etaErrMs >= 0 ? '+' : '−'}${Math.round(Math.abs(etaErrMs) / 1000)}s`,
      ok: Math.abs(etaErrMs) <= ETA_TOLERANCE_MS,
    });
  }
  if (order) items.push(order);
  return items;
}

// When did it actually touch down? A tracker polling every couple of minutes
// first sees a landed aircraft already taxiing, up to a full interval late —
// which would bias every ETA grade. Instead, fly the last airborne sample on to
// the threshold of the runway it landed on, at the average of its speed then
// and a typical touchdown speed. Clamped between that sample and the moment it
// was seen down; falls back to `seenTs` when there's nothing to go on.
export function estimateTouchdown(sample, seenTs, runwayEnd, airport) {
  if (!sample?.ts || !runwayEnd || !(sample.gs > 60)) return seenTs;
  const t = thresholds(airport).get(runwayEnd);
  if (!t) return seenTs;
  const p = toLocalNm(airport.lat, airport.lon, sample.lat, sample.lon);
  const nm = Math.hypot(p.x - t.x, p.y - t.y);
  const est = sample.ts + (nm / ((sample.gs + 135) / 2)) * 3600 * 1000;
  return Math.round(Math.min(seenTs, Math.max(sample.ts, est)));
}

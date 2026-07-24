// Wake turbulence — the single biggest driver of arrival capacity, and the
// reason real final-approach spacing is NOT a flat 3 nm.
//
// A heavy jet trails a pair of rotating vortices off its wingtips. A lighter
// aircraft following too closely can be rolled uncontrollably. So controllers
// hold extra distance behind heavier aircraft, set by the (leader, follower)
// weight-category pair. We use the ICAO 4-category scheme:
//
//   J  Super   — A380, An-124/225. Sheds the strongest wake.
//   H  Heavy   — max take-off weight ≥ 136 t: most widebodies (777, 787, 330,
//                350, 747, 767…). (The 757 is medium by weight but a notorious
//                wake generator, so it's grouped with Heavy here — a common
//                simplification of the FAA's special 757 handling.)
//   M  Medium  — 7–136 t: 737, A320 family, regional jets, turboprops.
//   L  Light   — < 7 t: light GA, small twins, most helicopters.

const SUPER = new Set(['A388', 'A124', 'A225']);
const HEAVY = new Set([
  'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K', 'B742', 'B743', 'B744', 'B748', 'B752', 'B753',
  'B762', 'B763', 'B764', 'B772', 'B77L', 'B77W', 'B778', 'B779', 'B788',
  'B789', 'B78X', 'MD11', 'A306', 'A310', 'IL96', 'DC10', 'C17', 'A400',
]);
const LIGHT = new Set([
  'C172', 'C152', 'C182', 'C206', 'C210', 'SR20', 'SR22', 'PA28', 'PA34',
  'PA46', 'DA40', 'DA42', 'BE36', 'BE58', 'C72R', 'P28A', 'P28R', 'AA5',
  'DR40', 'TBM9', 'PC12', 'C25A', 'C25B', 'C25C', 'C525', 'E50P', 'EA50',
  'R44', 'R66', 'EC30', 'AS50', 'B06', 'H500', 'S76', 'B407', 'EC35',
]);

// ICAO type designator (with the raw ADS-B emitter category as a fallback for
// aircraft with no type in the feed): A5 = heavy, A1/B1/B4 = light, A7 = heli.
export function wakeCat(type, adsbCategory) {
  if (type) {
    if (SUPER.has(type)) return 'J';
    if (HEAVY.has(type)) return 'H';
    if (LIGHT.has(type)) return 'L';
    return 'M';
  }
  const c = adsbCategory;
  if (c === 'A5') return 'H';
  if (c === 'A1' || c === 'B1' || c === 'B4' || c === 'A7') return 'L';
  if (c === 'A2' || c === 'A3' || c === 'A4') return 'M';
  return null; // unknown — no wake assumption
}

export const WAKE_LABEL = { J: 'SUPER', H: 'HEAVY', M: 'MEDIUM', L: 'LIGHT' };

// Required in-trail spacing on final (nm), by (leader → follower) category, from
// the ICAO distance-based wake minima, floored at the 3 nm terminal radar
// minimum where wake adds nothing. This is what the sequence must achieve.
const RADAR_MIN = 3;
const SEP = {
  J: { J: 4, H: 6, M: 7, L: 8 },
  H: { J: 3, H: 4, M: 5, L: 6 },
  M: { J: 3, H: 3, M: 3, L: 5 },
  L: { J: 3, H: 3, M: 3, L: 3 },
};

// Required spacing behind `leaderCat` for `followerCat`. Unknown category → the
// plain radar minimum (we never under-space, but don't invent a wake penalty).
export function wakeSepNm(leaderCat, followerCat) {
  if (!leaderCat || !followerCat) return RADAR_MIN;
  return Math.max(RADAR_MIN, SEP[leaderCat]?.[followerCat] ?? RADAR_MIN);
}

// Departure wake separation is TIME-based (the vortices sink/drift behind the
// departing aircraft), not distance-based — a following aircraft waits ~2 min
// behind a super/heavy. Floored at a 60 s runway-occupancy minimum (one
// departure per minute). Seconds, leader → follower.
const OCCUPANCY_S = 60;
const DEP_SEP = {
  J: { J: 120, H: 120, M: 120, L: 180 },
  H: { J: 90, H: 90, M: 120, L: 180 },
  M: { J: 60, H: 60, M: 60, L: 120 },
  L: { J: 60, H: 60, M: 60, L: 60 },
};

export function wakeDepartureSepSec(leaderCat, followerCat) {
  if (!leaderCat || !followerCat) return OCCUPANCY_S;
  return Math.max(OCCUPANCY_S, DEP_SEP[leaderCat]?.[followerCat] ?? OCCUPANCY_S);
}

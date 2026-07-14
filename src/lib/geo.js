// Geodesy + kinematics helpers. Distances in nautical miles, bearings in
// degrees true, speeds in knots, vertical rates in ft/min.

const R_NM = 3440.065; // earth radius in nm
export const DEG = Math.PI / 180;

export function distNm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG);
  const x =
    Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

// Destination point given start, bearing (true) and distance (nm).
export function project(lat, lon, brgDeg, dNm) {
  const d = dNm / R_NM;
  const brg = brgDeg * DEG;
  const la1 = lat * DEG;
  const lo1 = lon * DEG;
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg)
  );
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2)
    );
  return { lat: la2 / DEG, lon: lo2 / DEG };
}

// Local flat-earth projection around an origin — good enough within ~150nm.
// Returns {x, y} in nm, +x east, +y north.
export function toLocalNm(originLat, originLon, lat, lon) {
  const x = (lon - originLon) * DEG * R_NM * Math.cos(originLat * DEG);
  const y = (lat - originLat) * DEG * R_NM;
  return { x, y };
}

// Dead-reckon a position forward by dtSec using ground speed + track.
export function deadReckon(lat, lon, gsKt, trackDeg, dtSec) {
  if (!gsKt || dtSec <= 0) return { lat, lon };
  return project(lat, lon, trackDeg, (gsKt / 3600) * dtSec);
}

// Closest point of approach between two aircraft, from local-plane positions
// and velocity vectors. Returns time to CPA (sec) and separation at CPA (nm).
export function cpa(p1, v1, p2, v2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dvx = v2.x - v1.x; // nm/s
  const dvy = v2.y - v1.y;
  const dv2 = dvx * dvx + dvy * dvy;
  if (dv2 < 1e-12) {
    return { tSec: 0, sepNm: Math.hypot(dx, dy) };
  }
  const t = Math.max(0, -(dx * dvx + dy * dvy) / dv2);
  const sx = dx + dvx * t;
  const sy = dy + dvy * t;
  return { tSec: t, sepNm: Math.hypot(sx, sy) };
}

// Velocity vector in nm/s from knots + track.
export function velocityNmS(gsKt, trackDeg) {
  const s = gsKt / 3600;
  return { x: s * Math.sin(trackDeg * DEG), y: s * Math.cos(trackDeg * DEG) };
}

export function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Head/crosswind components (kt) for a runway true heading given wind dir/speed.
export function windComponents(rwyHdg, windDir, windKt) {
  const rel = (windDir - rwyHdg) * DEG;
  return {
    head: Math.round(windKt * Math.cos(rel)),
    cross: Math.round(Math.abs(windKt * Math.sin(rel))),
  };
}

export const fmtAlt = (ft) =>
  ft == null ? '---' : ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${Math.max(0, Math.round(ft)).toLocaleString()}ft`;

export const fmtFL = (ft) => (ft == null ? '---' : String(Math.round(ft / 100)).padStart(3, '0'));

// Other airports inside the radar range, and the traffic that belongs to them.
//
// LaGuardia sits 9 nm from JFK and Newark 18 nm. Their arrivals descend through
// JFK's approach airspace and their departures climb out across it, so judged
// on distance and closure alone they looked like JFK traffic. Until Nov 2026 the
// tracker locked them as JFK arrivals: about half of the "JFK landings" it
// graded were really at Newark, LaGuardia or Teterboro.
//
// An aircraft is another airport's traffic only when its track shows it plainly:
//   - established on one of that airport's finals: lined up with a runway,
//     inside the approach cone, at a height that fits the glide path;
//   - low and slow right over it (circling and visual approaches);
//   - lifting off one of its runways (then remembered by the caller, since a
//     climb-out soon stops looking like anything in particular).
// Our own airport wins any tie: an aircraft that could be on one of our finals
// stays ours unless it is clearly descending to a nearer field below our glide
// path. Its landing is still only graded if it touches down on our runways.

import { NEIGHBORS } from '../data/neighbors.js';
import { toLocalNm, angleDiff } from '../lib/geo.js';

const D = Math.PI / 180;
const GLIDE_FT_PER_NM = 318;   // 3° glide path
const NM_PER_FT = 1 / 6076.12;
const LOW_AGL_FT = 7000;       // above this, nothing here is decided

// Runway ends as landing directions, in nm east/north of the hub's reference
// point: threshold position and the heading flown to land there.
function endsFrom(hub, rw) {
  const out = [];
  for (const [a, aLat, aLon, b, bLat, bLon] of rw) {
    const pa = toLocalNm(hub.lat, hub.lon, aLat, aLon);
    const pb = toLocalNm(hub.lat, hub.lon, bLat, bLon);
    const hdg = (Math.atan2(pb.x - pa.x, pb.y - pa.y) / D + 360) % 360;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    out.push({ id: a, x: pa.x, y: pa.y, hdg, len });
    out.push({ id: b, x: pb.x, y: pb.y, hdg: (hdg + 180) % 360, len });
  }
  return out;
}

// The hub's own ends, from its runway centres (offX/offY), headings and lengths.
function homeEnds(airport) {
  const out = [];
  for (const r of airport.runways) {
    const half = (r.lenFt * NM_PER_FT) / 2;
    const ux = Math.sin(r.trueHdg * D), uy = Math.cos(r.trueHdg * D);
    const cx = r.offX || 0, cy = r.offY || 0;
    // Landing on ends[0] flies trueHdg and touches down at the near end.
    out.push({ id: r.ends[0], x: cx - half * ux, y: cy - half * uy, hdg: r.trueHdg, len: half * 2 });
    out.push({ id: r.ends[1], x: cx + half * ux, y: cy + half * uy, hdg: (r.trueHdg + 180) % 360, len: half * 2 });
  }
  return out;
}

const cache = new Map();
function geometry(airport) {
  let g = cache.get(airport.icao);
  if (g) return g;
  const nbs = (NEIGHBORS[airport.icao] || []).map((n) => {
    const p = toLocalNm(airport.lat, airport.lon, n.lat, n.lon);
    const ends = endsFrom(airport, n.rw);
    // How far its movement area reaches from its reference point.
    const r = Math.max(0.6, ...ends.map((e) => Math.hypot(e.x - p.x, e.y - p.y))) + 0.4;
    return { icao: n.icao, iata: n.iata, name: n.name, city: n.city, lat: n.lat, lon: n.lon, elevFt: n.elevFt, x: p.x, y: p.y, r, ends };
  });
  g = { home: homeEnds(airport), nbs };
  cache.set(airport.icao, g);
  return g;
}

export const neighborsOf = (airport) => geometry(airport).nbs;

// How well the aircraft fits a final approach to runway end `e` (field
// elevation `elevFt`). `loose` is the generous test used to protect our own
// arrivals; the strict one is what it takes to hand an aircraft to another
// airport. Returns { end, toGo, dev, score } (lower score = better) or null.
export function finalFit(ac, p, e, elevFt, loose = false) {
  const align = angleDiff(ac.track ?? 0, e.hdg);
  if (align > (loose ? 30 : 20)) return null;
  const ux = Math.sin(e.hdg * D), uy = Math.cos(e.hdg * D);
  const dx = p.x - e.x, dy = p.y - e.y;
  const toGo = -(dx * ux + dy * uy);             // nm still to fly to the threshold
  if (toGo < -0.5 || toGo > (loose ? 15 : 12)) return null;
  const cross = Math.abs(dx * uy - dy * ux);
  const cone = (loose ? 0.6 : 0.35) + 0.1 * Math.max(0, toGo);
  if (cross > cone) return null;
  const dev = (ac.altFt - elevFt) - GLIDE_FT_PER_NM * Math.max(0, toGo); // + = above the glide path
  if (loose ? dev > 1500 + 100 * toGo : Math.abs(dev) > Math.max(700, 120 * toGo)) return null;
  return { end: e.id, toGo, dev, score: cross / cone + align / 30 + Math.abs(dev) / 1500 };
}

// Lifting off runway end `e` (take-off direction = its landing heading): over
// the runway or just past its far end, aligned, low and climbing.
function climbOutFit(ac, p, e, elevFt) {
  const agl = ac.altFt - elevFt;
  if (agl > 2500 || angleDiff(ac.track ?? 0, e.hdg) > 30) return null;
  const ux = Math.sin(e.hdg * D), uy = Math.cos(e.hdg * D);
  const dx = p.x - e.x, dy = p.y - e.y;
  const along = dx * ux + dy * uy;               // nm down the runway from its start
  const past = along - e.len;                    // nm beyond the far end
  if (along < 0 || past > 1.5 + agl / 300) return null;
  const cross = Math.abs(dx * uy - dy * ux);
  if (cross > 0.5 + 0.1 * Math.max(0, past)) return null;
  if (agl > 600 + 1000 * Math.max(0, past)) return null; // too high to have left from here
  return { end: e.id };
}

const tag = (nb, role, rwy = null) => ({ icao: nb.icao, iata: nb.iata, name: nb.name, city: nb.city, lat: nb.lat, lon: nb.lon, role, rwy });

// Which other airport, if any, this aircraft evidently belongs to. Returns
// { icao, iata, name, city, lat, lon, role: 'arr' | 'dep' | 'gnd', rwy } or null.
// opts.fieldR      — our own movement-area radius (atc.js fieldRadiusNm)
// opts.remembered  — what an earlier sweep concluded for this aircraft (the
//                    browser keeps it so a climb-out stays tagged once it no
//                    longer looks like one)
// opts.departedHome — true when this aircraft was seen taking off from here
export function neighborTraffic(ac, airport, opts = {}) {
  if (ac?.lat == null || ac.altFt == null) return null;
  const g = geometry(airport);
  if (!g.nbs.length) return null;
  const p = toLocalNm(airport.lat, airport.lon, ac.lat, ac.lon);
  const dHome = Math.hypot(p.x, p.y);
  const near = (nb) => Math.hypot(p.x - nb.x, p.y - nb.y);

  // On the ground: parked or taxiing at another field.
  if (ac.onGround || (ac.altFt - airport.elevFt < 150 && (ac.gs ?? 0) < 60)) {
    if (dHome <= (opts.fieldR ?? 2)) return null;
    const nb = g.nbs.find((n) => near(n) <= n.r);
    return nb ? tag(nb, 'gnd') : null;
  }
  if (opts.departedHome) return null;

  // Anything that could be on one of our own finals stays ours…
  const vs = ac.vs ?? 0;
  let home = null;
  if (vs < 300) {
    for (const e of g.home) {
      const f = finalFit(ac, p, e, airport.elevFt, true);
      if (f && (!home || f.score < home.score)) home = f;
    }
  }
  const remembered = opts.remembered || null;
  if (remembered && !home) return remembered;
  if (ac.altFt - airport.elevFt > LOW_AGL_FT || dHome > 60) return null;

  // Established on another airport's final.
  let best = null;
  if (vs < 300 && (ac.gs ?? 0) < 230) {
    for (const nb of g.nbs) {
      for (const e of nb.ends) {
        const f = finalFit(ac, p, e, nb.elevFt, false);
        if (f && (!best || f.score < best.f.score)) best = { nb, f };
      }
    }
  }
  // …unless it is clearly descending to the nearer field, well below our
  // glide path (Hawthorne's arrivals pass under LAX's south-complex final).
  if (best && (!home || (home.dev < -700 && Math.abs(best.f.dev) < 400))) return tag(best.nb, 'arr', best.f.end);
  if (home) return null;

  // Low and slow right over another field: circling, or a visual approach.
  if (vs < 300 && (ac.gs ?? 0) < 200) {
    const nb = g.nbs.find((n) => ac.altFt - n.elevFt < 1200 && near(n) <= n.r);
    if (nb) return tag(nb, 'arr');
  }

  // Lifting off another field's runway.
  if (vs > 300 && (ac.gs ?? 0) > 70 && dHome > (opts.fieldR ?? 2)) {
    for (const nb of g.nbs) {
      if (near(nb) > nb.r + 4) continue;
      for (const e of nb.ends) {
        const f = climbOutFit(ac, p, e, nb.elevFt);
        if (f) return tag(nb, 'dep', f.end);
      }
    }
  }
  return null;
}

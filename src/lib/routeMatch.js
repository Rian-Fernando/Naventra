// Which part of a flight's published route this aircraft is actually flying —
// or none. Route databases are keyed by callsign, and airlines reuse flight
// numbers for different city pairs, so a lookup can return a route the aircraft
// is nowhere near (a live JFK sample, Nov 2026: 31 of 84 routes on file were
// impossible for the aircraft's position). A route is shown only if it fits:
//   - on the ground: at one of its airports
//   - climbing: its origin within reach of the altitude it has gained;
//     descending: its destination within reach
//   - level cruise: inside a corridor around the great circle between its
//     airports, heading the right way
// Multi-leg routes (A → B → C) are checked leg by leg. When nothing fits, the
// end the engine can see is still shown: a flight on final here is landing
// here; one seen climbing off our runway left from here.

import { distNm, angleDiff } from './geo.js';

const R_NM = 3440.065;
const LOW_FT = 10000;
const NEAR_NM = 40;      // airborne and low: within this of the airport
const AT_NM = 4;         // on the ground: at the airport itself
const rad = (d) => (d * Math.PI) / 180;

function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Cross-track (xt) and along-track (at) distance, nm, of point p from the great
// circle a → b.
export function crossAlong(a, b, p) {
  const d13 = distNm(a.lat, a.lon, p.lat, p.lon) / R_NM;
  const t13 = rad(bearingDeg(a.lat, a.lon, p.lat, p.lon));
  const t12 = rad(bearingDeg(a.lat, a.lon, b.lat, b.lon));
  const xtR = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12))));
  const atR = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.max(1e-9, Math.cos(xtR)))));
  const ahead = Math.cos(t13 - t12) >= 0 ? 1 : -1;
  return { xt: Math.abs(xtR) * R_NM, at: ahead * atR * R_NM };
}

// Does the aircraft fit the leg from → to right now? How far from an airport
// it can be grows with altitude — a climb or descent covers roughly 1 nm per
// 250 ft — so a jet passing 12,000 ft on its way out of New York must have
// left from within ~90 nm, not from San Diego.
export function legFits(ac, from, to) {
  if (from?.lat == null || to?.lat == null || ac?.lat == null) return false;
  const dFrom = distNm(ac.lat, ac.lon, from.lat, from.lon);
  const dTo = distNm(ac.lat, ac.lon, to.lat, to.lon);
  if (ac.onGround) return dFrom <= AT_NM || dTo <= AT_NM;
  const vs = ac.vs ?? 0;
  const alt = Math.max(0, ac.altFt ?? 0);
  const reach = NEAR_NM + alt / 250;
  if (vs > 500) { if (dFrom > reach) return false; }        // climbing: just left `from`
  else if (vs < -500) { if (dTo > reach) return false; }    // descending: about to reach `to`
  if (alt < LOW_FT) return dFrom <= reach || dTo <= reach;  // low and level: near one of them
  if (Math.min(dFrom, dTo) <= reach) return true;
  const len = distNm(from.lat, from.lon, to.lat, to.lon);
  const { xt, at } = crossAlong(from, to, ac);
  if (xt > Math.max(120, 0.1 * len) || at < -60 || at > len + 60) return false;
  // Heading for the destination, give or take routing.
  return ac.gs < 60 || angleDiff(ac.track ?? 0, bearingDeg(ac.lat, ac.lon, to.lat, to.lon)) < 100;
}

const sameAirport = (ep, ap) => !!ep && !!ap && ((ep.icao && ep.icao === ap.icao) || (ep.iata && ep.iata === ap.iata));

// What the engine already knows overrides geography: New York's three big
// airports sit 9–16 nm apart, so "within 40 nm of LaGuardia" can't tell a JFK
// arrival from a LaGuardia one. On this field → the leg must touch this
// airport; on final here → it must end here; seen climbing off our runway →
// it must start here.
function legConsistent(from, to, ac, airport) {
  if (ac.atField) return sameAirport(from, airport) || sameAirport(to, airport);
  if (ac.phase === 'FINAL') return sameAirport(to, airport);
  if (ac.depFromField) return sameAirport(from, airport);
  return true;
}
const asEndpoint = (ap) => ({ iata: ap.iata, icao: ap.icao, name: ap.name, city: (ap.city || '').split(',')[0], lat: ap.lat, lon: ap.lon });

export const isAirlineCallsign = (cs) => /^[A-Z]{3}[0-9]/.test(cs || '');

// What to show for one aircraft. `route` is a cached lookup ({ airline, from,
// to, via } | null when none is on file | undefined when not looked up yet).
// Returns { from, to, via, source, note }: from/to are endpoints or null;
// source is 'route' (published and fits), 'seen' (only what the track shows) or
// null; note explains, for the detail card, why something is missing.
export function describeRoute(route, ac, airport) {
  const here = asEndpoint(airport);
  const out = { from: null, to: null, via: null, source: null, note: null, airline: route?.airline || null };

  if (route) {
    const legs = route.via
      ? [[route.from, route.via], [route.via, route.to]]
      : [[route.from, route.to]];
    const fit = legs.filter(([f, t]) => legFits(ac, f, t) && legConsistent(f, t, ac, airport));
    if (fit.length === 1) {
      [out.from, out.to] = fit[0];
      out.source = 'route';
      return out;
    }
    if (fit.length === 2) { // on the ground at the stopover: show the whole route
      out.from = route.from; out.via = route.via; out.to = route.to; out.source = 'route';
      return out;
    }
    out.note = `A route is on file for ${ac.callsign} (${route.from?.iata || route.from?.icao} → ${route.to?.iata || route.to?.icao}), but it doesn't match where this aircraft is — airlines reuse flight numbers, so it isn't shown.`;
  } else if (route === null) {
    out.note = isAirlineCallsign(ac.callsign)
      ? `No published route on file for ${ac.callsign}.`
      : 'Private or general-aviation flight — these don\'t publish routes.';
  } else if (!isAirlineCallsign(ac.callsign)) {
    out.note = 'Private or general-aviation flight — these don\'t publish routes.';
  }

  // What the track itself shows.
  if (ac.phase === 'FINAL') { out.to = here; out.source = 'seen'; return out; }
  if (ac.depFromField) { out.from = here; out.source = 'seen'; return out; }
  // Low and close to one of the airports on file — e.g. climbing out 1 nm from
  // LaGuardia on a leg the database doesn't list. Which way it's going over
  // that airport is plain to see, even when the rest of the route isn't.
  if (route && !ac.onGround && (ac.altFt ?? 99999) < 3000) {
    for (const ep of [route.from, route.via, route.to]) {
      if (ep?.lat == null || distNm(ac.lat, ac.lon, ep.lat, ep.lon) > 6) continue;
      if ((ac.vs ?? 0) > 400) { out.from = ep; out.source = 'seen'; break; }
      if ((ac.vs ?? 0) < -400) { out.to = ep; out.source = 'seen'; break; }
    }
  }
  return out;
}

export { sameAirport };

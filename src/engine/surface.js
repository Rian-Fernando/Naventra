// Ground-safety monitor — runway occupancy and the clearest runway-incursion
// case: a ground aircraft sitting on (or crossing) a runway while another is on
// short final to land on it. This is the most serious class of ground risk.
//
// Honest limitation: ADS-B ground coverage is PARTIAL — many aircraft stop
// transmitting a position once on the surface, and MLAT fill-in is spotty at
// some fields. So this is an ADVISORY over what's actually broadcasting, not a
// certified surface-surveillance system (real towers use ASDE-X / RWSL).
import { toLocalNm } from '../lib/geo.js';

const FT_PER_NM = 6076.12;
const HALF_WIDTH_NM = 130 / FT_PER_NM; // ~260 ft — runway + shoulders, generous for GPS jitter

// Point (local nm east/north of the field) inside a runway's rectangle?
function inRunway(px, py, rwy, halfLenNm) {
  const dx = px - (rwy.offX || 0), dy = py - (rwy.offY || 0);
  const s = Math.sin(rwy.activeHdg * Math.PI / 180), c = Math.cos(rwy.activeHdg * Math.PI / 180);
  const along = dx * s + dy * c;   // distance along the runway centreline
  const cross = dx * c - dy * s;   // distance off the centreline
  return Math.abs(along) <= halfLenNm && Math.abs(cross) <= HALF_WIDTH_NM;
}

export function detectSurface(annotated, airport, runways) {
  const occupancy = []; // { activeEnd, id, callsigns[] }
  const incursions = []; // { runway, threat, distNm, occupant, severity }

  for (const rwy of runways) {
    const halfLen = rwy.lenFt / FT_PER_NM / 2;
    const onRwy = [];
    for (const a of annotated) {
      if (!a.onGround || a.lat == null || a.lon == null) continue;
      const p = toLocalNm(airport.lat, airport.lon, a.lat, a.lon);
      if (inRunway(p.x, p.y, rwy, halfLen)) onRwy.push(a);
    }
    if (onRwy.length) occupancy.push({ activeEnd: rwy.activeEnd, id: rwy.id, callsigns: onRwy.map((a) => a.callsign) });

    // Incursion: an arrival on short final to this runway with something else on it.
    if (rwy.role.includes('ARR')) {
      const arrival = annotated.find((a) => a.phase === 'FINAL' && a.runway === rwy.activeEnd && a.distNm < 2.5);
      const blockers = arrival ? onRwy.filter((a) => a.callsign !== arrival.callsign) : [];
      if (arrival && blockers.length) {
        incursions.push({
          runway: rwy.activeEnd,
          threat: arrival.callsign,
          distNm: arrival.distNm,
          occupant: blockers[0].callsign,
          severity: arrival.distNm < 1.2 ? 'critical' : 'warning',
        });
      }
    }
  }
  return { occupancy, incursions };
}

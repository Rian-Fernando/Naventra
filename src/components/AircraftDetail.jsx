import { useEffect, useState } from 'react';
import { PlaneLanding, PlaneTakeoff, Plane } from 'lucide-react';
import { radioName } from '../engine/atc.js';
import { fmtAlt, distNm } from '../lib/geo.js';
import { fetchRoute, getRoute } from '../lib/route.js';
import { typicalSeats } from '../lib/aircraftMeta.js';

// Format minutes as "4h 12m" / "38m".
function fmtDur(min) {
  if (min == null || !isFinite(min)) return null;
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
function clockZ(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString().slice(11, 16) + 'Z';
}

const epMatches = (ep, ap) => !!ep && !!ap && (ep.icao === ap.icao || ep.iata === ap.iata);
const apAsEp = (ap) => ({ iata: ap.iata, icao: ap.icao, name: ap.name, city: ap.city.split(',')[0], lat: ap.lat, lon: ap.lon });

// Floating card over the radar for the selected track.
export default function AircraftDetail({ aircraft, airport, onClose }) {
  const [route, setRoute] = useState(null);
  const cs = aircraft?.callsign;

  useEffect(() => {
    if (!cs) { setRoute(null); return undefined; }
    setRoute(getRoute(cs));
    let live = true;
    fetchRoute(cs).then((r) => { if (live) setRoute(r); });
    return () => { live = false; };
  }, [cs]);

  if (!aircraft) return null;
  const a = aircraft;
  const seats = typicalSeats(a.type);

  // Reconcile the scheduled route with what the aircraft is actually doing
  // (callsigns get reused across legs). Only trust the schedule when the
  // relevant endpoint matches this facility; enroute overflights are shown as-is.
  const inbound = ['ARRIVAL', 'APPROACH', 'FINAL'].includes(a.phase) || (a.phase === 'GROUND' && a.gate);
  let from = null, to = null, eteTo = null;
  if (route) {
    if (a.phase === 'DEPARTURE' && epMatches(route.from, airport)) {
      from = apAsEp(airport); to = route.to; eteTo = route.to;
    } else if (inbound && epMatches(route.to, airport)) {
      from = route.from; to = apAsEp(airport);
    } else if (a.phase === 'ENROUTE') {
      from = route.from; to = route.to; eteTo = route.to;
    }
  }

  // Time/distance to the actual destination when heading there (dep / enroute).
  let ete = null, distToDest = null, arrClock = null;
  if (eteTo?.lat != null && a.gs > 40 && !a.onGround) {
    distToDest = distNm(a.lat, a.lon, eteTo.lat, eteTo.lon);
    const min = (distToDest / a.gs) * 60;
    ete = fmtDur(min);
    arrClock = clockZ(min * 60000);
  }

  const rows = [
    ['Phase', a.phase],
    ['Altitude', a.onGround ? 'ON GROUND' : fmtAlt(a.altFt)],
    ['Ground speed', `${Math.round(a.gs)} kt`],
    ['Track', `${Math.round(a.track)}°`],
    ['V/S', `${a.vs > 0 ? '+' : ''}${Math.round(a.vs)} fpm`],
    ['Distance to field', `${a.distNm.toFixed(1)} nm`],
    a.seq != null ? ['Landing seq', `#${a.seq}`] : null,
    a.runway ? ['Runway', a.runway] : null,
    a.gate ? ['Stand', a.gate] : null,
    a.etaMin != null && a.phase !== 'DEPARTURE' ? ['ETA field', fmtDur(a.etaMin)] : null,
    ete ? ['ETE to dest', ete] : null,
    arrClock && ete ? ['Est. arrival', arrClock] : null,
    distToDest ? ['Dist to dest', `${Math.round(distToDest)} nm`] : null,
    ['Registration', a.reg || '—'],
    seats ? ['Typical seats', `~${seats}`] : null,
    ['Squawk', a.squawk || '—'],
  ].filter(Boolean);

  return (
    <div className="sel-detail">
      <div className="sel-cs">
        {a.callsign}
        <button onClick={onClose} title="Deselect">✕</button>
      </div>
      <div className="sel-sub">
        {route?.airline || radioName(a.callsign)}{a.desc ? ` · ${a.desc}` : a.type ? ` · ${a.type}` : ''}
      </div>

      {from && to && (
        <div className="sel-route">
          <div className="sel-route-line">
            <span className="ap"><PlaneTakeoff size={11} /> {from.iata || '—'}</span>
            <span className="arrow">→</span>
            <span className="ap"><PlaneLanding size={11} /> {to.iata || '—'}</span>
          </div>
          <div className="sel-route-names">{from.city || from.name} — {to.city || to.name}</div>
        </div>
      )}
      {!from && route === null && cs && (
        <div className="sel-route sel-route-none"><Plane size={11} /> route not on file</div>
      )}

      <div className="sel-grid">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { PlaneLanding, PlaneTakeoff, Plane } from 'lucide-react';
import { radioName } from '../engine/atc.js';
import { distNm } from '../lib/geo.js';
import { fetchRoute, getRoute } from '../lib/route.js';
import { describeRoute, sameAirport, isAirlineCallsign } from '../lib/routeMatch.js';
import { typicalSeats } from '../lib/aircraftMeta.js';
import { WAKE_LABEL } from '../engine/wake.js';
import { useSettings } from '../hooks/useSettings.jsx';
import { fmtAltitude, fmtSpeed, fmtDist } from '../lib/units.js';

// Format minutes as "4h 12m" / "38m".
function fmtDur(min) {
  if (min == null || !isFinite(min)) return null;
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
function clockZ(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString().slice(11, 16) + 'Z';
}

// Floating card over the radar for the selected track.
export default function AircraftDetail({ aircraft, airport, onClose }) {
  const [route, setRoute] = useState(undefined); // undefined = not looked up yet
  const { settings } = useSettings();
  const cs = aircraft?.callsign;

  useEffect(() => {
    if (!cs) { setRoute(undefined); return undefined; }
    setRoute(getRoute(cs));
    let live = true;
    fetchRoute(cs).then((r) => { if (live) setRoute(r); });
    return () => { live = false; };
  }, [cs]);

  if (!aircraft) return null;
  const a = aircraft;
  const seats = typicalSeats(a.type);

  // The published route only if it fits where the aircraft actually is
  // (flight numbers get reused); otherwise whatever end the track shows, plus
  // a plain reason for what's missing. See src/lib/routeMatch.js.
  const rd = describeRoute(route, a, airport);
  const { from, to, via } = rd;
  const eteTo = rd.source === 'route' && to && !sameAirport(to, airport) ? to : null;

  // Time/distance to the actual destination when heading there (dep / enroute).
  let ete = null, distToDest = null, arrClock = null;
  if (eteTo?.lat != null && a.gs > 40 && !a.onGround) {
    distToDest = distNm(a.lat, a.lon, eteTo.lat, eteTo.lon);
    const min = (distToDest / a.gs) * 60;
    ete = fmtDur(min);
    arrClock = clockZ(min * 60000);
  }

  // Another airport's traffic (engine/neighbors.js): say so plainly.
  const of = a.otherField;
  const ofName = of ? `${(of.name || '').replace(/\s+(International\s+)?Airport$/i, '') || of.iata || of.icao}${of.iata ? ` (${of.iata})` : ''}` : null;
  const ofLine = !of ? null
    : of.role === 'arr' ? `${ofName} traffic — ${of.rwy ? `on final for runway ${of.rwy}` : 'landing there'}. Not in ${airport.iata}'s arrival sequence.`
      : of.role === 'dep' ? `Departed ${ofName}${of.rwy ? `, runway ${of.rwy}` : ''} — passing through ${airport.iata}'s airspace.`
        : `On the ground at ${ofName}.`;

  const rows = [
    ['Phase', of ? `${of.iata || of.icao} ${of.role === 'arr' ? 'ARRIVAL' : of.role === 'dep' ? 'DEPARTURE' : 'GROUND'}` : a.phase],
    ['Altitude', a.onGround ? 'ON GROUND' : fmtAltitude(a.altFt, settings.altitude)],
    ['Ground speed', fmtSpeed(a.gs, settings.speed)],
    ['Track', `${Math.round(a.track)}°`],
    ['V/S', `${a.vs > 0 ? '+' : ''}${Math.round(a.vs)} fpm`],
    ['Distance to field', fmtDist(a.distNm, settings.distance)],
    a.wake ? ['Wake category', WAKE_LABEL[a.wake]] : null,
    a.reqSpacingNm ? ['Wake spacing', `${a.reqSpacingNm} nm behind ${a.leaderCs}${a.inTrailNm != null ? ` (${a.inTrailNm.toFixed(1)} now)` : ''}`] : null,
    a.seq != null ? ['Landing seq', `#${a.seq}`] : null,
    a.runway ? ['Runway', a.runway] : null,
    a.gate ? ['Proposed stand', `${a.gate} (engine)`] : null,
    a.etaMin != null && a.phase !== 'DEPARTURE' && !of ? ['ETA field', fmtDur(a.etaMin)] : null,
    ete ? ['ETE to dest', ete] : null,
    arrClock && ete ? ['Est. arrival', arrClock] : null,
    distToDest ? ['Dist to dest', fmtDist(distToDest, settings.distance, 0)] : null,
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
        {rd.airline || radioName(a.callsign)}{a.desc ? ` · ${a.desc}` : a.type ? ` · ${a.type}` : ''}
      </div>

      {(from || to) && (
        <div className="sel-route">
          <div className="sel-route-line">
            <span className="ap"><PlaneTakeoff size={11} /> {from ? from.iata || from.icao : '—'}</span>
            <span className="arrow">→</span>
            {via && <><span className="ap">{via.iata || via.icao}</span><span className="arrow">→</span></>}
            <span className="ap"><PlaneLanding size={11} /> {to ? to.iata || to.icao : '—'}</span>
          </div>
          <div className="sel-route-names">
            {from ? from.city || from.name : 'origin not published'}{via ? ` — ${via.city || via.name}` : ''} — {to ? to.city || to.name : 'destination not published'}
            {rd.source === 'seen' && <> · {to ? `seen on its approach to ${to.iata || to.icao}` : `seen climbing out of ${from.iata || from.icao}`}</>}
          </div>
        </div>
      )}
      {ofLine && (
        <div className="sel-route sel-route-none"><Plane size={11} /> {ofLine}</div>
      )}
      {rd.source !== 'route' && rd.note && (
        <div className="sel-route sel-route-none"><Plane size={11} /> {rd.note}</div>
      )}
      {rd.source !== 'route' && route === undefined && isAirlineCallsign(cs) && (
        <div className="sel-route sel-route-none"><Plane size={11} /> looking up route…</div>
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

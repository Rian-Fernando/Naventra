import { useState } from 'react';
import { PlaneLanding, PlaneTakeoff, CircleDot } from 'lucide-react';
import { getRoute } from '../lib/route.js';
import { describeRoute, sameAirport } from '../lib/routeMatch.js';
import { emergencyInfo } from '../lib/filters.js';
import { WAKE_LABEL } from '../engine/wake.js';
import { useSettings } from '../hooks/useSettings.jsx';
import { fmtAltScope, fmtSpeed, speedUnitLabel, convDist, distUnitLabel } from '../lib/units.js';

const TABS = [
  { key: 'ARR', label: 'Arrivals', icon: PlaneLanding, phases: ['ARRIVAL', 'APPROACH', 'FINAL'] },
  { key: 'DEP', label: 'Departures', icon: PlaneTakeoff, phases: ['DEPARTURE'] },
  // This airport's surface only — not aircraft parked at neighbouring fields.
  { key: 'GND', label: 'Ground', icon: CircleDot, phases: ['GROUND'], fieldOnly: true },
];
const inTab = (t, a) => t.phases.includes(a.phase) && (!t.fieldOnly || a.atField);

const code = (ep) => (ep ? ep.iata || ep.icao : '');
const place = (ep) => (ep ? ep.city || ep.name || code(ep) : '');

// Is this strip really another airport's traffic? An "arrival" whose route ends
// at LaGuardia, or a "departure" seen leaving Newark, is just passing through
// this airport's airspace.
function isElsewhere(rd, airport, tab) {
  const away = (ep) => !!ep && !sameAirport(ep, airport);
  if (tab === 'ARR') return away(rd.to) || (!rd.to && away(rd.from));
  if (tab === 'DEP') return away(rd.from) || (!rd.from && away(rd.to));
  return false;
}

// "BOS → JFK", "BOS → JFK → MIA", or just the end the track shows ("→ JFK").
function RouteTag({ rd, airport, tab, elsewhere }) {
  if (!rd.from && !rd.to) return null;
  const title = rd.source === 'seen'
    ? (rd.to ? `Landing at ${place(rd.to)} — seen on its approach. No published route fits this flight.` : `Departed ${place(rd.from)} — seen climbing out. No published route fits this flight.`)
    : `${place(rd.from)}${rd.via ? ` → ${place(rd.via)}` : ''} → ${place(rd.to)}`;
  const why = elsewhere ? ` — ${code(tab === 'ARR' ? rd.to || rd.from : rd.from || rd.to)} traffic passing through ${airport.iata}'s airspace, not ${tab === 'ARR' ? 'landing' : 'departing'} here` : '';
  return (
    <span className={`route ${rd.source === 'seen' ? 'seen' : ''} ${elsewhere ? 'elsewhere' : ''}`} title={title + why}>
      {rd.from ? code(rd.from) : ''}{rd.via ? ` → ${code(rd.via)}` : ''}{' → '}{rd.to ? code(rd.to) : ''}
    </span>
  );
}

export default function FlightStrips({ aircraft, conflicts, selectedId, onSelect, airline, airport }) {
  const [tab, setTab] = useState('ARR');
  const { settings } = useSettings();
  const active = TABS.find((t) => t.key === tab);
  const conflictIds = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]));

  const rows = aircraft
    .filter((a) => inTab(active, a))
    .filter((a) => !airline || (a.callsign || '').slice(0, 3).toUpperCase() === airline)
    // emergencies float to the top, then normal sequence / distance order
    .sort((a, b) => (emergencyInfo(b) ? 1 : 0) - (emergencyInfo(a) ? 1 : 0)
      || (a.seq ?? 99) - (b.seq ?? 99) || a.distNm - b.distNm);

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-head">
        <active.icon size={14} color="var(--green)" />
        <span className="panel-title">Flight Strips</span>
        <span className="badge">{aircraft.length} TRACKS</span>
      </div>
      <div className="strip-tabs">
        {TABS.map((t) => {
          const n = aircraft.filter((a) => inTab(t, a)).length;
          return (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              {t.label} <span className="n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="panel-body">
        {rows.length === 0 && (
          <div className="empty-note">
            No {active.label.toLowerCase()} in the sector.<br />Strips populate as traffic enters the {tab === 'ARR' ? 'arrival flow' : tab === 'DEP' ? 'departure corridor' : 'movement area'}.
          </div>
        )}
        {rows.map((a) => {
          // Published route, only if it fits where this aircraft actually is
          // (flight numbers get reused); else whatever end the track shows.
          const rd = describeRoute(getRoute(a.callsign), a, airport);
          const elsewhere = isElsewhere(rd, airport, tab);
          const em = emergencyInfo(a);
          return (
          <div
            key={a.id}
            className={`strip ${a.id === selectedId ? 'sel' : ''} ${conflictIds.has(a.id) ? 'conflict' : ''} ${em ? 'emergency' : ''}`}
            onClick={() => onSelect(a.id === selectedId ? null : a.id)}
          >
            <div className="strip-top">
              <span className="strip-cs">{a.callsign}</span>
              <span className="strip-type">{a.type || '—'}</span>
              {(a.wake === 'H' || a.wake === 'J') && <span className={`wk wk-${a.wake}`}>{WAKE_LABEL[a.wake]}</span>}
              {em && <span className="emg">⚠ {em.label}{a.squawk ? ` ${a.squawk}` : ''}</span>}
              {a.seq != null && !elsewhere && <span className="strip-seq">#{a.seq}</span>}
              <span className={`phase-chip phase-${a.phase}`} style={{ marginLeft: a.seq == null || elsewhere ? 'auto' : 0 }}>
                {a.phase}
              </span>
            </div>
            <div className="strip-mid">
              <span><b>{fmtAltScope(a.altFt, settings.altitude, a.onGround)}</b></span>
              <span><b>{fmtSpeed(a.gs, settings.speed, false)}</b>{speedUnitLabel(settings.speed)}</span>
              <span><b>{convDist(a.distNm, settings.distance).toFixed(1)}</b>{distUnitLabel(settings.distance)}</span>
              {a.etaMin != null && a.phase !== 'DEPARTURE' && <span>ETA <b>{Math.round(a.etaMin)}m</b></span>}
              {a.reqSpacingNm && <span className={`spc ${a.wakeTight ? 'tight' : ''}`} title={`Required wake spacing behind ${a.leaderCs}`}>◂<b>{a.reqSpacingNm}</b>nm</span>}
              {a.reqDepGapSec && <span className="spc" title={`Wake-on-departure spacing behind ${a.depLeaderCs}`}>◂<b>{Math.round(a.reqDepGapSec / 60 * 10) / 10}</b>min</span>}
            </div>
            <div className="strip-bot">
              {/* Another airport's traffic gets no runway or stand here. */}
              {a.runway && !elsewhere && <span className="rwy">RWY {a.runway}</span>}
              {a.gate && !elsewhere && <span className="gate" title="Stand proposed by the engine — real gate assignments aren't public data">STAND {a.gate}?</span>}
              <RouteTag rd={rd} airport={airport} tab={tab} elsewhere={elsewhere} />
              {!rd.from && !rd.to && a.squawk && <span>SQ {a.squawk}</span>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

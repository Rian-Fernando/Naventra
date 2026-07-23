import { useState } from 'react';
import { PlaneLanding, PlaneTakeoff, CircleDot } from 'lucide-react';
import { fmtAlt } from '../lib/geo.js';
import { getRoute } from '../lib/route.js';
import { emergencyInfo } from '../lib/filters.js';

const TABS = [
  { key: 'ARR', label: 'Arrivals', icon: PlaneLanding, phases: ['ARRIVAL', 'APPROACH', 'FINAL'] },
  { key: 'DEP', label: 'Departures', icon: PlaneTakeoff, phases: ['DEPARTURE'] },
  { key: 'GND', label: 'Ground', icon: CircleDot, phases: ['GROUND'] },
];

const epMatches = (ep, ap) => !!ep && !!ap && (ep.icao === ap.icao || ep.iata === ap.iata);

export default function FlightStrips({ aircraft, conflicts, selectedId, onSelect, airline, airport }) {
  const [tab, setTab] = useState('ARR');
  const active = TABS.find((t) => t.key === tab);
  const conflictIds = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]));

  const rows = aircraft
    .filter((a) => active.phases.includes(a.phase))
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
          const n = aircraft.filter((a) => t.phases.includes(a.phase)).length;
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
          const rt = getRoute(a.callsign);
          const em = emergencyInfo(a);
          // Only trust the scheduled route when the endpoint at THIS field matches
          // (callsigns get reused): arrivals show origin, departures show dest.
          const endpoint = rt && (tab === 'DEP'
            ? (epMatches(rt.from, airport) ? rt.to : null)
            : (epMatches(rt.to, airport) ? rt.from : null));
          return (
          <div
            key={a.id}
            className={`strip ${a.id === selectedId ? 'sel' : ''} ${conflictIds.has(a.id) ? 'conflict' : ''} ${em ? 'emergency' : ''}`}
            onClick={() => onSelect(a.id === selectedId ? null : a.id)}
          >
            <div className="strip-top">
              <span className="strip-cs">{a.callsign}</span>
              <span className="strip-type">{a.type || '—'}</span>
              {em && <span className="emg">⚠ {em.label}{a.squawk ? ` ${a.squawk}` : ''}</span>}
              {a.seq != null && <span className="strip-seq">#{a.seq}</span>}
              <span className={`phase-chip phase-${a.phase}`} style={{ marginLeft: a.seq == null ? 'auto' : 0 }}>
                {a.phase}
              </span>
            </div>
            <div className="strip-mid">
              <span><b>{a.onGround ? 'GND' : fmtAlt(a.altFt)}</b></span>
              <span><b>{Math.round(a.gs)}</b>kt</span>
              <span><b>{a.distNm.toFixed(1)}</b>nm</span>
              {a.etaMin != null && a.phase !== 'DEPARTURE' && <span>ETA <b>{Math.round(a.etaMin)}m</b></span>}
            </div>
            <div className="strip-bot">
              {a.runway && <span className="rwy">RWY {a.runway}</span>}
              {a.gate && <span className="gate">STAND {a.gate}</span>}
              {endpoint && (
                <span className="route">{tab === 'DEP' ? '→' : '←'} {endpoint.iata || endpoint.city}</span>
              )}
              {!endpoint && a.squawk && <span>SQ {a.squawk}</span>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

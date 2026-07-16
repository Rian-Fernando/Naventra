import { useState } from 'react';
import { PlaneLanding, PlaneTakeoff, CircleDot } from 'lucide-react';
import { fmtAlt } from '../lib/geo.js';

const TABS = [
  { key: 'ARR', label: 'Arrivals', icon: PlaneLanding, phases: ['ARRIVAL', 'APPROACH', 'FINAL'] },
  { key: 'DEP', label: 'Departures', icon: PlaneTakeoff, phases: ['DEPARTURE'] },
  { key: 'GND', label: 'Ground', icon: CircleDot, phases: ['GROUND'] },
];

export default function FlightStrips({ aircraft, conflicts, selectedId, onSelect, airline }) {
  const [tab, setTab] = useState('ARR');
  const active = TABS.find((t) => t.key === tab);
  const conflictIds = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]));

  const rows = aircraft
    .filter((a) => active.phases.includes(a.phase))
    .filter((a) => !airline || (a.callsign || '').slice(0, 3).toUpperCase() === airline)
    .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || a.distNm - b.distNm);

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
        {rows.map((a) => (
          <div
            key={a.id}
            className={`strip ${a.id === selectedId ? 'sel' : ''} ${conflictIds.has(a.id) ? 'conflict' : ''}`}
            onClick={() => onSelect(a.id === selectedId ? null : a.id)}
          >
            <div className="strip-top">
              <span className="strip-cs">{a.callsign}</span>
              <span className="strip-type">{a.type || '—'}</span>
              {a.emergency && <span className="emg">⚠ {a.squawk}</span>}
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
              {a.squawk && <span>SQ {a.squawk}</span>}
              {a.operator && <span>{a.operator.slice(0, 22)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

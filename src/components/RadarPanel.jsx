import { useState } from 'react';
import { Radar } from 'lucide-react';
import RadarScope from './RadarScope.jsx';
import Radar3D from './Radar3D.jsx';
import SearchBox from './SearchBox.jsx';
import { makeVisible, presentAirlines } from '../lib/filters.js';

// Legend rows double as category filter toggles. `key` maps to prefs.filters.
const LEGEND = [
  ['#3ddc97', 'ARRIVAL / APPROACH', 'arr'],
  ['#4cc9f0', 'DEPARTURE', 'dep'],
  ['#4a6272', 'ENROUTE / OVERFLIGHT', 'enr'],
  ['#a78bfa', 'GROUND', 'gnd'],
  ['#ff5c5c', 'CONFLICT', null], // overlay, always shown
];

// Shared chrome for the scope: view toggle (3D / 2D), range, trails, labels,
// category filters (legend checkboxes) and an airline filter.
export default function RadarPanel(props) {
  const { airport, mode, aircraft, conflicts, view } = props;
  const scope = view?.prefs.radarView || '3D';
  const setScope = view?.setRadarView || (() => {});
  const [range, setRange] = useState(40);
  const [labels, setLabels] = useState('AUTO');
  const [showTrails, setShowTrails] = useState(true);

  const filters = view?.prefs.filters;
  const airline = view?.prefs.airline || null;
  const vis = makeVisible(filters, airline);
  const shownAircraft = aircraft.filter(vis);
  const shownConflicts = conflicts.filter((c) => vis(c.a) && vis(c.b));
  const airlines = presentAirlines(aircraft);

  const viewProps = { ...props, aircraft: shownAircraft, conflicts: shownConflicts, range, labels, showTrails };

  return (
    <div className="panel radar-panel">
      <div className="panel-head">
        <Radar size={14} color="var(--green)" />
        <span className="panel-title">Radar / TRACON — {airport.icao}</span>
        {scope === '3D' && <span className="mono-sm">drag to orbit · scroll to zoom</span>}
        <span className={`badge ${mode === 'LIVE' ? 'green' : mode === 'SIM' ? 'amber' : ''}`}>
          {mode === 'LIVE' ? '● LIVE ADS-B' : mode === 'SIM' ? '◌ SIMULATION' : '… ACQUIRING'}
        </span>
      </div>
      <div className="radar-body">
        {scope === '3D'
          ? <Radar3D {...viewProps} onUnavailable={() => setScope('2D')} />
          : <RadarScope {...viewProps} />}
        <SearchBox aircraft={aircraft} onSelect={props.onSelect} />
        <div className="radar-controls">
          <div className="rc-group">
            {['3D', '2D'].map((v) => (
              <button key={v} className={scope === v ? 'on' : ''} onClick={() => setScope(v)}>{v}</button>
            ))}
          </div>
          <div className="rc-group">
            {[10, 20, 40, 80].map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
          <div className="rc-group">
            <button className={showTrails ? 'on' : ''} onClick={() => setShowTrails(!showTrails)}>TRL</button>
            {['AUTO', 'ALL', 'OFF'].map((m) => (
              <button key={m} className={labels === m ? 'on' : ''} onClick={() => setLabels(m)}>{m}</button>
            ))}
          </div>
          {view && (
            <div className="rc-airline">
              <select value={airline || ''} onChange={(e) => view.setAirline(e.target.value)} title="Filter by airline">
                <option value="">All airlines</option>
                {airlines.map((a) => (
                  <option key={a.code} value={a.code}>{a.code} · {a.name} ({a.n})</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="radar-legend">
          {LEGEND.map(([c, t, key]) => {
            const active = !key || (filters ? filters[key] : true);
            return (
              <button
                key={t}
                className={`legend-row ${key ? 'toggle' : ''} ${active ? '' : 'off'}`}
                onClick={key && view ? () => view.toggleFilter(key) : undefined}
                disabled={!key || !view}
              >
                <i style={{ background: c, opacity: active ? 1 : 0.25 }} />{t}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

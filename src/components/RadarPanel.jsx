import { useState } from 'react';
import { Radar } from 'lucide-react';
import RadarScope from './RadarScope.jsx';
import Radar3D from './Radar3D.jsx';

const LEGEND = [
  ['#3ddc97', 'ARRIVAL / APPROACH'],
  ['#4cc9f0', 'DEPARTURE'],
  ['#4a6272', 'ENROUTE / OVERFLIGHT'],
  ['#a78bfa', 'GROUND'],
  ['#ff5c5c', 'CONFLICT'],
];

// Shared chrome for the scope: view toggle (3D perspective / 2D plan),
// range selection, trails + label modes, legend.
export default function RadarPanel(props) {
  const { airport, mode } = props;
  const [view, setView] = useState('3D');
  const [range, setRange] = useState(40);
  const [labels, setLabels] = useState('AUTO');
  const [showTrails, setShowTrails] = useState(true);

  const viewProps = { ...props, range, labels, showTrails };

  return (
    <div className="panel radar-panel">
      <div className="panel-head">
        <Radar size={14} color="var(--green)" />
        <span className="panel-title">Radar / TRACON — {airport.icao}</span>
        {view === '3D' && <span className="mono-sm">drag to orbit · scroll to zoom</span>}
        <span className={`badge ${mode === 'LIVE' ? 'green' : mode === 'SIM' ? 'amber' : ''}`}>
          {mode === 'LIVE' ? '● LIVE ADS-B' : mode === 'SIM' ? '◌ SIMULATION' : '… ACQUIRING'}
        </span>
      </div>
      <div className="radar-body">
        {view === '3D'
          ? <Radar3D {...viewProps} onUnavailable={() => setView('2D')} />
          : <RadarScope {...viewProps} />}
        <div className="radar-controls">
          <div className="rc-group">
            {['3D', '2D'].map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v}</button>
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
        </div>
        <div className="radar-legend">
          {LEGEND.map(([c, t]) => (
            <span key={t}><i style={{ background: c }} />{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

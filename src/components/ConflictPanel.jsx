import { AlertTriangle, ShieldCheck } from 'lucide-react';

export default function ConflictPanel({ conflicts, onSelect }) {
  return (
    <div className="panel" style={{ maxHeight: conflicts.length ? 220 : 92, transition: 'max-height 0.3s' }}>
      <div className="panel-head">
        <AlertTriangle size={14} color={conflicts.length ? 'var(--red)' : 'var(--green)'} />
        <span className="panel-title">Separation Monitor</span>
        <span className={`badge ${conflicts.length ? 'red' : 'green'}`}>
          {conflicts.length ? `${conflicts.length} ACTIVE` : 'CLEAR'}
        </span>
      </div>
      <div className="panel-body">
        {conflicts.length === 0 && (
          <div className="all-clear">
            <ShieldCheck size={15} />
            All pairs above minima — 3nm / 1,000ft maintained
          </div>
        )}
        {conflicts.map((c) => (
          <div key={c.id} className={`conflict-card ${c.severity}`} onClick={() => onSelect(c.a.id)} style={{ cursor: 'pointer' }}>
            <div className="conflict-pair">
              <span style={{ color: 'var(--red)' }}>{c.a.callsign}</span>
              <span className="vs">×</span>
              <span style={{ color: 'var(--red)' }}>{c.b.callsign}</span>
              <span className="conflict-sev">{c.severity === 'critical' ? '⚠ LOS' : '△ PREDICTED'}</span>
            </div>
            <div className="conflict-nums">
              <span>Now <b>{c.sepNowNm.toFixed(1)}nm</b></span>
              <span>CPA <b>{c.sepCpaNm.toFixed(1)}nm</b> in <b>{c.tCpaSec}s</b></span>
              <span>Vert <b>{c.vSepFt}ft</b></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

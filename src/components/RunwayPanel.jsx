import { Route } from 'lucide-react';

export default function RunwayPanel({ runways }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <Route size={14} color="var(--green)" />
        <span className="panel-title">Runway Allocation</span>
        <span className="badge green">WIND-OPTIMIZED</span>
      </div>
      <div className="panel-body">
        {runways.map((r) => (
          <div className="rwy-row" key={r.id}>
            <div className="rwy-id">{r.activeEnd}</div>
            <div className="rwy-bar">
              <div className={`rwy-strip-vis ${r.status === 'X-WIND' ? 'closed' : r.role === 'DEP' ? 'dep' : ''}`} />
              <div className="rwy-info">
                <span><b>{r.lenFt.toLocaleString()}</b>ft</span>
                <span>HW <b>{r.head >= 0 ? '+' : ''}{r.head}kt</b></span>
                <span>XW <b>{r.cross}kt</b></span>
                {r.hasIls && <span style={{ color: 'var(--green)' }}>ILS</span>}
                {r.status === 'X-WIND' && <span style={{ color: 'var(--amber)' }}>X-WIND ADVISORY</span>}
              </div>
            </div>
            <div className={`rwy-role ${r.role === 'DEP+ARR' ? 'BOTH' : r.role}`}>{r.role}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

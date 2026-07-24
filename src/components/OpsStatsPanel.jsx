import { Activity } from 'lucide-react';

// Tower operations rates — movements observed by this console over the trailing
// hour (arrivals + departures) — plus the Airport Acceptance Rate (capacity).
const STATUS_CLASS = { NOMINAL: 'green', BUSY: 'amber', SATURATED: 'red' };

export default function OpsStatsPanel({ opsStats, kpis, capacity }) {
  const o = opsStats || {};
  const c = capacity;
  return (
    <div className="panel wx-panel">
      <div className="panel-head">
        <Activity size={14} color="var(--green)" />
        <span className="panel-title">Tower Ops</span>
        <span className="badge">{o.movHr ?? 0}/HR</span>
      </div>
      {c && (
        <div className="cap">
          <div className="cap-head">
            <span>Acceptance rate <em>est.</em></span>
            <span className={`cap-status ${STATUS_CLASS[c.status] || 'green'}`}>{c.status}</span>
          </div>
          <div className="cap-main">
            <div className="cap-rate"><b>{c.aar}</b><span>AAR · arr/hr</span></div>
            <div className="cap-rate"><b>{c.adr}</b><span>ADR · dep/hr</span></div>
          </div>
          <div className="cap-bar"><i className={STATUS_CLASS[c.status] || 'green'} style={{ width: `${Math.min(100, c.utilPct)}%` }} /></div>
          <div className="cap-rows">
            <span>Inbound <b>{c.inbound}</b></span>
            <span>Spacing <b>{c.meanSpacingNm}nm</b></span>
            <span>Wx <b>{c.wxCat}</b></span>
            {c.delayMin > 0 ? <span className="cap-delay">Delay ~<b>{c.delayMin}m</b></span> : <span>Load <b>{c.utilPct}%</b></span>}
          </div>
        </div>
      )}
      <div className="wx-grid">
        <div className="wx-cell">
          <div className="v">{o.arrHr ?? 0}</div>
          <div className="k">Arrivals / hr</div>
        </div>
        <div className="wx-cell">
          <div className="v">{o.depHr ?? 0}</div>
          <div className="k">Departures / hr</div>
        </div>
        <div className="wx-cell">
          <div className="v">{o.movHr ?? 0}</div>
          <div className="k">Movements / hr</div>
        </div>
        <div className="wx-cell">
          <div className="v">{o.busiest ? o.busiest.runway : '—'}</div>
          <div className="k">Busiest rwy{o.busiest ? ` (${o.busiest.n})` : ''}</div>
        </div>
        <div className="wx-cell">
          <div className="v">{(kpis?.arrivals ?? 0) + (kpis?.departures ?? 0)}</div>
          <div className="k">Airborne now</div>
        </div>
        <div className="wx-cell">
          <div className="v">{kpis?.ground ?? 0}</div>
          <div className="k">On ground</div>
        </div>
      </div>
    </div>
  );
}

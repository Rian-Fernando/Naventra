import { Activity } from 'lucide-react';

// Tower operations rates — movements observed by this console over the
// trailing hour (arrivals + departures), like a tower's traffic count board.
export default function OpsStatsPanel({ opsStats, kpis }) {
  const o = opsStats || {};
  return (
    <div className="panel wx-panel">
      <div className="panel-head">
        <Activity size={14} color="var(--green)" />
        <span className="panel-title">Tower Ops</span>
        <span className="badge">{o.movHr ?? 0}/HR</span>
      </div>
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

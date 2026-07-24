import { CloudSun, ArrowRight, AlertTriangle, Wind } from 'lucide-react';

// Weather Outlook — projects the runway configuration and a disruption-risk
// estimate forward from the live TAF forecast. Shows when the wind will flip the
// runways and how operationally stressed the field is likely to get.
const RISK_CLASS = { LOW: 'green', MODERATE: 'amber', HIGH: 'red' };

function zulu(ts) {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

export default function ForecastPanel({ forecast, airport }) {
  const rows = forecast?.outlook || [];
  const peakRisk = rows.reduce((m, r) => Math.max(m, r.risk.pct), 0);
  const nextFlip = rows.find((r) => r.flip);

  return (
    <div className="panel wx-panel forecast-panel">
      <div className="panel-head">
        <CloudSun size={14} color="var(--cyan)" />
        <span className="panel-title">Weather Outlook</span>
        <span className={`badge ${peakRisk >= 55 ? 'red' : peakRisk >= 28 ? 'amber' : 'green'}`}>
          {peakRisk >= 55 ? 'HIGH RISK' : peakRisk >= 28 ? 'WATCH' : 'STABLE'}
        </span>
      </div>
      <div className="panel-body">
        {!forecast && <div className="empty-note">Loading forecast…</div>}
        {forecast && !rows.length && <div className="empty-note">No TAF forecast published for {airport.icao}.</div>}

        {nextFlip && (
          <div className="fc-flip">
            <Wind size={12} /> Runways flip to <b>{nextFlip.config}</b> around <b>{zulu(nextFlip.from)}</b>
          </div>
        )}

        {rows.map((r, i) => (
          <div className={`fc-row ${r.flip ? 'flip' : ''}`} key={i}>
            <div className="fc-time">{zulu(r.from)}<span>{zulu(r.to)}</span></div>
            <div className="fc-mid">
              <div className="fc-cfg">
                {r.flip && i > 0 && <ArrowRight size={11} color="var(--amber)" />}
                <b>{r.config}</b>
                <span className="fc-wind">
                  {r.windDir != null ? `${String(r.windDir).padStart(3, '0')}°` : 'VRB'}/{r.windKt}
                  {r.gustKt ? `G${r.gustKt}` : ''}kt
                </span>
              </div>
              {r.appCat !== 'VMC' && (
                <div className={`fc-cap ${r.lvp ? 'lvp' : ''}`}>
                  {r.catDrop && <ArrowRight size={10} />}{r.appCat} · ~{r.capacityPct}% capacity{r.lvp ? ' · LVP' : ''}
                </div>
              )}
              {r.risk.reasons.length > 0 && (
                <div className="fc-reasons">{r.risk.reasons.join(' · ')}</div>
              )}
            </div>
            <div className={`fc-risk ${RISK_CLASS[r.risk.level]}`} title={`Disruption-risk estimate: ${r.risk.pct}%`}>
              {r.risk.level === 'HIGH' && <AlertTriangle size={10} />}
              {r.risk.pct}%
            </div>
          </div>
        ))}

        {rows.length > 0 && (
          <div className="fc-foot">
            Disruption risk is a model estimate from forecast wind, gusts, visibility &amp; ceiling —
            not real cancellation data. <a href="/guide">How this works</a>
          </div>
        )}
      </div>
    </div>
  );
}

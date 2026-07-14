import { Target } from 'lucide-react';

// AI vs reality: locked predictions graded against observed outcomes.
export default function ScorecardPanel({ scorecard, mode }) {
  const sc = scorecard;
  const all = sc?.allTime;

  return (
    <div className="panel score-panel">
      <div className="panel-head">
        <Target size={14} color="var(--green)" />
        <span className="panel-title">AI Scorecard</span>
        <span className={`badge ${mode === 'LIVE' ? 'green' : 'amber'}`}>
          {mode === 'LIVE' ? 'LIVE-VERIFIED' : 'SIM · NOT BANKED'}
        </span>
      </div>

      <div className="score-hero">
        <div className="score-num">
          {all?.pct != null ? `${all.pct}%` : '—'}
        </div>
        <div className="score-sub">
          {all?.n ? (
            <>of <b>{all.n}</b> predictions correct<br />all-time · live data only</>
          ) : (
            <>no landings graded yet —<br />predictions lock as flights join approach</>
          )}
          {sc?.openCount > 0 && <div className="score-open">{sc.openCount} prediction{sc.openCount > 1 ? 's' : ''} locked &amp; awaiting touchdown</div>}
          {sc?.learned > 0 && <div className="score-learn">self-improving · learned from {sc.learned} live landing{sc.learned > 1 ? 's' : ''}</div>}
        </div>
      </div>

      {all?.n > 0 && (
        <div className="score-cats">
          {Object.entries(all.byCat).map(([cat, c]) => (
            <div className="score-cat" key={cat}>
              <span className="sc-name">{c.label}</span>
              <div className="sc-bar"><i style={{ width: `${c.pct ?? 0}%` }} /></div>
              <span className="sc-pct">{c.pct != null ? `${c.pct}%` : '—'}<em> ({c.n})</em></span>
            </div>
          ))}
        </div>
      )}

      {sc?.recent?.length > 0 && (
        <div className="panel-body score-recent">
          {sc.recent.slice(0, 12).map((e, idx) => (
            <div className="score-row" key={`${e.callsign}${e.ts}${idx}`}>
              <span className="sr-cs">{e.callsign}</span>
              <span className="sr-ap">{e.airport}{e.live ? '' : '·SIM'}</span>
              <span className="sr-grades">
                {e.items.map((i) => (
                  <span key={i.cat} className={i.ok ? 'ok' : 'miss'} title={`${i.cat}: predicted ${i.predicted} → ${i.actual}`}>
                    {i.ok ? '✓' : '✗'}{i.cat === 'runway' ? 'RWY' : i.cat === 'config' ? 'CFG' : i.cat === 'eta' ? 'ETA' : 'SEQ'}
                  </span>
                ))}
              </span>
              <span className="sr-time">{new Date(e.ts).toISOString().slice(11, 16)}Z</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

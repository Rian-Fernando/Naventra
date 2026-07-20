import { Target } from 'lucide-react';

// Rolling accuracy (trailing 8-landing window) from recent graded landings,
// oldest→newest, as an SVG polyline — shows the AI improving over time.
function Sparkline({ recent }) {
  const chron = [...recent].reverse();
  if (chron.length < 4) return null;
  const win = 8;
  const pts = chron.map((_, i) => {
    const slice = chron.slice(Math.max(0, i - win + 1), i + 1).flatMap((e) => e.items);
    const ok = slice.filter((it) => it.ok).length;
    return slice.length ? ok / slice.length : 0;
  });
  const W = 210, H = 34, n = pts.length;
  const path = pts.map((v, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H - v * (H - 4) - 2).toFixed(1)}`).join(' ');
  const last = Math.round(pts[pts.length - 1] * 100);
  return (
    <div className="score-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={`0,${H} ${path.split(' ')[0]}`} className="spark-base" />
        <polyline points={path} className="spark-line" />
      </svg>
      <span className="spark-lbl">accuracy trend · now {last}%</span>
    </div>
  );
}

// AI vs reality: locked predictions graded against observed outcomes.
export default function ScorecardPanel({ scorecard, mode, scope = 'session', globalTotals }) {
  const sc = scorecard;
  const all = sc?.allTime;
  const global = scope === 'global';
  const processed = (globalTotals?.learned || 0) + (globalTotals?.depOps || 0);

  return (
    <div className="panel score-panel">
      <div className="panel-head">
        <Target size={14} color="var(--green)" />
        <span className="panel-title">AI Scorecard</span>
        <span className={`badge ${global ? 'cyan' : mode === 'LIVE' ? 'green' : 'amber'}`}>
          {global ? '● GLOBAL · 24/7' : mode === 'LIVE' ? 'LIVE-VERIFIED' : 'SIM · NOT BANKED'}
        </span>
      </div>

      {globalTotals && (
        <div className="learn-strip" title="The always-on tracker runs 24/7, learning from every real landing it grades across JFK, LAX and LHR — and logging each as a labeled training row.">
          <span className="ls-dot" />
          <span className="ls-text">
            <b>{processed.toLocaleString()}</b> ops graded
            {globalTotals.samples > 0 && <> · <b>{globalTotals.samples.toLocaleString()}</b> training rows</>}
          </span>
          <span className="ls-tag">SELF-LEARNING · 24/7</span>
        </div>
      )}

      <div className="score-hero">
        <div className="score-num">
          {all?.pct != null ? `${all.pct}%` : '—'}
        </div>
        <div className="score-sub">
          {all?.n ? (
            <>of <b>{all.n}</b> predictions correct<br />{global ? 'always-on tracker · all visitors' : 'all-time · live data only'}</>
          ) : (
            <>no landings graded yet —<br />predictions lock as flights join approach</>
          )}
          {sc?.recent24?.pct != null && (
            <div className="score-24h">last 24h: <b>{sc.recent24.pct}%</b> <em>({sc.recent24.n})</em></div>
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

      {sc?.recent?.length >= 4 && <Sparkline recent={sc.recent} />}

      {sc?.recent?.length > 0 && (
        <div className="panel-body score-recent">
          {sc.recent.slice(0, 12).map((e, idx) => (
            <div className="score-row" key={`${e.callsign}${e.ts}${idx}`}>
              <span className="sr-cs">{e.callsign}</span>
              <span className="sr-ap">{e.airport}{e.live ? '' : '·SIM'}</span>
              <span className="sr-grades">
                {e.items.map((i) => (
                  <span key={i.cat} className={i.ok ? 'ok' : 'miss'} title={`${i.cat}: predicted ${i.predicted} → ${i.actual}`}>
                    {i.ok ? '✓' : '✗'}{i.cat === 'runway' ? 'RWY' : i.cat === 'config' ? 'CFG' : i.cat === 'eta' ? 'ETA' : i.cat === 'deprwy' ? 'DEP' : 'SEQ'}
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

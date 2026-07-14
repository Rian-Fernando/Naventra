import { Cpu } from 'lucide-react';

function timeStr(ts) {
  return new Date(ts).toISOString().slice(11, 19) + 'Z';
}

export default function AIDecisionFeed({ decisions }) {
  return (
    <div className="panel" style={{ flex: 1.4 }}>
      <div className="panel-head">
        <Cpu size={14} color="var(--green)" />
        <span className="panel-title">AI Decision Feed</span>
        <span className="badge green">NAVENTRA CORE · ONLINE</span>
      </div>
      <div className="panel-body">
        {decisions.length === 0 && (
          <div className="empty-note">Decision core standing by.<br />Actions log here as the sector is worked.</div>
        )}
        {decisions.map((d) => (
          <div key={d.id} className={`feed-item ${d.severity}`}>
            <div className="feed-top">
              <span className="feed-type">{d.type}</span>
              {d.aircraft.slice(0, 2).map((cs) => (
                <span key={cs} className="mono-sm" style={{ color: 'var(--cyan)' }}>{cs}</span>
              ))}
              <span className="feed-time">{timeStr(d.ts)}</span>
            </div>
            <div className="feed-title">{d.title}</div>
            <div className="feed-detail">{d.detail}</div>
            <div className="feed-meta">
              <div className="conf-bar"><i style={{ width: `${d.confidence}%` }} /></div>
              <span className="conf-lbl">{d.confidence}% CONF</span>
              <span className={`feed-status ${d.status}`} style={{ marginLeft: 'auto' }}>◆ {d.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

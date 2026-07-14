import { Radio } from 'lucide-react';

function timeStr(ts) {
  return new Date(ts).toISOString().slice(11, 19);
}

export default function CommsLog({ comms, airport }) {
  const latest = [...comms].reverse(); // newest first, column-reverse re-flips visually

  return (
    <div className="panel">
      <div className="panel-head">
        <Radio size={14} color="var(--green)" />
        <span className="panel-title">Radio Communications — VHF</span>
        <span className="mono-sm">TWR {airport.freqs.tower} · GND {airport.freqs.ground} · APP {airport.freqs.approach}</span>
        <div className="tx-indicator"><i /><i /><i /><i /></div>
      </div>
      <div className="panel-body comms-body">
        {latest.length === 0 && <div className="empty-note">Monitoring {airport.icao} frequencies…</div>}
        {latest.map((c) => (
          <div key={c.id} className={`comm-line ${c.kind}`}>
            <span className="comm-time">{timeStr(c.ts)}</span>
            <span className="comm-freq">{c.freq}</span>
            <span className="comm-from">{c.from}</span>
            <span className="comm-text">{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
        <span className="panel-title">Controller Phraseology</span>
        <span className="badge" title="Standard ICAO/FAA phraseology the decision engine generates for the real traffic on the scope. This is not recorded radio — live ATC audio isn't freely redistributable.">GENERATED</span>
        <span className="mono-sm">TWR {airport.freqs.tower} · GND {airport.freqs.ground} · APP {airport.freqs.approach}</span>
        <div className="tx-indicator"><i /><i /><i /><i /></div>
      </div>
      <div className="panel-body comms-body">
        {latest.length === 0 && <div className="empty-note">The engine&rsquo;s phraseology for {airport.icao} traffic appears here — generated from the live scope, not recorded radio.</div>}
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

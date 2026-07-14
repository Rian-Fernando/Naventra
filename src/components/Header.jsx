import { useEffect, useState } from 'react';
import { MapPin, BookOpen, ExternalLink } from 'lucide-react';
import { AIRPORT_LIST } from '../data/airports.js';

export default function Header({ airport, icao, setIcao, mode, source, forceSim, setForceSim, kpis, scorecard, onGuide }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const utc = now.toISOString().slice(11, 19);
  let local = '--:--:--';
  try {
    local = now.toLocaleTimeString('en-GB', { timeZone: airport.tz, hour12: false });
  } catch { /* unknown tz — keep placeholder */ }

  return (
    <header className="header">
      <div className="brand">
        <img className="brand-logo" src="/naventra-mark.svg" alt="Naventra — control tower in a radar sweep" width="30" height="30" />
        <div>
          <div className="brand-name">naventra</div>
          <div className="brand-sub">AI Air Traffic Command</div>
        </div>
      </div>

      <div className="facility">
        <MapPin size={13} color="var(--green)" />
        <select value={icao} onChange={(e) => setIcao(e.target.value)} title="Facility">
          {AIRPORT_LIST.map((a) => (
            <option key={a.icao} value={a.icao}>
              {a.iata} — {a.name}
            </option>
          ))}
        </select>
      </div>

      <button
        className={`livebtn ${mode === 'SIM' ? 'sim' : mode === 'CONNECTING' ? 'connecting' : ''}`}
        onClick={() => setForceSim(!forceSim)}
        title={forceSim ? 'Switch back to live ADS-B feed' : 'Force simulation mode'}
      >
        <span className="dot" />
        {mode === 'LIVE' ? 'LIVE OPS' : mode === 'SIM' ? 'SIM OPS' : 'ACQUIRING'}
        <span className="mono-sm" style={{ letterSpacing: 0 }}>{source ? `· ${source}` : ''}</span>
      </button>

      <a className={`nav-link ${onGuide ? 'on' : ''}`} href={onGuide ? '/' : '/guide'}>
        <BookOpen size={12} /> {onGuide ? 'CONSOLE' : 'GUIDE'}
      </a>
      <a className="nav-link" href="https://rianfernando.com" target="_blank" rel="noopener" title="Built by Rian Fernando">
        <ExternalLink size={12} /> RIANFERNANDO.COM
      </a>

      <div className="kpis">
        <div className="kpi"><b>{kpis.tracked}</b><span>Tracked</span></div>
        <div className="kpi ok"><b>{kpis.arrivals}</b><span>Arrivals</span></div>
        <div className="kpi cyan"><b>{kpis.departures}</b><span>Departures</span></div>
        <div className="kpi"><b>{kpis.ground}</b><span>Ground</span></div>
        <div className={`kpi ${kpis.conflicts ? 'alert' : 'ok'}`}><b>{kpis.conflicts}</b><span>Conflicts</span></div>
        <div className="kpi ok" title="All-time AI prediction accuracy on live traffic">
          <b>{scorecard?.allTime?.pct != null ? `${scorecard.allTime.pct}%` : '—'}</b><span>AI Score</span>
        </div>
      </div>

      <div className="clockbox">
        <div className="utc">{local}</div>
        <div className="lbl">{airport.iata} LOCAL · {utc}Z UTC</div>
      </div>
    </header>
  );
}

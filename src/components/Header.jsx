import { useEffect, useState } from 'react';
import { MapPin, BookOpen, ExternalLink } from 'lucide-react';
import { AIRPORT_LIST } from '../data/airports.js';
import { TRACKED_HUBS, trackerConfigured } from '../lib/globalModel.js';
import { useSettings } from '../hooks/useSettings.jsx';
import ConsoleMenu from './ConsoleMenu.jsx';
import SettingsModal from './SettingsModal.jsx';

export default function Header({ airport, icao, setIcao, mode, source, forceSim, setForceSim, kpis, scorecard, onGuide, view }) {
  const [now, setNow] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const { settings } = useSettings();
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const h12 = settings.clock === '12h';
  const utc = h12 ? now.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true }) : now.toISOString().slice(11, 19);
  let local = '--:--:--';
  try {
    local = now.toLocaleTimeString(h12 ? 'en-US' : 'en-GB', { timeZone: airport.tz, hour12: h12 });
  } catch { /* unknown tz — keep placeholder */ }

  return (
    <header className="header">
      {view && !onGuide && (
        <ConsoleMenu
          prefs={view.prefs} togglePanel={view.togglePanel} applyPreset={view.applyPreset} reset={view.reset}
          openSettings={() => setShowSettings(true)}
          startTour={() => window.dispatchEvent(new Event('nv-tour'))}
        />
      )}
      <a className="brand" href="/" title="Naventra home" style={{ textDecoration: 'none' }}>
        <img className="brand-logo" src="/naventra-mark.svg" alt="Naventra — control tower in a radar sweep" width="30" height="30" />
        <div>
          <div className="brand-name">Naventra</div>
          <div className="brand-sub">AI Air Traffic Command</div>
        </div>
      </a>

      <div className="facility">
        <MapPin size={13} color="var(--green)" />
        <select value={icao} onChange={(e) => setIcao(e.target.value)} title="Facility">
          {trackerConfigured ? (
            <>
              <optgroup label="Always-on hubs · 24/7 model">
                {AIRPORT_LIST.filter((a) => TRACKED_HUBS.includes(a.icao)).map((a) => (
                  <option key={a.icao} value={a.icao}>◉ {a.iata} — {a.name}</option>
                ))}
              </optgroup>
              <optgroup label="Live view · session learning">
                {AIRPORT_LIST.filter((a) => !TRACKED_HUBS.includes(a.icao)).map((a) => (
                  <option key={a.icao} value={a.icao}>{a.iata} — {a.name}</option>
                ))}
              </optgroup>
            </>
          ) : (
            AIRPORT_LIST.map((a) => (
              <option key={a.icao} value={a.icao}>{a.iata} — {a.name}</option>
            ))
          )}
        </select>
      </div>

      <button
        className={`livebtn ${mode === 'SIM' ? 'sim' : mode === 'CONNECTING' ? 'connecting' : ''}`}
        onClick={() => setForceSim(!forceSim)}
        title={forceSim ? 'Switch back to live ADS-B feed' : 'Force simulation mode'}
      >
        <span className="dot" />
        {mode === 'LIVE' ? 'LIVE OPS' : mode === 'SIM' ? 'SIM OPS' : 'ACQUIRING'}
        <span className="mono-sm livebtn-src" style={{ letterSpacing: 0 }}>{source ? `· ${source}` : ''}</span>
      </button>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <a className={`nav-link ${onGuide ? 'on' : ''}`} href={onGuide ? '/live' : '/guide'}>
        <BookOpen size={12} /> {onGuide ? 'CONSOLE' : 'GUIDE'}
      </a>
      <a className="nav-link nav-portfolio" href="https://rianfernando.com" target="_blank" rel="noopener" title="Built by Rian Fernando · rianfernando.com">
        <ExternalLink size={12} /> <span className="nav-label">RIANFERNANDO.COM</span>
      </a>

      <div className="kpis">
        <div className="kpi"><b>{kpis.tracked}</b><span>Tracked</span></div>
        <div className="kpi ok kpi-mid"><b>{kpis.arrivals}</b><span>Arrivals</span></div>
        <div className="kpi cyan kpi-lo"><b>{kpis.departures}</b><span>Departures</span></div>
        <div className="kpi kpi-lo"><b>{kpis.ground}</b><span>Ground</span></div>
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

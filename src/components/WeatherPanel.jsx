import { CloudSun } from 'lucide-react';
import { atisLetter } from '../lib/weather.js';

export default function WeatherPanel({ weather, airport }) {
  if (!weather) {
    return (
      <div className="panel wx-panel">
        <div className="panel-head">
          <CloudSun size={14} color="var(--green)" />
          <span className="panel-title">METAR / ATIS</span>
          <span className="badge">FETCHING…</span>
        </div>
      </div>
    );
  }

  const catColor = { VFR: 'green', MVFR: 'cyan', IFR: 'amber', LIFR: 'red' }[weather.fltCat] || 'green';

  return (
    <div className="panel wx-panel">
      <div className="panel-head">
        <CloudSun size={14} color="var(--green)" />
        <span className="panel-title">METAR / ATIS</span>
        <span className={`badge ${catColor}`}>{weather.fltCat}</span>
      </div>
      <div className="wx-grid">
        <div className="wx-cell">
          <div className="v">{weather.windDir != null ? `${String(weather.windDir).padStart(3, '0')}°` : 'VRB'} / {weather.windKt}{weather.gustKt ? `G${weather.gustKt}` : ''}</div>
          <div className="k">Wind kt</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.visib}<span style={{ fontSize: 10 }}>SM</span></div>
          <div className="k">Visibility</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.altimInHg ?? '—'}</div>
          <div className="k">Altimeter</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.tempC ?? '—'}° / {weather.dewpC ?? '—'}°</div>
          <div className="k">Temp / Dew</div>
        </div>
        <div className="wx-cell">
          <div className="v">{airport.elevFt}<span style={{ fontSize: 10 }}>ft</span></div>
          <div className="k">Field Elev</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.clouds[0] ? `${(weather.clouds[0].code || weather.clouds[0].cover).slice(0, 3).toUpperCase()} ${Math.round(weather.clouds[0].baseFt / 100)}` : 'CLR'}</div>
          <div className="k">Ceiling</div>
        </div>
      </div>
      <div className="wx-raw">{weather.raw}</div>
      <div className="wx-atis">
        Information <b>{atisLetter()}</b> current · source {weather.source} · Tower {airport.freqs.tower} · ATIS {airport.freqs.atis}
      </div>
    </div>
  );
}

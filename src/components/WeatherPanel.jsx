import { CloudSun } from 'lucide-react';
import { useSettings } from '../hooks/useSettings.jsx';
import { fmtTemp, fmtSpeed, speedUnitLabel } from '../lib/units.js';

// Age of the observation in plain words ("12 min ago"), from the report's own
// timestamp — never the time we fetched it.
function obsAge(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  const hhmm = new Date(t).toISOString().slice(11, 16);
  return { label: `${hhmm}Z`, ago: min < 1 ? 'just now' : min < 90 ? `${min} min ago` : `${Math.round(min / 60)} h ago`, min };
}

const STATUS_BADGE = {
  loading: ['', 'FETCHING…'],
  unavailable: ['red', 'UNAVAILABLE'],
};

export default function WeatherPanel({ weather, airport, status = 'ok' }) {
  const { settings } = useSettings();
  if (!weather) {
    const [cls, text] = STATUS_BADGE[status] || STATUS_BADGE.loading;
    return (
      <div className="panel wx-panel">
        <div className="panel-head">
          <CloudSun size={14} color="var(--green)" />
          <span className="panel-title">METAR / ATIS</span>
          <span className={`badge ${cls}`}>{text}</span>
        </div>
        {status === 'unavailable' && (
          <div className="panel-body">
            <div className="empty-note">
              No weather report available for {airport.icao} right now. Naventra doesn&rsquo;t invent weather — this
              fills in as soon as a real METAR arrives.
            </div>
          </div>
        )}
      </div>
    );
  }

  const catColor = { VFR: 'green', MVFR: 'cyan', IFR: 'amber', LIFR: 'red' }[weather.fltCat] || '';
  const age = obsAge(weather.obsTime);
  const stale = status === 'stale' || (age && age.min > 120);

  return (
    <div className="panel wx-panel">
      <div className="panel-head">
        <CloudSun size={14} color="var(--green)" />
        <span className="panel-title">METAR / ATIS</span>
        {stale && <span className="badge amber" title="The latest fetch failed or the report is over 2 h old">STALE</span>}
        <span className={`badge ${catColor}`} title="FAA flight category from the reported ceiling and visibility">{weather.fltCat || '—'}</span>
      </div>
      <div className="panel-body">
      <div className="wx-grid">
        <div className="wx-cell">
          <div className="v">{weather.windDir != null ? `${String(weather.windDir).padStart(3, '0')}°` : 'VRB'} / {fmtSpeed(weather.windKt, settings.speed, false)}{weather.gustKt ? `G${fmtSpeed(weather.gustKt, settings.speed, false)}` : ''}</div>
          <div className="k">Wind {speedUnitLabel(settings.speed)}</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.visib ?? '—'}{weather.visib != null && <span style={{ fontSize: 10 }}>SM</span>}</div>
          <div className="k">Visibility</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.altimInHg ?? '—'}</div>
          <div className="k">Altimeter</div>
        </div>
        <div className="wx-cell">
          <div className="v">{fmtTemp(weather.tempC, settings.temp)} / {fmtTemp(weather.dewpC, settings.temp)}</div>
          <div className="k">Temp / Dew</div>
        </div>
        <div className="wx-cell">
          <div className="v">{airport.elevFt}<span style={{ fontSize: 10 }}>ft</span></div>
          <div className="k">Field Elev</div>
        </div>
        <div className="wx-cell">
          <div className="v">{weather.clouds[0] ? `${(weather.clouds[0].code || weather.clouds[0].cover).slice(0, 3).toUpperCase()} ${Math.round(weather.clouds[0].baseFt / 100)}` : 'CLR'}</div>
          <div className="k">Lowest cloud</div>
        </div>
      </div>
      <div className="wx-raw">{weather.raw}</div>
      <div className="wx-atis">
        {age ? <>Observed <b>{age.label}</b> ({age.ago})</> : 'Observation time not reported'} · source {weather.source} ·
        Tower {airport.freqs.tower} · ATIS {airport.freqs.atis}
      </div>
      </div>
    </div>
  );
}

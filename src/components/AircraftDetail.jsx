import { radioName } from '../engine/atc.js';
import { fmtAlt } from '../lib/geo.js';

// Floating card over the radar for the selected track.
export default function AircraftDetail({ aircraft, onClose }) {
  if (!aircraft) return null;
  const a = aircraft;

  const rows = [
    ['Phase', a.phase],
    ['Altitude', a.onGround ? 'ON GROUND' : fmtAlt(a.altFt)],
    ['Ground speed', `${Math.round(a.gs)} kt`],
    ['Track', `${Math.round(a.track)}°`],
    ['V/S', `${a.vs > 0 ? '+' : ''}${Math.round(a.vs)} fpm`],
    ['Distance', `${a.distNm.toFixed(1)} nm`],
    ['Squawk', a.squawk || '—'],
    ['Registration', a.reg || '—'],
    a.seq != null ? ['Sequence', `#${a.seq}`] : null,
    a.runway ? ['Runway', a.runway] : null,
    a.gate ? ['Stand', a.gate] : null,
    a.etaMin != null ? ['ETA', `${Math.round(a.etaMin)} min`] : null,
  ].filter(Boolean);

  return (
    <div className="sel-detail">
      <div className="sel-cs">
        {a.callsign}
        <button onClick={onClose} title="Deselect">✕</button>
      </div>
      <div className="sel-sub">
        {radioName(a.callsign)}{a.desc ? ` · ${a.desc}` : a.type ? ` · ${a.type}` : ''}
        {a.operator ? ` · ${a.operator}` : ''}
      </div>
      <div className="sel-grid">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Unit conversion + formatting, driven by the user's display settings.
// Internally everything is knots / nautical miles / feet / °C; these format to
// whatever the user picked.

const KT_MPH = 1.15078, KT_KMH = 1.852;
const NM_KM = 1.852, NM_MI = 1.15078;
const FT_M = 0.3048;

export const speedUnitLabel = (u) => (u === 'mph' ? 'mph' : u === 'kmh' ? 'km/h' : 'kt');
export const distUnitLabel = (u) => (u === 'km' ? 'km' : u === 'mi' ? 'mi' : 'nm');

export function convSpeed(kt, u) {
  if (kt == null) return null;
  return u === 'mph' ? kt * KT_MPH : u === 'kmh' ? kt * KT_KMH : kt;
}
export function convDist(nm, u) {
  if (nm == null) return null;
  return u === 'km' ? nm * NM_KM : u === 'mi' ? nm * NM_MI : nm;
}

export function fmtTemp(c, u) {
  if (c == null) return '—';
  return u === 'F' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

// Speed with unit suffix (kt has no space, others do). withUnit=false → number only.
export function fmtSpeed(kt, u, withUnit = true) {
  if (kt == null) return '—';
  const v = Math.round(convSpeed(kt, u));
  if (!withUnit) return `${v}`;
  return u === 'kt' ? `${v}kt` : `${v} ${speedUnitLabel(u)}`;
}

export function fmtDist(nm, u, digits = 1) {
  if (nm == null) return '—';
  return `${convDist(nm, u).toFixed(digits)}${distUnitLabel(u)}`;
}

// Altitude: feet keeps the FL convention above 18,000 ft; metres are absolute.
export function fmtAltitude(ft, u) {
  if (ft == null) return '---';
  if (u === 'm') return `${Math.round(ft * FT_M).toLocaleString()}m`;
  return ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${(Math.round(ft / 100) * 100).toLocaleString()}ft`;
}
// Compact altitude for dense scope labels (FL nnn / feet-in-hundreds / metres).
export function fmtAltScope(ft, u, onGround) {
  if (onGround) return 'GND';
  if (ft == null) return '---';
  if (u === 'm') return `${Math.round(ft * FT_M)}m`;
  return ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${Math.round(ft / 100) * 100}`;
}

export function fmtWind(dir, kt, gust, u) {
  const d = dir != null ? `${String(dir).padStart(3, '0')}°` : 'VRB';
  return `${d} / ${fmtSpeed(kt, u)}${gust ? ` G${fmtSpeed(gust, u, false)}` : ''}`;
}

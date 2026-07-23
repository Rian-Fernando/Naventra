// Classify the live METAR into a visual-weather effect for the scope overlay.
// Reads the raw report for present-weather codes and falls back to visibility /
// wind so there's always something appropriate on screen.

export function classifyWeather(w) {
  if (!w) return { kind: 'clear', intensity: 0, windKt: 0, windDir: 0, label: '' };
  const raw = String(w.raw || '').toUpperCase();
  const windKt = w.windKt || 0;
  const windDir = w.windDir ?? 0;
  const vis = parseFloat(String(w.visib)) || 10;
  const heavy = /\+(RA|SN|TSRA|SHRA)/.test(raw);
  const light = /-(RA|SN|DZ)/.test(raw);
  const intensity = heavy ? 1 : light ? 0.4 : 0.7;
  const base = { windKt, windDir };

  if (/\bTS\b|TSRA|VCTS|\+TS/.test(raw)) return { kind: 'thunder', intensity: 1, ...base, label: 'Thunderstorm' };
  if (/SN|SG|GS|GR/.test(raw)) return { kind: 'snow', intensity, ...base, label: heavy ? 'Heavy snow' : 'Snow' };
  if (/RA|DZ|SH/.test(raw)) return { kind: 'rain', intensity, ...base, label: heavy ? 'Heavy rain' : light ? 'Light rain' : 'Rain' };
  if (/\bFG\b|\bBR\b|\bHZ\b|\bFU\b|\bMIFG\b/.test(raw) || vis < 2) {
    return { kind: 'fog', intensity: vis < 1 ? 1 : 0.6, ...base, label: vis < 1 ? 'Fog' : 'Mist / haze' };
  }
  if (windKt >= 24) return { kind: 'wind', intensity: Math.min(1, windKt / 40), ...base, label: `Strong wind ${Math.round(windKt)}kt` };
  return { kind: 'clear', intensity: 0, ...base, label: '' };
}

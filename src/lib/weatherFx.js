// Classify the live METAR into a visual-weather effect for the scope.
//
// Present weather appears ONLY in the report body, never in the remarks (RMK …),
// and only as whole, space-delimited tokens. So we strip the remarks first and
// match tokens exactly — otherwise remark text like "DSNT" (distant) or "TSNO"
// (thunderstorm info not available) is read as the substring "SN" and a clear
// summer day gets painted as snow.

// One WMO present-weather token: an optional intensity/proximity (+, -, VC), any
// descriptor(s), then one or more two-letter phenomena — anchored to token bounds.
const WX_TOKEN =
  /(?:^|\s)((?:[+-]|VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)*(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS|TS)+)(?=\s|$)/g;

export function classifyWeather(w) {
  if (!w) return { kind: 'clear', intensity: 0, windKt: 0, windDir: 0, label: '' };
  const raw = String(w.raw || '').toUpperCase();
  const windKt = w.windKt || 0;
  const windDir = w.windDir ?? 0;
  const vis = parseFloat(String(w.visib)) || 10;
  const base = { windKt, windDir };

  // Body only (drop remarks), then pull out just the present-weather tokens.
  const body = raw.split(/\bRMK\b/)[0];
  const wx = [...body.matchAll(WX_TOKEN)].map((m) => m[1]).join(' ');

  const heavy = /(?:^|\s)\+/.test(wx);
  const light = /(?:^|\s)-/.test(wx);
  const intensity = heavy ? 1 : light ? 0.4 : 0.7;

  if (/TS/.test(wx)) return { kind: 'thunder', intensity: 1, ...base, label: 'Thunderstorm' };
  if (/SN|SG|GS|GR|PL|IC/.test(wx)) return { kind: 'snow', intensity, ...base, label: heavy ? 'Heavy snow' : light ? 'Light snow' : 'Snow' };
  if (/RA|DZ/.test(wx)) return { kind: 'rain', intensity, ...base, label: heavy ? 'Heavy rain' : light ? 'Light rain' : 'Rain' };
  if (/FG|BR|HZ|FU|VA|DU|SA/.test(wx) || vis < 2) {
    return { kind: 'fog', intensity: vis < 1 ? 1 : 0.6, ...base, label: vis < 1 ? 'Fog' : 'Mist / haze' };
  }
  if (windKt >= 24) return { kind: 'wind', intensity: Math.min(1, windKt / 40), ...base, label: `Strong wind ${Math.round(windKt)}kt` };
  return { kind: 'clear', intensity: 0, ...base, label: '' };
}

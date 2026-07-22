// Real TAF (Terminal Aerodrome Forecast) ingestion + decode.
// Source: aviationweather.gov data API via /proxy/wx (free, keyless). A TAF is
// the airport's official forecast — wind, visibility, cloud and weather over the
// next ~24–30h, broken into change periods. We use it to project the runway
// configuration and a disruption-risk estimate before conditions actually shift.

function parseVis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes('+')) return parseFloat(s) || 6; // "6+" → 6sm or better
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

// Lowest broken/overcast layer = the ceiling (ft AGL).
function ceilingOf(clouds) {
  const bases = (clouds || [])
    .filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover))
    .map((c) => c.base)
    .filter((b) => typeof b === 'number');
  return bases.length ? Math.min(...bases) : null;
}

export async function fetchTaf(icao) {
  try {
    const res = await fetch(`/proxy/wx/api/data/taf?ids=${icao}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const arr = await res.json();
    const taf = Array.isArray(arr) ? arr[0] : arr;
    if (!taf || !Array.isArray(taf.fcsts)) return null;
    const now = Date.now();
    const periods = taf.fcsts
      .map((f) => ({
        from: f.timeFrom * 1000,
        to: f.timeTo * 1000,
        windDir: typeof f.wdir === 'number' ? f.wdir : null,
        windKt: f.wspd ?? 0,
        gustKt: f.wgst ?? null,
        visibSm: parseVis(f.visib),
        ceilingFt: ceilingOf(f.clouds),
        wx: f.wxString || '',
      }))
      .filter((p) => p.to > now)
      .slice(0, 6);
    if (!periods.length) return null;
    return { station: taf.icaoId || icao, issued: taf.issueTime || null, raw: taf.rawTAF || '', periods };
  } catch {
    return null;
  }
}

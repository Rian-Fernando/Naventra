// Real METAR ingestion + decode.
//
// Primary  : aviationweather.gov data API (all ICAO stations, via /proxy/wx)
// Fallback : api.weather.gov latest observation (US stations, CORS-open)
//
// If both fail we return null — never synthetic weather. Callers keep the last
// real report (with its observation time) or show weather as unavailable.

function decodeCover(cover) {
  return { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast', VV: 'vertical visibility', CLR: 'sky clear', SKC: 'sky clear', CAVOK: 'CAVOK' }[cover] || cover;
}

// FAA flight category from ceiling (lowest BKN/OVC/VV, ft) and visibility (sm).
export function flightCategory(ceilingFt, visSm) {
  const c = ceilingFt ?? Infinity;
  const v = visSm ?? Infinity;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

function fromAwc(m) {
  return {
    station: m.icaoId,
    raw: m.rawOb,
    windDir: typeof m.wdir === 'number' ? m.wdir : null, // 'VRB' → null
    windKt: m.wspd ?? 0,
    gustKt: m.wgst ?? null,
    visib: m.visib == null ? null : `${m.visib}`,
    tempC: m.temp ?? null,
    dewpC: m.dewp ?? null,
    altimInHg: m.altim ? (m.altim / 33.8639).toFixed(2) : null,
    qnhHpa: m.altim ? Math.round(m.altim) : null,
    fltCat: m.fltCat || null,
    clouds: (m.clouds || []).map((c) => ({ code: c.cover, cover: decodeCover(c.cover), baseFt: c.base })),
    obsTime: m.reportTime || (m.obsTime ? new Date(m.obsTime * 1000).toISOString() : null),
    source: 'aviationweather.gov',
  };
}

// Statute-mile visibility from a raw US METAR: P6SM, 10SM, 1/2SM, 1 1/2SM, M1/4SM.
function parseVisSm(raw) {
  const m = raw.match(/ (P|M)?(?:(\d+) )?(\d+)(?:\/(\d+))?SM /);
  if (!m) return null;
  const whole = m[2] ? parseInt(m[2], 10) : 0;
  const part = m[4] ? parseInt(m[3], 10) / parseInt(m[4], 10) : parseInt(m[3], 10);
  return { value: whole + part, plus: m[1] === 'P' };
}

export function parseRawMetar(raw, station, obsTime = null) {
  // Decode of a raw METAR string (fallback path).
  const wind = raw.match(/ (\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT/);
  const temp = raw.match(/ (M?\d{2})\/(M?\d{2}) /);
  const alt = raw.match(/ A(\d{4})/);
  const q = raw.match(/ Q(\d{4})/);
  const num = (s) => (s ? parseInt(s.replace('M', '-'), 10) : null);
  const clouds = [...raw.matchAll(/ (FEW|SCT|BKN|OVC|VV)(\d{3})/g)]
    .map((c) => ({ code: c[1], cover: decodeCover(c[1]), baseFt: parseInt(c[2], 10) * 100 }));
  const ceil = clouds.filter((c) => ['BKN', 'OVC', 'VV'].includes(c.code)).map((c) => c.baseFt);
  const vis = /CAVOK/.test(raw) ? { value: 10, plus: true } : parseVisSm(raw);
  return {
    station,
    raw: raw.trim(),
    windDir: wind && wind[1] !== 'VRB' ? parseInt(wind[1], 10) : null,
    windKt: wind ? parseInt(wind[2], 10) : 0,
    gustKt: wind && wind[3] ? parseInt(wind[3], 10) : null,
    visib: vis ? `${+vis.value.toFixed(2)}${vis.plus ? '+' : ''}` : null,
    tempC: temp ? num(temp[1]) : null,
    dewpC: temp ? num(temp[2]) : null,
    altimInHg: alt ? (parseInt(alt[1], 10) / 100).toFixed(2) : q ? (parseInt(q[1], 10) / 33.8639).toFixed(2) : null,
    qnhHpa: q ? parseInt(q[1], 10) : alt ? Math.round((parseInt(alt[1], 10) / 100) * 33.8639) : null,
    // Derived from the reported ceiling + visibility, never assumed.
    fltCat: vis || ceil.length ? flightCategory(ceil.length ? Math.min(...ceil) : null, vis?.value ?? null) : null,
    clouds,
    obsTime,
    source: 'weather.gov',
  };
}

export async function fetchMetar(icao) {
  try {
    const res = await fetch(`/proxy/wx/api/data/metar?ids=${icao}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length && arr[0].rawOb) return fromAwc(arr[0]);
    }
  } catch { /* fall through */ }

  if (icao.startsWith('K')) {
    try {
      const res = await fetch(`https://api.weather.gov/stations/${icao}/observations/latest`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/geo+json' },
      });
      if (res.ok) {
        const obs = await res.json();
        const p = obs?.properties;
        if (p?.rawMessage) return parseRawMetar(` ${p.rawMessage} `, icao, p.timestamp || null);
      }
    } catch { /* fall through */ }
  }
  return null;
}

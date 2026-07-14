// Real METAR ingestion + decode.
//
// Primary  : aviationweather.gov data API (all ICAO stations, via /proxy/wx)
// Fallback : api.weather.gov latest observation (US stations, CORS-open)
// Final    : deterministic synthetic weather so the console never goes blank.

function decodeCover(cover) {
  return { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast', CLR: 'sky clear', CAVOK: 'CAVOK' }[cover] || cover;
}

function fromAwc(m) {
  return {
    station: m.icaoId,
    raw: m.rawOb,
    windDir: typeof m.wdir === 'number' ? m.wdir : null, // 'VRB' → null
    windKt: m.wspd ?? 0,
    gustKt: m.wgst ?? null,
    visib: typeof m.visib === 'string' ? m.visib : `${m.visib}`,
    tempC: m.temp ?? null,
    dewpC: m.dewp ?? null,
    altimInHg: m.altim ? (m.altim / 33.8639).toFixed(2) : null,
    qnhHpa: m.altim ? Math.round(m.altim) : null,
    fltCat: m.fltCat || 'VFR',
    clouds: (m.clouds || []).map((c) => ({ code: c.cover, cover: decodeCover(c.cover), baseFt: c.base })),
    obsTime: m.reportTime || null,
    source: 'aviationweather.gov',
  };
}

function parseRawMetar(raw, station) {
  // Minimal decode of a raw METAR string (fallback path).
  const wind = raw.match(/ (\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT/);
  const temp = raw.match(/ (M?\d{2})\/(M?\d{2}) /);
  const alt = raw.match(/ A(\d{4})/);
  const q = raw.match(/ Q(\d{4})/);
  const num = (s) => (s ? parseInt(s.replace('M', '-'), 10) : null);
  return {
    station,
    raw,
    windDir: wind && wind[1] !== 'VRB' ? parseInt(wind[1], 10) : null,
    windKt: wind ? parseInt(wind[2], 10) : 0,
    gustKt: wind && wind[3] ? parseInt(wind[3], 10) : null,
    visib: /CAVOK/.test(raw) ? '10+' : (raw.match(/ (\d{1,2})SM /) || [])[1] || '10',
    tempC: temp ? num(temp[1]) : null,
    dewpC: temp ? num(temp[2]) : null,
    altimInHg: alt ? (parseInt(alt[1], 10) / 100).toFixed(2) : q ? (parseInt(q[1], 10) / 33.8639).toFixed(2) : null,
    qnhHpa: q ? parseInt(q[1], 10) : alt ? Math.round((parseInt(alt[1], 10) / 100) * 33.8639) : null,
    fltCat: 'VFR',
    clouds: [],
    obsTime: null,
    source: 'weather.gov',
  };
}

function synthetic(icao) {
  // Seeded by station + hour so it is stable between polls.
  const seed = [...icao].reduce((a, c) => a + c.charCodeAt(0), new Date().getUTCHours());
  const dir = (seed * 37) % 360;
  return {
    station: icao,
    raw: `${icao} ${String(new Date().getUTCDate()).padStart(2, '0')}${String(new Date().getUTCHours()).padStart(2, '0')}50Z ${String(Math.round(dir / 10) * 10).padStart(3, '0')}${String(8 + (seed % 9)).padStart(2, '0')}KT 10SM FEW045 SCT120 18/09 A3002 (SIMULATED)`,
    windDir: Math.round(dir / 10) * 10,
    windKt: 8 + (seed % 9),
    gustKt: null,
    visib: '10+',
    tempC: 18,
    dewpC: 9,
    altimInHg: '30.02',
    qnhHpa: 1016,
    fltCat: 'VFR',
    clouds: [
      { code: 'FEW', cover: 'few', baseFt: 4500 },
      { code: 'SCT', cover: 'scattered', baseFt: 12000 },
    ],
    obsTime: new Date().toISOString(),
    source: 'simulated',
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
        if (obs?.properties?.rawMessage) return parseRawMetar(` ${obs.properties.rawMessage} `, icao);
      }
    } catch { /* fall through */ }
  }
  return synthetic(icao);
}

// ATIS information letter cycles hourly, like the real thing.
export function atisLetter() {
  const letters = 'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL INDIA JULIETT KILO LIMA MIKE NOVEMBER OSCAR PAPA QUEBEC ROMEO SIERRA TANGO UNIFORM VICTOR WHISKEY XRAY YANKEE ZULU'.split(' ');
  return letters[(new Date().getUTCHours() + new Date().getUTCDate()) % letters.length];
}

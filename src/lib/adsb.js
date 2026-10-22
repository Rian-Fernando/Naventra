// Live ADS-B ingestion with multi-source failover.
//
// Primary  : adsb.lol — keyless, dynamic load-based limits, data under ODbL 1.0
// Fallback : adsb.fi  — 1 req/s, personal non-commercial use, cite + link adsb.fi
// Both are reached through the /proxy/* rewrites (no CORS): the vite dev proxy
// locally, vercel.json / netlify.toml in prod.
//
// airplanes.live was removed: it closed its public API to non-feeders (Aug 2026).
// Both sources return the same readsb JSON schema, so one normalizer serves both.

const SOURCES = [
  {
    id: 'adsb.lol',
    url: (lat, lon, r) => `/proxy/adsblol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(r)}`,
  },
  {
    id: 'adsb.fi',
    url: (lat, lon, r) => `/proxy/adsbfi/api/v3/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(r)}`,
  },
];

let preferred = 0; // sticky index of the last source that worked

function normalize(raw, now) {
  const alt = raw.alt_baro === 'ground' ? 0 : raw.alt_baro;
  if (raw.lat == null || raw.lon == null) return null;
  return {
    id: raw.hex,
    callsign: (raw.flight || '').trim() || raw.r || raw.hex.toUpperCase(),
    reg: raw.r || null,
    type: raw.t || null,
    desc: raw.desc || null,
    operator: raw.ownOp || null,
    lat: raw.lat,
    lon: raw.lon,
    altFt: typeof alt === 'number' ? alt : null,
    gs: raw.gs ?? 0,
    track: raw.track ?? raw.true_heading ?? 0,
    vs: raw.baro_rate ?? raw.geom_rate ?? 0,
    squawk: raw.squawk || null,
    category: raw.category || null,
    onGround: raw.alt_baro === 'ground',
    emergency: raw.emergency && raw.emergency !== 'none' ? raw.emergency : null,
    seenAt: now - (raw.seen_pos ?? raw.seen ?? 0) * 1000,
  };
}

export async function fetchLiveTraffic(lat, lon, radiusNm) {
  const order = [...SOURCES.keys()].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  let lastErr = null;

  for (const idx of order) {
    const src = SOURCES[idx];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(src.url(lat, lon, radiusNm), { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`${src.id} HTTP ${res.status}`);
      const data = await res.json();
      const list = data.ac || data.aircraft || [];
      const now = Date.now();
      const aircraft = list.map((a) => normalize(a, now)).filter(Boolean);
      preferred = idx;
      return { aircraft, source: src.id };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('all ADS-B sources failed');
}

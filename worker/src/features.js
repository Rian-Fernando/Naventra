// Feature engineering for the training dataset. Every graded landing becomes
// one labeled row whose inputs are the full situation at lock time. All of it
// is derived — free and keyless — from the ADS-B track, the METAR, the airport
// spec, and the clock. This is the data an actual ML model would train on.

import { windComponents } from '../../src/lib/geo.js';
import { octantOf } from '../../src/engine/octant.js';

// ICAO type designator → wake turbulence category: J super, H heavy, M medium,
// L light. Drives spacing and, at some fields, runway assignment.
const WAKE_SUPER = new Set(['A388', 'A124', 'A225']);
const WAKE_HEAVY = new Set([
  'A332', 'A333', 'A337', 'A338', 'A339', 'A342', 'A343', 'A345', 'A346',
  'A359', 'A35K', 'A388', 'B742', 'B743', 'B744', 'B748', 'B752', 'B753',
  'B762', 'B763', 'B764', 'B772', 'B77L', 'B77W', 'B778', 'B779', 'B788',
  'B789', 'B78X', 'MD11', 'A306', 'A310', 'IL96', 'DC10', 'C17', 'A400',
]);
const WAKE_LIGHT = new Set([
  'C172', 'C152', 'C182', 'C206', 'C210', 'SR20', 'SR22', 'PA28', 'PA34',
  'PA46', 'DA40', 'DA42', 'BE36', 'BE58', 'C72R', 'P28A', 'P28R', 'AA5',
  'DR40', 'TBM9', 'PC12', 'C25A', 'C25B', 'C25C', 'C525', 'E50P', 'EA50',
  'R44', 'R66', 'EC30', 'AS50', 'B06', 'H500', 'S76', 'B407', 'EC35',
]);

export function wakeCat(type) {
  if (!type) return null;
  if (WAKE_SUPER.has(type)) return 'J';
  if (WAKE_HEAVY.has(type)) return 'H';
  if (WAKE_LIGHT.has(type)) return 'L';
  return 'M';
}

// Decode the AWC METAR JSON into the fields the model cares about.
export function decodeWx(m) {
  if (!m) return null;
  const clouds = m.clouds || [];
  const ceil = clouds
    .filter((c) => c.cover === 'BKN' || c.cover === 'OVC')
    .map((c) => c.base)
    .filter((b) => typeof b === 'number');
  return {
    windDir: typeof m.wdir === 'number' ? m.wdir : null,
    windKt: m.wspd ?? 0,
    gustKt: m.wgst ?? null,
    visib: typeof m.visib === 'number' ? m.visib : (m.visib === '10+' ? 10 : parseFloat(m.visib) || null),
    ceilingFt: ceil.length ? Math.min(...ceil) : null,
    fltCat: m.fltCat || null,
    tempC: m.temp ?? null,
    dewpC: m.dewp ?? null,
    qnhHpa: m.altim ? Math.round(m.altim) : null,
  };
}

function localHour(tz, d) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d), 10) % 24;
  } catch {
    return d.getUTCHours();
  }
}

// The full lock-time feature vector for one committed arrival.
export function lockFeatures(ac, airport, ctx) {
  const { wx, rwys, arrEnds, depEnds, inbound, sector, arrRate1h, predRunway, predEtaTs } = ctx;
  const d = new Date();

  // Wind components relative to the runway the AI predicted.
  const predRwy = rwys.find((r) => r.activeEnd === predRunway);
  let head = null, cross = null;
  if (predRwy && wx?.windDir != null) {
    const c = windComponents(predRwy.activeHdg, wx.windDir, wx.windKt);
    head = c.head; cross = c.cross;
  }

  return {
    // --- geometry / kinematics at lock ---
    octant: octantOf(ac.brgFromField),
    brg: Math.round(ac.brgFromField),
    dist_nm: +ac.distNm.toFixed(1),
    alt_ft: ac.altFt,
    agl_ft: ac.agl,
    gs_kt: Math.round(ac.gs),
    vs_fpm: Math.round(ac.vs),
    // --- airframe ---
    type: ac.type || null,
    wake: wakeCat(ac.type),
    airline: (ac.callsign || '').slice(0, 3),
    // --- weather ---
    wind_dir: wx?.windDir ?? null,
    wind_kt: wx?.windKt ?? null,
    gust_kt: wx?.gustKt ?? null,
    head_kt: head,
    cross_kt: cross,
    visib_sm: wx?.visib ?? null,
    ceiling_ft: wx?.ceilingFt ?? null,
    flt_cat: wx?.fltCat ?? null,
    temp_c: wx?.tempC ?? null,
    qnh_hpa: wx?.qnhHpa ?? null,
    // --- time ---
    hour_utc: d.getUTCHours(),
    hour_local: localHour(airport.tz, d),
    dow: d.getUTCDay(),
    // --- configuration & load ---
    active_arr: arrEnds.join(','),
    active_dep: depEnds.join(','),
    n_arr_rwy: arrEnds.length,
    inbound_count: inbound,
    sector_count: sector,
    arr_rate_1h: arrRate1h,
    seq_rwy: ac.seqRwy ?? null,
    // --- the AI's plan being tested ---
    pred_runway: predRunway,
    pred_eta_ts: predEtaTs,
  };
}

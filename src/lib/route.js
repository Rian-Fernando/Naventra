// Flight route lookup — origin/destination airports by callsign, from the free,
// keyless, CORS-open adsbdb.com API, fetched by each visitor's browser and shown
// live. Results are cached (memory + localStorage) because a callsign's route is
// stable within a day, and lookups are paced so we stay a polite client.
//
// License: adsbdb's route data is the work of David Taylor (Edinburgh) and Jim
// Mason (Glasgow) and may not be copied, published or incorporated into other
// databases without permission. So routes are only DISPLAYED: they never go
// into the tracker, its D1 database or the downloadable dataset.
//
// Whether a looked-up route actually fits the aircraft is decided separately
// (src/lib/routeMatch.js) — flight numbers get reused for other city pairs.

import { isAirlineCallsign } from './routeMatch.js';

const CACHE = new Map();   // callsign -> route | null (null = looked up, none on file)
const inflight = new Set();
const queue = [];
let active = 0;
let lastStart = 0;
const MAX_CONCURRENT = 2;
const GAP_MS = 150;        // between request starts
const STORE = 'nv-routes-v2';
const ROUTE_TTL = 2 * 24 * 3600 * 1000;
const NONE_TTL = 12 * 3600 * 1000;    // "no route on file" is rechecked twice a day

try {
  const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
  const now = Date.now();
  for (const [cs, v] of Object.entries(raw)) {
    if (v && now - v.t < (v.r ? ROUTE_TTL : NONE_TTL)) CACHE.set(cs, v.r);
  }
} catch { /* ignore */ }

const stamps = new Map(); // callsign -> when it was looked up
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const o = {};
      for (const [cs, r] of CACHE) o[cs] = { r, t: stamps.get(cs) || Date.now() };
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch { /* full/denied */ }
  }, 1500);
}

function mapAirport(a) {
  if (!a) return null;
  return { iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, lat: a.latitude, lon: a.longitude };
}

async function run(cs) {
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const fr = (await res.json())?.response?.flightroute;
      CACHE.set(cs, fr?.origin && fr?.destination
        ? { airline: fr.airline?.name || null, from: mapAirport(fr.origin), via: mapAirport(fr.midpoint), to: mapAirport(fr.destination) }
        : null);
      stamps.set(cs, Date.now());
      persist();
    } else if (res.status === 404) {
      CACHE.set(cs, null); // definitively no route on file
      stamps.set(cs, Date.now());
      persist();
    }
    // other statuses: leave uncached so it can retry later
  } catch { /* transient network/timeout — allow retry */ }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const wait = lastStart + GAP_MS - Date.now();
    if (wait > 0) { setTimeout(pump, wait); return; }
    const cs = queue.shift();
    if (CACHE.has(cs) || inflight.has(cs)) continue;
    inflight.add(cs);
    active++;
    lastStart = Date.now();
    run(cs).finally(() => { inflight.delete(cs); active--; pump(); });
  }
}

// The cached route: an object, null (none on file), or undefined (not known yet).
export function getRoute(cs) {
  return CACHE.has(cs) ? CACHE.get(cs) : undefined;
}

// Queue callsigns for lookup, most relevant first (callers pass them sorted),
// capped per call so a busy sector doesn't flood the queue.
export function prefetchRoutes(callsigns, cap = 30) {
  let added = 0;
  for (const cs of callsigns) {
    if (added >= cap) break;
    if (!isAirlineCallsign(cs) || CACHE.has(cs) || inflight.has(cs) || queue.includes(cs)) continue;
    queue.push(cs);
    added++;
  }
  if (added) pump();
}

// Await a single route (the detail card on selection) — jumps the queue.
export async function fetchRoute(cs) {
  if (CACHE.has(cs)) return CACHE.get(cs);
  if (!isAirlineCallsign(cs)) return null;
  if (!inflight.has(cs)) {
    const i = queue.indexOf(cs);
    if (i >= 0) queue.splice(i, 1);
    inflight.add(cs); active++;
    await run(cs);
    inflight.delete(cs); active--; pump();
  }
  return CACHE.has(cs) ? CACHE.get(cs) : undefined;
}

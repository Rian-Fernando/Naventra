// Flight route lookup — origin/destination airports by callsign, from the free,
// keyless, CORS-open adsbdb.com API. Results are cached (memory + localStorage)
// because a callsign's route is stable within a day, and fetches are throttled
// so we stay a polite client. Only arrival/departure callsigns are prefetched;
// everything reads the shared cache during the app's normal re-renders.

const CACHE = new Map();   // callsign -> route | null (null = looked up, none)
const inflight = new Set();
const queue = [];
let active = 0;
const MAX_CONCURRENT = 2;
const STORE = 'nv-routes-v1';

try {
  const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000; // 2-day TTL
  for (const [cs, v] of Object.entries(raw)) if (v && v.t > cutoff) CACHE.set(cs, v.r);
} catch { /* ignore */ }

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const o = {};
      for (const [cs, r] of CACHE) if (r) o[cs] = { r, t: Date.now() };
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
        ? { airline: fr.airline?.name || null, from: mapAirport(fr.origin), to: mapAirport(fr.destination) }
        : null);
      persist();
    } else if (res.status === 404) {
      CACHE.set(cs, null); // definitively no route on file
    }
    // other statuses: leave uncached so it can retry later
  } catch { /* transient network/timeout — allow retry */ }
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const cs = queue.shift();
    if (CACHE.has(cs) || inflight.has(cs)) continue;
    inflight.add(cs);
    active++;
    run(cs).finally(() => { inflight.delete(cs); active--; pump(); });
  }
}

// Valid airline callsigns only (3-letter prefix + digits) — skips registrations.
function isAirlineCallsign(cs) {
  return /^[A-Z]{3}[0-9]/.test(cs || '');
}

export function getRoute(cs) {
  return CACHE.get(cs) || null;
}

export function requestRoute(cs) {
  if (!isAirlineCallsign(cs) || CACHE.has(cs) || inflight.has(cs) || queue.includes(cs)) return;
  queue.push(cs);
  pump();
}

// Prefetch routes for a set of callsigns (arrivals + departures), capped so a
// busy sector doesn't flood the queue.
export function prefetchRoutes(callsigns) {
  let added = 0;
  for (const cs of callsigns) {
    if (added >= 24) break;
    if (!isAirlineCallsign(cs) || CACHE.has(cs) || inflight.has(cs) || queue.includes(cs)) continue;
    queue.push(cs);
    added++;
  }
  if (added) pump();
}

// Await a single route (used by the detail card on selection).
export async function fetchRoute(cs) {
  if (CACHE.has(cs)) return CACHE.get(cs);
  if (!isAirlineCallsign(cs)) return null;
  if (!inflight.has(cs)) { inflight.add(cs); active++; await run(cs); inflight.delete(cs); active--; pump(); }
  return CACHE.get(cs) || null;
}

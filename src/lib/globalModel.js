// Bridge to the always-on Cloudflare tracker. When configured (and reachable),
// the console shows the GLOBAL, continuously-learned scorecard — the model that
// has been running 24/7 across all visitors — instead of the per-browser one.
// If unset or unreachable, the app silently falls back to local learning.

// Set at build time via VITE_TRACKER_URL (see .env.example). No trailing slash.
const BASE = import.meta.env.VITE_TRACKER_URL || '';

export const trackerConfigured = !!BASE;

// Hubs the always-on tracker monitors 24/7. Other airports show the local
// per-session scorecard instead of the global one.
export const TRACKED_HUBS = ['KJFK', 'KLAX', 'EGLL'];

export async function fetchGlobalScorecard(icao) {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/scorecard?icao=${encodeURIComponent(icao)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Learned priors for the whole fleet, so the live console's runway predictions
// also benefit from what the 24/7 tracker has learned.
export async function fetchGlobalModels() {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/api/model`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Build a priorFn (icao, octant, end) -> [0,1] from fetched global models,
// matching src/engine/learning.js semantics.
export function priorFnFromModels(payload) {
  const models = payload?.models || {};
  return (icao, oct, end) => {
    const bucket = models[icao]?.rwy?.[oct];
    if (!bucket) return 0;
    const total = Object.values(bucket).reduce((a, b) => a + b, 0);
    if (total < 2) return 0;
    return (bucket[end] || 0) / (total + 2);
  };
}

// Which hubs the tracker polls, and the daily adsb.lol request budget.
//
// adsb.lol meters /v2 (Nov 2026): 500 requests/day per IP without a key,
// 1,000/day with the free key, 7,200/day with a free feeder key. So which hubs
// run, and how often, is set in wrangler.toml [vars] (TRACKED_HUBS,
// TICK_EVERY_MIN), and the scheduler checks the budget before every tick —
// stopping for the day rather than running past it. With the configured
// cadence (one hub every 2 minutes ≈ 720/day) the cap should never be reached.

import { AIRPORTS } from '../../src/data/airports.js';

// Hubs with tracker history in D1 (all three were polled every minute,
// Jul–Nov 2026), and the ones polled now.
export const DATA_HUBS = ['KJFK', 'KLAX', 'EGLL'];

export function activeHubs(env) {
  const list = String(env?.TRACKED_HUBS || 'KJFK').split(',').map((x) => x.trim().toUpperCase()).filter((i) => AIRPORTS[i]);
  return list.length ? [...new Set(list)] : ['KJFK'];
}

export const knownHubs = (env) => [...new Set([...DATA_HUBS, ...activeHubs(env)])];

// Budget per UTC day, counted in the tick heartbeat.
export function dayBudget(prevQuota, now, cap, perTick) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = prevQuota?.day === day ? prevQuota.used || 0 : 0;
  return { day, used, cap, allowed: used + perTick <= cap };
}

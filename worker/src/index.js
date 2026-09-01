// Naventra always-on tracker.
//   scheduled()  — every minute: tick each hub, grade landings, learn.
//   fetch()      — read API for the frontend:
//     GET /api/scorecard[?icao=KJFK]   global accuracy + recent landings
//     GET /api/model                    learned model params (all airports)
//     GET /api/health                   liveness + tracked hubs

import { tickAirport, TRACKED } from './tracker.js';
import { getScorecard, getModels, datasetCount, datasetRows } from './store.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200, maxAge = 30) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}`, ...CORS },
  });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all(
      TRACKED.map((icao) =>
        tickAirport(env, icao).catch((e) => ({ icao, error: String(e && e.message || e) }))
      )
    ).then((r) => console.log('tick', JSON.stringify(r))));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Edge cache: serve repeated reads from the colo without touching D1. A Worker
    // does NOT cache its own responses from Cache-Control alone — we do it via the
    // Cache API. This caps D1 rows_read at ~one computation per TTL per colo, no
    // matter how many visitors poll the scorecard.
    const cache = caches.default;
    if (req.method === 'GET') {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    const served = (resp) => {
      if (req.method === 'GET' && resp.ok) ctx.waitUntil(cache.put(req, resp.clone()));
      return resp;
    };

    try {
      if (url.pathname === '/api/scorecard') {
        const icao = url.searchParams.get('icao') || null;
        return served(json(await getScorecard(env.DB, icao && TRACKED.includes(icao) ? icao : null), 200, 30));
      }
      if (url.pathname === '/api/model') {
        return served(json({ tracked: TRACKED, models: await getModels(env.DB) }, 200, 300));
      }
      if (url.pathname === '/api/health') {
        return served(json({ ok: true, tracked: TRACKED, samples: await datasetCount(env.DB), ts: Date.now() }, 200, 60));
      }
      // Training dataset as JSONL (one labeled landing per line) for offline ML.
      if (url.pathname === '/api/dataset.jsonl') {
        const icao = url.searchParams.get('icao');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000', 10) || 5000, 20000);
        const rows = await datasetRows(env.DB, icao && TRACKED.includes(icao) ? icao : null, limit);
        return served(new Response(rows.join('\n') + (rows.length ? '\n' : ''), {
          headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'public, max-age=300', ...CORS },
        }));
      }
      // Manual trigger for local testing / first warm-up (harmless in prod). Never cached.
      if (url.pathname === '/api/tick') {
        const r = await Promise.all(TRACKED.map((i) =>
          tickAirport(env, i).catch((e) => {
            console.error('tickAirport failed', i, e);
            return { icao: i, error: 'tick failed' };
          })
        ));
        return json({ ticked: r }, 200, 0);
      }
    } catch (e) {
      console.error('Unhandled fetch error', e);
      return json({ error: 'internal server error' }, 500, 0);
    }
    return json({ error: 'not found', endpoints: ['/api/scorecard', '/api/model', '/api/health', '/api/dataset.jsonl'] }, 404, 0);
  },
};

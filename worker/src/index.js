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

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15', ...CORS },
  });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all(
      TRACKED.map((icao) =>
        tickAirport(env, icao).catch((e) => ({ icao, error: String(e && e.message || e) }))
      )
    ).then((r) => console.log('tick', JSON.stringify(r))));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (url.pathname === '/api/scorecard') {
        const icao = url.searchParams.get('icao') || null;
        return json(await getScorecard(env.DB, icao && TRACKED.includes(icao) ? icao : null));
      }
      if (url.pathname === '/api/model') {
        return json({ tracked: TRACKED, models: await getModels(env.DB) });
      }
      if (url.pathname === '/api/health') {
        return json({ ok: true, tracked: TRACKED, samples: await datasetCount(env.DB), ts: Date.now() });
      }
      // Training dataset as JSONL (one labeled landing per line) for offline ML.
      if (url.pathname === '/api/dataset.jsonl') {
        const icao = url.searchParams.get('icao');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000', 10) || 5000, 20000);
        const rows = await datasetRows(env.DB, icao && TRACKED.includes(icao) ? icao : null, limit);
        return new Response(rows.join('\n') + (rows.length ? '\n' : ''), {
          headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'public, max-age=60', ...CORS },
        });
      }
      // Manual trigger for local testing / first warm-up (harmless in prod).
      if (url.pathname === '/api/tick') {
        const r = await Promise.all(TRACKED.map((i) => tickAirport(env, i).catch((e) => ({ icao: i, error: String(e) }))));
        return json({ ticked: r });
      }
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
    return json({ error: 'not found', endpoints: ['/api/scorecard', '/api/model', '/api/health', '/api/dataset.jsonl'] }, 404);
  },
};

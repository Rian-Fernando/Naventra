// Data-integrity tests: Naventra must show real data or say it has none — never
// invent traffic, weather or scores. These lock that in so a future change can't
// quietly reintroduce a synthetic fallback.
//   node scripts/test-integrity.mjs
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FAIL  ${name} — ${e.message}`); fail++; }
};
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------- weather --
const { parseRawMetar, flightCategory, fetchMetar } = await import('../src/lib/weather.js');

await check('flight category: FAA thresholds', () => {
  assert.strictEqual(flightCategory(200, 0.25), 'LIFR');
  assert.strictEqual(flightCategory(800, 10), 'IFR');
  assert.strictEqual(flightCategory(2500, 10), 'MVFR');
  assert.strictEqual(flightCategory(null, 4), 'MVFR');
  assert.strictEqual(flightCategory(5000, 10), 'VFR');
});
await check('US fallback derives category from the report (fog → LIFR, not VFR)', () => {
  const w = parseRawMetar(' KJFK 211151Z 18004KT 1/4SM FG VV002 12/12 A3001 ', 'KJFK');
  assert.strictEqual(w.fltCat, 'LIFR');
  assert.strictEqual(w.visib, '0.25');
  assert.deepStrictEqual(w.clouds.map((c) => [c.code, c.baseFt]), [['VV', 200]]);
});
await check('US fallback parses mixed-fraction and P6SM visibility', () => {
  assert.strictEqual(parseRawMetar(' KSFO 211151Z 27008KT 1 1/2SM BR OVC006 14/13 A3002 ', 'KSFO').visib, '1.5');
  const v = parseRawMetar(' KLAX 211151Z 25010KT P6SM FEW025 22/14 A2995 ', 'KLAX');
  assert.strictEqual(v.visib, '6+');
  assert.strictEqual(v.fltCat, 'VFR');
});
await check('missing visibility/clouds stay unknown (no assumed VFR)', () => {
  const w = parseRawMetar(' KXYZ 211151Z 18004KT 12/12 A3001 ', 'KXYZ');
  assert.strictEqual(w.fltCat, null);
  assert.strictEqual(w.visib, null);
});
await check('fetchMetar returns null when every source fails — no synthetic weather', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { assert.strictEqual(await fetchMetar('KJFK'), null); }
  finally { globalThis.fetch = realFetch; }
});

// ------------------------------------------------------------------- ADS-B --
const adsbSrc = src('src/lib/adsb.js');
const { fetchLiveTraffic } = await import('../src/lib/adsb.js');

await check('browser ADS-B sources exclude airplanes.live (closed to non-feeders)', () => {
  assert.ok(!/api\.airplanes\.live/.test(adsbSrc));
});
await check('adsb.fi uses its documented /api/v3 point endpoint', () => {
  assert.match(adsbSrc, /\/proxy\/adsbfi\/api\/v3\/lat\//);
});
await check('fetchLiveTraffic throws when all sources fail — no invented traffic', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('down', { status: 503 });
  try { await assert.rejects(fetchLiveTraffic(40.64, -73.78, 50)); }
  finally { globalThis.fetch = realFetch; }
});
await check('fetchLiveTraffic passes real fields through untouched', async () => {
  const realFetch = globalThis.fetch;
  const ac = { hex: 'a1b2c3', flight: 'DAL123 ', lat: 40.7, lon: -73.9, alt_baro: 5200, gs: 210, track: 45, baro_rate: -800, t: 'A321', r: 'N123DN' };
  globalThis.fetch = async () => new Response(JSON.stringify({ ac: [ac] }), { status: 200 });
  try {
    const { aircraft } = await fetchLiveTraffic(40.64, -73.78, 50);
    assert.strictEqual(aircraft.length, 1);
    const a = aircraft[0];
    assert.deepStrictEqual([a.id, a.callsign, a.lat, a.lon, a.altFt, a.gs, a.track, a.type, a.reg],
      ['a1b2c3', 'DAL123', 40.7, -73.9, 5200, 210, 45, 'A321', 'N123DN']);
  } finally { globalThis.fetch = realFetch; }
});

// ------------------------------------------------------------------ worker --
const tracker = src('worker/src/tracker.js');
await check('worker ADS-B sources exclude airplanes.live; adsb.fi on v3', () => {
  assert.ok(!/https:\/\/api\.airplanes\.live/.test(tracker));
  assert.match(tracker, /opendata\.adsb\.fi\/api\/v3\/lat\//);
});
await check('worker identifies itself and honours 429 Retry-After', () => {
  assert.match(tracker, /'User-Agent': UA/);
  assert.match(tracker, /Retry-After/);
  assert.match(tracker, /res.status === 403/, '403 (deliberate block) must not be retried every minute');
});
await check('worker paces each ADS-B host ≥1s apart (adsb.fi allows 1 req/s)', () => {
  const m = tracker.match(/async function pace\(host, gapMs = (\d+)\)/);
  assert.ok(m && Number(m[1]) >= 1000, 'pace gap must be ≥1000ms');
});
await check('dataset export declares its ODbL license', () => {
  const idx = src('worker/src/index.js');
  assert.match(idx, /rel="license"/);
  assert.match(idx, /'X-Data-License': 'ODbL-1\.0'/);
});

// ------------------------------------------------------------------ engine --
await check('engine decisions carry a graded category, never a made-up confidence', async () => {
  const t0 = Date.now(); let ms = 0; const realNow = Date.now; Date.now = () => t0 + ms;
  try {
    const [{ SimEngine }, { AIRPORTS }, atc] = await Promise.all([
      import('../src/lib/sim.js'), import('../src/data/airports.js'), import('../src/engine/atc.js'),
    ]);
    // A simulated feed is used ONLY here, to exercise the engine offline.
    const ap = AIRPORTS.KJFK; const wx = { windDir: 220, windKt: 10 };
    const rwys = atc.allocateRunways(ap, wx); const sim = new SimEngine(ap, rwys);
    let prev = [], prevIds = new Set(); const all = [];
    for (let t = 0; t < 900; t += 1.5) {
      ms += 1500;
      const ann = atc.annotateAircraft(sim.tick(1.5), ap, rwys, {}, () => 0);
      const confl = atc.detectConflicts(ann, ap);
      const { decisions } = atc.generateEvents(prev, ann, ap, rwys, confl, prevIds, wx);
      all.push(...decisions); prev = ann; prevIds = new Set(confl.map((c) => c.id));
    }
    assert.ok(all.length > 20, `expected decisions, got ${all.length}`);
    assert.ok(all.every((d) => !('confidence' in d)), 'a decision still carries a confidence field');
    const CAT = { SEQUENCE: 'sequence', CLEARANCE: 'runway', DEPARTURE: 'deprwy' };
    for (const d of all) assert.strictEqual(d.cat, CAT[d.type] || null, `${d.type} → ${d.cat}`);
  } finally { Date.now = realNow; }
});

// -------------------------------------------------- no synthetic fallbacks --
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|jsx)$/.test(n)) out.push(p);
  }
  return out;
}
const appFiles = walk(fileURLToPath(new URL('../src', import.meta.url))).filter((p) => !p.endsWith('/lib/sim.js'));
await check('the app never imports the simulator (tests only)', () => {
  const offenders = appFiles.filter((p) => /from ['"].*\/sim(\.js)?['"]/.test(readFileSync(p, 'utf8')));
  assert.deepStrictEqual(offenders, []);
});
await check('no synthetic weather, fake ATIS letter or confidence score in app code', () => {
  const bad = /function synthetic\(|source: 'simulated'|atisLetter|confidence:\s*(Math|\d)/;
  const offenders = appFiles.filter((p) => bad.test(readFileSync(p, 'utf8')));
  assert.deepStrictEqual(offenders, []);
});
await check('no UI label claims a simulation mode', () => {
  const comp = appFiles.filter((p) => /\/(components|pages)\//.test(p) || p.endsWith('Console.jsx'));
  const offenders = comp.filter((p) => /SIM · |SIM OPS|'SIM'|◌ SIMULATION|NOT BANKED/.test(readFileSync(p, 'utf8')));
  assert.deepStrictEqual(offenders, []);
});
await check('generated phraseology is labelled as generated, not as recorded radio', () => {
  const c = src('src/components/CommsLog.jsx');
  assert.match(c, /GENERATED/);
  assert.ok(!/Radio Communications — VHF/.test(c));
});

// ------------------------------------------------------------------ secrets --
// Alert credentials and the alert recipient live only in Cloudflare secrets.
const { execSync } = await import('node:child_process');
const tracked = execSync('git ls-files', { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
  .split('\n').filter((f) => f && !/\.(png|jpe?g|webp|ico|woff2?|gif|pdf|mp4)$/i.test(f));
await check('no API keys or tokens in tracked files', () => {
  const pat = /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}|\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
  const hits = tracked.filter((f) => { try { return pat.test(src(f)); } catch { return false; } });
  assert.deepStrictEqual(hits, []);
});
await check('alert recipient and keys are secrets, not config', () => {
  const toml = src('worker/wrangler.toml');
  assert.ok(!/^\s*(RESEND_API_KEY|ALERT_TO|GITHUB_DISPATCH_TOKEN)\s*=/m.test(toml), 'secret in wrangler.toml');
  assert.ok(!/@(gmail|outlook|hotmail|yahoo|icloud)\.com/i.test(src('worker/src/alerts.js')), 'hard-coded recipient');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

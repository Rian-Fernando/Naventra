// Unit tests for the always-on tracker's newer logic: email alert policy and
// sending (Resend + GitHub calls mocked — nothing leaves the machine), the
// departure-runway experts, the observed-departure runway roles, and dataset
// paging.
//
//   node scripts/test-tracker.mjs

import { planAlerts, runAlerts, planDatabaseAlert, alertDatabase, resetDatabaseStreak, DOWN_AFTER_MS, MODEL_STALE_MS, fmtDur } from '../worker/src/alerts.js';
import { datasetRows } from '../worker/src/store.js';
import { AIRPORTS } from '../src/data/airports.js';
import { allocateRunways } from '../src/engine/atc.js';
import {
  observeDepartures, flowWeights, makeDeparturePlanner, chooseExpert, learnDeparture,
  emptyDepModel, thresholds, cellOf, FLOW_WINDOW_MS,
} from '../src/engine/departures.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

// ------------------------------------------------------------------ alerts ---
const T = ['KJFK', 'KLAX', 'EGLL'];
const now = Date.parse('2026-10-22T12:00:00Z');
const live = (ts = now) => ({ ok: true, lastOkTs: ts, tracked: 200, source: 'relay→adsb.lol' });
const healthy = { KJFK: live(), KLAX: live(), EGLL: live() };
const fresh = Date.parse('2026-10-20T07:00:00Z');

{
  const p = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: null });
  check('first run sends exactly one setup confirmation', p.emails.length === 1 && p.emails[0].kind === 'setup');
  check('setup email shows live status', /KJFK  live — 200 aircraft/.test(p.emails[0].text));
}
const afterSetup = { setupTs: now - 1000 };
{
  const p = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: afterSetup });
  check('healthy: no email', p.emails.length === 0 && !Object.keys(p.patch).length);
}
{
  const hubs = { ...healthy, KLAX: { ok: false, lastOkTs: now - DOWN_AFTER_MS + 60000, error: 'adsb: 429' } };
  const p = planAlerts({ now, tracked: T, hubs, modelGeneratedAt: fresh, state: afterSetup });
  check('outage under 2 h: no email yet', p.emails.length === 0);
}
const downSince = now - DOWN_AFTER_MS - 5 * 60000;
const downHubs = { ...healthy, KLAX: { ok: false, lastOkTs: downSince, error: 'adsb: relay→adsb.lol 429' } };
let downState;
{
  const p = planAlerts({ now, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: afterSetup });
  check('outage over 2 h: one DOWN email', p.emails.length === 1 && p.emails[0].kind === 'down');
  check('DOWN email names the hub and the error', /KLAX/.test(p.emails[0].subject) && /429/.test(p.emails[0].text));
  check('DOWN idempotency key is stable per outage', p.emails[0].idem === `naventra-down-${downSince}`);
  downState = { ...afterSetup, ...p.emails[0].patch };
}
{
  const p = planAlerts({ now: now + 3600000, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: downState });
  check('still down an hour later: no repeat', p.emails.length === 0);
  const p2 = planAlerts({ now: now + 24 * 3600000, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: downState });
  check('still down after 24 h: one reminder', p2.emails.length === 1 && p2.emails[0].kind === 'down-reminder');
}
{
  const half = { ...healthy, KLAX: { ok: true, lastOkTs: now - 30 * 60000, tracked: 100 } };
  const p = planAlerts({ now, tracked: T, hubs: half, modelGeneratedAt: fresh, state: downState });
  check('partially back (data 30 min old): no RECOVERED yet', p.emails.length === 0);
  const p2 = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: downState });
  check('all hubs fresh: one RECOVERED email', p2.emails.length === 1 && p2.emails[0].kind === 'recovered');
  check('RECOVERED clears the outage', p2.emails[0].patch.down === null);
  check('RECOVERED reports the outage length', /2 h 05 min/.test(p2.emails[0].subject), p2.emails[0].subject);
}
{
  const old = now - MODEL_STALE_MS - 3600000;
  const p = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: old, state: afterSetup });
  check('model over 10 days old: STALE email', p.emails.length === 1 && p.emails[0].kind === 'stale');
  check('STALE email links the workflow', /actions\/workflows\/train\.yml/.test(p.emails[0].text));
  const pb = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: old, modelSource: 'bundled', state: afterSetup });
  check('STALE on a bundled model says the download may be the problem', /could not download/.test(pb.emails[0].text));
  const st = { ...afterSetup, staleSentTs: now - 3600000 };
  check('STALE not repeated within a week', planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: old, state: st }).emails.length === 0);
  check('fresh model clears the STALE marker', planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: st }).patch.staleSentTs === null);
}
{
  const p = planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: null, state: afterSetup });
  check('model without a timestamp: no STALE guess', p.emails.length === 0);
}
{
  // The database was what failed: DOWN went out but its state was never saved.
  // Recovery is read off the previous heartbeat instead.
  const prevHubs = { KJFK: live(now - 4 * 3600000), KLAX: live(now - 4 * 3600000), EGLL: live(now - 4 * 3600000) };
  const p = planAlerts({ now, tracked: T, hubs: healthy, prevHubs, modelGeneratedAt: fresh, state: afterSetup });
  check('RECOVERED still sent when the outage state was never saved', p.emails.length === 1 && p.emails[0].kind === 'recovered' && /4 h 00 min/.test(p.emails[0].subject), p.emails.map((e) => e.subject).join(' | '));
  const q = planAlerts({ now, tracked: T, hubs: healthy, prevHubs: healthy, modelGeneratedAt: fresh, state: afterSetup });
  check('no RECOVERED after a normal minute', q.emails.length === 0);
}
check('duration formatting', fmtDur(125 * 60000) === '2 h 05 min' && fmtDur(50 * 3600000) === '2 days 2 h', `${fmtDur(125 * 60000)} / ${fmtDur(50 * 3600000)}`);
{
  // One subject format across projects: "[Project] STATUS — detail".
  const all = [
    ...planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: null }).emails,
    ...planAlerts({ now, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: afterSetup }).emails,
    ...planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: downState }).emails,
    ...planAlerts({ now, tracked: T, hubs: healthy, modelGeneratedAt: now - MODEL_STALE_MS - 1, state: afterSetup }).emails,
  ];
  const bad = all.filter((e) => !/^\[Naventra\] (ALERTS ON|DOWN|STILL DOWN|RECOVERED|STALE MODEL|DATABASE) — /.test(e.subject));
  check('every subject reads "[Naventra] STATUS — detail"', all.length === 4 && bad.length === 0, bad.map((e) => e.subject).join(' | '));
}
{
  const limitMsg = "D1_ERROR: Your account has exceeded D1's free tier daily row write limit.";
  const a = planDatabaseAlert(limitMsg, now, 1);
  check('database limit error alerts on the first tick', !!a && /DATABASE/.test(a.subject) && /midnight UTC/.test(a.text));
  check('database alert key is per UTC day', a.idem === 'naventra-db-2026-10-22' && planDatabaseAlert(limitMsg, now + 86400000, 1).idem === 'naventra-db-2026-10-23');
  check('a passing D1 blip does not alert', planDatabaseAlert('D1_ERROR: Network connection lost.', now, 2) === null);
  check('…but five failed ticks in a row do', !!planDatabaseAlert('D1_ERROR: Network connection lost.', now, 5));
}

// runAlerts with a mocked network.
const realFetch = globalThis.fetch;
const calls = [];
const mockFetch = (status) => async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(status === 200 ? '{"id":"x"}' : '{"message":"nope"}', { status });
};
const env = { RESEND_API_KEY: 're_test', ALERT_TO: 'ops@example.com' };
const quiet = { log() {}, error() {} };
const realConsole = { log: console.log, error: console.error };
const muted = async (fn) => { Object.assign(console, quiet); try { return await fn(); } finally { Object.assign(console, realConsole); } };
try {
  globalThis.fetch = mockFetch(200);
  const s1 = await muted(() => runAlerts(env, { now, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: null, ua: 'test' }));
  const c = calls.at(-1);
  const body = JSON.parse(c.init.body);
  check('sends through the Resend API', c.url === 'https://api.resend.com/emails' && c.init.method === 'POST');
  check('authenticates with the secret key + idempotency key', c.init.headers.Authorization === 'Bearer re_test' && !!c.init.headers['Idempotency-Key']);
  check('sends as "Naventra Alerts <naventra-alerts@rianfernando.com>" to ALERT_TO', body.from === 'Naventra Alerts <naventra-alerts@rianfernando.com>' && body.to[0] === 'ops@example.com', body.from);
  check('state records the setup email', !!s1?.setupTs);
  calls.length = 0;
  const s2 = await muted(() => runAlerts(env, { now: now + 60000, tracked: T, hubs: healthy, modelGeneratedAt: fresh, state: s1, ua: 'test' }));
  check('healthy tick: no send, no state write', calls.length === 0 && s2 === null);

  globalThis.fetch = mockFetch(500);
  const s3 = await muted(() => runAlerts(env, { now, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: afterSetup, ua: 'test' }));
  check('failed send keeps the alert pending + backs off', s3 && !s3.down && s3.sendFailTs === now);
  calls.length = 0;
  const s4 = await muted(() => runAlerts(env, { now: now + 60000, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: s3, ua: 'test' }));
  check('no retry storm: nothing sent within 30 min of a failure', calls.length === 0 && s4 === null);

  globalThis.fetch = mockFetch(409);
  const s5 = await muted(() => runAlerts(env, { now, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: afterSetup, ua: 'test' }));
  check('409 (idempotency key already used) counts as sent', !!s5?.down);

  calls.length = 0;
  globalThis.fetch = mockFetch(200);
  const s6 = await muted(() => runAlerts({}, { now, tracked: T, hubs: downHubs, modelGeneratedAt: fresh, state: null, ua: 'test' }));
  check('unconfigured: no network calls, no state', calls.length === 0 && s6 === null);

  calls.length = 0;
  globalThis.fetch = mockFetch(200);
  resetDatabaseStreak();
  const sentDb = await muted(() => alertDatabase(env, "D1_ERROR: Your account has exceeded D1's free tier daily row write limit.", 'test', now));
  check('database alert is sent through Resend with a daily key', sentDb === true && calls.length === 1 && calls[0].init.headers['Idempotency-Key'] === 'naventra-db-2026-10-22');
  calls.length = 0;
  const unsent = await muted(() => alertDatabase({}, 'D1_ERROR: limit exceeded', 'test', now));
  check('database alert needs the Resend secrets', unsent === false && calls.length === 0);

  calls.length = 0;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(null, { status: 204 }); };
  const old = now - 9 * 24 * 3600000;
  const s7 = await muted(() => runAlerts({ GITHUB_DISPATCH_TOKEN: 'gh_test' }, { now, tracked: T, hubs: healthy, modelGeneratedAt: old, state: null, ua: 'test' }));
  check('stale model + dispatch token: re-runs the retrain workflow', calls.length === 1 && /train\.yml\/dispatches$/.test(calls[0].url) && JSON.parse(calls[0].init.body).ref === 'main');
  calls.length = 0;
  await muted(() => runAlerts({ GITHUB_DISPATCH_TOKEN: 'gh_test' }, { now: now + 3600000, tracked: T, hubs: healthy, modelGeneratedAt: old, state: s7, ua: 'test' }));
  check('dispatch at most once a day', calls.length === 0);
} finally {
  globalThis.fetch = realFetch;
}

// -------------------------------------------------------------- departures ---
const jfk = AIRPORTS.KJFK;
const lax = AIRPORTS.KLAX;
const thrJ = thresholds(jfk);
check('every runway end has a threshold', jfk.runways.every((r) => r.ends.every((e) => thrJ.has(e))));

// A synthetic climb-out off a given end: low, fast, climbing, on centerline.
const climbOut = (ap, end, id, distNm = 1.5) => {
  const t = thresholds(ap).get(end);
  const r = ap.runways.find((x) => x.ends.includes(end));
  const hdg = (r.trueHdg + (r.ends.indexOf(end) ? 180 : 0)) % 360;
  const h = hdg * Math.PI / 180;
  const x = t.x + Math.sin(h) * distNm, y = t.y + Math.cos(h) * distNm;
  const lat = ap.lat + y / 60, lon = ap.lon + x / (60 * Math.cos(ap.lat * Math.PI / 180));
  return { id, phase: 'DEPARTURE', onGround: false, agl: 900, vs: 2200, gs: 165, track: hdg, lat, lon, distNm: Math.hypot(x, y) };
};
{
  const t0 = now;
  let { flow, added } = observeDepartures([], [climbOut(jfk, '22R', 'a1'), climbOut(jfk, '22R', 'a2'), climbOut(jfk, '31L', 'a3')], jfk, t0);
  check('climb-outs are read off the runway they used', added === 3 && flow.map((f) => f[1]).sort().join() === '22R,22R,31L', flow.map((f) => f[1]).join());
  ({ flow, added } = observeDepartures(flow, [climbOut(jfk, '22R', 'a1')], jfk, t0 + 60000));
  check('the same flight is not counted twice', added === 0 && flow.length === 3);
  const w = flowWeights(flow, t0 + 60000);
  check('flow weights favour the busier runway', w.get('22R') > w.get('31L'));
  const later = observeDepartures(flow, [], jfk, t0 + FLOW_WINDOW_MS + 61000);
  check('flow forgets departures older than 45 min', later.flow.length === 0);

  const rw = allocateRunways(jfk, { windDir: 220, windKt: 12 }, new Map([['22L', 3]]), w);
  const role = (end) => rw.find((r) => r.activeEnd === end)?.role;
  check('JFK SW flow: observed 22R/31L are DEP, idle crosser goes IDLE, 22L ARR',
    role('22R') === 'DEP' && role('31L') === 'DEP' && role('13L') === 'IDLE' && role('22L') === 'ARR',
    rw.map((r) => `${r.activeEnd}:${r.role}`).join(' '));
  const rw0 = allocateRunways(jfk, { windDir: 220, windKt: 12 }, new Map([['22L', 3]]));
  check('no departures observed: allocation unchanged (no IDLE)', !rw0.some((r) => r.role === 'IDLE'));
}
{
  // LAX: both inner runways in use → position on the field should decide.
  const w = new Map([['24L', 2], ['25R', 2]]);
  const plan = makeDeparturePlanner(lax, w, null);
  const rw = allocateRunways(lax, { windDir: 250, windKt: 10 }, null, w);
  const at = (xNm, yNm) => ({ lat: lax.lat + yNm / 60, lon: lax.lon + xNm / (60 * Math.cos(lax.lat * Math.PI / 180)) });
  const north = plan(at(-0.2, 0.2), rw), south = plan(at(-0.2, -0.15), rw);
  check('LAX near expert: north-side flight → 24L', north.picks.near === '24L', JSON.stringify(north.picks));
  check('LAX near expert: south-side flight → 25R', south.picks.near === '25R', JSON.stringify(south.picks));
  check('default expert is the observed flow', north.by === 'flow' && north.ctx === 'F-');

  // Learning: the learned cell starts voting after 3 departures from that cell,
  // and a better expert takes over only with enough evidence.
  const dm = emptyDepModel();
  const c = cellOf(at(-0.2, -0.15), lax);
  for (let i = 0; i < 3; i++) learnDeparture(dm, { ctx: 'F-', cell: c, picks: { flow: '24L', near: '25R', learned: null } }, '25R');
  const p2 = makeDeparturePlanner(lax, w, dm)(at(-0.2, -0.15), rw);
  check('learned expert votes once its cell has evidence', p2.picks.learned === '25R' && p2.ctx === 'FL');
  const scores = { flow: { n: 40, ok: 18 }, learned: { n: 40, ok: 33 }, near: { n: 40, ok: 30 } };
  check('expert with clearly better record takes over', chooseExpert({ flow: '24L', learned: '25R', near: '25R' }, scores) === 'learned');
  check('no takeover without enough evidence', chooseExpert({ flow: '24L', learned: '25R', near: '25R' }, { learned: { n: 10, ok: 10 }, flow: { n: 40, ok: 18 } }) === 'flow');
  check('no takeover on a marginal edge', chooseExpert({ flow: '24L', near: '25R' }, { flow: { n: 40, ok: 30 }, near: { n: 40, ok: 30.5 } }) === 'flow');
  // Decay keeps scores bounded; cells halve past their cap.
  for (let i = 0; i < 500; i++) learnDeparture(dm, { ctx: 'F-', cell: c, picks: { flow: '24L', near: '25R', learned: null } }, '25R');
  const s = dm.experts['F-'];
  check('expert memory is bounded (decay)', s.near.n < 101 && s.near.ok / s.near.n > 0.99 && s.flow.ok / s.flow.n < 0.01);
  const total = Object.values(dm.cells[c]).reduce((a, b) => a + b, 0);
  check('cell memory is bounded (halving)', total <= 61, `total=${total}`);
}

// ---------------------------------------------------------- dataset paging ---
{
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: 100 - i, icao: 'KJFK', iata: 'JFK', ts: 1, callsign: 'X', features_json: '{}', outcome_json: '{}' }));
  const fake = {
    prepare(sql) {
      return {
        bind: (...args) => ({
          all: async () => {
            const [cursor, limit] = sql.includes('icao=?') ? args.slice(1) : args;
            return { results: rows.filter((r) => r.id < cursor).slice(0, limit) };
          },
        }),
      };
    },
  };
  const p1 = await datasetRows(fake, null, 3);
  const p2 = await datasetRows(fake, null, 3, p1.nextBefore);
  const p3 = await datasetRows(fake, null, 3, p2.nextBefore);
  const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => JSON.parse(r).id);
  check('paging walks the whole history once, newest first', ids.join() === '100,99,98,97,96,95,94', ids.join());
  check('last page has no next cursor', p3.nextBefore === null && p1.nextBefore === 98);
}

console.log(`\n${failures ? `${failures} FAILED` : 'All tracker checks passed'}`);
process.exit(failures ? 1 : 0);

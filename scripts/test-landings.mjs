// Landings: which airport a flight belongs to, which touchdowns count, and
// whether the landing order held. Covers the engine (neighbors.js), the
// grading rules both trackers share, the browser tracker, and full worker
// ticks against an in-memory D1 with the network mocked (nothing leaves the
// machine).
//
//   node scripts/test-landings.mjs

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// The worker imports public/model.json the way its bundler does; serve JSON as
// a module so Node can load worker/src/tracker.js as-is.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return { format: 'module', source: `export default ${readFileSync(new URL(url), 'utf8')}`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const realNow = Date.now;
let clock = Date.parse('2026-11-20T15:00:00Z');
Date.now = () => clock;

const { AIRPORTS } = await import('../src/data/airports.js');
const { NEIGHBORS } = await import('../src/data/neighbors.js');
const atc = await import('../src/engine/atc.js');
const { neighborTraffic } = await import('../src/engine/neighbors.js');
const grading = await import('../src/engine/grading.js');
const { thresholds } = await import('../src/engine/departures.js');
const { PredictionTracker } = await import('../src/engine/predictions.js');
const { describeRoute } = await import('../src/lib/routeMatch.js');
const { tickAirport } = await import('../worker/src/tracker.js');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

// ----------------------------------------------------------------- geometry ---
const R_NM = 3440.065, D = Math.PI / 180;
const fromLocal = (hub, x, y) => ({
  lat: hub.lat + y / (D * R_NM),
  lon: hub.lon + x / (D * R_NM * Math.cos(hub.lat * D)),
});
const JFK = AIRPORTS.KJFK, LAX = AIRPORTS.KLAX;
const nb = (hub, icao) => NEIGHBORS[hub.icao].find((n) => n.icao === icao);
const toLocal = (hub, lat, lon) => ({ x: (lon - hub.lon) * D * R_NM * Math.cos(hub.lat * D), y: (lat - hub.lat) * D * R_NM });

// A neighbour's runway end as a landing direction (threshold + heading).
function nbEnd(hub, icao, end) {
  for (const [a, aLat, aLon, b, bLat, bLon] of nb(hub, icao).rw) {
    const pa = toLocal(hub, aLat, aLon), pb = toLocal(hub, bLat, bLon);
    const h = (Math.atan2(pb.x - pa.x, pb.y - pa.y) / D + 360) % 360;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (a === end) return { x: pa.x, y: pa.y, hdg: h, len };
    if (b === end) return { x: pb.x, y: pb.y, hdg: (h + 180) % 360, len };
  }
  throw new Error(`${icao} has no runway end ${end}`);
}
// Our own runway end, from the engine's thresholds.
function homeEnd(hub, end) {
  const t = thresholds(hub).get(end);
  const hdg = (Math.atan2(t.far.x - t.x, t.far.y - t.y) / D + 360) % 360;
  return { x: t.x, y: t.y, hdg, len: Math.hypot(t.far.x - t.x, t.far.y - t.y) };
}
const unit = (h) => ({ x: Math.sin(h * D), y: Math.cos(h * D) });

// An aircraft `toGo` nm out on final for end `e` (field elevation `elev`), on a
// 3° glide path unless `aglFt` says otherwise.
function onFinal(hub, e, toGo, elev, extra = {}) {
  const u = unit(e.hdg);
  const p = fromLocal(hub, e.x - u.x * toGo, e.y - u.y * toGo);
  const agl = extra.aglFt ?? 318 * toGo;
  return { id: extra.id || 'a1', callsign: extra.callsign || 'TST1', lat: p.lat, lon: p.lon, altFt: Math.round(elev + agl), gs: 140, track: e.hdg, vs: -750, onGround: false, ...extra };
}
// `past` nm beyond the far end of end `e` after taking off from it.
function climbingOut(hub, e, past, elev, aglFt, extra = {}) {
  const u = unit(e.hdg);
  const along = e.len + past;
  const p = fromLocal(hub, e.x + u.x * along, e.y + u.y * along);
  return { id: extra.id || 'd1', callsign: extra.callsign || 'TST2', lat: p.lat, lon: p.lon, altFt: Math.round(elev + aglFt), gs: 165, track: e.hdg, vs: 2200, onGround: false, ...extra };
}
const parkedAt = (pos, extra = {}) => ({ id: 'g1', callsign: 'TST3', lat: pos.lat, lon: pos.lon, altFt: 0, gs: 0, track: 0, vs: 0, onGround: true, ...extra });
const opts = (hub) => ({ fieldR: atc.fieldRadiusNm(hub) });

// --------------------------------------------------------- neighbours data ---
check('JFK neighbours include LaGuardia, Newark and Teterboro', ['KLGA', 'KEWR', 'KTEB'].every((i) => !!nb(JFK, i)));
check('every neighbour runway has both thresholds', Object.values(NEIGHBORS).flat().every((n) => n.rw.length && n.rw.every((r) => r.length === 6 && r.every((v) => v !== null))));

// ----------------------------------------------------- who owns the traffic ---
const LGA22 = nbEnd(JFK, 'KLGA', '22');
{
  const ac = onFinal(JFK, LGA22, 4, nb(JFK, 'KLGA').elevFt);
  const of = neighborTraffic(ac, JFK, opts(JFK));
  check('on LaGuardia runway 22 final: LaGuardia arrival', of?.icao === 'KLGA' && of.role === 'arr' && of.rwy === '22', JSON.stringify(of));
}
{
  const ac = onFinal(JFK, homeEnd(JFK, '31R'), 6, JFK.elevFt);
  check('on JFK 31R final: ours', neighborTraffic(ac, JFK, opts(JFK)) === null);
}
{
  // 10 nm out on JFK's 22L final the aircraft is nearer LaGuardia than JFK.
  const ac = onFinal(JFK, homeEnd(JFK, '22L'), 10, JFK.elevFt);
  const p = toLocal(JFK, ac.lat, ac.lon);
  const lga = nb(JFK, 'KLGA');
  const dLga = Math.hypot(p.x - toLocal(JFK, lga.lat, lga.lon).x, p.y - toLocal(JFK, lga.lat, lga.lon).y);
  check('JFK 22L final passes nearer LaGuardia than JFK', dLga < Math.hypot(p.x, p.y), `${dLga.toFixed(1)} vs ${Math.hypot(p.x, p.y).toFixed(1)} nm`);
  check('…and is still ours', neighborTraffic(ac, JFK, opts(JFK)) === null);
}
{
  const ac = climbingOut(JFK, nbEnd(JFK, 'KEWR', '22R'), 0.6, nb(JFK, 'KEWR').elevFt, 900);
  const of = neighborTraffic(ac, JFK, opts(JFK));
  check('lifting off Newark 22R: Newark departure', of?.icao === 'KEWR' && of.role === 'dep' && of.rwy === '22R', JSON.stringify(of));
}
{
  const ac = climbingOut(JFK, homeEnd(JFK, '22R'), 0.6, JFK.elevFt, 900);
  check('lifting off JFK 22R: ours', neighborTraffic(ac, JFK, opts(JFK)) === null);
}
{
  const lga = nb(JFK, 'KLGA');
  check('parked at LaGuardia: on the ground there', neighborTraffic(parkedAt(lga), JFK, opts(JFK))?.role === 'gnd');
  check('parked at JFK: ours', neighborTraffic(parkedAt(JFK), JFK, opts(JFK)) === null);
  // Over LaGuardia at 3,500 ft, climbing: a JFK departure crossing above it.
  const over = { id: 'x', callsign: 'TST4', lat: lga.lat, lon: lga.lon, altFt: 3500, gs: 220, track: 310, vs: 1800, onGround: false };
  check('a JFK departure crossing over LaGuardia high is not LaGuardia\'s', neighborTraffic(over, JFK, opts(JFK)) === null);
  check('…nor once we saw it leave JFK', neighborTraffic(over, JFK, { ...opts(JFK), departedHome: true }) === null);
}
{
  // Remembered verdicts: a climb-out stays tagged after it stops looking like one…
  const dep = { icao: 'KLGA', iata: 'LGA', name: 'LaGuardia Airport', city: 'New York', lat: 40.7772, lon: -73.8726, role: 'dep', rwy: '13' };
  const later = { id: 'y', callsign: 'TST5', ...fromLocal(JFK, 2, 25), altFt: 9000, gs: 280, track: 60, vs: 2500, onGround: false };
  check('remembered LaGuardia climb-out stays tagged', neighborTraffic(later, JFK, { ...opts(JFK), remembered: dep }) === dep);
  // …but never over an aircraft lined up on one of our finals.
  const ours = onFinal(JFK, homeEnd(JFK, '31R'), 6, JFK.elevFt);
  check('a remembered verdict never overrides one of our finals', neighborTraffic(ours, JFK, { ...opts(JFK), remembered: { ...dep, role: 'arr' } }) === null);
}
{
  // Hawthorne sits under LAX's south-complex final.
  const hhr = nb(LAX, 'KHHR');
  const hhrEnd = nbEnd(LAX, 'KHHR', hhr.rw[0][3]);           // its west-facing end
  const low = onFinal(LAX, hhrEnd, 1.5, hhr.elevFt, { gs: 110 });
  const ofLow = neighborTraffic(low, LAX, opts(LAX));
  check('Hawthorne arrival below LAX\'s glide path: Hawthorne', ofLow?.icao === 'KHHR' && ofLow.role === 'arr', JSON.stringify(ofLow));
  const over = { ...low, altFt: 1800 };
  check('LAX arrival passing over Hawthorne on our glide path: ours', neighborTraffic(over, LAX, opts(LAX)) === null);
}

// --------------------------------------------------------- engine wiring ---
const wx = { windDir: 300, windKt: 12 };
function annotate(hub, tracks, eopts) {
  const base = atc.allocateRunways(hub, wx);
  let ann = atc.annotateAircraft(tracks, hub, base, {}, () => 0, null, eopts);
  const obs = atc.inferActiveArrivals(ann, hub);
  const rw = obs.size ? atc.allocateRunways(hub, wx, obs) : base;
  ann = atc.annotateAircraft(tracks, hub, rw, {}, () => 0, null, eopts);
  return { ann, rw };
}
{
  const tracks = [
    onFinal(JFK, homeEnd(JFK, '31R'), 7, JFK.elevFt, { id: 'jfk1', callsign: 'JBU1' }),
    onFinal(JFK, homeEnd(JFK, '31R'), 11, JFK.elevFt, { id: 'jfk2', callsign: 'DAL2' }),
    onFinal(JFK, LGA22, 3, nb(JFK, 'KLGA').elevFt, { id: 'lga1', callsign: 'AAL3' }),
    parkedAt(nb(JFK, 'KEWR'), { id: 'ewr1', callsign: 'UAL4' }),
  ];
  const { ann } = annotate(JFK, tracks);
  const by = Object.fromEntries(ann.map((a) => [a.id, a]));
  check('LaGuardia arrival is not sequenced at JFK', by.lga1.phase === 'ENROUTE' && by.lga1.seq == null && by.lga1.otherField?.iata === 'LGA');
  check('JFK arrivals are sequenced without it', by.jfk1.seqRwy === 1 && by.jfk2.seqRwy === 2, `${by.jfk1.seqRwy}, ${by.jfk2.seqRwy}`);
  check('aircraft at Newark is not on JFK\'s surface', !by.ewr1.atField && by.ewr1.otherField?.role === 'gnd');
  check('KPIs count JFK\'s arrivals only', atc.computeKpis(ann, []).arrivals === 2);
  const rd = describeRoute(null, by.lga1, JFK);
  check('the strip shows where it is going: → LGA (seen)', rd.to?.iata === 'LGA' && rd.source === 'seen');
  const wrong = describeRoute({ airline: 'American', from: { iata: 'MIA', lat: 25.79, lon: -80.29 }, to: { iata: 'JFK', icao: 'KJFK', lat: JFK.lat, lon: JFK.lon } }, by.lga1, JFK);
  check('…and a route on file into JFK is not believed for it', wrong.source === 'seen' && wrong.to?.iata === 'LGA');
}

// ---------------------------------------------------------- grading rules ---
{
  const onRwy = { lat: JFK.lat, lon: JFK.lon, distNm: 0.5 };
  check('touchdown on JFK\'s field counts', grading.onOurField(onRwy, JFK));
  check('touchdown at LaGuardia does not', !grading.onOurField({ ...nb(JFK, 'KLGA'), distNm: 9.6 }, JFK));
  const t = 1_800_000_000_000;
  const s = (seq, ahead, rwy = '31R') => ({ seq, rwy, ahead, ts: t });
  const none = () => false;
  const log = (...l) => l.map(([id, ts, rwy = '31R']) => ({ id, rwy, ts }));
  const g = (sample, landed, lg, inbound = none, actual = '31R') => grading.gradeOrder('me', sample, actual, landed, lg, inbound);
  check('#1 and nothing else landed: in order', g(s(1, []), t + 60e3, log())?.ok === true);
  check('#2 behind A, both down between two looks, A first: in order', g(s(2, ['A']), t + 110e3, log(['A', t + 50e3], ['me', t + 110e3]))?.ok === true);
  check('#2 but A still on the approach when we land: out of order', g(s(2, ['A']), t + 110e3, log(), () => true)?.ok === false);
  check('#2 behind A, A landed after us: out of order', g(s(2, ['A']), t + 60e3, log(['A', t + 100e3]))?.ok === false);
  check('#2 behind A, A went to LaGuardia (gone): in order', g(s(2, ['A']), t + 60e3, log())?.ok === true);
  const cut = g(s(1, []), t + 110e3, log(['B', t + 40e3]));
  check('#1 but B landed first: out of order', cut?.ok === false, cut?.actual);
  check('B landing on the other runway does not count', g(s(1, []), t + 110e3, log(['B', t + 40e3, '31L']))?.ok === true);
  check('landing on a different runway than queued for: out of order', g(s(1, []), t + 60e3, log(), none, '31L')?.ok === false);
  check('a sample from before queues were recorded: not graded', g({ seq: 1, rwy: '31R', ts: t }, t + 60e3, log()) === null);
  check('no runway identified: not graded', g(s(1, []), t + 60e3, log(), none, null) === null);
}

// ----------------------------------------------------- browser tracker run ---
// Three inbound at JFK, one of them really LaGuardia traffic sitting in JFK's
// queue on a downwind leg. Two JFK flights land between two looks.
{
  clock = Date.parse('2026-11-20T15:00:00Z');
  const tr = new PredictionTracker(JFK);
  const r31 = homeEnd(JFK, '31R');
  const lga = nb(JFK, 'KLGA');
  // LaGuardia arrival on a downwind 7 nm WNW of JFK: looks like JFK approach traffic.
  const downwind = (extra) => ({ id: 'lgaDw', callsign: 'AAL1389', ...fromLocal(JFK, -6.9, 2.4), altFt: 3600, gs: 205, track: 61, vs: 0, onGround: false, ...extra });
  const sweep = (tracks) => {
    const { ann, rw } = annotate(JFK, tracks);
    return { ann, ev: tr.update(ann, rw, true, true, atc.departureEnd) };
  };
  // Look 1: everyone well out → locks.
  let r = sweep([
    onFinal(JFK, r31, 9, JFK.elevFt, { id: 'A', callsign: 'JBU1' }),
    onFinal(JFK, r31, 13, JFK.elevFt, { id: 'B', callsign: 'DAL2', aglFt: 4000 }),
    downwind(),
  ]);
  check('downwind LaGuardia traffic looks like JFK approach traffic', r.ann.find((a) => a.id === 'lgaDw').phase === 'APPROACH');
  check('all three locked', tr.open.size === 3, `${tr.open.size}`);
  // Look 2: A 2 nm out, B 4.5 nm out (both sampled with their queue).
  clock += 120e3;
  r = sweep([
    onFinal(JFK, r31, 2, JFK.elevFt, { id: 'A', callsign: 'JBU1' }),
    onFinal(JFK, r31, 4.5, JFK.elevFt, { id: 'B', callsign: 'DAL2' }),
    { ...onFinal(JFK, LGA22, 3, lga.elevFt), id: 'lgaDw', callsign: 'AAL1389' },
  ]);
  check('once on LaGuardia\'s final it is voided, not graded', !tr.open.has('lgaDw'));
  check('A was #1, B #2 behind A', tr.open.get('A')?.sample?.seq === 1 && tr.open.get('B')?.sample?.seq === 2 && tr.open.get('B')?.sample?.ahead?.[0] === 'A');
  // Look 3: both down on the runway.
  clock += 120e3;
  const rolling = (id, cs, frac, gs) => {
    const u = unit(r31.hdg), along = r31.len * frac;
    const p = fromLocal(JFK, r31.x + u.x * along, r31.y + u.y * along);
    return { id, callsign: cs, lat: p.lat, lon: p.lon, altFt: 0, gs, track: r31.hdg, vs: 0, onGround: true };
  };
  r = sweep([rolling('A', 'JBU1', 0.8, 25), rolling('B', 'DAL2', 0.5, 70)]);
  const ver = r.ev.filter((e) => e.kind === 'verify');
  const items = (cs) => ver.find((e) => e.callsign === cs)?.entry.items || [];
  const it = (cs, cat) => items(cs).find((i) => i.cat === cat);
  check('both JFK landings graded', ver.length === 2, ver.map((e) => e.callsign).join());
  check('runway read off the approach: 31R', it('JBU1', 'runway')?.actual === '31R' && it('DAL2', 'runway')?.actual === '31R');
  check('B landed in order behind A (old rule called this a miss)', it('DAL2', 'sequence')?.ok === true, JSON.stringify(it('DAL2', 'sequence')));
  check('A landed in order', it('JBU1', 'sequence')?.ok === true);
  check('nothing was graded for the LaGuardia flight', !ver.some((e) => e.callsign === 'AAL1389'));
}
{
  // A flight locked as a JFK arrival that comes down at LaGuardia is voided.
  clock = Date.parse('2026-11-20T16:00:00Z');
  const tr = new PredictionTracker(JFK);
  const r31 = homeEnd(JFK, '31R');
  const sweep = (tracks) => { const { ann, rw } = annotate(JFK, tracks); return tr.update(ann, rw, true, true, atc.departureEnd); };
  sweep([{ id: 'Z', callsign: 'DAL2603', ...fromLocal(JFK, -6.9, 2.4), altFt: 3600, gs: 205, track: 61, vs: 0, onGround: false },
    onFinal(JFK, r31, 12, JFK.elevFt, { id: 'Y', callsign: 'JBU9' })]);
  check('locked while it looked like JFK traffic', tr.open.has('Z'));
  clock += 600e3;
  const ev = sweep([parkedAt(nb(JFK, 'KLGA'), { id: 'Z', callsign: 'DAL2603', gs: 20 })]);
  check('down at LaGuardia: voided, no grade', !tr.open.has('Z') && !ev.some((e) => e.callsign === 'DAL2603'));
}

// ------------------------------------------------------- worker, full ticks ---
// In-memory D1: just enough SQL for one hub's tick.
class MockD1 {
  constructor() { this.state = new Map(); this.model = new Map(); this.samples = []; this.landings = []; this.stats = new Map(); }
  prepare(sql) {
    const db = this;
    return {
      sql, args: [],
      bind(...a) { this.args = a; return this; },
      async first() { return db.read(this.sql, this.args); },
      async all() { const r = db.read(this.sql, this.args); return { results: Array.isArray(r) ? r : r ? [r] : [] }; },
      async run() { db.write(this); return { success: true }; },
    };
  }
  async batch(stmts) { for (const s of stmts) this.write(s); return stmts.map(() => ({ success: true })); }
  read(sql, a) {
    if (sql.startsWith('SELECT * FROM model WHERE icao=?')) return this.model.get(a[0]) || null;
    if (sql.startsWith('SELECT data_json FROM state WHERE icao=?')) return this.state.has(a[0]) ? { data_json: this.state.get(a[0]) } : null;
    if (sql.startsWith('SELECT COUNT(*) k FROM samples')) return { k: 0 };
    if (sql.startsWith('SELECT * FROM predictions')) return [];
    throw new Error(`unmocked read: ${sql}`);
  }
  write({ sql, args: a }) {
    if (sql.includes('INSERT INTO state')) this.state.set(a[0], a[1]);
    else if (sql.includes('INSERT INTO model')) this.model.set(a[0], { icao: a[0], rwy_json: a[1], eta_ema: a[2], eta_n: a[3], landings: a[4], samples: a[5] });
    else if (sql.includes('INSERT INTO samples')) this.samples.push(a);
    else if (sql.includes('INSERT INTO landings')) this.landings.push({ callsign: a[3], items: JSON.parse(a[4]) });
    else if (sql.includes('INSERT INTO stats')) { const k = `${a[0]}|${a[1]}`; const s = this.stats.get(k) || { n: 0, c: 0 }; s.n += a[2]; s.c += a[3]; this.stats.set(k, s); }
    else if (sql.startsWith('DELETE FROM predictions')) { /* legacy cleanup */ }
    else throw new Error(`unmocked write: ${sql}`);
  }
}
{
  const db = new MockD1();
  const env = { DB: db, ADSBLOL_API_KEY: 'sk-test' };
  let traffic = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('aviationweather.gov')) {
      return new Response(JSON.stringify([{ icaoId: 'KJFK', wdir: 300, wspd: 12, visib: '10+', clouds: [], fltCat: 'VFR', temp: 9, altim: 1020 }]), { status: 200 });
    }
    if (u.includes('api.adsb.lol') || u.includes('adsb')) {
      const ac = traffic.map((t) => ({
        hex: t.id, flight: t.callsign, lat: t.lat, lon: t.lon, alt_baro: t.onGround ? 'ground' : t.altFt,
        gs: t.gs, track: t.track, baro_rate: t.vs, category: 'A3', t: 'A320', seen_pos: 0,
      }));
      return new Response(JSON.stringify({ ac }), { status: 200 });
    }
    return new Response('not found', { status: 404 }); // the model download: keep the bundled one
  };
  const r31 = homeEnd(JFK, '31R');
  const lga = nb(JFK, 'KLGA');
  const tick = async (tracks) => { traffic = tracks; return tickAirport(env, 'KJFK'); };
  try {
    clock = Date.parse('2026-11-20T17:00:00Z');
    let out = await tick([
      onFinal(JFK, r31, 9, JFK.elevFt, { id: 'a1', callsign: 'JBU1' }),
      onFinal(JFK, r31, 13, JFK.elevFt, { id: 'b2', callsign: 'DAL2', aglFt: 4000 }),
      { id: 'c3', callsign: 'AAL1389', ...fromLocal(JFK, -6.9, 2.4), altFt: 3600, gs: 205, track: 61, vs: 0, onGround: false },
    ]);
    check('worker: three locks on the first tick', out.locked === 3, JSON.stringify(out));
    clock += 120e3;
    out = await tick([
      onFinal(JFK, r31, 2, JFK.elevFt, { id: 'a1', callsign: 'JBU1' }),
      onFinal(JFK, r31, 4.5, JFK.elevFt, { id: 'b2', callsign: 'DAL2' }),
      { ...onFinal(JFK, LGA22, 3, lga.elevFt), id: 'c3', callsign: 'AAL1389' },
    ]);
    check('worker: LaGuardia flight voided on its final', out.voided === 1 && !JSON.parse(db.state.get('open:KJFK')).arr.c3);
    clock += 120e3;
    const rolling = (id, cs, frac, gs) => {
      const u = unit(r31.hdg), along = r31.len * frac;
      const p = fromLocal(JFK, r31.x + u.x * along, r31.y + u.y * along);
      return { id, callsign: cs, lat: p.lat, lon: p.lon, altFt: 0, gs, track: r31.hdg, vs: 0, onGround: true };
    };
    out = await tick([rolling('a1', 'JBU1', 0.8, 25), rolling('b2', 'DAL2', 0.5, 70)]);
    check('worker: two JFK landings graded', out.graded === 2, JSON.stringify(out));
    const seq = (cs) => db.landings.find((l) => l.callsign === cs)?.items.find((i) => i.cat === 'sequence');
    check('worker: both landed in order', seq('JBU1')?.ok === true && seq('DAL2')?.ok === true, `${JSON.stringify(seq('JBU1'))} ${JSON.stringify(seq('DAL2'))}`);
    const outcome = JSON.parse(db.samples[0][8]);
    check('worker: training rows mark the touchdown as on the field', outcome.at_field === 1 && outcome.actual_runway === '31R');
    check('worker: no row for the LaGuardia flight', db.samples.length === 2 && !db.landings.some((l) => l.callsign === 'AAL1389'));
    const st = (cat) => db.stats.get(`KJFK|${cat}`) || { n: 0, c: 0 };
    check('worker: scorecard counts two ETA and two landing-order grades', st('eta').n === 2 && st('sequence').n === 2 && st('sequence').c === 2);
    const saved = JSON.parse(db.state.get('open:KJFK'));
    check('worker: touchdown log persisted with the open state', saved.log?.length === 2 && saved.log.every((l) => l.rwy === '31R'));
    // A flight that lands at LaGuardia after being locked is voided at touchdown.
    clock += 120e3;
    await tick([{ id: 'd4', callsign: 'DAL2733', ...fromLocal(JFK, -6.9, 2.4), altFt: 3600, gs: 205, track: 61, vs: 0, onGround: false }]);
    clock += 600e3;
    out = await tick([parkedAt(lga, { id: 'd4', callsign: 'DAL2733', gs: 20 })]);
    check('worker: down at LaGuardia → voided, not graded', out.graded === 0 && out.voided === 1 && db.samples.length === 2, JSON.stringify(out));
  } finally {
    globalThis.fetch = realFetch;
  }
}

Date.now = realNow;
if (failures) { console.error(`\n${failures} landing check(s) failed`); process.exit(1); }
console.log('\nAll landing checks passed');

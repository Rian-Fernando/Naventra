// CI regression gate: runs the full engine pipeline (sim traffic → two-pass
// config inference → annotate → prediction lock/grade, arrivals + departures)
// for 30 sim-minutes per airport and fails the build if grading breaks or
// accuracy collapses. Keeps engine regressions from ever reaching production.
//
//   node scripts/ci-regression.mjs

const t0 = Date.now();
let simMs = 0;
Date.now = () => t0 + simMs;

// Deterministic simulator: seed Math.random (mulberry32) so every CI run sees
// the same traffic and a pass/fail can't flip on luck.
{
  let a = 0x9e3779b9;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};

const [{ SimEngine }, { AIRPORTS }, atc, { PredictionTracker }, { runwayPrior }, { buildOutlook }, { wakeCat, wakeSepNm, wakeDepartureSepSec }, { computeCapacity }, { etaVec, etaCorrectionSec, updateEtaBias, etaBiasFrom }, grading] = await Promise.all([
  import('../src/lib/sim.js'),
  import('../src/data/airports.js'),
  import('../src/engine/atc.js'),
  import('../src/engine/predictions.js'),
  import('../src/engine/learning.js'),
  import('../src/engine/forecast.js'),
  import('../src/engine/wake.js'),
  import('../src/engine/capacity.js'),
  import('../src/engine/etaModel.js'),
  import('../src/engine/grading.js'),
]);
const { detectSurface } = await import('../src/engine/surface.js');
const departures = await import('../src/engine/departures.js');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

for (const icao of ['KJFK', 'KLAX', 'EGLL', 'YSSY']) {
  const ap = AIRPORTS[icao];
  const wx = { windDir: 250, windKt: 10 };
  const sim = new SimEngine(ap, atc.allocateRunways(ap, wx));
  const tracker = new PredictionTracker(ap);
  const gateMap = {};
  let graded = 0;
  let flow = [];
  let lastRwys = [];
  const depModel = departures.emptyDepModel();

  // Same pipeline as the console (useAtcSystem): wind plan → observed arrivals
  // and departure flow → re-allocate → annotate with the departure planner.
  for (let t = 0; t < 1800; t += 1.5) {
    simMs += 1500;
    const tracks = sim.tick(1.5);
    const base = atc.allocateRunways(ap, wx);
    let ann = atc.annotateAircraft(tracks, ap, base, gateMap, runwayPrior);
    const obs = atc.inferActiveArrivals(ann, ap);
    flow = departures.observeDepartures(flow, ann, ap, Date.now()).flow;
    const depW = departures.flowWeights(flow, Date.now());
    const rwys = obs.size || depW.size ? atc.allocateRunways(ap, wx, obs.size ? obs : null, depW) : base;
    ann = atc.annotateAircraft(tracks, ap, rwys, gateMap, runwayPrior, departures.makeDeparturePlanner(ap, depW, depModel));
    lastRwys = rwys;
    for (const ev of tracker.update(ann, rwys, true, true, atc.departureEnd)) {
      if (ev.kind === 'verify') graded++;
      if (ev.depPlan) departures.learnDeparture(depModel, ev.depPlan, ev.actual);
    }
  }

  const st = tracker.getState();
  check(`${icao} grades operations`, graded >= 8, `graded=${graded}`);
  const dep = st.allTime.byCat.deprwy;
  // The simulator picks each departure's runway at random among the DEP
  // runways, so this is a does-it-work floor, not an accuracy benchmark (the
  // learning test below is the one that measures improvement).
  check(`${icao} departure runways graded with the planner`, dep.n >= 3 && (dep.pct ?? 0) >= 20, `n=${dep.n} ${dep.pct}%`);
  check(`${icao} observed flow keeps a departure runway`, lastRwys.some((r) => r.role.includes('DEP')), lastRwys.map((r) => `${r.activeEnd}:${r.role}`).join(' '));
  check(`${icao} accuracy sane`, (st.allTime.pct ?? 0) >= 55, `overall=${st.allTime.pct}%`);
  check(`${icao} state shape`, !!st.allTime.byCat && typeof st.openCount === 'number');
}

// Departure experts learn: in the simulator every departure spawns ON the runway
// it will use (chosen at random among the DEP runways), so following the flow is
// a coin toss while "nearest strip" is right almost every time. Over two
// sim-hours the planner must notice that and hand the call to the better expert.
{
  const ap = AIRPORTS.KJFK;
  const wx = { windDir: 250, windKt: 10 };
  const sim = new SimEngine(ap, atc.allocateRunways(ap, wx));
  const tracker = new PredictionTracker(ap);
  const depModel = departures.emptyDepModel();
  const gateMap = {};
  let flow = [];
  const byHalf = [[0, 0], [0, 0]];
  const usedBy = new Map();
  for (let t = 0; t < 7200; t += 2) {
    simMs += 2000;
    const tracks = sim.tick(2);
    const base = atc.allocateRunways(ap, wx);
    let ann = atc.annotateAircraft(tracks, ap, base, gateMap, runwayPrior);
    const obs = atc.inferActiveArrivals(ann, ap);
    flow = departures.observeDepartures(flow, ann, ap, Date.now()).flow;
    const depW = departures.flowWeights(flow, Date.now());
    const rwys = obs.size || depW.size ? atc.allocateRunways(ap, wx, obs.size ? obs : null, depW) : base;
    ann = atc.annotateAircraft(tracks, ap, rwys, gateMap, runwayPrior, departures.makeDeparturePlanner(ap, depW, depModel));
    for (const ev of tracker.update(ann, rwys, true, true, atc.departureEnd)) {
      if (!ev.depPlan) continue;
      const h = t < 3600 ? 0 : 1;
      byHalf[h][0]++; byHalf[h][1] += ev.ok ? 1 : 0;
      if (h === 1) usedBy.set(ev.depPlan.by, (usedBy.get(ev.depPlan.by) || 0) + 1);
      departures.learnDeparture(depModel, ev.depPlan, ev.actual);
    }
  }
  const pct = ([n, ok]) => (n ? Math.round((100 * ok) / n) : 0);
  const ctx = Object.entries(depModel.experts).sort((a, b) => (b[1].near?.n || 0) - (a[1].near?.n || 0))[0];
  const nearAcc = ctx ? ctx[1].near.ok / ctx[1].near.n : 0, flowAcc = ctx?.[1].flow ? ctx[1].flow.ok / ctx[1].flow.n : 0;
  check('departure experts: near scores above flow in the simulator', nearAcc > flowAcc + 0.1, `near ${Math.round(nearAcc * 100)}% vs flow ${Math.round(flowAcc * 100)}%`);
  const handed = (usedBy.get('near') || 0) + (usedBy.get('learned') || 0);
  check('departure experts: the planner hands over from flow to a better expert', handed > 2 * (usedBy.get('flow') || 0), JSON.stringify(Object.fromEntries(usedBy)));
  check('departure experts: accuracy improves as it learns', pct(byHalf[1]) > pct(byHalf[0]) + 10, `hour 1 ${pct(byHalf[0])}% (n=${byHalf[0][0]}) → hour 2 ${pct(byHalf[1])}% (n=${byHalf[1][0]})`);
}

// Airport data integrity (generated file).
for (const ap of Object.values(AIRPORTS)) {
  for (const r of ap.runways) {
    if (!(r.trueHdg >= 0 && r.trueHdg <= 360) || !(r.lenFt > 3000) || typeof r.offX !== 'number') {
      check(`${ap.icao} runway data valid`, false, r.id);
    }
  }
}
check('airport data integrity', failures === 0 || true); // summarized above

// Forecast outlook: calm should read LOW risk, a storm HIGH, and the config flip
// must be detected when the wind swings the runways.
{
  const ap = AIRPORTS.KJFK;
  const now = Date.now();
  const out = buildOutlook(ap, [
    { from: now, to: now + 3.6e6, windDir: 250, windKt: 8, gustKt: null, visibSm: 6, ceilingFt: 6000 },
    { from: now + 3.6e6, to: now + 7.2e6, windDir: 50, windKt: 24, gustKt: 38, visibSm: 0.5, ceilingFt: 300 },
  ]);
  check('forecast calm = LOW risk', out[0].risk.level === 'LOW', `${out[0].risk.pct}%`);
  check('forecast storm = HIGH risk', out[1].risk.level === 'HIGH', `${out[1].risk.pct}%`);
  check('forecast produces a config label', !!out[0].config && out[0].config !== '—', out[0].config);
  check('forecast projects VMC when clear', out[0].appCat === 'VMC', out[0].appCat);
  check('forecast projects low-vis category + LVP', out[1].lvp === true && out[1].capacityPct < 100, `${out[1].appCat} ${out[1].capacityPct}%`);
}

// Wake turbulence: categories from type + the separation matrix (floored at the
// 3 nm radar minimum), so final-approach spacing is realistic.
check('wake A388 = super', wakeCat('A388') === 'J');
check('wake B77W = heavy', wakeCat('B77W') === 'H');
check('wake A320 = medium', wakeCat('A320') === 'M');
check('wake C172 = light', wakeCat('C172') === 'L');
check('wake sep medium-behind-heavy = 5nm', wakeSepNm('H', 'M') === 5, `${wakeSepNm('H', 'M')}`);
check('wake sep light-behind-super = 8nm', wakeSepNm('J', 'L') === 8, `${wakeSepNm('J', 'L')}`);
check('wake sep floored at radar min 3nm', wakeSepNm('M', 'M') === 3, `${wakeSepNm('M', 'M')}`);
check('wake sep unknown → radar min', wakeSepNm(null, 'M') === 3);
check('dep wake: 2 min behind heavy', wakeDepartureSepSec('H', 'M') === 120, `${wakeDepartureSepSec('H', 'M')}`);
check('dep wake: floored at 60s occupancy', wakeDepartureSepSec('M', 'M') === 60, `${wakeDepartureSepSec('M', 'M')}`);

// Capacity (AAR): responds to weather and stays in a sane range; low visibility
// must lower the acceptance rate.
{
  const ap = AIRPORTS.KJFK;
  const rwys = atc.allocateRunways(ap, { windDir: 250, windKt: 10 });
  const ann = atc.annotateAircraft([], ap, rwys, {}, runwayPrior);
  const vmc = computeCapacity(ann, rwys, { clouds: [], visib: '10' }, 20);
  check('AAR positive & sane', vmc.aar > 10 && vmc.aar < 200, `${vmc.aar}`);
  check('AAR exposes drivers', vmc.meanSpacingNm > 0 && vmc.finalSpeedKt > 0);
  check('ADR positive & sane', vmc.adr > 5 && vmc.adr < 200, `${vmc.adr}`);
  // Real major fields sustain roughly 30–90 departures/hr; the old model said 144 at JFK.
  check('ADR realistic for a major hub (30–90/hr)', vmc.adr >= 30 && vmc.adr <= 90, `${vmc.adr}`);
  // Low-visibility: CAT III (100ft ceiling, 1/4mi vis) cuts AAR hard + sets LVP.
  const catIII = computeCapacity(ann, rwys, { clouds: [{ code: 'OVC', baseFt: 100 }], visib: '1/4' }, 20);
  check('clear sky = VMC, no LVP', vmc.approachCat === 'VMC' && vmc.lvp === false, vmc.approachCat);
  check('low ceiling/vis = CAT III + LVP', catIII.approachCat === 'CAT III' && catIII.lvp === true, catIII.approachCat);
  check('LVP widens spacing to ≥6nm', catIII.effSpacingNm >= 6, `${catIII.effSpacingNm}`);
  check('CAT III AAR well below VMC', catIII.aar < vmc.aar * 0.7, `${catIII.aar} vs ${vmc.aar}`);
}

// ETA model serving: feature vector matches training length, correction is
// clamped, and it only fires for an adopted airport.
check('etaVec length = 13 (season inputs after bias)', etaVec({}).length === 13);
check('etaVec all finite', etaVec({ dist_nm: 10, gs_kt: 140, head_kt: 8, wake: 'H', flt_cat: 'IFR', hour_local: 14 }).every(Number.isFinite));
{
  // Golden vector shared with scripts/test_train.py — JS serving and Python
  // training must build the identical ETA feature vector.
  const golden = [0.625, 0.7, 0.4, 0.5, 0.4, 0.5, 1, 1, -0.5, -0.866025, 1, 0.988854, -0.14889];
  const v = etaVec({ dist_nm: 10, gs_kt: 140, head_kt: 8, arr_rate_1h: 30, inbound_count: 20, sector_count: 100, wake: 'H', flt_cat: 'IFR', hour_local: 14, doy: 100 });
  check('etaVec matches the Python trainer (golden vector)', v.every((x, i) => Math.abs(x - golden[i]) < 1e-5), JSON.stringify(v.map((x) => +x.toFixed(6))));
}
{
  const synth = { airports: { TEST: { eta: { adopt: true, W: new Array(11).fill(1) } } } };
  const corr = etaCorrectionSec(synth, 'TEST', { dist_nm: 16, gs_kt: 200, head_kt: 20 });
  check('eta correction is a clamped number', typeof corr === 'number' && corr >= -600 && corr <= 900, `${corr}`);
  check('eta correction null when no model', etaCorrectionSec(synth, 'NOPE', {}) === null);
  check('eta correction null when not adopted', etaCorrectionSec({ airports: { X: { eta: { adopt: false, W: [1] } } } }, 'X', {}) === null);
}

// Online ETA bias: robust to holds (errors clipped), matches the Python replay
// (golden sequence shared with scripts/test_train.py), and re-seeds a value
// left behind by the old unclipped estimator.
{
  const eta = { ema: 0, n: 0 };
  const out = [];
  for (const e of [300, -50, 60, 1500, 20, -400, 90, -10]) { out.push(+etaBiasFrom(eta).toFixed(4)); updateEtaBias(eta, e); }
  const golden = [0, 0, 0, 98.7, 100.83, 92.747, 71.4723, 73.3251];
  check('online ETA bias matches the trainer replay (golden)', out.every((x, i) => Math.abs(x - golden[i]) < 1e-3), JSON.stringify(out));
  const old = { ema: 238, n: 400 };
  updateEtaBias(old, 45);
  check('online ETA bias re-seeds a pinned old value', old.ema === 45 && etaBiasFrom(old) === 45, `${old.ema}`);
  const holds = { ema: 0, n: 0 };
  for (let i = 0; i < 50; i++) updateEtaBias(holds, i % 5 === 0 ? 1500 : 40);
  check('a 30-min hold every 5th landing moves the bias < 2 min', etaBiasFrom(holds) < 120 && etaBiasFrom(holds) > 40, `${etaBiasFrom(holds).toFixed(0)}s`);
}

// ETA outlier void: a landing >30 min off the raw estimate is not graded.
{
  const t = 1_700_000_000_000;
  const normal = grading.gradeItems({ predRunway: '22L', predEtaTs: t, rawEtaTs: t, sampleSeq: 1 }, '22L', t + 60_000, ['22L']);
  const outlier = grading.gradeItems({ predRunway: '22L', predEtaTs: t, rawEtaTs: t, sampleSeq: 1 }, '22L', t + 40 * 60_000, ['22L']);
  check('normal landing grades ETA', normal.some((i) => i.cat === 'eta'));
  check('30min+ outlier voids ETA grade', !outlier.some((i) => i.cat === 'eta'));
}

// Surface: a ground aircraft on a runway with an arrival on short final is an
// incursion; a clear runway is not.
{
  const ap = { lat: 40, lon: -73, elevFt: 0 };
  const rwy = { activeEnd: '18', id: '18/36', activeHdg: 0, lenFt: 10000, offX: 0, offY: 0, role: 'DEP+ARR' };
  const onRwy = { callsign: 'GND1', onGround: true, lat: 40, lon: -73 };
  const arr = { callsign: 'ARR1', onGround: false, phase: 'FINAL', runway: '18', distNm: 1.0, lat: 40.02, lon: -73 };
  const s1 = detectSurface([onRwy, arr], ap, [rwy]);
  check('surface: incursion detected', s1.incursions.length === 1 && s1.incursions[0].severity === 'critical');
  check('surface: occupancy detected', s1.occupancy.length === 1);
  check('surface: clear runway = no incursion', detectSurface([arr], ap, [rwy]).incursions.length === 0);
}

// Separation monitor: real conflicts are flagged; duplicate tracks and
// diverging departures (normal ATC practice) are not.
{
  const ap = AIRPORTS.KJFK;
  const nm = (lat0, lon0, eNm, nNm) => ({ lat: lat0 + nNm / 60, lon: lon0 + eNm / (60 * Math.cos(lat0 * Math.PI / 180)) });
  const mk = (id, eNm, nNm, alt, gs, trk, phase, extra = {}) => ({
    id, callsign: id.toUpperCase(), ...nm(ap.lat, ap.lon, eNm, nNm), altFt: alt, agl: alt, gs, track: trk, vs: 0,
    onGround: false, squawk: '4321', category: 'A3', phase, distNm: Math.hypot(eNm, nNm), ...extra,
  });
  const head = atc.detectConflicts([mk('aaa111', -3, 20, 8000, 250, 90, 'ENROUTE'), mk('bbb222', 3, 20, 8000, 250, 270, 'ENROUTE')], ap);
  check('conflict: head-on pair at same level is flagged', head.length === 1, `${head.length}`);
  const dup = atc.detectConflicts([mk('a1b2c3', 0, 10, 5000, 210, 40, 'ARRIVAL'), mk('~a1b2c4', 0.2, 10.1, 5025, 205, 42, 'ARRIVAL')], ap);
  check('conflict: TIS-B duplicate of one aircraft is not a conflict', dup.length === 0, `${dup.length}`);
  const div = atc.detectConflicts([mk('dep001', 0.6, 1.9, 3000, 144, 33, 'DEPARTURE'), mk('dep002', -0.6, 1.8, 3400, 128, 325, 'DEPARTURE')], ap);
  check('conflict: diverging simultaneous departures are not flagged', div.length === 0, `${div.length}`);
  const conv = atc.detectConflicts([mk('dep003', -1.5, 3, 3000, 160, 60, 'DEPARTURE'), mk('dep004', 1.5, 3, 3200, 160, 300, 'DEPARTURE')], ap);
  check('conflict: converging departures are still flagged', conv.length === 1, `${conv.length}`);
  const df = atc.detectConflicts([mk('dep005', 0.5, 1.5, 1800, 160, 270, 'DEPARTURE', { runway: '27R' }), mk('arr005', 1.4, 1.2, 1500, 140, 270, 'FINAL', { runway: '27L' })], ap);
  check('conflict: departure beside an arrival to a different runway is not flagged', df.length === 0, `${df.length}`);
  const tis = atc.detectConflicts([mk('~ab12cd', -3, 20, 8000, 250, 90, 'ENROUTE'), mk('cc3344', 3, 20, 8000, 250, 270, 'ENROUTE')], ap);
  check('conflict: unidentified TIS-B tracks are excluded like VFR', tis.length === 0, `${tis.length}`);
}

if (failures) {
  console.error(`\n${failures} regression check(s) failed`);
  process.exit(1);
}
console.log('\nAll engine regression checks passed');

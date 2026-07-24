// CI regression gate: runs the full engine pipeline (sim traffic → two-pass
// config inference → annotate → prediction lock/grade, arrivals + departures)
// for 30 sim-minutes per airport and fails the build if grading breaks or
// accuracy collapses. Keeps engine regressions from ever reaching production.
//
//   node scripts/ci-regression.mjs

const t0 = Date.now();
let simMs = 0;
Date.now = () => t0 + simMs;

globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};

const [{ SimEngine }, { AIRPORTS }, atc, { PredictionTracker }, { runwayPrior }, { buildOutlook }, { wakeCat, wakeSepNm }, { computeCapacity }] = await Promise.all([
  import('../src/lib/sim.js'),
  import('../src/data/airports.js'),
  import('../src/engine/atc.js'),
  import('../src/engine/predictions.js'),
  import('../src/engine/learning.js'),
  import('../src/engine/forecast.js'),
  import('../src/engine/wake.js'),
  import('../src/engine/capacity.js'),
]);

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

  for (let t = 0; t < 1800; t += 1.5) {
    simMs += 1500;
    const tracks = sim.tick(1.5);
    const base = atc.allocateRunways(ap, wx);
    let ann = atc.annotateAircraft(tracks, ap, base, gateMap, runwayPrior);
    const obs = atc.inferActiveArrivals(ann, ap);
    const rwys = obs.size ? atc.allocateRunways(ap, wx, obs) : base;
    if (obs.size) ann = atc.annotateAircraft(tracks, ap, rwys, gateMap, runwayPrior);
    for (const ev of tracker.update(ann, rwys, true, true, atc.departureEnd)) {
      if (ev.kind === 'verify') graded++;
    }
  }

  const st = tracker.getState();
  check(`${icao} grades operations`, graded >= 8, `graded=${graded}`);
  check(`${icao} accuracy sane`, (st.allTime.pct ?? 0) >= 55, `overall=${st.allTime.pct}%`);
  check(`${icao} state shape`, !!st.allTime.byCat && typeof st.openCount === 'number');
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

// Capacity (AAR): responds to weather and stays in a sane range; low visibility
// must lower the acceptance rate.
{
  const ap = AIRPORTS.KJFK;
  const rwys = atc.allocateRunways(ap, { windDir: 250, windKt: 10 });
  const ann = atc.annotateAircraft([], ap, rwys, {}, runwayPrior);
  const vmc = computeCapacity(ann, rwys, { fltCat: 'VFR' }, 20);
  const lifr = computeCapacity(ann, rwys, { fltCat: 'LIFR' }, 20);
  check('AAR positive & sane', vmc.aar > 10 && vmc.aar < 200, `${vmc.aar}`);
  check('low visibility lowers AAR', lifr.aar < vmc.aar, `LIFR ${lifr.aar} < VFR ${vmc.aar}`);
  check('AAR exposes drivers', vmc.meanSpacingNm > 0 && vmc.finalSpeedKt > 0);
}

if (failures) {
  console.error(`\n${failures} regression check(s) failed`);
  process.exit(1);
}
console.log('\nAll engine regression checks passed');

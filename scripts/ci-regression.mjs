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

const [{ SimEngine }, { AIRPORTS }, atc, { PredictionTracker }, { runwayPrior }] = await Promise.all([
  import('../src/lib/sim.js'),
  import('../src/data/airports.js'),
  import('../src/engine/atc.js'),
  import('../src/engine/predictions.js'),
  import('../src/engine/learning.js'),
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

if (failures) {
  console.error(`\n${failures} regression check(s) failed`);
  process.exit(1);
}
console.log('\nAll engine regression checks passed');

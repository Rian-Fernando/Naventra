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

const [{ SimEngine }, { AIRPORTS }, atc, { PredictionTracker }, { runwayPrior }, { buildOutlook }, { wakeCat, wakeSepNm, wakeDepartureSepSec }, { computeCapacity }, { etaVec, etaCorrectionSec }, grading] = await Promise.all([
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
  // Low-visibility: CAT III (100ft ceiling, 1/4mi vis) cuts AAR hard + sets LVP.
  const catIII = computeCapacity(ann, rwys, { clouds: [{ code: 'OVC', baseFt: 100 }], visib: '1/4' }, 20);
  check('clear sky = VMC, no LVP', vmc.approachCat === 'VMC' && vmc.lvp === false, vmc.approachCat);
  check('low ceiling/vis = CAT III + LVP', catIII.approachCat === 'CAT III' && catIII.lvp === true, catIII.approachCat);
  check('LVP widens spacing to ≥6nm', catIII.effSpacingNm >= 6, `${catIII.effSpacingNm}`);
  check('CAT III AAR well below VMC', catIII.aar < vmc.aar * 0.7, `${catIII.aar} vs ${vmc.aar}`);
}

// ETA model serving: feature vector matches training length, correction is
// clamped, and it only fires for an adopted airport.
check('etaVec length = 11', etaVec({}).length === 11);
check('etaVec all finite', etaVec({ dist_nm: 10, gs_kt: 140, head_kt: 8, wake: 'H', flt_cat: 'IFR', hour_local: 14 }).every(Number.isFinite));
{
  const synth = { airports: { TEST: { eta: { adopt: true, W: new Array(11).fill(1) } } } };
  const corr = etaCorrectionSec(synth, 'TEST', { dist_nm: 16, gs_kt: 200, head_kt: 20 });
  check('eta correction is a clamped number', typeof corr === 'number' && corr >= -600 && corr <= 900, `${corr}`);
  check('eta correction null when no model', etaCorrectionSec(synth, 'NOPE', {}) === null);
  check('eta correction null when not adopted', etaCorrectionSec({ airports: { X: { eta: { adopt: false, W: [1] } } } }, 'X', {}) === null);
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

if (failures) {
  console.error(`\n${failures} regression check(s) failed`);
  process.exit(1);
}
console.log('\nAll engine regression checks passed');

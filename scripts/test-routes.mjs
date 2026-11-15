// Route display tests: a published route is shown only when it fits where the
// aircraft actually is (flight numbers get reused), multi-leg routes pick the
// right leg, and the end the track shows survives when no route fits.
//
//   node scripts/test-routes.mjs

import { legFits, describeRoute, crossAlong, isAirlineCallsign } from '../src/lib/routeMatch.js';
import { AIRPORTS } from '../src/data/airports.js';
import { fieldRadiusNm, annotateAircraft, allocateRunways } from '../src/engine/atc.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failures++;
};

const ep = (iata, icao, lat, lon, city) => ({ iata, icao, lat, lon, city, name: city });
const JFK = ep('JFK', 'KJFK', 40.6398, -73.7789, 'New York');
const LGA = ep('LGA', 'KLGA', 40.7769, -73.874, 'New York');
const BOS = ep('BOS', 'KBOS', 42.3656, -71.0096, 'Boston');
const MIA = ep('MIA', 'KMIA', 25.7959, -80.287, 'Miami');
const LAX = ep('LAX', 'KLAX', 33.9425, -118.408, 'Los Angeles');
const LHR = ep('LHR', 'EGLL', 51.47, -0.4543, 'London');
const ORD = ep('ORD', 'KORD', 41.9786, -87.9048, 'Chicago');
const jfk = AIRPORTS.KJFK;
const near = (p, dLat, dLon) => ({ lat: p.lat + dLat, lon: p.lon + dLon });

// ------------------------------------------------------------------ geometry --
{
  const mid = { lat: 41.5, lon: -72.4 }; // roughly between JFK and BOS
  const { xt, at } = crossAlong(JFK, BOS, mid);
  check('cross-track of a point near the JFK–BOS line is small', xt < 15, `${xt.toFixed(1)} nm`);
  check('along-track lands between the two airports', at > 50 && at < 170, `${at.toFixed(0)} nm`);
}

// ------------------------------------------------------------ fits / doesn't --
check('cruise over Kansas fits JFK → LAX', legFits({ lat: 38.9, lon: -97.5, altFt: 37000, vs: 0, gs: 460, track: 265 }, JFK, LAX));
check('…but not if it is heading east', !legFits({ lat: 38.9, lon: -97.5, altFt: 37000, vs: 0, gs: 460, track: 85 }, JFK, LAX));
check('cruise 600 nm off the great circle does not fit', !legFits({ lat: 30.0, lon: -97.5, altFt: 37000, vs: 0, gs: 460, track: 265 }, JFK, LAX));
check('climbing out of JFK fits JFK → MIA', legFits({ ...near(JFK, -0.05, 0.02), altFt: 3000, vs: 2500, gs: 220, track: 200 }, JFK, MIA));
check('descending near JFK does NOT fit JFK → MIA (wrong direction)', !legFits({ ...near(JFK, 0.1, 0.1), altFt: 3000, vs: -900, gs: 200, track: 220 }, JFK, MIA));
check('descending into JFK fits BOS → JFK', legFits({ ...near(JFK, 0.15, 0.2), altFt: 4000, vs: -900, gs: 210, track: 220 }, BOS, JFK));
check('climbing away from JFK does NOT fit BOS → JFK', !legFits({ ...near(JFK, 0.1, 0.1), altFt: 4000, vs: 2000, gs: 230, track: 40 }, BOS, JFK));
check('low near NYC fits neither end of BOS → MIA', !legFits({ ...near(JFK, 0.1, 0.1), altFt: 2500, vs: -700, gs: 180, track: 220 }, BOS, MIA));
check('parked at JFK fits a route from or to JFK', legFits({ ...near(JFK, 0.005, 0.005), altFt: 0, onGround: true, vs: 0, gs: 0, track: 0 }, JFK, MIA));
check('parked at JFK does not fit Chicago → Los Angeles', !legFits({ ...near(JFK, 0.005, 0.005), altFt: 0, onGround: true, vs: 0, gs: 0, track: 0 }, ORD, LAX));

// ------------------------------------------------------------ describeRoute --
const route = (from, to, via = null, airline = 'Test Air') => ({ airline, from, to, via });
{
  const ac = { callsign: 'DAL123', ...near(JFK, 0.12, 0.15), altFt: 3500, vs: -800, gs: 200, track: 220, phase: 'APPROACH' };
  const rd = describeRoute(route(BOS, JFK), ac, jfk);
  check('arrival with a fitting route shows both ends', rd.source === 'route' && rd.from.iata === 'BOS' && rd.to.iata === 'JFK');
}
{
  const ac = { callsign: 'UAL1643', ...near(JFK, 0.1, 0.1), altFt: 2500, vs: -900, gs: 180, track: 220, phase: 'ARRIVAL' };
  const rd = describeRoute(route(ep('RIC', 'KRIC', 37.505, -77.3197, 'Richmond'), ep('DEN', 'KDEN', 39.8617, -104.6731, 'Denver')), ac, jfk);
  check('stale route (reused flight number) is not shown', rd.source == null && !rd.from && !rd.to);
  check('…and the card says why', /doesn't match where this aircraft is/.test(rd.note || ''), rd.note);
}
{
  const ac = { callsign: 'EDV5552', ...near(LGA, -0.08, -0.05), altFt: 2200, vs: -700, gs: 160, track: 40, phase: 'ARRIVAL' };
  const rd = describeRoute(route(ep('SDF', 'KSDF', 38.1744, -85.736, 'Louisville'), LGA), ac, jfk);
  check('flight into LaGuardia shows its real route (SDF → LGA)', rd.source === 'route' && rd.to.iata === 'LGA');
}
{
  const ac = { callsign: 'JBU1382', ...near(JFK, -0.04, 0.03), altFt: 600, vs: -700, gs: 140, track: 310, phase: 'FINAL' };
  const rd = describeRoute(null, ac, jfk);
  check('on final with no route on file: still shows → JFK (seen)', rd.source === 'seen' && rd.to.iata === 'JFK' && !rd.from);
  check('…and explains no route is on file', /No published route/.test(rd.note || ''));
}
{
  const ac = { callsign: 'JBU920', ...near(JFK, -0.03, -0.04), altFt: 1500, vs: 2300, gs: 190, track: 220, phase: 'DEPARTURE', depFromField: true };
  const rd = describeRoute(undefined, ac, jfk);
  check('climbing off our runway, route unknown yet: shows JFK → (seen)', rd.source === 'seen' && rd.from.iata === 'JFK' && !rd.to);
}
{
  const ac = { callsign: 'EDV5004', ...near(LGA, 0.004, 0.006), altFt: 500, vs: 2600, gs: 170, track: 33, phase: 'DEPARTURE' };
  const rd = describeRoute(route(ep('CHS', 'KCHS', 32.8986, -80.0405, 'Charleston'), LGA), ac, jfk);
  check('climbing out over an airport on file, other leg: shows LGA → (seen)', rd.source === 'seen' && rd.from.iata === 'LGA' && !rd.to);
}
{
  const ac = { callsign: 'N123AB', ...near(JFK, 0.2, 0.2), altFt: 2000, vs: 0, gs: 110, track: 90, phase: 'ENROUTE' };
  const rd = describeRoute(null, ac, jfk);
  check('private / GA callsign gets a plain explanation', /Private or general-aviation/.test(rd.note || '') && !rd.source);
  check('registrations are not airline callsigns', !isAirlineCallsign('N123AB') && isAirlineCallsign('BAW117'));
}
{
  // Multi-leg: LAX → JFK → LHR under one flight number.
  const legs = route(LAX, LHR, JFK);
  const arriving = describeRoute(legs, { callsign: 'AAL100', ...near(JFK, 0.15, 0.2), altFt: 4000, vs: -800, gs: 200, track: 220, phase: 'APPROACH' }, jfk);
  check('multi-leg, arriving at the stopover: LAX → JFK leg', arriving.from?.iata === 'LAX' && arriving.to?.iata === 'JFK', `${arriving.from?.iata}>${arriving.to?.iata}`);
  const leaving = describeRoute(legs, { callsign: 'AAL100', ...near(JFK, 0.1, 0.15), altFt: 5000, vs: 2500, gs: 250, track: 50, phase: 'DEPARTURE' }, jfk);
  check('multi-leg, climbing out of the stopover: JFK → LHR leg', leaving.from?.iata === 'JFK' && leaving.to?.iata === 'LHR', `${leaving.from?.iata}>${leaving.to?.iata}`);
  const parked = describeRoute(legs, { callsign: 'AAL100', ...near(JFK, 0.004, 0.004), altFt: 0, onGround: true, vs: 0, gs: 0, track: 0, phase: 'GROUND' }, jfk);
  check('multi-leg, on the ground at the stopover: whole route', parked.via?.iata === 'JFK' && parked.from?.iata === 'LAX' && parked.to?.iata === 'LHR');
}

{
  // New York's airports are 9–16 nm apart: engine evidence must win.
  const parked = { callsign: 'EDV5035', ...near(JFK, 0.004, 0.006), altFt: 0, onGround: true, vs: 0, gs: 0, track: 0, phase: 'GROUND', atField: true };
  check('parked at JFK: a route ending at LaGuardia is not shown', !describeRoute(route(ep('TYS', 'KTYS', 35.811, -83.994, 'Knoxville'), LGA), parked, jfk).source);
  const finalHere = { callsign: 'JBU1408', ...near(JFK, 0.05, 0.05), altFt: 1200, vs: -700, gs: 140, track: 220, phase: 'FINAL' };
  const rf = describeRoute(route(MIA, ep('EWR', 'KEWR', 40.6925, -74.1687, 'Newark')), finalHere, jfk);
  check('on final at JFK: a route ending at Newark is replaced by → JFK (seen)', rf.source === 'seen' && rf.to.iata === 'JFK');
  const offOurRunway = { callsign: 'RPA3586', ...near(JFK, -0.04, -0.03), altFt: 1800, vs: 2400, gs: 190, track: 220, phase: 'DEPARTURE', depFromField: true };
  check('climbing off a JFK runway: a route from Newark is not shown', describeRoute(route(ep('EWR', 'KEWR', 40.6925, -74.1687, 'Newark'), ep('GSO', 'KGSO', 36.098, -79.937, 'Greensboro')), offOurRunway, jfk).from?.iata === 'JFK');
  const atLga = { callsign: 'DAL1', ...near(LGA, 0.002, 0.002), altFt: 0, onGround: true, vs: 0, gs: 0, track: 0 };
  check('on the ground: "at the airport" means within 4 nm, not 40', legFits(atLga, LGA, MIA) && !legFits(atLga, JFK, MIA));
}

{
  const SAN = ep('SAN', 'KSAN', 32.7336, -117.1897, 'San Diego');
  const climbingOutOfNY = { callsign: 'JBU920', ...near(JFK, 0.3, 0.4), altFt: 12000, vs: 2200, gs: 300, track: 60, phase: 'DEPARTURE' };
  check('climbing through 12,000 ft near New York does not fit San Diego → Boston', !legFits(climbingOutOfNY, SAN, BOS));
  const overflight = { callsign: 'JBU999', lat: 40.95, lon: -73.0, altFt: 35000, vs: 0, gs: 460, track: 75 };
  check('level at FL350 over Long Island still fits a long route passing overhead', legFits(overflight, ep('PIT', 'KPIT', 40.4915, -80.2329, 'Pittsburgh'), BOS));
  const downwind = annotateAircraft([{ id: 'd1', callsign: 'ASL500', ...near(JFK, 0.12, -0.12), altFt: 4000, gs: 210, track: 315, vs: -800 }], jfk, allocateRunways(jfk, { windDir: 220, windKt: 10 }), {})[0];
  check('descending while moving away (downwind) is not called a departure', downwind.phase !== 'DEPARTURE', downwind.phase);
}

// --------------------------------------------------------- on this airport --
{
  check('field radius covers Amsterdam\'s Polderbaan (ends 3.8 nm out)', fieldRadiusNm(AIRPORTS.EHAM) > 4.3, fieldRadiusNm(AIRPORTS.EHAM).toFixed(2));
  check('field radius at JFK stays well short of LaGuardia (9 nm)', fieldRadiusNm(jfk) < 3, fieldRadiusNm(jfk).toFixed(2));
  const parkedAtLGA = { id: 'a1', callsign: 'DAL1', ...near(LGA, 0, 0), altFt: 0, onGround: true, gs: 0, track: 0, vs: 0 };
  const parkedAtJFK = { id: 'a2', callsign: 'DAL2', ...near(JFK, 0.004, 0.004), altFt: 0, onGround: true, gs: 0, track: 0, vs: 0 };
  const ann = annotateAircraft([parkedAtLGA, parkedAtJFK], jfk, allocateRunways(jfk, { windDir: 220, windKt: 10 }), {});
  check('aircraft parked at LaGuardia is not on JFK\'s field', ann[0].atField === false && ann[0].runway == null && ann[0].gate == null);
  check('aircraft parked at JFK is on the field', ann[1].atField === true);
}

console.log(`\n${failures ? `${failures} FAILED` : 'All route checks passed'}`);
process.exit(failures ? 1 : 0);

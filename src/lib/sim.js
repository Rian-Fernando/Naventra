// Physics-based traffic simulation, used when no live ADS-B source is
// reachable (or when SIM mode is forced). Aircraft fly plausible profiles
// against the selected airport's real runway geometry and carrier mix:
// arrivals intercept the active approach course and ride a 3° glideslope,
// departures roll, rotate and climb out on the active departure runway.

import { project, bearingDeg, distNm } from './geo.js';

// Aim point of a runway strip: the airport reference point shifted by the
// strip's lateral offset (parallels are ~0.55nm apart — see stripOffsets).
function runwayPoint(airport, rwy) {
  const offX = rwy.offX || 0;
  const offY = rwy.offY || 0;
  const dist = Math.hypot(offX, offY);
  if (dist < 0.01) return { lat: airport.lat, lon: airport.lon };
  const brg = (Math.atan2(offX, offY) * 180) / Math.PI;
  return project(airport.lat, airport.lon, brg, dist);
}

const TYPES = [
  ['B738', 'BOEING 737-800'], ['A320', 'AIRBUS A320'], ['A21N', 'AIRBUS A321neo'],
  ['B77W', 'BOEING 777-300ER'], ['A359', 'AIRBUS A350-900'], ['B789', 'BOEING 787-9'],
  ['E75L', 'EMBRAER 175'], ['B763', 'BOEING 767-300'], ['CRJ9', 'CRJ-900'], ['A333', 'AIRBUS A330-300'],
];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function turnToward(current, target, maxDeg) {
  let diff = ((target - current + 540) % 360) - 180;
  if (Math.abs(diff) <= maxDeg) return target;
  return (current + Math.sign(diff) * maxDeg + 360) % 360;
}

export class SimEngine {
  constructor(airport, runways) {
    this.airport = airport;
    this.runways = runways;
    this.seq = 0;
    this.aircraft = [];
    this.usedFlights = new Set();
    for (let i = 0; i < 11; i++) this.spawnArrival(rnd(6, 48));
    for (let i = 0; i < 4; i++) this.spawnDeparture(rnd(3, 22));
    for (let i = 0; i < 5; i++) this.spawnOverflight();
  }

  setRunways(runways) {
    this.runways = runways;
  }

  makeIdentity() {
    const carrier = pick(this.airport.carriers);
    let flight;
    do { flight = `${carrier}${Math.floor(rnd(100, 2900))}`; } while (this.usedFlights.has(flight));
    this.usedFlights.add(flight);
    const [t, desc] = pick(TYPES);
    return { id: `sim${(++this.seq).toString(16).padStart(4, '0')}`, callsign: flight, type: t, desc, reg: null, operator: null, squawk: String(Math.floor(rnd(1000, 7000))), category: 'A3', emergency: null };
  }

  arrRwy() { return pick(this.runways.filter((r) => r.role.includes('ARR'))) || this.runways[0]; }
  depRwy() { return pick(this.runways.filter((r) => r.role.includes('DEP'))) || this.runways[0]; }

  spawnArrival(atDistNm) {
    const rwy = this.arrRwy();
    const appCourse = rwy.activeHdg;                 // direction flown on final
    const backBrg = (appCourse + 180) % 360;         // from field out along approach
    const aim = runwayPoint(this.airport, rwy);
    // Start displaced laterally from the approach course; converge via a gate
    // point 9nm out on the extended centerline.
    const lateral = rnd(-40, 40);
    const p = project(aim.lat, aim.lon, (backBrg + lateral + 360) % 360, atDistNm);
    const alt = Math.min(16000, Math.max(2200, atDistNm * 310 + rnd(-400, 600))) + this.airport.elevFt;
    this.aircraft.push({
      ...this.makeIdentity(),
      mode: 'arr', rwy, aim,
      lat: p.lat, lon: p.lon,
      altFt: alt,
      gs: atDistNm > 25 ? rnd(270, 320) : atDistNm > 10 ? rnd(200, 250) : rnd(140, 175),
      track: bearingDeg(p.lat, p.lon, aim.lat, aim.lon) + rnd(-8, 8),
      vs: -rnd(600, 1400),
      onGround: false, groundT: 0,
    });
  }

  spawnDeparture(atDistNm = 0) {
    const rwy = this.depRwy();
    const hdg = rwy.activeHdg;
    if (atDistNm < 1) {
      const aim = runwayPoint(this.airport, rwy);
      this.aircraft.push({
        ...this.makeIdentity(), mode: 'dep', rwy,
        lat: aim.lat, lon: aim.lon,
        altFt: this.airport.elevFt, gs: 0, track: hdg, vs: 0, onGround: true, groundT: 0, holdT: rnd(8, 90),
      });
    } else {
      const p = project(this.airport.lat, this.airport.lon, hdg + rnd(-14, 14), atDistNm);
      this.aircraft.push({
        ...this.makeIdentity(), mode: 'dep', rwy,
        lat: p.lat, lon: p.lon,
        altFt: this.airport.elevFt + Math.min(17000, atDistNm * 480 + rnd(0, 1500)),
        gs: rnd(250, 320), track: hdg + rnd(-12, 12), vs: rnd(1500, 2600), onGround: false, groundT: 0,
      });
    }
  }

  spawnOverflight() {
    const brg = rnd(0, 360);
    const p = project(this.airport.lat, this.airport.lon, brg, rnd(20, 55));
    this.aircraft.push({
      ...this.makeIdentity(), mode: 'ovf',
      lat: p.lat, lon: p.lon,
      altFt: rnd(24000, 39000), gs: rnd(400, 500),
      track: (brg + 180 + rnd(-50, 50) + 360) % 360, vs: rnd(-100, 100), onGround: false, groundT: 0,
    });
  }

  tick(dtSec) {
    const ap = this.airport;
    const gone = [];

    for (const ac of this.aircraft) {
      const d = distNm(ac.lat, ac.lon, ap.lat, ap.lon);

      if (ac.mode === 'arr' && !ac.onGround) {
        const appCourse = ac.rwy.activeHdg;
        const dAim = distNm(ac.lat, ac.lon, ac.aim.lat, ac.aim.lon);
        const gatePt = project(ac.aim.lat, ac.aim.lon, (appCourse + 180) % 360, 9);
        const onFinal = dAim < 9.5;
        // Inside 1.2nm the bearing to the aim point flips as we pass it — hold
        // the runway course instead so short final stays stable to touchdown.
        const desired = onFinal
          ? (dAim < 1.2 ? appCourse : bearingDeg(ac.lat, ac.lon, ac.aim.lat, ac.aim.lon))
          : bearingDeg(ac.lat, ac.lon, gatePt.lat, gatePt.lon);
        ac.track = turnToward(ac.track, desired, 3 * dtSec);

        const targetGs = dAim > 25 ? 290 : dAim > 10 ? 220 : dAim > 4 ? 170 : 145;
        ac.gs += Math.sign(targetGs - ac.gs) * Math.min(Math.abs(targetGs - ac.gs), 1.6 * dtSec);
        const targetAlt = ap.elevFt + Math.max(0, dAim * 318);       // 3° slope
        const err = ac.altFt - targetAlt;
        ac.vs = Math.max(-2000, Math.min(-200, -err * 2 - 300));
        if (err < -300) ac.vs = 0;                                   // never below profile
        ac.altFt += (ac.vs / 60) * dtSec;

        if (dAim < 0.6 && ac.altFt - ap.elevFt < 220) {              // touchdown
          ac.onGround = true;
          ac.altFt = ap.elevFt;
          ac.vs = 0;
        }
      } else if (ac.mode === 'arr' && ac.onGround) {
        ac.gs = Math.max(12, ac.gs - 4.5 * dtSec);                   // rollout → taxi
        ac.groundT += dtSec;
        if (ac.groundT > 75) gone.push(ac.id);                       // at the stand
      } else if (ac.mode === 'dep') {
        if (ac.onGround) {
          if (ac.holdT > 0) { ac.holdT -= dtSec; }                   // lineup wait
          else {
            ac.gs += 4.8 * dtSec;                                    // takeoff roll
            if (ac.gs >= 152) { ac.onGround = false; ac.vs = 2300; }
          }
        } else {
          ac.gs = Math.min(ac.gs + 2.2 * dtSec, 445);
          ac.altFt += (ac.vs / 60) * dtSec;
          ac.vs = ac.altFt - ap.elevFt > 15000 ? Math.max(800, ac.vs - 12 * dtSec) : ac.vs;
          ac.track = turnToward(ac.track, ac.track + (ac.turnBias ??= rnd(-18, 18)) * 0.01, 1.2 * dtSec);
          if (d > 56) gone.push(ac.id);
        }
        if (!ac.onGround) { /* position advanced below */ }
      } else if (ac.mode === 'ovf') {
        ac.altFt += (ac.vs / 60) * dtSec;
        if (d > 58) gone.push(ac.id);
      }

      if (!ac.onGround || ac.gs > 0) {
        const p = project(ac.lat, ac.lon, ac.track, (ac.gs / 3600) * dtSec);
        ac.lat = p.lat;
        ac.lon = p.lon;
      }
    }

    this.aircraft = this.aircraft.filter((a) => !gone.includes(a.id));

    // Keep the pattern fed.
    const arrivals = this.aircraft.filter((a) => a.mode === 'arr').length;
    const deps = this.aircraft.filter((a) => a.mode === 'dep').length;
    const ovf = this.aircraft.filter((a) => a.mode === 'ovf').length;
    if (arrivals < 11 && Math.random() < 0.35) this.spawnArrival(rnd(38, 52));
    if (deps < 5 && Math.random() < 0.3) this.spawnDeparture(0);
    if (ovf < 5 && Math.random() < 0.15) this.spawnOverflight();

    const now = Date.now();
    return this.aircraft.map((a) => ({
      id: a.id, callsign: a.callsign, reg: a.reg, type: a.type, desc: a.desc, operator: a.operator,
      lat: a.lat, lon: a.lon, altFt: Math.round(a.altFt), gs: Math.round(a.gs), track: (a.track + 360) % 360,
      vs: Math.round(a.vs), squawk: a.squawk, category: a.category, onGround: a.onGround,
      emergency: null, seenAt: now,
    }));
  }
}

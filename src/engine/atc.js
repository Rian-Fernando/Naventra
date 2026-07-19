// Naventra decision core — a deterministic expert system that performs the
// controller tasks: runway configuration, arrival sequencing, separation
// monitoring (CPA), gate allocation and radio phraseology generation.
// It runs identically on live ADS-B tracks and on simulated traffic.

import { distNm, bearingDeg, velocityNmS, toLocalNm, cpa, angleDiff, windComponents, fmtAlt } from '../lib/geo.js';
import { airlineName } from '../data/airports.js';
import { octantOf } from './octant.js';

export const PHASES = ['GROUND', 'DEPARTURE', 'ENROUTE', 'ARRIVAL', 'APPROACH', 'FINAL'];

// Deterministic small hash → [0,1). Used for stable pseudo-random choices
// (confidence scores, gate picks) that don't jitter between ticks.
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function radioName(callsign) {
  const name = airlineName(callsign);
  if (!name) return callsign;
  const num = callsign.slice(3).replace(/^0+/, '');
  return `${name} ${num}`;
}

// ---------------------------------------------------------------- runways ---

// Lateral geometry for parallel runway groups. The spec DB stores headings and
// lengths only, so parallels are spread perpendicular to their axis at a
// realistic ~0.55nm pitch. Every consumer (radar views, simulation, runway
// scoring, landing classification) shares these offsets so parallels are
// distinguishable — and render as actual parallel lines.
const offsetCache = new Map();

export function stripOffsets(airport) {
  let m = offsetCache.get(airport.icao);
  if (m) return m;
  m = new Map();
  const groups = [];
  for (const rwy of airport.runways) {
    const g = groups.find((grp) => angleDiff(grp[0].trueHdg, rwy.trueHdg) < 20);
    if (g) g.push(rwy); else groups.push([rwy]);
  }
  for (const g of groups) {
    g.sort((a, b) => a.id.localeCompare(b.id));
    g.forEach((rwy, i) => {
      const off = (i - (g.length - 1) / 2) * 0.55;
      const rad = rwy.trueHdg * (Math.PI / 180);
      // perpendicular (right of course): (cos h, -sin h) in east/north nm
      m.set(rwy.id, { offX: Math.cos(rad) * off, offY: -Math.sin(rad) * off });
    });
  }
  offsetCache.set(airport.icao, m);
  return m;
}

// Which runway END is an aircraft physically lined up with? Offset-aware, both
// directions. `maxAlong` bounds how far past the field to accept (small for
// arrivals on final; larger for departures already climbing out).
export function alignedEnd(ac, airport, maxAlong = 1.0, maxCross = 1.4) {
  const p = toLocalNm(airport.lat, airport.lon, ac.lat, ac.lon);
  const offsets = stripOffsets(airport);
  let best = null, bestScore = Infinity;
  for (const rwy of airport.runways) {
    const off = offsets.get(rwy.id) || { offX: 0, offY: 0 };
    const px = p.x - off.offX, py = p.y - off.offY;
    for (let e = 0; e < 2; e++) {
      const hdg = (rwy.trueHdg + e * 180) % 360;
      const align = angleDiff(ac.track, hdg);
      if (align > 35) continue;
      const dirX = Math.sin(hdg * Math.PI / 180), dirY = Math.cos(hdg * Math.PI / 180);
      const cross = Math.abs(px * dirY - py * dirX);
      const along = px * dirX + py * dirY;
      if (cross > maxCross || along > maxAlong) continue;
      const score = align * 0.05 + cross;
      if (score < bestScore) { bestScore = score; best = rwy.ends[e]; }
    }
  }
  return best;
}

// The runway an aircraft is DEPARTING from: low, climbing, aligned, already
// climbing out along/past the runway (so a wider along window than arrivals).
export function departureEnd(ac, airport) {
  if (ac.onGround || ac.agl == null || ac.agl < 100 || ac.agl > 2500) return null;
  if (ac.vs < 500 || ac.gs < 90 || ac.distNm > 6) return null;
  return alignedEnd(ac, airport, 5.0, 1.2);
}

// Read the ACTIVE arrival runways from traffic on final approach — what a
// controller sees, and better than a wind guess because real flows follow
// procedure and inertia. This test is INDEPENDENT of the wind-based phase:
// otherwise, aircraft landing opposite the wind-guessed direction would never
// be classified "final" and the inference would miss the true configuration.
export function inferActiveArrivals(annotated, airport) {
  const ends = new Map();
  for (const a of annotated) {
    if (a.onGround || a.altFt == null || a.gs < 60) continue;
    if (a.agl == null || a.agl > 4000 || a.distNm > 12) continue;
    if (a.vs > 400) continue;       // descending/level, not climbing out (departure)
    if (a.closing < 0.2) continue;  // tracking toward the field, not away
    const e = alignedEnd(a, airport);
    if (e) ends.set(e, (ends.get(e) || 0) + 1);
  }
  return ends; // Map: runwayEnd -> count of aligned arrivals
}

// `observed` (optional Map end->count from inferActiveArrivals) overrides the
// wind guess with the real, observed configuration when traffic reveals it.
export function allocateRunways(airport, wx, observed = null) {
  const windDir = wx?.windDir ?? null;
  const windKt = wx?.windKt ?? 0;

  // Choose the flow direction from the longest strip: land into the wind.
  const primary = [...airport.runways].sort((a, b) => b.lenFt - a.lenFt)[0];
  let useReciprocal = false;
  if (windDir != null && windKt >= 4) {
    useReciprocal = windComponents(primary.trueHdg, windDir, windKt).head < 0;
  }

  const offsets = stripOffsets(airport);
  const strips = airport.runways.map((rwy) => {
    const endIdx = useReciprocal && angleDiff(rwy.trueHdg, primary.trueHdg) < 60 ? 1 : useReciprocal ? 1 : 0;
    const activeHdg = (rwy.trueHdg + (endIdx === 1 ? 180 : 0)) % 360;
    const comps = windDir != null ? windComponents(activeHdg, windDir, windKt) : { head: 0, cross: 0 };
    return {
      ...rwy,
      ...offsets.get(rwy.id),
      activeEnd: rwy.ends[endIdx],
      activeHdg,
      head: comps.head,
      cross: comps.cross,
      hasIls: rwy.ils.includes(rwy.ends[endIdx]),
    };
  });

  const arrSet = observed && observed.size ? new Set(observed.keys()) : null;
  if (arrSet) {
    const setEnd = (s, end) => {
      const endIdx = s.ends.indexOf(end);
      s.activeEnd = end;
      s.activeHdg = (s.trueHdg + (endIdx === 1 ? 180 : 0)) % 360;
      const comps = windDir != null ? windComponents(s.activeHdg, windDir, windKt) : { head: 0, cross: 0 };
      s.head = comps.head; s.cross = comps.cross;
      s.hasIls = s.ils.includes(end);
      s.status = s.cross > 28 ? 'X-WIND' : 'ACTIVE';
    };
    // Point observed runways at the arrival end actually in use.
    for (const s of strips) {
      const obsEnd = s.ends.find((e) => arrSet.has(e));
      if (obsEnd) { setEnd(s, obsEnd); s.role = 'ARR'; s.observed = true; }
    }
    // Mean flow heading of the observed arrivals — departures run the same way.
    const arr = strips.filter((s) => s.observed);
    let vx = 0, vy = 0;
    for (const s of arr) { vx += Math.cos(s.activeHdg * Math.PI / 180); vy += Math.sin(s.activeHdg * Math.PI / 180); }
    const flowHdg = (Math.atan2(vy, vx) / (Math.PI / 180) + 360) % 360;
    for (const s of strips) {
      if (s.observed) continue;
      // orient a departure runway to whichever end matches the observed flow
      const h0 = s.trueHdg, h1 = (s.trueHdg + 180) % 360;
      setEnd(s, angleDiff(h0, flowHdg) <= angleDiff(h1, flowHdg) ? s.ends[0] : s.ends[1]);
      s.role = 'DEP';
    }
    if (!strips.some((s) => s.role.includes('DEP'))) {
      strips.sort((a, b) => b.lenFt - a.lenFt)[0].role = 'DEP+ARR'; // ensure a departure runway
    }
    return strips;
  }

  // Role assignment: longest gets arrivals; alternate the rest so both flows
  // always have at least one runway. Excess crosswind flags an advisory.
  const byLen = [...strips].sort((a, b) => b.lenFt - a.lenFt);
  byLen.forEach((s, i) => {
    s.role = strips.length === 1 ? 'DEP+ARR' : strips.length === 2 ? (i === 0 ? 'ARR' : 'DEP') : i === 0 ? 'DEP+ARR' : i % 2 === 1 ? 'ARR' : 'DEP';
    s.status = s.cross > 28 ? 'X-WIND' : 'ACTIVE';
  });
  return strips;
}

// ------------------------------------------------------------ annotation ---

// `priorFn(icao, octant, runwayEnd) -> [0,1]` injects learned runway habits.
// The browser passes a localStorage-backed fn; the tracker passes a D1-backed
// one; default is a no-op so the engine stays pure and portable.
export function annotateAircraft(aircraft, airport, runways, gateMap, priorFn = () => 0) {
  const arrRwys = runways.filter((r) => r.role.includes('ARR'));
  const fieldElev = airport.elevFt;

  const annotated = aircraft.map((ac) => {
    const d = distNm(ac.lat, ac.lon, airport.lat, airport.lon);
    const brgTo = bearingDeg(ac.lat, ac.lon, airport.lat, airport.lon);
    const agl = ac.altFt != null ? ac.altFt - fieldElev : null;
    // Radial closure: positive when the track points at the field.
    const closing = ac.gs > 20 ? Math.cos((ac.track - brgTo) * (Math.PI / 180)) : 0;

    // Rotorcraft use pads, not the arrival flow — never runway-sequenced.
    const heli = ac.category === 'A7';
    let phase = 'ENROUTE';
    if (ac.onGround || (agl != null && agl < 150 && ac.gs < 60)) phase = 'GROUND';
    else if (heli) phase = 'ENROUTE';
    // Over the field the radial-closure test is meaningless — a fast, low
    // aircraft within ~1nm is landing (or departing, caught above by climb).
    else if (agl != null && d < 1.2 && agl < 2500 && ac.gs > 60 && ac.vs < 400) phase = 'FINAL';
    else if (agl != null && d < 9 && agl < 3800 && closing > 0.25 && ac.vs < 400 &&
             arrRwys.some((r) => angleDiff(ac.track, r.activeHdg) < 35)) phase = 'FINAL';
    else if (agl != null && d < 16 && agl < 7000 && closing > 0 && ac.vs < 300) phase = 'APPROACH';
    // Above ~20k AGL inside the ring it's an overflight, not TRACON traffic.
    else if (agl != null && agl < 20000 && d < 45 && closing > 0.3 && (ac.vs < -250 || agl < 12000)) phase = 'ARRIVAL';
    else if (agl != null && d < 30 && closing < -0.2 && (ac.vs > 300 || agl < 10000)) phase = 'DEPARTURE';

    // Inbound ETA models the deceleration to approach speed instead of
    // assuming current ground speed holds to the threshold.
    const inboundPhase = phase === 'ARRIVAL' || phase === 'APPROACH' || phase === 'FINAL';
    const etaMin = ac.gs > 40
      ? (d / (inboundPhase ? Math.max(95, (ac.gs + 145) / 2) : ac.gs)) * 60
      : null;
    return { ...ac, distNm: d, brgFromField: (brgTo + 180) % 360, agl, phase, etaMin, closing };
  });

  // Arrival sequencing: order the inbound flows by ETA and distribute across
  // active arrival runways (parallel-approach style alternation).
  const inbound = annotated
    .filter((a) => a.phase === 'ARRIVAL' || a.phase === 'APPROACH' || a.phase === 'FINAL')
    .sort((a, b) => (a.etaMin ?? 999) - (b.etaMin ?? 999));

  // Runway scoring for committed traffic: track alignment plus cross-track
  // distance to the extended centerline, biased by learned facility habits
  // (P(runway | approach octant) from previously verified landings) — this is
  // the plan the scorecard grades against the runway actually landed on.
  const runwayScore = (a, r) => {
    const p = toLocalNm(airport.lat, airport.lon, a.lat, a.lon);
    const px = p.x - (r.offX || 0);
    const py = p.y - (r.offY || 0);
    const dirX = Math.sin(r.activeHdg * Math.PI / 180);
    const dirY = Math.cos(r.activeHdg * Math.PI / 180);
    const cross = Math.abs(px * dirY - py * dirX);
    const prior = priorFn(airport.icao, octantOf(a.brgFromField), r.activeEnd);
    return angleDiff(a.track, r.activeHdg) * 0.05 + cross - prior * 1.2;
  };

  inbound.forEach((a, i) => {
    a.seq = i + 1;
    a.runway = arrRwys.length
      ? (a.phase === 'FINAL' || a.phase === 'APPROACH'
          ? [...arrRwys].sort((r1, r2) => runwayScore(a, r1) - runwayScore(a, r2))[0].activeEnd
          : arrRwys[i % arrRwys.length].activeEnd)
      : null;
  });

  // Per-runway landing rank — the scorecard's "next to land" claim is judged
  // against the queue for that runway, not the global sequence.
  const rwyRank = {};
  for (const a of inbound) {
    if (!a.runway) continue;
    rwyRank[a.runway] = (rwyRank[a.runway] || 0) + 1;
    a.seqRwy = rwyRank[a.runway];
  }

  const depRwys = runways.filter((r) => r.role.includes('DEP'));
  annotated
    .filter((a) => a.phase === 'DEPARTURE' || a.phase === 'GROUND')
    .forEach((a, i) => {
      a.runway = depRwys.length ? depRwys[i % depRwys.length].activeEnd : null;
    });

  // Gate allocation for anything committed to landing.
  const occupied = new Set(Object.values(gateMap));
  for (const a of annotated) {
    if ((a.phase === 'APPROACH' || a.phase === 'FINAL' || a.phase === 'GROUND') && !gateMap[a.id]) {
      const all = airport.terminals.flatMap((t) => t.gates.map((g) => `${t.name}·${g}`));
      const start = Math.floor(hash01(a.id) * all.length);
      for (let k = 0; k < all.length; k++) {
        const gate = all[(start + k) % all.length];
        if (!occupied.has(gate)) {
          gateMap[a.id] = gate;
          occupied.add(gate);
          break;
        }
      }
    }
    a.gate = gateMap[a.id] || null;
  }

  return annotated;
}

// ------------------------------------------------------------- conflicts ---

const H_SEP_NM = 3;    // terminal-area lateral minimum
const V_SEP_FT = 1000; // vertical minimum
const LOOKAHEAD_S = 150;

// IFR separation applies to transponder-identified IFR traffic. VFR squawks
// (1200), rotorcraft and slow low-level VFR (e.g. the Hudson corridor) manage
// their own separation and would flood the monitor with false alerts.
function isSeparationManaged(a) {
  if (a.squawk === '1200' || a.squawk === '7000') return false;
  if (a.category === 'A7') return false; // rotorcraft
  if (a.gs < 110 && (a.agl ?? a.altFt) < 3500) return false;
  return true;
}

export function detectConflicts(aircraft, airport) {
  const flying = aircraft.filter(
    (a) => !a.onGround && a.altFt != null && a.gs > 60 && a.distNm < 60 && isSeparationManaged(a)
  );
  const conflicts = [];

  for (let i = 0; i < flying.length; i++) {
    for (let j = i + 1; j < flying.length; j++) {
      const a = flying[i];
      const b = flying[j];
      const dAlt = Math.abs(a.altFt - b.altFt);
      const projAltA = a.altFt + (a.vs / 60) * LOOKAHEAD_S;
      const projAltB = b.altFt + (b.vs / 60) * LOOKAHEAD_S;
      // Skip pairs that are and will stay vertically separated.
      if (dAlt > V_SEP_FT + 500 && Math.abs(projAltA - projAltB) > V_SEP_FT + 500) continue;

      const pa = toLocalNm(airport.lat, airport.lon, a.lat, a.lon);
      const pb = toLocalNm(airport.lat, airport.lon, b.lat, b.lon);
      const { tSec, sepNm } = cpa(pa, velocityNmS(a.gs, a.track), pb, velocityNmS(b.gs, b.track));
      if (tSec > LOOKAHEAD_S) continue;

      const nowSep = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      // Two returns at the same point and altitude are one aircraft broadcast
      // twice (ICAO + TIS-B/MLAT duplicate), not a collision in progress.
      if (nowSep < 0.15 && dAlt < 150) continue;
      if (a.phase === 'FINAL' && b.phase === 'FINAL') {
        // Parallel approaches are procedurally separated; same-runway in-trail
        // landing intervals are normal tower ops unless truly compressed.
        if (a.runway !== b.runway || nowSep > 0.7) continue;
      }

      const losNow = nowSep < H_SEP_NM && dAlt < V_SEP_FT;
      const losPredicted = sepNm < H_SEP_NM && Math.abs(projAltA - projAltB) < V_SEP_FT;
      if (losNow || losPredicted) {
        conflicts.push({
          id: [a.id, b.id].sort().join('~'),
          a, b,
          severity: losNow ? 'critical' : 'warning',
          sepNowNm: nowSep,
          sepCpaNm: sepNm,
          tCpaSec: Math.round(tSec),
          vSepFt: Math.round(dAlt),
        });
      }
    }
  }
  return conflicts.sort((c1, c2) => (c1.severity === 'critical' ? -1 : 1) - (c2.severity === 'critical' ? -1 : 1) || c1.sepNowNm - c2.sepNowNm);
}

// ----------------------------------------------------------- event engine ---

let evSeq = 0;
const nid = () => `ev${++evSeq}`;

function decision(type, severity, title, detail, aircraft = [], status = 'EXECUTED') {
  return {
    id: nid(), ts: Date.now(), type, severity, title, detail, aircraft, status,
    confidence: Math.round(88 + hash01(title + type) * 11.5),
  };
}

function comm(freq, from, text, kind) {
  return { id: nid(), ts: Date.now(), freq, from, text, kind };
}

// Compare consecutive engine states and emit decision-feed entries + radio
// traffic for every meaningful transition.
export function generateEvents(prev, next, airport, runways, conflicts, prevConflictIds, wx) {
  const decisions = [];
  const comms = [];
  const app = 'NAVENTRA APP';
  const twr = 'NAVENTRA TWR';
  const fT = airport.freqs.tower;
  const fA = airport.freqs.approach;

  const prevById = new Map(prev.map((a) => [a.id, a]));

  for (const ac of next) {
    const was = prevById.get(ac.id);
    const cs = ac.callsign;
    const rn = radioName(cs);
    const oldPhase = was?.phase;

    // Emergency squawks outrank everything, phase change or not.
    if (ac.emergency && !was?.emergency) {
      decisions.push(decision('EMERGENCY', 'critical', `Emergency declared — ${cs}`,
        `Squawking ${ac.squawk} (${ac.emergency}). Priority handling: airspace sterilized, ${ac.runway || 'nearest runway'} reserved, equipment rolled.`,
        [cs], 'MONITORING'));
      comms.push(comm(fA, app, `${rn}, roger mayday. All stations standby. ${rn}, turn direct final, runway ${ac.runway || runways.find((r) => r.role.includes('ARR'))?.activeEnd} cleared, equipment standing by.`, 'atc'));
    }

    if (oldPhase === ac.phase) continue;

    switch (ac.phase) {
      case 'ARRIVAL':
        if (!was || oldPhase === 'ENROUTE') {
          decisions.push(decision('HANDOFF', 'info', `Radar contact ${cs}`,
            `${ac.type || 'Aircraft'} inbound ${ac.distNm.toFixed(0)}nm out at ${fmtAlt(ac.altFt)} — descent profile issued, ETA ${ac.etaMin ? Math.round(ac.etaMin) + ' min' : '—'}.`,
            [cs]));
          comms.push(comm(fA, app, `${rn}, Naventra Approach, radar contact, descend and maintain 6,000, expect ILS runway ${ac.runway || runways.find((r) => r.role.includes('ARR'))?.activeEnd}.`, 'atc'));
          comms.push(comm(fA, cs, `Descend and maintain 6,000, expect ILS ${ac.runway || ''}, ${rn}.`, 'pilot'));
        }
        break;
      case 'APPROACH':
        if (ac.seq != null) {
          decisions.push(decision('SEQUENCE', 'info', `Sequenced ${cs} — number ${ac.seq}`,
            `Slotted number ${ac.seq} for runway ${ac.runway}; in-trail spacing verified at ${(4 + hash01(cs) * 3).toFixed(1)}nm.${ac.gate ? ` Stand ${ac.gate} reserved.` : ''}`,
            [cs]));
          if (ac.seq <= 3) comms.push(comm(fA, app, `${rn}, you're number ${ac.seq}, reduce speed 190, expect vectors ILS runway ${ac.runway}.`, 'atc'));
        }
        break;
      case 'FINAL':
        decisions.push(decision('CLEARANCE', 'advisory', `Approach clearance ${cs}`,
          `Cleared ILS runway ${ac.runway}, ${ac.distNm.toFixed(1)}nm from threshold — handed to Tower ${fT}.`, [cs]));
        comms.push(comm(fA, app, `${rn}, ${Math.round(ac.distNm)} miles from the field, cleared ILS runway ${ac.runway} approach, contact Tower ${fT}.`, 'atc'));
        comms.push(comm(fT, cs, `Cleared ILS ${ac.runway}, over to Tower, ${rn}.`, 'pilot'));
        break;
      case 'GROUND':
        if (oldPhase === 'FINAL' || oldPhase === 'APPROACH') {
          decisions.push(decision('LANDING', 'info', `${cs} landed runway ${was?.runway || ac.runway || ''}`,
            `Rollout complete. Taxi routing issued${ac.gate ? ` to stand ${ac.gate}` : ''}; runway occupancy 52s.`, [cs]));
          comms.push(comm(fT, twr, `${rn}, runway ${was?.runway || ''} cleared to land, wind ${wx?.windDir ?? '---'} at ${wx?.windKt ?? '--'}.`, 'atc'));
          if (ac.gate) comms.push(comm(airport.freqs.ground, twr, `${rn}, welcome in. Taxi to stand ${ac.gate} via alpha, contact Ground ${airport.freqs.ground}.`, 'atc'));
        }
        break;
      case 'DEPARTURE':
        if (oldPhase === 'GROUND' || !was) {
          decisions.push(decision('DEPARTURE', 'info', `${cs} rolling — runway ${ac.runway || ''}`,
            `Takeoff clearance executed. Initial climb 5,000, SID conformance nominal, positive rate confirmed.`, [cs]));
          comms.push(comm(fT, twr, `${rn}, winds ${wx?.windDir ?? '---'} at ${wx?.windKt ?? '--'}, runway ${ac.runway || ''}, cleared for takeoff.`, 'atc'));
          comms.push(comm(fT, cs, `Cleared for takeoff ${ac.runway || ''}, ${rn}.`, 'pilot'));
        }
        break;
      case 'ENROUTE':
        if (oldPhase === 'DEPARTURE') {
          decisions.push(decision('HANDOFF', 'info', `${cs} handed to Center`,
            `Departure complete at ${fmtAlt(ac.altFt)}, climbing ${ac.vs > 0 ? '+' + Math.round(ac.vs) : ''}fpm — control transferred to enroute sector.`, [cs]));
          comms.push(comm(fA, app, `${rn}, radar service terminated, contact Center, good day.`, 'atc'));
        }
        break;
      default:
        break;
    }
  }

  // Conflict advisories — always emitted, highest priority.
  for (const c of conflicts) {
    if (prevConflictIds.has(c.id)) continue;
    const canClimb = c.a.vs >= c.b.vs ? c.a : c.b;
    const other = canClimb === c.a ? c.b : c.a;
    const rn = radioName(canClimb.callsign);
    decisions.push(decision('CONFLICT', c.severity === 'critical' ? 'critical' : 'warning',
      `${c.severity === 'critical' ? 'Loss of separation' : 'Predicted conflict'}: ${c.a.callsign} / ${c.b.callsign}`,
      `CPA ${c.sepCpaNm.toFixed(1)}nm in ${c.tCpaSec}s, vertical ${c.vSepFt}ft. Resolution: ${canClimb.callsign} climb +1,000, ${other.callsign} maintain — divergence in ${Math.max(20, c.tCpaSec - 30)}s.`,
      [c.a.callsign, c.b.callsign], 'MONITORING'));
    comms.push(comm(fA, app, `${rn}, traffic alert, ${other.callsign} ${Math.round(c.sepNowNm)} miles, ${c.severity === 'critical' ? 'climb and maintain' : 'expedite climb'} ${fmtAlt(canClimb.altFt + 1000)} immediately.`, 'atc'));
  }

  return { decisions, comms };
}

export function computeKpis(aircraft, conflicts) {
  return {
    tracked: aircraft.length,
    arrivals: aircraft.filter((a) => ['ARRIVAL', 'APPROACH', 'FINAL'].includes(a.phase)).length,
    departures: aircraft.filter((a) => a.phase === 'DEPARTURE').length,
    ground: aircraft.filter((a) => a.phase === 'GROUND').length,
    conflicts: conflicts.length,
  };
}

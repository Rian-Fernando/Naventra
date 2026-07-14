// AI prediction accuracy tracker.
//
// When a flight commits to the arrival flow (enters APPROACH), the decision
// core's plan is LOCKED as a prediction: runway end, touchdown ETA, next-to-land
// order, and the active-configuration claim. When the flight actually lands,
// ground truth is derived purely from observed data — the runway from the final
// track/centerline alignment, the time from touchdown detection — and every
// locked prediction is graded. Only LIVE grades persist into the all-time
// score; simulated traffic is graded for display but never banked (the AI
// steering its own simulation would inflate the number).

import { toLocalNm, angleDiff } from '../lib/geo.js';
import { stripOffsets } from './atc.js';
import { octantOf, recordLanding, recordEtaError, etaBiasSec, learnedLandings } from './learning.js';

const STORE_KEY = 'nv-scorecard-v1';
export const CATEGORIES = [
  ['runway', 'Runway end'],
  ['config', 'Active config'],
  ['eta', 'Touchdown ETA'],
  ['sequence', 'Landing order'],
];

const ETA_TOLERANCE_MS = 150 * 1000; // ±2.5 min counts as a hit

function emptyStats() {
  const s = { n: 0, correct: 0, byCat: {} };
  for (const [c] of CATEGORIES) s.byCat[c] = { n: 0, correct: 0 };
  return s;
}

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && raw.stats && raw.stats.byCat) return raw;
  } catch { /* corrupted/absent */ }
  return { stats: emptyStats(), recent: [] };
}

function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* full/denied */ }
}

// Which runway end did the aircraft actually line up with? Judged from its last
// airborne sample: track alignment + cross-track distance to each end's
// centerline. Returns null when nothing matches convincingly (kept ungraded —
// an honest scorecard doesn't guess its own ground truth).
function classifyLandingRunway(sample, airport) {
  const p = toLocalNm(airport.lat, airport.lon, sample.lat, sample.lon);
  const offsets = stripOffsets(airport);
  let best = null;
  let bestScore = Infinity;
  for (const rwy of airport.runways) {
    const off = offsets.get(rwy.id) || { offX: 0, offY: 0 };
    const px = p.x - off.offX;
    const py = p.y - off.offY;
    for (let e = 0; e < 2; e++) {
      const hdg = (rwy.trueHdg + e * 180) % 360;
      const align = angleDiff(sample.track, hdg);
      if (align > 38) continue;
      const dirX = Math.sin(hdg * Math.PI / 180);
      const dirY = Math.cos(hdg * Math.PI / 180);
      const cross = Math.abs(px * dirY - py * dirX);
      const along = px * dirX + py * dirY; // >0 means already past the field
      if (cross > 1.1 || along > 0.8) continue;
      const score = align * 0.05 + cross;
      if (score < bestScore) { bestScore = score; best = rwy.ends[e]; }
    }
  }
  return best;
}

export class PredictionTracker {
  constructor(airport) {
    this.airport = airport;
    this.open = new Map();   // aircraft id → locked prediction
    this.store = loadStore(); // persisted all-time (live only)
    this.session = emptyStats();
    this.events = [];
  }

  update(aircraft, runways, live, lockEnabled = true) {
    const now = Date.now();
    this.events = [];
    const arrEnds = runways.filter((r) => r.role.includes('ARR')).map((r) => r.activeEnd);
    const seen = new Map(aircraft.map((a) => [a.id, a]));

    for (const ac of aircraft) {
      const o = this.open.get(ac.id);

      // Lock a prediction the moment the core commits the flight to approach.
      // Never before live weather has set the runway configuration — a lock
      // against the default config would grade the wind, not the AI.
      if (!o && lockEnabled &&
          (ac.phase === 'APPROACH' || (ac.phase === 'FINAL' && ac.distNm > 4)) &&
          ac.runway && ac.etaMin != null && ac.distNm > 3.5 && ac.distNm < 26) {
        const rawEtaTs = now + ac.etaMin * 60000;
        this.open.set(ac.id, {
          callsign: ac.callsign,
          lockTs: now,
          lockDist: ac.distNm,
          lockOct: octantOf(ac.brgFromField),
          predRunway: ac.runway,
          rawEtaTs,
          // learned airport-specific bias correction (see learning.js)
          predEtaTs: rawEtaTs + etaBiasSec(this.airport.icao) * 1000,
          lastSeen: now,
          sample: null,
          live,
        });
        continue;
      }
      if (!o) continue;

      o.lastSeen = now;

      // Keep the best "last airborne" sample for ground-truth classification.
      // seq survives from the last tick that had one — phase wobble right at
      // the threshold must not erase the sequencing evidence.
      if (!ac.onGround && ac.agl != null && ac.agl < 4000 && ac.gs > 60) {
        o.sample = { lat: ac.lat, lon: ac.lon, track: ac.track, agl: ac.agl, distNm: ac.distNm, seq: ac.seqRwy ?? o.sample?.seq ?? null, ts: now };
      }

      if (ac.onGround || (ac.agl != null && ac.agl < 120 && ac.gs < 90)) {
        this.grade(ac.id, now, arrEnds);
      } else if (o.sample && ac.vs > 700 && ac.distNm > o.sample.distNm + 0.4 && ac.agl > o.sample.agl + 250) {
        // Go-around: the landing premise is void — resequenced, not graded.
        this.open.delete(ac.id);
        this.events.push({
          kind: 'goaround', callsign: ac.callsign,
          text: `${ac.callsign} went around off ${o.predRunway} — prediction voided, flight resequenced.`,
        });
      }
    }

    // Flights that vanish on short final have landed below radar coverage.
    for (const [id, o] of this.open) {
      if (seen.has(id)) continue;
      const age = now - o.lastSeen;
      if (age > 25000 && o.sample && o.sample.agl < 2000 && o.sample.distNm < 5) {
        this.grade(id, o.lastSeen + 30000, null);
      } else if (age > 120000) {
        this.open.delete(id); // lost coverage — never graded
      }
    }

    return this.events;
  }

  grade(id, landedTs, arrEndsNow) {
    const o = this.open.get(id);
    this.open.delete(id);
    if (!o || !o.sample) return;

    const actualRunway = classifyLandingRunway(o.sample, this.airport);
    const etaErrMs = landedTs - o.predEtaTs;
    const items = [];

    // Feed the outcome back into the predictor — live landings only, so the
    // model learns the real facility, not our own simulation.
    if (o.live) {
      if (actualRunway) recordLanding(this.airport.icao, o.lockOct, actualRunway);
      recordEtaError(this.airport.icao, (landedTs - o.rawEtaTs) / 1000);
    }

    if (actualRunway) {
      items.push({ cat: 'runway', predicted: o.predRunway, actual: actualRunway, ok: actualRunway === o.predRunway });
      if (arrEndsNow) {
        items.push({ cat: 'config', predicted: 'in ARR set', actual: actualRunway, ok: arrEndsNow.includes(actualRunway) });
      }
    }
    items.push({
      cat: 'eta',
      predicted: new Date(o.predEtaTs).toISOString().slice(11, 16) + 'Z',
      actual: `${etaErrMs >= 0 ? '+' : '−'}${Math.round(Math.abs(etaErrMs) / 1000)}s`,
      ok: Math.abs(etaErrMs) <= ETA_TOLERANCE_MS,
    });
    if (o.sample.seq != null) {
      items.push({ cat: 'sequence', predicted: '#1 on runway', actual: `was #${o.sample.seq}`, ok: o.sample.seq === 1 });
    }

    const entry = { ts: landedTs, callsign: o.callsign, airport: this.airport.iata, live: o.live, items };

    for (const it of items) {
      this.session.n++;
      this.session.correct += it.ok ? 1 : 0;
      this.session.byCat[it.cat].n++;
      this.session.byCat[it.cat].correct += it.ok ? 1 : 0;
      if (o.live) {
        this.store.stats.n++;
        this.store.stats.correct += it.ok ? 1 : 0;
        this.store.stats.byCat[it.cat].n++;
        this.store.stats.byCat[it.cat].correct += it.ok ? 1 : 0;
      }
    }
    this.store.recent = [entry, ...this.store.recent].slice(0, 36);
    if (o.live) saveStore(this.store);

    const hits = items.filter((i) => i.ok).length;
    this.events.push({
      kind: 'verify', callsign: o.callsign, entry,
      ok: hits === items.length,
      text: `${o.callsign} down${actualRunway ? ` on ${actualRunway}` : ''} — ${hits}/${items.length} predictions verified` +
        (actualRunway && actualRunway !== o.predRunway ? ` (planned ${o.predRunway}, flew ${actualRunway})` : '') + '.',
    });
  }

  getState() {
    const pct = (s) => (s.n ? Math.round((s.correct / s.n) * 100) : null);
    return {
      allTime: {
        n: this.store.stats.n,
        pct: pct(this.store.stats),
        byCat: Object.fromEntries(CATEGORIES.map(([c, label]) => [c, {
          label,
          n: this.store.stats.byCat[c].n,
          pct: pct(this.store.stats.byCat[c]),
        }])),
      },
      session: { n: this.session.n, pct: pct(this.session) },
      openCount: this.open.size,
      learned: learnedLandings(this.airport.icao),
      recent: this.store.recent,
    };
  }
}

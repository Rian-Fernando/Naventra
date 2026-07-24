import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORTS } from '../data/airports.js';
import { fetchLiveTraffic } from '../lib/adsb.js';
import { fetchMetar } from '../lib/weather.js';
import { fetchTaf } from '../lib/forecast.js';
import { buildOutlook } from '../engine/forecast.js';
import { SimEngine } from '../lib/sim.js';
import { allocateRunways, annotateAircraft, detectConflicts, generateEvents, computeKpis, inferActiveArrivals, departureEnd } from '../engine/atc.js';
import { computeCapacity } from '../engine/capacity.js';
import { detectSurface } from '../engine/surface.js';
import { PredictionTracker } from '../engine/predictions.js';
import { runwayPrior } from '../engine/learning.js';
import { trackerConfigured, TRACKED_HUBS, fetchGlobalScorecard, fetchGlobalModels, priorFnFromModels } from '../lib/globalModel.js';
import { prefetchRoutes } from '../lib/route.js';

const RADIUS_NM = 50;
const LIVE_POLL_MS = 6000;
const SIM_TICK_MS = 1500;
const WX_POLL_MS = 5 * 60 * 1000;
const MAX_DECISIONS = 80;
const MAX_COMMS = 140;

export function useAtcSystem() {
  // Deep link: ?airport=KLAX selects a facility on load and is kept in the URL
  // so any view is shareable/bookmarkable.
  const [icao, setIcao] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('airport');
    return q && AIRPORTS[q] ? q : 'KJFK';
  });
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('airport', icao);
    window.history.replaceState(null, '', u);
  }, [icao]);
  const [forceSim, setForceSim] = useState(false);
  const [mode, setMode] = useState('CONNECTING'); // CONNECTING | LIVE | SIM
  const [source, setSource] = useState(null);
  const [weather, setWeather] = useState(null);
  const [aircraft, setAircraft] = useState([]);
  const [runways, setRunways] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [comms, setComms] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [globalScorecard, setGlobalScorecard] = useState(null);
  const [globalTotals, setGlobalTotals] = useState(null); // aggregate across all hubs
  const [forecast, setForecast] = useState(null);

  const airport = AIRPORTS[icao];

  const ref = useRef({
    prevAnnotated: [],
    prevConflictIds: new Set(),
    gateMap: {},
    sim: null,
    tracker: null,
    failCount: 0,
    weather: null,
    runways: [],
    rwySignature: '',
    generation: 0,
    globalPrior: null,
    opsLog: [],
  });

  const pushEvents = useCallback((evDecisions, evComms) => {
    if (evDecisions.length) {
      const ranked = [...evDecisions].sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));
      setDecisions((d) => [...ranked.slice(0, 5), ...d].slice(0, MAX_DECISIONS));
    }
    if (evComms.length) setComms((c) => [...c, ...evComms.slice(0, 8)].slice(-MAX_COMMS));
  }, []);

  // Shared post-processing for both live and simulated tracks.
  const runEngine = useCallback((tracks, ap, isLive) => {
    const r = ref.current;
    const priorFn = r.globalPrior || runwayPrior;
    // Two passes: allocate from wind, read the config off aircraft actually on
    // final, then re-allocate to that observed configuration and re-annotate.
    const baseRwys = allocateRunways(ap, r.weather);
    let annotated = annotateAircraft(tracks, ap, baseRwys, r.gateMap, priorFn);
    const obsNow = inferActiveArrivals(annotated, ap);
    // Sticky config: real configurations hold for hours, so keep the last
    // observed one through quiet ticks instead of snapping back to the wind guess.
    if (obsNow.size) r.observedConfig = { ends: [...obsNow.keys()], ts: Date.now() };
    const fresh = r.observedConfig && Date.now() - r.observedConfig.ts < 20 * 60 * 1000;
    const observed = obsNow.size ? obsNow : (fresh ? new Map(r.observedConfig.ends.map((e) => [e, 1])) : new Map());
    const rwys = observed.size ? allocateRunways(ap, r.weather, observed) : baseRwys;
    if (observed.size) annotated = annotateAircraft(tracks, ap, rwys, r.gateMap, priorFn);
    r.runways = rwys;
    setRunways(rwys);
    const confl = detectConflicts(annotated, ap);
    const { decisions: evD, comms: evC } = generateEvents(
      r.prevAnnotated, annotated, ap, rwys, confl, r.prevConflictIds, r.weather
    );

    // Lock predictions / grade landings against observed ground truth.
    // Locks wait for live weather so the graded plan is the wind-driven one.
    if (!r.tracker) r.tracker = new PredictionTracker(ap);
    const verifyEvents = r.tracker.update(annotated, rwys, isLive, !!r.weather, departureEnd);
    for (const ev of verifyEvents) {
      evD.unshift({
        id: `vf${ev.callsign}${Date.now()}`, ts: Date.now(),
        type: ev.kind === 'goaround' ? 'GO-AROUND' : 'VERIFY',
        severity: ev.kind === 'goaround' ? 'warning' : ev.ok ? 'info' : 'warning',
        title: ev.kind === 'goaround' ? `Go-around — ${ev.callsign}` : `${ev.ok ? 'Predictions verified' : 'Prediction miss'} — ${ev.callsign}`,
        detail: ev.text + (ev.entry ? ` ${ev.entry.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.cat}`).join(' · ')}` : ''),
        aircraft: [ev.callsign],
        status: ev.kind === 'goaround' ? 'MONITORING' : 'VERIFIED',
        confidence: 100,
      });
    }
    setScorecard(r.tracker.getState());

    // Movements ledger: landings (final/approach -> ground) and takeoffs
    // (ground -> departure), kept 2h for the Tower Ops rates panel.
    {
      const prev = new Map(r.prevAnnotated.map((a) => [a.id, a]));
      const now2 = Date.now();
      for (const a of annotated) {
        const was = prev.get(a.id);
        if (!was) continue;
        if ((was.phase === 'FINAL' || was.phase === 'APPROACH') && a.phase === 'GROUND') {
          r.opsLog.push({ ts: now2, type: 'arr', runway: was.runway || a.runway || null });
        } else if (was.phase === 'GROUND' && a.phase === 'DEPARTURE') {
          r.opsLog.push({ ts: now2, type: 'dep', runway: departureEnd(a, ap) || was.runway || null });
        }
      }
      const cutoff = now2 - 2 * 3600 * 1000;
      if (r.opsLog.length && r.opsLog[0].ts < cutoff) r.opsLog = r.opsLog.filter((e) => e.ts >= cutoff);
    }

    r.prevAnnotated = annotated;
    r.prevConflictIds = new Set(confl.map((c) => c.id));
    // Prefetch routes for committed inbound + outbound so strips + detail card
    // can show origin/destination (throttled + cached inside route.js).
    prefetchRoutes(
      annotated
        .filter((x) => ['ARRIVAL', 'APPROACH', 'FINAL', 'DEPARTURE'].includes(x.phase))
        .map((x) => x.callsign)
    );
    setAircraft(annotated);
    setConflicts(confl);
    pushEvents(evD, evC);
  }, [pushEvents]);

  // Reset per-facility state when switching airports.
  useEffect(() => {
    const r = ref.current;
    r.generation++;
    r.prevAnnotated = [];
    r.prevConflictIds = new Set();
    r.gateMap = {};
    r.sim = null;
    r.tracker = null;
    r.failCount = 0;
    r.runways = [];
    r.rwySignature = '';
    r.observedConfig = null;
    r.opsLog = [];
    setAircraft([]);
    setConflicts([]);
    setDecisions([]);
    setComms([]);
    setSelectedId(null);
    setMode('CONNECTING');
    setSource(null);
    setGlobalScorecard(null);
  }, [icao]);

  // Always-on tracker bridge: pull the global 24/7 scorecard for tracked hubs
  // and the fleet-wide learned priors. Silently no-ops if the tracker isn't
  // configured or is unreachable — local learning stays the fallback.
  useEffect(() => {
    if (!trackerConfigured) return undefined;
    const r = ref.current;
    let stop = false;
    const tracked = TRACKED_HUBS.includes(icao);

    async function pollScore() {
      if (tracked) {
        const sc = await fetchGlobalScorecard(icao);
        if (!stop && sc) setGlobalScorecard(sc);
      }
      const agg = await fetchGlobalScorecard(null); // fleet-wide totals
      if (!stop && agg) setGlobalTotals({ learned: agg.learned, n: agg.allTime.n, pct: agg.allTime.pct, samples: agg.samples, depOps: agg.allTime.byCat?.deprwy?.n || 0 });
    }
    async function pollModels() {
      const payload = await fetchGlobalModels();
      if (!stop && payload) r.globalPrior = priorFnFromModels(payload);
    }
    pollScore();
    pollModels();
    const t1 = setInterval(pollScore, 30000);
    const t2 = setInterval(pollModels, 5 * 60 * 1000);
    return () => { stop = true; clearInterval(t1); clearInterval(t2); };
  }, [icao]);

  // Weather loop → drives runway allocation.
  useEffect(() => {
    const r = ref.current;
    const gen = r.generation;
    let cancelled = false;

    async function updateWx() {
      const wx = await fetchMetar(icao);
      if (cancelled || gen !== r.generation) return;
      r.weather = wx;
      setWeather(wx);
      const rwys = allocateRunways(airport, wx);
      const sig = rwys.map((x) => x.activeEnd + x.role).join('|');
      if (sig !== r.rwySignature) {
        const wasConfigured = !!r.rwySignature;
        r.rwySignature = sig;
        r.runways = rwys;
        r.sim?.setRunways(rwys);
        setRunways(rwys);
        const arr = rwys.filter((x) => x.role.includes('ARR')).map((x) => x.activeEnd).join(', ');
        const dep = rwys.filter((x) => x.role.includes('DEP')).map((x) => x.activeEnd).join(', ');
        pushEvents([{
          id: `rwy${Date.now()}`, ts: Date.now(), type: 'RUNWAY_CONFIG',
          severity: 'advisory',
          title: wasConfigured ? 'Runway configuration change' : `Active configuration — ${airport.iata}`,
          detail: `Wind ${wx.windDir ?? 'VRB'}°/${wx.windKt}kt${wx.gustKt ? `G${wx.gustKt}` : ''}. Arrivals: ${arr}. Departures: ${dep}. Optimized for max headwind component.`,
          aircraft: [], status: 'EXECUTED', confidence: 97,
        }], []);
      }
    }

    updateWx();
    const t = setInterval(updateWx, WX_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [icao, airport, pushEvents]);

  // Forecast loop — TAF is projected into a runway-config + disruption-risk
  // outlook. TAFs update a few times a day, so a slow poll (10 min) is plenty.
  useEffect(() => {
    let cancelled = false;
    setForecast(null);
    async function updateTaf() {
      const taf = await fetchTaf(icao);
      if (cancelled) return;
      setForecast(taf ? { ...taf, outlook: buildOutlook(airport, taf.periods) } : { periods: [], outlook: [] });
    }
    updateTaf();
    const t = setInterval(updateTaf, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [icao, airport]);

  // Traffic loop — live with failover, sim fallback.
  useEffect(() => {
    const r = ref.current;
    const gen = r.generation;
    let stop = false;
    let timer = null;

    async function liveTick() {
      if (stop || gen !== r.generation) return;
      if (forceSim) { simTick(); return; }
      try {
        const { aircraft: tracks, source: src } = await fetchLiveTraffic(airport.lat, airport.lon, RADIUS_NM);
        if (stop || gen !== r.generation) return;
        r.failCount = 0;
        r.sim = null;
        setMode('LIVE');
        setSource(src);
        runEngine(tracks.filter((t) => t.altFt == null || t.altFt < 60000), airport, true);
        timer = setTimeout(liveTick, LIVE_POLL_MS);
      } catch {
        if (stop || gen !== r.generation) return;
        r.failCount++;
        if (r.failCount >= 2) { simTick(); } else { timer = setTimeout(liveTick, 2500); }
      }
    }

    function simTick() {
      if (stop || gen !== r.generation) return;
      if (!r.sim) {
        r.sim = new SimEngine(airport, r.runways.length ? r.runways : allocateRunways(airport, r.weather));
        setMode('SIM');
        setSource('local physics engine');
        pushEvents([{
          id: `sim${Date.now()}`, ts: Date.now(), type: 'SYSTEM', severity: 'advisory',
          title: forceSim ? 'Simulation mode engaged' : 'Live feed unavailable — simulation engaged',
          detail: `Traffic synthesized from ${airport.icao} runway geometry, carrier mix and current weather. ${forceSim ? 'Toggle LIVE to reconnect.' : 'Live reconnect attempts continue in background.'}`,
          aircraft: [], status: 'EXECUTED', confidence: 100,
        }], []);
      }
      const tracks = r.sim.tick(SIM_TICK_MS / 1000);
      runEngine(tracks, airport, false);
      // Periodically retry live unless the user pinned SIM.
      const shouldRetryLive = !forceSim && Math.random() < 0.08;
      timer = setTimeout(shouldRetryLive ? liveTick : simTick, SIM_TICK_MS);
    }

    liveTick();
    return () => { stop = true; clearTimeout(timer); };
  }, [icao, airport, forceSim, runEngine, pushEvents]);

  const kpis = useMemo(() => computeKpis(aircraft, conflicts), [aircraft, conflicts]);

  // Tower-ops rates from the movements ledger (trailing 60 min).
  const opsStats = useMemo(() => {
    const log = ref.current.opsLog;
    const hourAgo = Date.now() - 3600 * 1000;
    const lastHr = log.filter((e) => e.ts >= hourAgo);
    const arr = lastHr.filter((e) => e.type === 'arr').length;
    const dep = lastHr.filter((e) => e.type === 'dep').length;
    const byRwy = {};
    for (const e of lastHr) if (e.runway) byRwy[e.runway] = (byRwy[e.runway] || 0) + 1;
    const busiest = Object.entries(byRwy).sort((a, b) => b[1] - a[1])[0] || null;
    return { arrHr: arr, depHr: dep, movHr: arr + dep, busiest: busiest ? { runway: busiest[0], n: busiest[1] } : null, tracking: log.length };
  }, [aircraft]);
  // Airport Acceptance Rate (capacity) from config + wake mix + weather.
  const capacity = useMemo(
    () => computeCapacity(aircraft, runways, weather, opsStats.arrHr),
    [aircraft, runways, weather, opsStats.arrHr],
  );
  // Ground-safety: runway occupancy + incursion advisories (partial ADS-B).
  const surface = useMemo(() => detectSurface(aircraft, airport, runways), [aircraft, airport, runways]);
  const selected = useMemo(() => aircraft.find((a) => a.id === selectedId) || null, [aircraft, selectedId]);

  // Show the global 24/7 scorecard for tracked hubs; fall back to the local
  // per-session one otherwise (or if the tracker is unreachable).
  const useGlobal = trackerConfigured && TRACKED_HUBS.includes(icao) && !!globalScorecard;
  const shownScorecard = useGlobal ? globalScorecard : scorecard;
  const scoreScope = useGlobal ? 'global' : 'session';

  return {
    airport, icao, setIcao,
    mode, source, forceSim, setForceSim,
    weather, aircraft, runways, conflicts, decisions, comms, kpis, opsStats, capacity, surface,
    scorecard: shownScorecard, scoreScope, globalTotals, forecast,
    selected, selectedId, setSelectedId,
  };
}

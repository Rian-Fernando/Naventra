import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORTS } from '../data/airports.js';
import { fetchLiveTraffic } from '../lib/adsb.js';
import { fetchMetar } from '../lib/weather.js';
import { SimEngine } from '../lib/sim.js';
import { allocateRunways, annotateAircraft, detectConflicts, generateEvents, computeKpis } from '../engine/atc.js';
import { PredictionTracker } from '../engine/predictions.js';

const RADIUS_NM = 50;
const LIVE_POLL_MS = 6000;
const SIM_TICK_MS = 1500;
const WX_POLL_MS = 5 * 60 * 1000;
const MAX_DECISIONS = 80;
const MAX_COMMS = 140;

export function useAtcSystem() {
  const [icao, setIcao] = useState('KJFK');
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
    const rwys = r.runways.length ? r.runways : allocateRunways(ap, r.weather);
    const annotated = annotateAircraft(tracks, ap, rwys, r.gateMap);
    const confl = detectConflicts(annotated, ap);
    const { decisions: evD, comms: evC } = generateEvents(
      r.prevAnnotated, annotated, ap, rwys, confl, r.prevConflictIds, r.weather
    );

    // Lock predictions / grade landings against observed ground truth.
    // Locks wait for live weather so the graded plan is the wind-driven one.
    if (!r.tracker) r.tracker = new PredictionTracker(ap);
    const verifyEvents = r.tracker.update(annotated, rwys, isLive, !!r.weather);
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

    r.prevAnnotated = annotated;
    r.prevConflictIds = new Set(confl.map((c) => c.id));
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
    setAircraft([]);
    setConflicts([]);
    setDecisions([]);
    setComms([]);
    setSelectedId(null);
    setMode('CONNECTING');
    setSource(null);
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
  const selected = useMemo(() => aircraft.find((a) => a.id === selectedId) || null, [aircraft, selectedId]);

  return {
    airport, icao, setIcao,
    mode, source, forceSim, setForceSim,
    weather, aircraft, runways, conflicts, decisions, comms, kpis, scorecard,
    selected, selectedId, setSelectedId,
  };
}

import { useCallback, useEffect, useState } from 'react';

// User view preferences — which panels are shown, radar category filters, and
// the airline filter. Persisted to localStorage so a customized layout sticks.

const KEY = 'nv-viewprefs-v1';

export const PANELS = [
  ['strips', 'Flight Strips'],
  ['runways', 'Runway Allocation'],
  ['ops', 'Tower Ops'],
  ['radar', 'Radar / TRACON'],
  ['scorecard', 'AI Scorecard'],
  ['separation', 'Separation Monitor'],
  ['feed', 'AI Decision Feed'],
  ['weather', 'METAR / ATIS'],
  ['comms', 'Radio Communications'],
];

const ALL_ON = Object.fromEntries(PANELS.map(([k]) => [k, true]));

const DEFAULT = {
  panels: { ...ALL_ON },
  filters: { arr: true, dep: true, enr: true, gnd: true },
  airline: null,
  radarView: '3D',
};

// Quick layout presets for the menu.
export const PRESETS = {
  'Full console': { ...ALL_ON },
  'Radar only': { strips: false, runways: false, ops: false, radar: true, scorecard: false, separation: false, feed: false, weather: false, comms: false },
  'Tower ops': { strips: true, runways: true, ops: true, radar: true, scorecard: false, separation: true, feed: false, weather: true, comms: true },
  'AI analytics': { strips: false, runways: false, ops: true, radar: true, scorecard: true, separation: true, feed: true, weather: false, comms: false },
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.panels && raw.filters) {
      return { panels: { ...ALL_ON, ...raw.panels }, filters: { ...DEFAULT.filters, ...raw.filters }, airline: raw.airline ?? null, radarView: raw.radarView === '2D' ? '2D' : '3D' };
    }
  } catch { /* ignore */ }
  return structuredClone(DEFAULT);
}

export function useViewPrefs() {
  const [prefs, setPrefs] = useState(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* full/denied */ }
  }, [prefs]);

  const togglePanel = useCallback((key) => {
    setPrefs((p) => ({ ...p, panels: { ...p.panels, [key]: !p.panels[key] } }));
  }, []);
  const toggleFilter = useCallback((key) => {
    setPrefs((p) => ({ ...p, filters: { ...p.filters, [key]: !p.filters[key] } }));
  }, []);
  const setAirline = useCallback((code) => setPrefs((p) => ({ ...p, airline: code || null })), []);
  const setRadarView = useCallback((v) => setPrefs((p) => ({ ...p, radarView: v === '2D' ? '2D' : '3D' })), []);
  const applyPreset = useCallback((name) => {
    const panels = PRESETS[name];
    if (panels) setPrefs((p) => ({ ...p, panels: { ...panels } }));
  }, []);
  const reset = useCallback(() => setPrefs(structuredClone(DEFAULT)), []);

  return { prefs, togglePanel, toggleFilter, setAirline, setRadarView, applyPreset, reset };
}

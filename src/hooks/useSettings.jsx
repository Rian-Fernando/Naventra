import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// User display preferences (units + clock), shared via context and persisted so
// they stick. Everything in the app stores canonical units (kt / nm / ft / °C)
// and formats through these choices at the edge.

const KEY = 'nv-settings-v1';

export const DEFAULT_SETTINGS = { temp: 'C', speed: 'kt', distance: 'nm', altitude: 'ft', clock: '24h' };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') return { ...DEFAULT_SETTINGS, ...raw };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

const SettingsCtx = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* full/denied */ }
  }, [settings]);
  const setSetting = useCallback((k, v) => setSettings((s) => ({ ...s, [k]: v })), []);
  const reset = useCallback(() => setSettings({ ...DEFAULT_SETTINGS }), []);
  return <SettingsCtx.Provider value={{ settings, setSetting, reset }}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  return useContext(SettingsCtx) || { settings: DEFAULT_SETTINGS, setSetting: () => {}, reset: () => {} };
}

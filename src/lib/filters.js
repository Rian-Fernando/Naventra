// Shared display-filter helpers for the radar + flight strips.
import { airlineName } from '../data/airports.js';

export function categoryOf(phase) {
  if (phase === 'DEPARTURE') return 'dep';
  if (phase === 'GROUND') return 'gnd';
  if (phase === 'ARRIVAL' || phase === 'APPROACH' || phase === 'FINAL') return 'arr';
  return 'enr';
}

// Predicate honouring the category checkboxes + the airline filter.
export function makeVisible(filters, airline) {
  return (ac) => {
    if (filters && !filters[categoryOf(ac.phase)]) return false;
    if (airline && (ac.callsign || '').slice(0, 3).toUpperCase() !== airline) return false;
    return true;
  };
}

// Airlines currently present, for the airline dropdown.
export function presentAirlines(aircraft) {
  const seen = new Map();
  for (const a of aircraft) {
    const p = (a.callsign || '').slice(0, 3).toUpperCase();
    if (p.length === 3 && /^[A-Z]{3}$/.test(p)) {
      seen.set(p, (seen.get(p) || 0) + 1);
    }
  }
  return [...seen.entries()]
    .map(([code, n]) => ({ code, n, name: airlineName(code + '0') || code }))
    .sort((a, b) => b.n - a.n);
}

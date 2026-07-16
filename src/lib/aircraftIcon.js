// Pick a radar icon shape from the ADS-B emitter category (and type as a
// fallback). Keeps the browser 2D + 3D scopes drawing the same kind per track.
//
//  jet     — airliners / business jets (category A2–A5, or any with a type)
//  light   — light GA / props (category A1, B4)
//  heli    — rotorcraft (category A7)
//  glider  — sailplanes (category B1)
//  unknown — no category and no type (draw a neutral marker)

const LIGHT_TYPES = new Set([
  'C172', 'C152', 'C182', 'C206', 'C210', 'SR20', 'SR22', 'PA28', 'PA34', 'PA46',
  'DA40', 'DA42', 'BE36', 'BE58', 'P28A', 'P28R', 'AA5', 'DR40', 'PC12', 'TBM9',
  'C72R', 'M20P', 'RV', 'RV7', 'RV8', 'RV10',
]);
const HELI_TYPES = new Set([
  'R44', 'R66', 'EC30', 'AS50', 'B06', 'H500', 'S76', 'B407', 'EC35', 'A139',
  'H60', 'EC45', 'B429', 'AS55', 'B412', 'S92', 'EC20',
]);

export function iconKind(ac) {
  const c = ac.category;
  if (c === 'A7' || (ac.type && HELI_TYPES.has(ac.type))) return 'heli';
  if (c === 'B1') return 'glider';
  if (c === 'A1' || c === 'B4' || (ac.type && LIGHT_TYPES.has(ac.type))) return 'light';
  if (c === 'A2' || c === 'A3' || c === 'A4' || c === 'A5') return 'jet';
  if (ac.type) return 'jet';
  return 'unknown';
}

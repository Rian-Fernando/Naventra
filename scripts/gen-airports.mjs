// Build-time generator: merge authoritative airport reference data from
// OurAirports (public domain — exact runway thresholds, headings, lengths,
// frequencies, field elevation) with our curated fields (timezone, magnetic
// declination, carrier mix, terminals/gates) and emit src/data/airports.js.
//
//   node scripts/gen-airports.mjs
//
// Exact runway thresholds give each runway its true lateral offset, which is
// what lets the engine tell close parallels (24L vs 24R) apart. Adding an
// airport = add its ICAO + curated fields to CURATED below and re-run.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const OA = join(ROOT, 'scripts', '.oa'); // cached CSVs

const SOURCES = {
  runways: 'https://davidmegginson.github.io/ourairports-data/runways.csv',
  freqs: 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv',
  airports: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
};

async function load(name) {
  const path = join(OA, `${name}.csv`);
  try { return readFileSync(path, 'utf8'); } catch { /* fetch below */ }
  const res = await fetch(SOURCES[name]);
  const text = await res.text();
  try { require('node:fs').mkdirSync(OA, { recursive: true }); } catch { /* */ }
  writeFileSync(path, text);
  return text;
}

// Minimal CSV parser (handles quoted fields with commas).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inq = false; }
      else field += c;
    } else if (c === '"') inq = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; } if (c === '\r' && text[i + 1] === '\n') i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const R_NM = 3440.065, DEG = Math.PI / 180;
function toLocalNm(oLat, oLon, lat, lon) {
  return {
    x: (lon - oLon) * DEG * R_NM * Math.cos(oLat * DEG),
    y: (lat - oLat) * DEG * R_NM,
  };
}

// Curated fields OurAirports doesn't carry. Runways/freqs/coords come from OA.
const CURATED = {
  KJFK: { iata: 'JFK', name: 'John F. Kennedy Intl', city: 'New York, USA', tz: 'America/New_York', decl: -13, carriers: ['JBU', 'DAL', 'AAL', 'UAL', 'BAW', 'VIR', 'AFR', 'DLH', 'UAE', 'QTR', 'KAL', 'EIN'], terminals: [{ name: 'T1', gates: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }, { name: 'T4', gates: ['A2', 'A4', 'A6', 'B22', 'B24', 'B26', 'B28', 'B31', 'B33', 'B35', 'B37', 'B39', 'B41', 'B43'] }, { name: 'T5', gates: ['1', '3', '5', '7', '9', '11', '13', '15', '17', '19', '21', '23', '25'] }, { name: 'T7', gates: ['2', '4', '6', '8', '10', '12'] }, { name: 'T8', gates: ['1', '3', '5', '7', '9', '12', '14', '16', '31', '33', '35'] }] },
  KLAX: { iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles, USA', tz: 'America/Los_Angeles', decl: 12, carriers: ['UAL', 'DAL', 'AAL', 'SWA', 'ASA', 'QFA', 'ANA', 'CPA', 'KAL', 'SIA', 'AFR', 'BAW'], terminals: [{ name: 'T1', gates: ['9', '11', '12', '13', '14', '15', '17', '18'] }, { name: 'T4', gates: ['40', '41', '42', '44', '45', '46', '47', '48', '49'] }, { name: 'T5', gates: ['50', '51', '52', '53', '54', '55', '57', '59'] }, { name: 'TBIT', gates: ['101', '103', '105', '107', '130', '132', '134', '148', '150', '155', '159'] }] },
  EGLL: { iata: 'LHR', name: 'London Heathrow', city: 'London, UK', tz: 'Europe/London', decl: 0, carriers: ['BAW', 'VIR', 'AAL', 'UAL', 'DLH', 'AFR', 'UAE', 'QTR', 'SIA', 'CPA', 'EIN', 'IBE'], terminals: [{ name: 'T2', gates: ['A1', 'A3', 'A5', 'A7', 'A10', 'B35', 'B37', 'B39', 'B44', 'B46'] }, { name: 'T3', gates: ['1', '3', '5', '7', '9', '11', '13', '15'] }, { name: 'T4', gates: ['1', '3', '5', '7', '9', '11', '15', '17'] }, { name: 'T5', gates: ['A7', 'A10', 'A13', 'A16', 'A21', 'B32', 'B36', 'B40', 'B44', 'C52', 'C56', 'C60'] }] },
  KATL: { iata: 'ATL', name: 'Hartsfield-Jackson Atlanta', city: 'Atlanta, USA', tz: 'America/New_York', decl: -6, carriers: ['DAL', 'SWA', 'AAL', 'UAL', 'FFT', 'NKS', 'KLM', 'AFR', 'VIR', 'KAL'], terminals: [{ name: 'A', gates: ['1', '3', '5', '7', '9', '11', '17', '19', '21', '25', '29', '33'] }, { name: 'B', gates: ['2', '4', '6', '10', '12', '14', '18', '24', '26', '28'] }, { name: 'C', gates: ['1', '5', '9', '11', '15', '19', '21', '37', '41', '55'] }, { name: 'F', gates: ['1', '3', '5', '7', '9', '12', '14'] }] },
  KORD: { iata: 'ORD', name: "Chicago O'Hare Intl", city: 'Chicago, USA', tz: 'America/Chicago', decl: -4, carriers: ['UAL', 'AAL', 'SWA', 'DAL', 'ENY', 'SKW', 'DLH', 'BAW', 'JAL', 'ANA'], terminals: [{ name: 'T1', gates: ['B1', 'B3', 'B5', 'B9', 'B12', 'B16', 'B20', 'C10', 'C16', 'C20', 'C24'] }, { name: 'T2', gates: ['E1', 'E3', 'E5', 'E7', 'F1', 'F4', 'F8', 'F12'] }, { name: 'T3', gates: ['G2', 'G6', 'G10', 'G14', 'H2', 'H6', 'H12', 'K2', 'K6', 'K12'] }, { name: 'T5', gates: ['M6', 'M8', 'M10', 'M12', 'M14', 'M16'] }] },
  KSFO: { iata: 'SFO', name: 'San Francisco Intl', city: 'San Francisco, USA', tz: 'America/Los_Angeles', decl: 13, carriers: ['UAL', 'ASA', 'DAL', 'AAL', 'SWA', 'SIA', 'CPA', 'ANA', 'JAL', 'AFR', 'BAW', 'UAE'], terminals: [{ name: 'T1', gates: ['B6', 'B8', 'B10', 'B12', 'B14', 'B17', 'B22', 'B24'] }, { name: 'T2', gates: ['D1', 'D3', 'D5', 'D9', 'D11', 'D14', 'D16', 'D18'] }, { name: 'T3', gates: ['E4', 'E6', 'E8', 'F1', 'F5', 'F9', 'F13', 'F18', 'F22'] }, { name: 'ITB', gates: ['A3', 'A5', 'A9', 'A11', 'G3', 'G7', 'G9', 'G13'] }] },
  KSEA: { iata: 'SEA', name: 'Seattle-Tacoma Intl', city: 'Seattle, USA', tz: 'America/Los_Angeles', decl: 15, carriers: ['ASA', 'DAL', 'SWA', 'UAL', 'AAL', 'QXE', 'ANA', 'EVA', 'BAW', 'UAE'], terminals: [{ name: 'A', gates: ['A1', 'A3', 'A5', 'A7', 'A9', 'A11', 'A14'] }, { name: 'B', gates: ['B1', 'B3', 'B5', 'B7', 'B9', 'B11'] }, { name: 'C', gates: ['C3', 'C9', 'C11', 'C15', 'C17', 'C20'] }, { name: 'D', gates: ['D1', 'D3', 'D5', 'D7', 'D9', 'D11'] }, { name: 'S', gates: ['S1', 'S3', 'S7', 'S9', 'S11', 'S15'] }] },
  EDDF: { iata: 'FRA', name: 'Frankfurt Main', city: 'Frankfurt, Germany', tz: 'Europe/Berlin', decl: 3, carriers: ['DLH', 'CFG', 'UAL', 'AAL', 'SIA', 'ANA', 'KAL', 'QTR', 'UAE', 'THY', 'AFR', 'BAW'], terminals: [{ name: 'T1A', gates: ['A14', 'A16', 'A20', 'A24', 'A28', 'A34', 'A40', 'A50', 'A56', 'A62'] }, { name: 'T1B', gates: ['B22', 'B24', 'B28', 'B32', 'B41', 'B43', 'B46'] }, { name: 'T2D', gates: ['D1', 'D4', 'D6', 'D8', 'D22', 'D25'] }, { name: 'T2E', gates: ['E3', 'E5', 'E7', 'E9', 'E24'] }] },
  LFPG: { iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris, France', tz: 'Europe/Paris', decl: 1, carriers: ['AFR', 'EZY', 'DAL', 'AAL', 'UAE', 'QTR', 'SIA', 'JAL', 'KAL', 'DLH', 'BAW', 'RYR'], terminals: [{ name: 'T1', gates: ['11', '13', '15', '17', '21', '23', '25'] }, { name: 'T2E', gates: ['K21', 'K25', 'K29', 'K33', 'K41', 'L21', 'L25', 'L31', 'M22', 'M28'] }, { name: 'T2F', gates: ['F21', 'F25', 'F29', 'F33', 'F37'] }, { name: 'T3', gates: ['30', '32', '34', '36'] }] },
  RJTT: { iata: 'HND', name: 'Tokyo Haneda', city: 'Tokyo, Japan', tz: 'Asia/Tokyo', decl: -8, carriers: ['JAL', 'ANA', 'SKY', 'SFJ', 'DAL', 'UAL', 'AAL', 'CPA', 'KAL', 'SIA', 'BAW', 'AFR'], terminals: [{ name: 'T1', gates: ['1', '3', '5', '7', '9', '11', '13', '15', '17'] }, { name: 'T2', gates: ['51', '53', '55', '57', '59', '61', '63', '65'] }, { name: 'T3', gates: ['101', '103', '105', '107', '109', '111', '112', '114'] }] },
  VHHH: { iata: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong', tz: 'Asia/Hong_Kong', decl: -3, carriers: ['CPA', 'HDA', 'CRK', 'CES', 'CSN', 'CCA', 'SIA', 'ANA', 'KAL', 'UAE', 'QTR', 'BAW'], terminals: [{ name: 'T1', gates: ['1', '3', '5', '7', '9', '23', '25', '27', '31', '35', '43', '47', '61', '63'] }, { name: 'MID', gates: ['201', '203', '205', '207', '209', '211', '215', '219'] }] },
  EHAM: { iata: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam, Netherlands', tz: 'Europe/Amsterdam', decl: 2, carriers: ['KLM', 'TRA', 'DLH', 'BAW', 'AFR', 'UAE', 'DAL', 'EZY', 'VLG', 'CPA', 'SIA', 'ANZ'], terminals: [{ name: 'D', gates: ['D2', 'D4', 'D6', 'D8', 'D57', 'D59', 'D61', 'D87'] }, { name: 'E', gates: ['E2', 'E4', 'E6', 'E18', 'E22', 'E24'] }, { name: 'F', gates: ['F2', 'F4', 'F6', 'F8'] }, { name: 'G', gates: ['G2', 'G4', 'G6', 'G9'] }, { name: 'H/M', gates: ['H1', 'H3', 'H5', 'M5', 'M7'] }] },
  KDFW: { iata: 'DFW', name: 'Dallas Fort Worth Intl', city: 'Dallas, USA', tz: 'America/Chicago', decl: 3, carriers: ['AAL', 'ENY', 'SKW', 'UAL', 'DAL', 'SWA', 'NKS', 'BAW', 'DLH', 'QFA'], terminals: [{ name: 'A', gates: ['A8', 'A10', 'A14', 'A16', 'A20', 'A24', 'A28', 'A33'] }, { name: 'B', gates: ['B2', 'B6', 'B10', 'B14', 'B22', 'B30', 'B39'] }, { name: 'C', gates: ['C2', 'C8', 'C14', 'C20', 'C27', 'C33'] }, { name: 'D', gates: ['D6', 'D10', 'D16', 'D22', 'D30', 'D40'] }, { name: 'E', gates: ['E4', 'E8', 'E12', 'E18', 'E31'] }] },
  YSSY: { iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney, Australia', tz: 'Australia/Sydney', decl: 13, carriers: ['QFA', 'JST', 'VOZ', 'UAE', 'SIA', 'ANZ', 'CPA', 'QTR', 'ANA', 'AAL'], terminals: [{ name: 'T1', gates: ['8', '9', '10', '24', '30', '37', '50', '55', '59', '63'] }, { name: 'T2', gates: ['1', '3', '5', '7', '9', '11', '13'] }, { name: 'T3', gates: ['1', '2', '3', '4', '5', '14', '19', '22'] }] },
  OMDB: { iata: 'DXB', name: 'Dubai Intl', city: 'Dubai, UAE', tz: 'Asia/Dubai', decl: 2, carriers: ['UAE', 'FDB', 'QTR', 'ETD', 'BAW', 'SIA', 'CPA', 'THY', 'AFR', 'DLH', 'AIC', 'PIA'], terminals: [{ name: 'T1', gates: ['D1', 'D3', 'D5', 'D7', 'D9', 'D11', 'D15'] }, { name: 'T2', gates: ['F1', 'F3', 'F5', 'F7'] }, { name: 'T3A', gates: ['A1', 'A3', 'A5', 'A7', 'A9', 'A13', 'A17', 'A21'] }, { name: 'T3B', gates: ['B7', 'B9', 'B13', 'B17', 'B21', 'B25', 'B27'] }] },
};

// Fallback comm frequencies (used only if OurAirports has no valid VHF entry).
const FALLBACK_FREQS = {
  KJFK: { tower: '119.100', ground: '121.900', approach: '127.400', atis: '128.725' },
  KLAX: { tower: '120.950', ground: '121.750', approach: '124.500', atis: '133.800' },
  EGLL: { tower: '118.500', ground: '121.905', approach: '119.725', atis: '128.075' },
  KATL: { tower: '119.100', ground: '121.900', approach: '127.250', atis: '125.550' },
  KORD: { tower: '120.750', ground: '121.900', approach: '119.000', atis: '135.400' },
  KSFO: { tower: '120.500', ground: '121.800', approach: '134.500', atis: '118.850' },
  KSEA: { tower: '119.900', ground: '121.700', approach: '119.200', atis: '118.000' },
  EDDF: { tower: '119.900', ground: '121.800', approach: '120.800', atis: '118.025' },
  LFPG: { tower: '119.250', ground: '121.800', approach: '121.150', atis: '127.125' },
  RJTT: { tower: '118.100', ground: '121.700', approach: '119.100', atis: '128.800' },
  VHHH: { tower: '118.200', ground: '121.600', approach: '119.100', atis: '128.200' },
  EHAM: { tower: '119.225', ground: '121.700', approach: '121.200', atis: '122.150' },
  KDFW: { tower: '126.550', ground: '121.650', approach: '118.550', atis: '135.925' },
  YSSY: { tower: '120.500', ground: '121.700', approach: '124.400', atis: '126.250' },
  OMDB: { tower: '118.750', ground: '121.650', approach: '124.900', atis: '131.700' },
};

const AIRLINES = {
  JBU: 'JetBlue', DAL: 'Delta', AAL: 'American', UAL: 'United', BAW: 'Speedbird', VIR: 'Virgin', AFR: 'Air France', DLH: 'Lufthansa', UAE: 'Emirates', QTR: 'Qatari', KAL: 'Korean Air', EIN: 'Shamrock', SWA: 'Southwest', ASA: 'Alaska', QFA: 'Qantas', ANA: 'All Nippon', CPA: 'Cathay', SIA: 'Singapore', FFT: 'Frontier Flight', NKS: 'Spirit Wings', KLM: 'KLM', ENY: 'Envoy', SKW: 'SkyWest', JAL: 'Japan Air', EVA: 'Eva', QXE: 'Horizon', CFG: 'Condor', THY: 'Turkish', EZY: 'Easy', RYR: 'Ryanair', SKY: 'Skymark', SFJ: 'Starflyer', HDA: 'Dragon', CRK: 'Bauhinia', CES: 'China Eastern', CSN: 'China Southern', CCA: 'Air China', FDB: 'Sky Dubai', ETD: 'Etihad', AIC: 'Air India', PIA: 'Pakistan', IBE: 'Iberia', TRA: 'Transavia', VLG: 'Vueling', JST: 'Jetstar', VOZ: 'Velocity', ANZ: 'New Zealand',
};

function main() {
  const runways = parseCSV(readFileSync(join(OA, 'runways.csv'), 'utf8'));
  const freqs = parseCSV(readFileSync(join(OA, 'freqs.csv'), 'utf8'));
  const airports = parseCSV(readFileSync(join(OA, 'airports.csv'), 'utf8'));

  const apByIdent = Object.fromEntries(airports.map((a) => [a.ident, a]));
  const out = {};

  for (const [icao, cur] of Object.entries(CURATED)) {
    const oa = apByIdent[icao];
    if (!oa) { console.warn('!! not in OurAirports:', icao); continue; }
    const lat = +oa.latitude_deg, lon = +oa.longitude_deg;
    const elevFt = Math.round(+oa.elevation_ft || 0);

    const pad = (id) => (id || '').replace(/^(\d+)/, (m) => m.padStart(2, '0'));
    const rws = runways.filter((r) => r.airport_ident === icao && r.closed !== '1' && r.le_latitude_deg && r.he_latitude_deg);
    const rwOut = rws.map((r) => {
      const leLat = +r.le_latitude_deg, leLon = +r.le_longitude_deg;
      const heLat = +r.he_latitude_deg, heLon = +r.he_longitude_deg;
      const mid = toLocalNm(lat, lon, (leLat + heLat) / 2, (leLon + heLon) / 2);
      const trueHdg = Math.round(+r.le_heading_degT || (Math.atan2(...(() => { const a = toLocalNm(lat, lon, leLat, leLon), b = toLocalNm(lat, lon, heLat, heLon); return [b.x - a.x, b.y - a.y]; })()) / DEG));
      const le = pad(r.le_ident), he = pad(r.he_ident);
      return {
        id: `${le}/${he}`,
        ends: [le, he],
        trueHdg: ((trueHdg % 360) + 360) % 360,
        lenFt: Math.round(+r.length_ft || 0),
        ils: [le, he], // major hubs: assume ILS both ends (curated navdata not free-structured)
        offX: +mid.x.toFixed(4),
        offY: +mid.y.toFixed(4),
      };
    }).filter((r) => r.lenFt > 3000).sort((a, b) => b.lenFt - a.lenFt);

    const af = freqs.filter((f) => f.airport_ident === icao);
    // Only accept VHF air-band comm frequencies (118.000–136.975); OA also lists
    // navaid/UHF entries that would be nonsense on a radio panel.
    const pick = (types) => {
      for (const t of types) {
        const m = af.find((f) => f.type === t && +f.frequency_mhz >= 118 && +f.frequency_mhz <= 137);
        if (m) return (+m.frequency_mhz).toFixed(3);
      }
      return null;
    };
    const fb = FALLBACK_FREQS[icao] || {};
    const fq = {
      tower: pick(['TWR', 'TOWER']) || fb.tower || '118.100',
      ground: pick(['GND', 'GROUND']) || fb.ground || '121.900',
      approach: pick(['APP', 'APPROACH', 'A/D', 'ARR']) || fb.approach || '119.100',
      atis: pick(['ATIS', 'D-ATIS', 'A-ATIS']) || fb.atis || '127.000',
    };

    out[icao] = {
      icao, tz: cur.tz, iata: cur.iata, name: cur.name, city: cur.city,
      lat: +lat.toFixed(4), lon: +lon.toFixed(4), elevFt, decl: cur.decl,
      freqs: fq, runways: rwOut, terminals: cur.terminals, carriers: cur.carriers,
    };
    console.log(`${icao}: ${rwOut.length} runways, thresholds exact`);
  }

  const body = `// AUTO-GENERATED by scripts/gen-airports.mjs — do not edit by hand.
// Runway thresholds, headings, lengths, frequencies + field elevation come from
// OurAirports (public domain). Timezone, declination, carriers and terminals are
// curated in the generator. offX/offY are each runway's exact lateral offset (nm
// from the field reference), derived from real thresholds so close parallels are
// distinguishable. Re-run: node scripts/gen-airports.mjs

export const AIRPORTS = ${JSON.stringify(out, null, 2)};

export const AIRPORT_LIST = Object.values(AIRPORTS);

export const AIRLINES = ${JSON.stringify(AIRLINES, null, 2)};

export function airlineName(callsign) {
  if (!callsign) return null;
  return AIRLINES[callsign.slice(0, 3).toUpperCase()] || null;
}
`;
  writeFileSync(join(ROOT, 'src', 'data', 'airports.js'), body);
  console.log('\\nwrote src/data/airports.js —', Object.keys(out).length, 'airports');
}

main();

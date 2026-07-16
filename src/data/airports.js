// Real-world airport specifications used for radar geometry, runway allocation,
// gate assignment and simulated operations.
//
// Runway model: each entry is one physical strip. `ends` are the two runway
// designators; `trueHdg` is the true bearing (degrees) flown when landing on
// ends[0] (magnetic heading corrected by local declination). `lenFt` is the
// published length; `ils` lists ends with an ILS approach.
// Frequencies are published VHF (MHz). Hub carriers seed realistic sim callsigns.

export const AIRPORTS = {
  KJFK: {
    icao: 'KJFK', tz: 'America/New_York', iata: 'JFK', name: 'John F. Kennedy Intl', city: 'New York, USA',
    lat: 40.6413, lon: -73.7781, elevFt: 13, decl: -13,
    freqs: { tower: '119.100', ground: '121.900', approach: '127.400', atis: '128.725' },
    runways: [
      { id: '04L/22R', ends: ['04L', '22R'], trueHdg: 31, lenFt: 12079, ils: ['04L', '22R'] },
      { id: '04R/22L', ends: ['04R', '22L'], trueHdg: 31, lenFt: 8400, ils: ['04R', '22L'] },
      { id: '13L/31R', ends: ['13L', '31R'], trueHdg: 121, lenFt: 10000, ils: ['13L', '31R'] },
      { id: '13R/31L', ends: ['13R', '31L'], trueHdg: 121, lenFt: 14511, ils: ['13R'] },
    ],
    terminals: [
      { name: 'T1', gates: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] },
      { name: 'T4', gates: ['A2', 'A4', 'A6', 'B22', 'B24', 'B26', 'B28', 'B31', 'B33', 'B35', 'B37', 'B39', 'B41', 'B43'] },
      { name: 'T5', gates: ['1', '3', '5', '7', '9', '11', '13', '15', '17', '19', '21', '23', '25'] },
      { name: 'T7', gates: ['2', '4', '6', '8', '10', '12'] },
      { name: 'T8', gates: ['1', '3', '5', '7', '9', '12', '14', '16', '31', '33', '35'] },
    ],
    carriers: ['JBU', 'DAL', 'AAL', 'UAL', 'BAW', 'VIR', 'AFR', 'DLH', 'UAE', 'QTR', 'KAL', 'EIN'],
  },
  KLAX: {
    icao: 'KLAX', tz: 'America/Los_Angeles', iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles, USA',
    lat: 33.9425, lon: -118.4081, elevFt: 128, decl: 12,
    freqs: { tower: '120.950', ground: '121.750', approach: '124.500', atis: '133.800' },
    runways: [
      { id: '06L/24R', ends: ['06L', '24R'], trueHdg: 83, lenFt: 8926, ils: ['06L', '24R'] },
      { id: '06R/24L', ends: ['06R', '24L'], trueHdg: 83, lenFt: 10285, ils: ['06R', '24L'] },
      { id: '07L/25R', ends: ['07L', '25R'], trueHdg: 83, lenFt: 12091, ils: ['07L', '25R'] },
      { id: '07R/25L', ends: ['07R', '25L'], trueHdg: 83, lenFt: 11095, ils: ['07R', '25L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['9', '11', '12', '13', '14', '15', '17', '18'] },
      { name: 'T4', gates: ['40', '41', '42', '44', '45', '46', '47', '48', '49'] },
      { name: 'T5', gates: ['50', '51', '52', '53', '54', '55', '57', '59'] },
      { name: 'TBIT', gates: ['101', '103', '105', '107', '130', '132', '134', '148', '150', '155', '159'] },
    ],
    carriers: ['UAL', 'DAL', 'AAL', 'SWA', 'ASA', 'QFA', 'ANA', 'CPA', 'KAL', 'SIA', 'AFR', 'BAW'],
  },
  EGLL: {
    icao: 'EGLL', tz: 'Europe/London', iata: 'LHR', name: 'London Heathrow', city: 'London, UK',
    lat: 51.4700, lon: -0.4543, elevFt: 83, decl: 0,
    freqs: { tower: '118.500', ground: '121.905', approach: '119.725', atis: '128.075' },
    runways: [
      { id: '09L/27R', ends: ['09L', '27R'], trueHdg: 90, lenFt: 12799, ils: ['09L', '27R'] },
      { id: '09R/27L', ends: ['09R', '27L'], trueHdg: 90, lenFt: 12001, ils: ['09R', '27L'] },
    ],
    terminals: [
      { name: 'T2', gates: ['A1', 'A3', 'A5', 'A7', 'A10', 'B35', 'B37', 'B39', 'B44', 'B46'] },
      { name: 'T3', gates: ['1', '3', '5', '7', '9', '11', '13', '15'] },
      { name: 'T4', gates: ['1', '3', '5', '7', '9', '11', '15', '17'] },
      { name: 'T5', gates: ['A7', 'A10', 'A13', 'A16', 'A21', 'B32', 'B36', 'B40', 'B44', 'C52', 'C56', 'C60'] },
    ],
    carriers: ['BAW', 'VIR', 'AAL', 'UAL', 'DLH', 'AFR', 'UAE', 'QTR', 'SIA', 'CPA', 'EIN', 'IBE'],
  },
  KATL: {
    icao: 'KATL', tz: 'America/New_York', iata: 'ATL', name: 'Hartsfield-Jackson Atlanta', city: 'Atlanta, USA',
    lat: 33.6407, lon: -84.4277, elevFt: 1026, decl: -6,
    freqs: { tower: '119.100', ground: '121.900', approach: '127.250', atis: '125.550' },
    runways: [
      { id: '08L/26R', ends: ['08L', '26R'], trueHdg: 74, lenFt: 9000, ils: ['08L', '26R'] },
      { id: '08R/26L', ends: ['08R', '26L'], trueHdg: 74, lenFt: 10000, ils: ['08R', '26L'] },
      { id: '09L/27R', ends: ['09L', '27R'], trueHdg: 84, lenFt: 12390, ils: ['09L', '27R'] },
      { id: '09R/27L', ends: ['09R', '27L'], trueHdg: 84, lenFt: 9000, ils: ['09R', '27L'] },
      { id: '10/28', ends: ['10', '28'], trueHdg: 94, lenFt: 9000, ils: ['10', '28'] },
    ],
    terminals: [
      { name: 'A', gates: ['1', '3', '5', '7', '9', '11', '17', '19', '21', '25', '29', '33'] },
      { name: 'B', gates: ['2', '4', '6', '10', '12', '14', '18', '24', '26', '28'] },
      { name: 'C', gates: ['1', '5', '9', '11', '15', '19', '21', '37', '41', '55'] },
      { name: 'F', gates: ['1', '3', '5', '7', '9', '12', '14'] },
    ],
    carriers: ['DAL', 'SWA', 'AAL', 'UAL', 'FFT', 'NKS', 'KLM', 'AFR', 'VIR', 'KAL'],
  },
  KORD: {
    icao: 'KORD', tz: 'America/Chicago', iata: 'ORD', name: "Chicago O'Hare Intl", city: 'Chicago, USA',
    lat: 41.9742, lon: -87.9073, decl: -4, elevFt: 672,
    freqs: { tower: '120.750', ground: '121.900', approach: '119.000', atis: '135.400' },
    runways: [
      { id: '10L/28R', ends: ['10L', '28R'], trueHdg: 96, lenFt: 13000, ils: ['10L', '28R'] },
      { id: '10C/28C', ends: ['10C', '28C'], trueHdg: 96, lenFt: 10801, ils: ['10C', '28C'] },
      { id: '09R/27L', ends: ['09R', '27L'], trueHdg: 86, lenFt: 11260, ils: ['09R', '27L'] },
      { id: '09C/27C', ends: ['09C', '27C'], trueHdg: 86, lenFt: 11245, ils: ['09C', '27C'] },
      { id: '04R/22L', ends: ['04R', '22L'], trueHdg: 36, lenFt: 8075, ils: ['04R', '22L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['B1', 'B3', 'B5', 'B9', 'B12', 'B16', 'B20', 'C10', 'C16', 'C20', 'C24'] },
      { name: 'T2', gates: ['E1', 'E3', 'E5', 'E7', 'F1', 'F4', 'F8', 'F12'] },
      { name: 'T3', gates: ['G2', 'G6', 'G10', 'G14', 'H2', 'H6', 'H12', 'K2', 'K6', 'K12'] },
      { name: 'T5', gates: ['M6', 'M8', 'M10', 'M12', 'M14', 'M16'] },
    ],
    carriers: ['UAL', 'AAL', 'SWA', 'DAL', 'ENY', 'SKW', 'DLH', 'BAW', 'JAL', 'ANA'],
  },
  KSFO: {
    icao: 'KSFO', tz: 'America/Los_Angeles', iata: 'SFO', name: 'San Francisco Intl', city: 'San Francisco, USA',
    lat: 37.6213, lon: -122.3790, elevFt: 13, decl: 13,
    freqs: { tower: '120.500', ground: '121.800', approach: '134.500', atis: '118.850' },
    runways: [
      { id: '01L/19R', ends: ['01L', '19R'], trueHdg: 24, lenFt: 7650, ils: ['19R'] },
      { id: '01R/19L', ends: ['01R', '19L'], trueHdg: 24, lenFt: 8650, ils: ['19L'] },
      { id: '10L/28R', ends: ['10L', '28R'], trueHdg: 114, lenFt: 11870, ils: ['28R', '28L'] },
      { id: '10R/28L', ends: ['10R', '28L'], trueHdg: 114, lenFt: 11381, ils: ['28L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['B6', 'B8', 'B10', 'B12', 'B14', 'B17', 'B22', 'B24'] },
      { name: 'T2', gates: ['D1', 'D3', 'D5', 'D9', 'D11', 'D14', 'D16', 'D18'] },
      { name: 'T3', gates: ['E4', 'E6', 'E8', 'F1', 'F5', 'F9', 'F13', 'F18', 'F22'] },
      { name: 'ITB', gates: ['A3', 'A5', 'A9', 'A11', 'G3', 'G7', 'G9', 'G13'] },
    ],
    carriers: ['UAL', 'ASA', 'DAL', 'AAL', 'SWA', 'SIA', 'CPA', 'ANA', 'JAL', 'AFR', 'BAW', 'UAE'],
  },
  KSEA: {
    icao: 'KSEA', tz: 'America/Los_Angeles', iata: 'SEA', name: 'Seattle-Tacoma Intl', city: 'Seattle, USA',
    lat: 47.4502, lon: -122.3088, elevFt: 433, decl: 15,
    freqs: { tower: '119.900', ground: '121.700', approach: '119.200', atis: '118.000' },
    runways: [
      { id: '16L/34R', ends: ['16L', '34R'], trueHdg: 175, lenFt: 11901, ils: ['16L', '34R'] },
      { id: '16C/34C', ends: ['16C', '34C'], trueHdg: 175, lenFt: 9426, ils: ['16C', '34C'] },
      { id: '16R/34L', ends: ['16R', '34L'], trueHdg: 175, lenFt: 8500, ils: ['16R', '34L'] },
    ],
    terminals: [
      { name: 'A', gates: ['A1', 'A3', 'A5', 'A7', 'A9', 'A11', 'A14'] },
      { name: 'B', gates: ['B1', 'B3', 'B5', 'B7', 'B9', 'B11'] },
      { name: 'C', gates: ['C3', 'C9', 'C11', 'C15', 'C17', 'C20'] },
      { name: 'D', gates: ['D1', 'D3', 'D5', 'D7', 'D9', 'D11'] },
      { name: 'S', gates: ['S1', 'S3', 'S7', 'S9', 'S11', 'S15'] },
    ],
    carriers: ['ASA', 'DAL', 'SWA', 'UAL', 'AAL', 'QXE', 'ANA', 'EVA', 'BAW', 'UAE'],
  },
  EGLL_DUP: null, // placeholder removed at export
  EDDF: {
    icao: 'EDDF', tz: 'Europe/Berlin', iata: 'FRA', name: 'Frankfurt Main', city: 'Frankfurt, Germany',
    lat: 50.0379, lon: 8.5622, elevFt: 364, decl: 3,
    freqs: { tower: '119.900', ground: '121.800', approach: '120.800', atis: '118.025' },
    runways: [
      { id: '07C/25C', ends: ['07C', '25C'], trueHdg: 73, lenFt: 13123, ils: ['07C', '25C'] },
      { id: '07R/25L', ends: ['07R', '25L'], trueHdg: 73, lenFt: 13123, ils: ['07R', '25L'] },
      { id: '07L/25R', ends: ['07L', '25R'], trueHdg: 73, lenFt: 9240, ils: ['07L', '25R'] },
      { id: '18/36', ends: ['18', '36'], trueHdg: 183, lenFt: 13123, ils: [] },
    ],
    terminals: [
      { name: 'T1A', gates: ['A14', 'A16', 'A20', 'A24', 'A28', 'A34', 'A40', 'A50', 'A56', 'A62'] },
      { name: 'T1B', gates: ['B22', 'B24', 'B28', 'B32', 'B41', 'B43', 'B46'] },
      { name: 'T2D', gates: ['D1', 'D4', 'D6', 'D8', 'D22', 'D25'] },
      { name: 'T2E', gates: ['E3', 'E5', 'E7', 'E9', 'E24'] },
    ],
    carriers: ['DLH', 'CFG', 'UAL', 'AAL', 'SIA', 'ANA', 'KAL', 'QTR', 'UAE', 'THY', 'AFR', 'BAW'],
  },
  LFPG: {
    icao: 'LFPG', tz: 'Europe/Paris', iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris, France',
    lat: 49.0097, lon: 2.5479, elevFt: 392, decl: 1,
    freqs: { tower: '119.250', ground: '121.800', approach: '121.150', atis: '127.125' },
    runways: [
      { id: '08L/26R', ends: ['08L', '26R'], trueHdg: 86, lenFt: 13829, ils: ['08L', '26R'] },
      { id: '08R/26L', ends: ['08R', '26L'], trueHdg: 86, lenFt: 8858, ils: ['08R', '26L'] },
      { id: '09L/27R', ends: ['09L', '27R'], trueHdg: 86, lenFt: 8858, ils: ['09L', '27R'] },
      { id: '09R/27L', ends: ['09R', '27L'], trueHdg: 86, lenFt: 13780, ils: ['09R', '27L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['11', '13', '15', '17', '21', '23', '25'] },
      { name: 'T2E', gates: ['K21', 'K25', 'K29', 'K33', 'K41', 'L21', 'L25', 'L31', 'M22', 'M28'] },
      { name: 'T2F', gates: ['F21', 'F25', 'F29', 'F33', 'F37'] },
      { name: 'T3', gates: ['30', '32', '34', '36'] },
    ],
    carriers: ['AFR', 'EZY', 'DAL', 'AAL', 'UAE', 'QTR', 'SIA', 'JAL', 'KAL', 'DLH', 'BAW', 'RYR'],
  },
  RJTT: {
    icao: 'RJTT', tz: 'Asia/Tokyo', iata: 'HND', name: 'Tokyo Haneda', city: 'Tokyo, Japan',
    lat: 35.5494, lon: 139.7798, elevFt: 21, decl: -8,
    freqs: { tower: '118.100', ground: '121.700', approach: '119.100', atis: '128.800' },
    runways: [
      { id: '16R/34L', ends: ['16R', '34L'], trueHdg: 157, lenFt: 9840, ils: ['34L', '16R'] },
      { id: '16L/34R', ends: ['16L', '34R'], trueHdg: 157, lenFt: 11024, ils: ['34R'] },
      { id: '04/22', ends: ['04', '22'], trueHdg: 32, lenFt: 8200, ils: ['22'] },
      { id: '05/23', ends: ['05', '23'], trueHdg: 42, lenFt: 8200, ils: ['23'] },
    ],
    terminals: [
      { name: 'T1', gates: ['1', '3', '5', '7', '9', '11', '13', '15', '17'] },
      { name: 'T2', gates: ['51', '53', '55', '57', '59', '61', '63', '65'] },
      { name: 'T3', gates: ['101', '103', '105', '107', '109', '111', '112', '114'] },
    ],
    carriers: ['JAL', 'ANA', 'SKY', 'SFJ', 'DAL', 'UAL', 'AAL', 'CPA', 'KAL', 'SIA', 'BAW', 'AFR'],
  },
  VHHH: {
    icao: 'VHHH', tz: 'Asia/Hong_Kong', iata: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong',
    lat: 22.3080, lon: 113.9185, elevFt: 28, decl: -3,
    freqs: { tower: '118.200', ground: '121.600', approach: '119.100', atis: '128.200' },
    runways: [
      { id: '07L/25R', ends: ['07L', '25R'], trueHdg: 73, lenFt: 12467, ils: ['07L', '25R'] },
      { id: '07C/25C', ends: ['07C', '25C'], trueHdg: 73, lenFt: 12467, ils: ['07C', '25C'] },
      { id: '07R/25L', ends: ['07R', '25L'], trueHdg: 73, lenFt: 12467, ils: ['07R', '25L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['1', '3', '5', '7', '9', '23', '25', '27', '31', '35', '43', '47', '61', '63'] },
      { name: 'MID', gates: ['201', '203', '205', '207', '209', '211', '215', '219'] },
    ],
    carriers: ['CPA', 'HDA', 'CRK', 'CES', 'CSN', 'CCA', 'SIA', 'ANA', 'KAL', 'UAE', 'QTR', 'BAW'],
  },
  VCBI: {
    icao: 'VCBI', tz: 'Asia/Colombo', iata: 'CMB', name: 'Bandaranaike Intl', city: 'Colombo, Sri Lanka',
    lat: 7.1808, lon: 79.8841, elevFt: 30, decl: -2,
    freqs: { tower: '118.700', ground: '121.900', approach: '132.400', atis: '127.100' },
    runways: [
      { id: '04/22', ends: ['04', '22'], trueHdg: 38, lenFt: 10991, ils: ['04', '22'] },
    ],
    terminals: [
      { name: 'T1', gates: ['4', '5', '6', '7', '8', '9', '10', '11', '12'] },
      { name: 'APR', gates: ['15', '16', '17', '18', '21', '22'] },
    ],
    carriers: ['ALK', 'UAE', 'QTR', 'SIA', 'AIC', 'IGO', 'THY', 'CPA', 'MAS', 'ETD'],
  },
  OMDB: {
    icao: 'OMDB', tz: 'Asia/Dubai', iata: 'DXB', name: 'Dubai Intl', city: 'Dubai, UAE',
    lat: 25.2532, lon: 55.3657, elevFt: 62, decl: 2,
    freqs: { tower: '118.750', ground: '121.650', approach: '124.900', atis: '131.700' },
    runways: [
      { id: '12L/30R', ends: ['12L', '30R'], trueHdg: 122, lenFt: 13124, ils: ['12L', '30R'] },
      { id: '12R/30L', ends: ['12R', '30L'], trueHdg: 122, lenFt: 14590, ils: ['12R', '30L'] },
    ],
    terminals: [
      { name: 'T1', gates: ['D1', 'D3', 'D5', 'D7', 'D9', 'D11', 'D15'] },
      { name: 'T2', gates: ['F1', 'F3', 'F5', 'F7'] },
      { name: 'T3A', gates: ['A1', 'A3', 'A5', 'A7', 'A9', 'A13', 'A17', 'A21'] },
      { name: 'T3B', gates: ['B7', 'B9', 'B13', 'B17', 'B21', 'B25', 'B27'] },
    ],
    carriers: ['UAE', 'FDB', 'QTR', 'ETD', 'BAW', 'SIA', 'CPA', 'THY', 'AFR', 'DLH', 'AIC', 'PIA'],
  },
};

delete AIRPORTS.EGLL_DUP;

export const AIRPORT_LIST = Object.values(AIRPORTS);

// Airline telephony designators for radio phraseology and strip display.
export const AIRLINES = {
  JBU: 'JetBlue', DAL: 'Delta', AAL: 'American', UAL: 'United', BAW: 'Speedbird',
  VIR: 'Virgin', AFR: 'Air France', DLH: 'Lufthansa', UAE: 'Emirates', QTR: 'Qatari',
  KAL: 'Korean Air', EIN: 'Shamrock', SWA: 'Southwest', ASA: 'Alaska', QFA: 'Qantas',
  ANA: 'All Nippon', CPA: 'Cathay', SIA: 'Singapore', FFT: 'Frontier Flight', NKS: 'Spirit Wings',
  KLM: 'KLM', ENY: 'Envoy', SKW: 'SkyWest', JAL: 'Japan Air', EVA: 'Eva', QXE: 'Horizon',
  CFG: 'Condor', THY: 'Turkish', EZY: 'Easy', RYR: 'Ryanair', SKY: 'Skymark', SFJ: 'Starflyer',
  HDA: 'Dragon', CRK: 'Bauhinia', CES: 'China Eastern', CSN: 'China Southern', CCA: 'Air China',
  FDB: 'Sky Dubai', ETD: 'Etihad', AIC: 'Air India', PIA: 'Pakistan', IBE: 'Iberia',
  ALK: 'SriLankan', IGO: 'IFly', MAS: 'Malaysian',
};

export function airlineName(callsign) {
  if (!callsign) return null;
  const prefix = callsign.slice(0, 3).toUpperCase();
  return AIRLINES[prefix] || null;
}

// Typical seating capacity + range by ICAO type designator. These are
// representative figures for a common two-class layout — actual passenger
// counts are private airline data and not available from any free feed, so the
// UI labels these as typical estimates, never live counts.

const SEATS = {
  // narrowbody
  A319: 140, A320: 165, A321: 200, A19N: 140, A20N: 165, A21N: 200,
  B712: 110, B733: 140, B734: 150, B735: 120, B736: 130, B737: 140, B738: 175,
  B739: 185, B37M: 150, B38M: 178, B39M: 190, E170: 76, E75L: 76, E75S: 76,
  E190: 100, E195: 120, E290: 114, E295: 132, CRJ2: 50, CRJ7: 70, CRJ9: 90,
  CRJX: 100, AT76: 74, AT75: 70, DH8D: 78, BCS1: 130, BCS3: 145, A220: 140,
  // widebody
  B762: 210, B763: 245, B764: 245, B772: 314, B77L: 317, B77W: 396, B778: 395,
  B779: 426, B788: 240, B789: 296, B78X: 330, A332: 268, A333: 300, A337: 260,
  A338: 287, A339: 287, A342: 260, A343: 295, A345: 320, A346: 380, A359: 325,
  A35K: 366, A388: 525, B742: 400, B743: 420, B744: 416, B748: 410, MD11: 293,
  IL96: 300, A306: 250, A310: 220,
  // regional / GA / turboprop (small)
  C208: 9, PC12: 9, B350: 9, C25A: 8, C25B: 9, C56X: 9, GLF6: 16, E55P: 9,
  BE20: 9, SF34: 34, E120: 30, JS41: 29,
};

export function typicalSeats(type) {
  return type ? (SEATS[type] ?? null) : null;
}

// Pure geometry shared by the browser engine and the Cloudflare tracker.
// Approach direction bucketed into 8 sectors (0=N, 1=NE, 2=E, …).
export function octantOf(brgFromField) {
  return Math.floor((((brgFromField % 360) + 360) % 360 + 22.5) / 45) % 8;
}

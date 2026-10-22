# Changelog

All notable changes to Naventra are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Departure runways — read off traffic, chosen by results
- Departures were dealt round-robin across every runway arrivals weren't using (JFK 26%,
  LAX 38% correct). Three predictors now name a runway for every taxiing flight — the
  departure flow actually in use, the nearest strip, and a learned per-spot habit — and
  each airport uses whichever has the best recent record (`src/engine/departures.js`).
  Replaying 18,880 real graded departures with an honest taxi lag: JFK ~81%, Heathrow ~89%.
- Runway Allocation shows only runways traffic is using: unused runways go **IDLE** instead
  of being counted as departure runways (JFK south-west flow showed three), and the badge
  says whether the configuration came from live traffic or the wind.
- Ground traffic at other airports in range (Newark, Teterboro, Long Beach…) no longer gets
  a runway or a departure prediction, and a flight we just saw land isn't mistaken for a
  departure. Departure records refresh at most every 2.5 min; long hold-short queues are no
  longer dropped after 10 minutes.

### Seasons — the model keeps up as they change
- The weekly retrain walks the **whole** dataset (it had silently used only the newest
  20,000 rows), weights recent rows more with a half-life validated per airport, and only
  adopts a model that wins on the most recent 21 days.
- The ETA model must beat the ETA that is actually live (not the raw estimate) and now also
  learns from landings whose runway couldn't be classified.
- Day-of-year inputs are wired through training and serving but stay off until the data
  spans ~a year. The report tracks every month — accuracy, ETA bias, IFR share, wind, the
  runway used most — and flags shifts between the last two 30-day windows.
- The tracker's learned priors forget gradually (counts halve past a cap), and it reloads
  `model.json` from GitHub hourly, so a retrain goes live without a redeploy.

### Alerts & monitoring (free)
- Email alerts through Resend when live data stalls for 2 h, when it recovers, and when the
  weekly retrain stops — plus a one-time confirmation. State-change only, idempotent, and
  off until `RESEND_API_KEY` + `ALERT_TO` are set (see `worker/README.md`).
- An hourly GitHub Actions watchdog checks `/api/health` from outside and fails (GitHub
  emails the owner) if the worker is unreachable or its cron stops.
- GitHub had silently stopped running the weekly retrain and CodeQL schedules after 7 Sep;
  both re-registered. Optional `GITHUB_DISPATCH_TOKEN` lets a stale model re-run the
  retrain itself. `/api/health` now reports each hub's observed configuration and the
  model in use; `/api/dataset.jsonl` pages through the full history (`X-Next-Before`).

### Phones
- On phones the console opens on the radar (it was below three panels, ~1,100 px down),
  followed by the AI scorecard and decision feed. The radar keeps its height (a flex rule
  had collapsed it to 380 px), its controls become one swipeable toolbar and the legend a
  single row, and the header lost a row. Lighthouse mobile on /live: performance 37 → 80,
  layout shift 0.62 → 0.005.

### Live data only — nothing invented
- **Removed the simulation fallback.** The console no longer switches to synthetic traffic
  when the ADS-B feeds fail (or via a SIM button). It retries with backoff, shows
  RECONNECTING, logs the interruption, and clears the scope after 30 s rather than show
  positions that have stopped updating.
- **Removed synthetic weather.** When both METAR sources failed, a fake METAR was generated
  — and predictions locked against it were graded and banked. Now weather is a real report
  (with its observation time), the last real report marked STALE, or UNAVAILABLE. The US
  fallback derives its flight category from the reported ceiling/visibility instead of
  assuming VFR. Switching airports no longer briefly applies the previous airport's weather.
- **Removed invented numbers.** Decision "confidence" scores were a hash of the title; graded
  decisions now show their category's real verified accuracy and sample size (from the
  scorecard), and alerts show none. The ATIS information letter was made up from the clock and
  is gone. The landing page shows "—" until real stats arrive instead of animating to 0.
- **Honest labels.** The comms panel is "Controller Phraseology · GENERATED" (engine-written
  ICAO/FAA phraseology, not recorded radio). Stands are marked as engine-proposed (real gate
  assignments aren't public). Landing/Guide/Tour copy no longer mentions a simulation or
  claims every airport is tracked every minute.
- **Fewer false conflict alerts.** Unidentified TIS-B tracks ('~' hex — radar rebroadcasts
  without ADS-B identity, usually VFR or duplicates) are excluded like VFR; diverging
  simultaneous departures (≥15° apart, opening) and a departure beside an arrival on final
  for a different runway are no longer flagged as losses of separation.
- **Realistic departure rate.** ADR no longer counts every departure runway as an
  independent stream at the 60 s wake minimum (JFK showed ~144/hr); it now uses a ~90 s
  sustained interval with diminishing returns per extra runway (JFK ~50/hr).

### Reliability & monitoring
- `/api/health` reports each hub's last successful tick and returns **503 when any hub is
  stale** (>10 min), so a free uptime monitor can alert on a stalled feed.
- Header shows the feed source and data age ("LIVE · adsb.lol · 4s ago"), amber when lagging.
- Landing stats retry after 8 s on a failed fetch instead of waiting 45 s; the landing
  mini-radar clears stale blips and says "feed reconnecting".

### UI & performance
- Landing: the WebGL backdrop loads after first paint (entry JS 893 kB → 280 kB) and runs a
  lite mode on phones / low-power devices (no bloom, 1×, 30 fps). Lighthouse: desktop
  100/100/96/100, mobile performance 61 → 93.
- Console: flight strips and the AI feed have bounded default heights (they had grown to
  ~2,800 px, burying Runway Allocation, Tower Ops and METAR); the Separation Monitor keeps
  one height instead of jumping 92↔220 px; the scorecard reserves its tracker strip.
- Accessibility 90 → 100 on the console: WCAG-AA contrast for muted text, 24 px legend
  targets, a `<main>` landmark; landing footer heading order fixed.

### Dependencies & tooling
- React 19.3, lucide-react 1.61 (local GitHub icon — brand icons were removed), three 0.186,
  Vite 8.3.5, @vitejs/plugin-react 6.1, wrangler 4.151 — 0 known vulnerabilities.
- `npm test` runs every suite; new `scripts/test-integrity.mjs` (18 checks) locks in "no
  synthetic data". Python trainer deps pinned (`scripts/requirements.txt`); Node version
  pinned via `.nvmrc` + `engines` and used by CI; setup-python v7; Dependabot groups
  react + react-dom; public source maps.

### Fixed
- **24/7 tracker starved of live data (Aug–Sep 2026).** Every cron tick was failing with
  `adsb 429`, cutting graded landings from ~1,000/day to ~40/day. Causes: airplanes.live
  closed its public API to non-feeders (403), the adsb.fi call used a non-existent
  `/v2/point` path (400), and adsb.lol rate-limits Cloudflare's shared egress IPs. The
  worker now uses adsb.fi's documented `/api/v3/lat/…/lon/…/dist/…` endpoint with adsb.lol
  failover, and logs every source's status when a tick fails.

### Changed
- **Provider terms compliance.** Removed airplanes.live everywhere (worker, browser, copy).
  Worker requests to each ADS-B host are paced ≥1.1s apart (adsb.fi allows 1 req/s), a
  429 cools that host down per `Retry-After`, and all requests — including METAR, which
  aviationweather.gov asks for — carry an identifying User-Agent. The browser console no
  longer polls from background tabs.
- **Attribution & licensing.** Data & Sources now links adsb.fi (required by its terms),
  credits adsb.lol's ODbL 1.0 license, and states that the downloadable training dataset —
  an adapted database of that data — is offered under ODbL 1.0 (code stays MIT);
  `/api/dataset.jsonl` declares this via `Link: rel="license"` and `X-Data-License`.
- **Privacy page accuracy.** It claimed there was no form on the site; the Feedex feedback
  button is one, so the page now says exactly what a report carries. It also now explains
  that traffic/weather go through Naventra's relay while route lookups go direct.
- Dependencies: `npm audit fix` (nanoid, postcss), Vite 8.3, wrangler 4.138 — 0 known
  vulnerabilities in either package.

### Added
- **Feedback widget (Feedex).** The feedback launcher is injected at build time by a
  Vite plugin (`vite/feedex.js`) — only when a `pk_fdx_…` key is configured, so local
  dev never posts to the real inbox. Reads `VITE_FEEDEX_KEY` or `NEXT_PUBLIC_FEEDEX_KEY`
  (Node/build-time, sidestepping Vite's `VITE_`-only client exposure). Appearance pinned
  on the tag to match the brand (cyan `#4cc9f0`, dark, bottom-right — clear of the landing
  hero's bottom-left scroll hint). Reports carry only non-sensitive context (route +
  version/build); no accounts, so no email is attached. Tests: `npm run test:feedex`.

## [1.0.0] — 2026-07-22

First tagged release. Naventra is a live, AI-native air-traffic-control console
that works real ADS-B traffic and grades its own predictions against reality.

### Console
- Live 3D TRACON scope (three.js) with a 2D fallback, dead-reckoned motion,
  type-accurate aircraft icons, spinning helicopter rotors, pitch attitude and
  click-to-inspect.
- Deep zoom (2/5 nm) rendering real runway ribbons, threshold designators and a
  schematic terminal/apron layer.
- Resizable & collapsible panels with draggable column and comms-footer gutters;
  layouts persist per browser.
- Aircraft search (callsign / registration / type / hex).
- Tower Ops panel (movements/hr, arrival & departure rates, busiest runway).

### AI & scoring
- Deterministic expert-system decision core: runway allocation from live wind,
  arrival sequencing, separation monitoring (CPA, 150 s lookahead), gate
  assignment and VHF phraseology.
- Self-grading scorecard: predictions (arrival runway, active config, touchdown
  ETA, landing order, departure runway) are locked before the outcome and graded
  against observation. Trailing-24 h accuracy shown alongside the all-time score.
- Online learning layer: per-airport runway priors and ETA bias, updated from
  live landings only.

### Always-on backend
- Cloudflare Worker + D1 running the same engine 24/7 on a 1-minute cron across
  JFK / LAX / LHR, banking a shared model and logging every graded operation as a
  labeled training row exported at `/api/dataset.jsonl`.
- Rotating multi-source ADS-B fallback (airplanes.live → adsb.lol → adsb.fi) so a
  single source rate-limiting the worker can't starve the model.

### Weather
- Live METAR decode driving runway allocation.
- TAF-driven Weather Outlook: projects the runway configuration and a
  disruption-risk estimate for each forecast period.

### Site
- Scroll-driven 3D marketing landing page with a live mini-radar of real traffic.
- Operator's Guide, plus About / Data & Sources / Privacy pages.
- SEO: sitemap, robots, canonical, Open Graph, JSON-LD; SPA route rewrites.

### Engineering
- Shared pure engine modules imported by both browser and worker.
- Build-time airport-data generation from the OurAirports public-domain dataset.
- CI on every push: build, worker syntax check, and a multi-airport engine
  regression suite.

[1.0.0]: https://github.com/Rian-Fernando/Naventra/releases/tag/v1.0.0

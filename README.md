# Naventra — AI Air Traffic Command

An AI-native air traffic control console that works **real, live air traffic** — and
**grades its own AI against reality**. It ingests live ADS-B transponder returns around
any of 12 major world airports, pulls the current METAR, and runs an autonomous ATC
decision core that does what a TRACON controller does — continuously, and visibly:

- **Runway configuration** — computes head/crosswind components for every runway end from
  the live METAR and selects the active configuration (arrivals, departures, crosswind advisories).
- **Arrival sequencing** — classifies every track into a flight phase (enroute → arrival →
  approach → final → ground), builds the arrival sequence by ETA, and distributes traffic
  across active parallel runways.
- **Separation monitoring** — pairwise closest-point-of-approach (CPA) prediction with a
  150-second lookahead against 3nm / 1,000ft terminal minima, with resolution advisories.
  VFR squawks, rotorcraft and slow low-level VFR are excluded, like real STCA.
- **Ground logistics** — arrivals get a real terminal + stand assignment from the airport's
  actual gate layout.
- **Radio communications** — every decision is voiced as realistic VHF phraseology
  (with airline telephony callsigns: "Speedbird", "Cathay", …) on the facility's real
  tower/ground/approach frequencies, with pilot readbacks.

## The AI Scorecard — predictions vs reality

The headline feature. When an inbound flight commits to the approach, the core's plan is
**locked** as a prediction: runway end, touchdown ETA, next-to-land order, and the
active-configuration claim. When the flight actually lands, ground truth is derived purely
from observed data (final track + centerline alignment, touchdown time) and every locked
item is graded ✓/✗. The all-time accuracy percentage — overall and per category — is shown
live, with a rolling log of every graded landing.

Kept honest: only live traffic banks into the persistent score (simulated traffic is graded
on screen but never persisted, since the AI steers its own sim); go-arounds void their
predictions; unclassifiable landings are discarded rather than guessed; conflict advisories
are not graded (a real controller resolving a predicted conflict is not a miss).

### Always-on learning (optional backend)

A companion Cloudflare Worker (`worker/`) runs the same engine **24/7 on a 1-minute cron**,
with no browser open, against JFK / LAX / LHR — grading real landings and banking the learned
model into a free **D1** database. The frontend reads the global scorecard from it, so every
visitor sees one continuously-improving number (badge: **GLOBAL · 24/7**). Set
`VITE_TRACKER_URL` to enable it; unset, the app runs fully client-side with per-browser
learning. See [`worker/README.md`](worker/README.md) for the (free) deploy steps.

## The AI — a self-improving expert system

The decision core is a deterministic, auditable rule engine (no external model, no API, no
keys — runs 100% in the browser). On top sits an **online learning layer**: every verified
live landing updates per-airport runway priors (P(runway | approach direction)) and an ETA
bias correction, both blended back into future predictions. Naventra literally gets more
accurate the longer it watches an airport, and the scorecard measures exactly how much.

## The scope — 3D and 2D

The default view is a **3D TRACON scope** (Three.js): drag to orbit, scroll to zoom. Every
aircraft sits at its (5×-exaggerated) true altitude with a stem dropped to the ground
plane, so altitude and flight paths read at a glance — plus 3D history trails, velocity
heading cones, parallel-runway geometry with extended final-approach centerlines, a
rotating sweep, and raycast click-to-inspect. The 2D toggle gives the classic top-down
phosphor scope with data blocks and range rings. Positions are dead-reckoned between
polls, so motion is continuous at 60fps in both views.

A built-in **Operator's Guide** (`#/guide`) explains every panel, the scoring methodology
and all the ATC terminology for visitors who've never watched a scope before.

## Data sources (all free, no API keys)

| Feed | Source | Notes |
|---|---|---|
| Live traffic (primary) | [airplanes.live](https://airplanes.live) | CORS-open, includes airframe type + operator |
| Live traffic (fallback) | [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi) | via dev/deploy proxy rewrites |
| Weather | [aviationweather.gov](https://aviationweather.gov) METAR API | real METARs, all ICAO stations |
| Weather (fallback) | api.weather.gov latest observation | US stations, CORS-open |

If every live source is unreachable (or you press the **LIVE OPS** button to force SIM),
a physics-based simulation takes over, seeded with the selected airport's real runway
geometry, carrier mix and current weather: arrivals intercept the localizer and ride a 3°
glideslope to touchdown, departures roll and climb out on the active runway. The engine,
panels and comms run identically in both modes.

## Airports

JFK · LAX · ATL · ORD · SFO · SEA · LHR · CDG · FRA · HND · HKG · DXB — each with real
runway lengths/headings, ILS coverage, tower/ground/approach/ATIS frequencies, field
elevation, terminals and gates.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies the non-CORS APIs (see `vite.config.js`). For deployment the
same rewrites are preconfigured for **Vercel** (`vercel.json`) and **Netlify**
(`netlify.toml`) — `npm run build` and deploy the repo as-is.

## Architecture

```
src/
  data/airports.js       airport spec database (runways, freqs, gates, carriers)
  lib/geo.js             geodesy + CPA math (haversine, dead reckoning, wind components)
  lib/adsb.js            live ADS-B ingestion with multi-source failover
  lib/weather.js         METAR fetch + decode, ATIS letter
  lib/sim.js             physics-based traffic simulation fallback
  engine/atc.js          decision core: allocation, phases, sequencing, CPA, comms
  engine/predictions.js  scorecard: prediction locking, ground-truth grading, persistence
  hooks/useAtcSystem.js  orchestration: polling, failover, engine ticks, event diffing
  components/            Radar3D (three.js) + RadarScope (2D canvas) + console panels
  pages/Guide.jsx        operator's guide: screen map, scoring methodology, glossary
```

No backend — the entire system, including the decision engine, runs client-side.

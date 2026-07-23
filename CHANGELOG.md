# Changelog

All notable changes to Naventra are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

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

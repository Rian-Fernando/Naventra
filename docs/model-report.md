# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,200** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,800 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,803 | 4 | 93.8% | 61.2% | 79.5% | — |
| KJFK | 3,597 | 8 | 82.2% | 72.1% | 85.3% | — |
| KLAX | 4,800 | 4 | 91.2% | 84.5% | 85.2% | — |

**Pooled time-split:** engine 89.4% vs model 73.6% over 3,051 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 515 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,798 | 322s | 161s | 45.1% | 61.2% | ✅ |
| KJFK | 3,587 | 258s | 150s | 42.4% | 66.8% | ✅ |
| KLAX | 4,794 | 165s | 118s | 71.9% | 77.4% | ✅ |

**Pooled ETA within ±2.5 min:** engine 54.8% → corrected 69.2% (+14.4 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

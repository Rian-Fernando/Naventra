# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,157** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,843 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,805 | 4 | 97.8% | 90.9% | 79.1% | — |
| KJFK | 3,661 | 8 | 80.1% | 41.6% | 84.0% | — |
| KLAX | 4,691 | 4 | 92.6% | 80.9% | 83.3% | — |

**Pooled time-split:** engine 90.5% vs model 72.2% over 3,041 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 604 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,800 | 182s | 132s | 57.2% | 68.4% | ✅ |
| KJFK | 3,635 | 283s | 179s | 42.2% | 59.8% | ✅ |
| KLAX | 4,672 | 216s | 162s | 54.9% | 64.6% | ✅ |

**Pooled ETA within ±2.5 min:** engine 51.8% → corrected 64.4% (+12.6 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

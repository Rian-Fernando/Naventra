# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,659** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,341 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 4,246 | 4 | 93.9% | 39.9% | 61.5% | — |
| KJFK | 3,718 | 8 | 88.9% | 70.2% | 86.8% | — |
| KLAX | 4,695 | 7 | 92.1% | 81.3% | 78.4% | — |

**Pooled time-split:** engine 91.8% vs model 64.2% over 3,166 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 538 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 4,241 | 230s | 124s | 53.3% | 72.2% | ✅ |
| KJFK | 3,714 | 266s | 134s | 45.6% | 70.2% | ✅ |
| KLAX | 4,685 | 153s | 112s | 68.7% | 77.8% | ✅ |

**Pooled ETA within ±2.5 min:** engine 56.7% → corrected 73.7% (+17.0 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,432** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,568 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,883 | 4 | 88.6% | 70.8% | 71.6% | — |
| KJFK | 3,738 | 8 | 88.1% | 73.6% | 83.7% | — |
| KLAX | 4,811 | 5 | 88.8% | 81.7% | 85.0% | — |

**Pooled time-split:** engine 88.5% vs model 75.8% over 3,109 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 518 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,879 | 197s | 106s | 64.7% | 80.3% | ✅ |
| KJFK | 3,733 | 247s | 111s | 44.8% | 75.7% | ✅ |
| KLAX | 4,804 | 102s | 71s | 88.3% | 92.3% | ✅ |

**Pooled ETA within ±2.5 min:** engine 67.8% → corrected 83.5% (+15.7 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

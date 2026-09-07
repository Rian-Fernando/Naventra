# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,314** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,686 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,935 | 4 | 97.5% | 75.9% | 75.5% | — |
| KJFK | 3,724 | 8 | 84.6% | 86.5% | 85.7% | — |
| KLAX | 4,655 | 4 | 92.3% | 83.2% | 86.2% | — |

**Pooled time-split:** engine 91.6% vs model 81.9% over 3,079 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 757 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,928 | 174s | 153s | 62.6% | 59.9% | — |
| KJFK | 3,684 | 304s | 214s | 43.9% | 47.8% | ✅ |
| KLAX | 4,621 | 205s | 188s | 61.2% | 54.0% | — |

**Pooled ETA within ±2.5 min:** engine 56.4% → corrected 54.0% (-2.4 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** KJFK. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

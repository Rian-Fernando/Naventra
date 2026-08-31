# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,332** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,668 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,963 | 4 | 97.5% | 77.8% | 78.1% | — |
| KJFK | 3,705 | 8 | 83.7% | 84.6% | 83.3% | — |
| KLAX | 4,664 | 4 | 92.4% | 82.8% | 84.8% | — |

**Pooled time-split:** engine 91.4% vs model 81.7% over 3,084 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 695 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,957 | 172s | 144s | 62.0% | 63.7% | — |
| KJFK | 3,673 | 305s | 203s | 43.0% | 50.8% | ✅ |
| KLAX | 4,638 | 209s | 177s | 58.9% | 58.6% | — |

**Pooled ETA within ±2.5 min:** engine 55.1% → corrected 57.9% (+2.8 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** KJFK. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

# Model training report

Dataset: **20,000** rows from the always-on tracker; **12,466** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,534 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,961 | 4 | 95.7% | 63.4% | 72.7% | — |
| KJFK | 3,807 | 8 | 85.7% | 81.5% | 82.5% | — |
| KLAX | 4,698 | 7 | 92.8% | 89.3% | 83.7% | — |

**Pooled time-split:** engine 91.5% vs model 78.7% over 3,118 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** none — the expert engine wins everywhere else.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 920 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,933 | 167s | 154s | 68.4% | 60.5% | — |
| KJFK | 3,733 | 263s | 224s | 56.6% | 45.0% | — |
| KLAX | 4,633 | 175s | 198s | 72.3% | 48.1% | — |

**Pooled ETA within ±2.5 min:** engine 66.3% → corrected 51.1% (-15.2 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** none. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

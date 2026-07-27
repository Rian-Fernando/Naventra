# Model training report

Dataset: **18,486** rows from the always-on tracker; **11,374** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 7,112 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,841 | 4 | 90.5% | 68.5% | 81.9% | — |
| KJFK | 3,075 | 8 | 67.0% | 80.9% | 90.0% | ✅ |
| KLAX | 4,458 | 6 | 88.3% | 39.0% | 60.0% | — |

**Pooled time-split:** engine 83.3% vs model 60.3% over 2,845 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** KJFK.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 486 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 3,837 | 117s | 76s | 81.6% | 87.6% | ✅ |
| KJFK | 3,071 | 219s | 105s | 44.7% | 80.2% | ✅ |
| KLAX | 4,454 | 84s | 65s | 91.2% | 93.7% | ✅ |

**Pooled ETA within ±2.5 min:** engine 75.4% → corrected 88.0% (+12.6 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

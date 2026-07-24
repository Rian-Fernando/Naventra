# Model training report

Dataset: **13,900** rows from the always-on tracker; **8,236** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 5,664 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 2,647 | 4 | 91.5% | 14.2% | 85.5% | — |
| KJFK | 2,260 | 8 | 57.3% | 86.2% | 90.4% | ✅ |
| KLAX | 3,329 | 5 | 86.9% | 4.8% | 61.1% | — |

**Pooled time-split:** engine 80.3% vs model 30.1% over 2,060 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** KJFK.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and subtracts it. MAE = mean absolute error; ok% = within ±2.5 min (the scorecard window). 382 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | engine MAE | corrected MAE | engine ok% | corrected ok% | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 2,646 | 183s | 102s | 65.3% | 81.0% | ✅ |
| KJFK | 2,257 | 138s | 81s | 62.7% | 88.7% | ✅ |
| KLAX | 3,326 | 81s | 51s | 93.1% | 97.7% | ✅ |

**Pooled ETA within ±2.5 min:** engine 75.8% → corrected 89.8% (+14.0 pts).

**Adopt (corrected ok% beats engine by ≥2 pts):** EGLL, KJFK, KLAX. The dominant correction is the per-airport bias — flights land late — and the features add a light adjustment.

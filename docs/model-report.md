# Model training report

Generated 2026-11-09T17:41:39Z from the always-on tracker's full history: **118,343** graded landings over **116 days** (2026-07 → 2026-11, 6 pages). **70,344** passed the runway-model checks and **114,834** the ETA-model checks.

Seasons in the data: summer 2026 (54,670), autumn 2026 (63,673). Day-of-year features stay **off** until the data spans 330 days (about June 2027): a seasonal pattern learned from part of a year would be a guess. Until then the model adapts through recency weighting and the weather inputs that drive seasonal change.

### Data quality — rows rejected (never learned from)
| reason | runway model | ETA model |
|---|--:|--:|
| no_runway | 47,997 | 0 |
| eta_outlier | 0 | 3,476 |
| agl_negative | 1 | 17 |
| groundspeed | 1 | 15 |
| altitude | 0 | 1 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

Every comparison below is on the **most recent 21 days**, trained only on what came before — so it measures the season we're in now. The recency half-life is picked on a separate validation slice of the training data, never on the test window. A model is adopted only if its win is also significant on those same rows (paired z ≥ 1.64, counting only the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.

## Runway model

| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 22,702 | 4 | none | 93.0% | 70.5% | 72.3% | -32.7 | — |
| KJFK | 20,321 | 8 | none | 83.2% | 81.3% | 80.5% | -3.1 | — |
| KLAX | 27,321 | 8 | 14 d | 87.7% | 82.3% | 76.4% | -9.7 | — |

**Pooled, last 21 days:** engine 88.1% vs model 78.2% over 17,588 test rows.

**Adopt (model beats engine by ≥3.0 pts on the recent window, paired z ≥ 1.64):** none — the expert engine wins everywhere.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and adds it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard actually graded at the time; *online* = the tracker's online bias as it runs now (each error clipped to ±120 s, α 0.1), replayed over the same landings — the baseline a model must beat; *model* = raw + this correction (fitted on the same clipped errors). ok% = within ±2.5 min, the scorecard window. Landings whose runway couldn't be classified still have a valid touchdown time, so they train the ETA model too. 3,476 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 27,778 | none | 295s | 231s | 52.1% | 52.7% | 51.6% | 53.6% | +10.7 | — |
| KJFK | 38,865 | none | 308s | 228s | 37.5% | 38.4% | 37.4% | 40.4% | +12.9 | ✅ |
| KLAX | 48,191 | none | 236s | 213s | 62.6% | 61.1% | 61.0% | 62.5% | +9.2 | — |

**Pooled ETA within ±2.5 min, last 21 days:** raw 51.6% · online bias 50.7% · model 52.8% (+2.1 pts vs the online bias).

**Adopt (model beats the online bias by ≥2 pts, paired z ≥ 1.64):** KJFK.

## Seasonal trends

Month by month, per airport (UTC months): live engine runway accuracy, live ETA hits within ±2.5 min, median ETA error (positive = flights land later than the straight-line ETA), IFR share, mean surface wind, and the arrival runway used most. This is what the retrain watches as the seasons turn: wind patterns move the runway configuration, and weather and traffic move the ETA bias.

### EGLL

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 7,125 | 89.8% | 53.5% | 80 s | 0.0% | 7.8 kt | 27L (37%) |
| 2026-08 | 6,597 | 92.7% | 66.4% | 105 s | 0.2% | 8.4 kt | 27L (38%) |
| 2026-09 | 365 | 95.1% | 52.6% | 31 s | 1.1% | 10.8 kt | 27L (51%) |
| 2026-10 | 7,131 | 93.0% | 70.9% | 76 s | 10.9% | 10.3 kt | 27L (38%) |
| 2026-11 | 6,825 | 93.1% | 53.0% | 96 s | 21.8% | 6.2 kt | 09L (68%) |

### KJFK

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 8,654 | 64.9% | 61.1% | 160 s | 4.9% | 8.8 kt | 22L (51%) |
| 2026-08 | 9,304 | 85.7% | 63.3% | 250 s | 3.8% | 7.8 kt | 22L (68%) |
| 2026-09 | 409 | 87.8% | 41.1% | 145 s | 4.9% | 9.7 kt | 04R (46%) |
| 2026-10 | 11,010 | 73.2% | 61.0% | 137 s | 0.1% | 7.8 kt | 31R (47%) |
| 2026-11 | 10,052 | 83.7% | 39.8% | 237 s | 4.2% | 9.8 kt | 22L (61%) |

Last 30 days vs the 30 before: runway accuracy 80.4% → 78.2%; ETA hits 35.7% → 50.9%; median ETA error 49 s → 154 s. **Shift flagged in ETA hit rate, ETA bias** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KLAX

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 11,909 | 75.3% | 54.7% | 54 s | 2.8% | 8.5 kt | 25L (39%) |
| 2026-08 | 11,081 | 90.9% | 64.2% | 77 s | 3.7% | 8.7 kt | 25L (51%) |
| 2026-09 | 538 | 92.4% | 20.7% | 72 s | 1.1% | 8.7 kt | 25L (51%) |
| 2026-10 | 14,178 | 89.6% | 61.1% | 55 s | 0.0% | 7.1 kt | 25L (50%) |
| 2026-11 | 13,165 | 87.8% | 62.0% | 54 s | 0.0% | 7.5 kt | 25L (51%) |

Last 30 days vs the 30 before: runway accuracy 90.9% → 88.7%; ETA hits 16.2% → 61.6%; median ETA error 42 s → 55 s. **Shift flagged in ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

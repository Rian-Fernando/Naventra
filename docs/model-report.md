# Model training report

Generated 2026-11-23T19:22:48Z from the always-on tracker's full history: **145,350** graded landings over **130 days** (2026-07 → 2026-11, 8 pages). **86,465** passed the runway-model checks and **86,358** the ETA-model checks. **58,785** rows have no touchdown confirmed at the airport — mostly landings at a neighbouring airport (Newark, LaGuardia, Teterboro…) that the tracker counted as its own until Nov 2026; they are not learned from.

Seasons in the data: summer 2026 (54,670), autumn 2026 (90,680). Day-of-year features stay **off** until the data spans 330 days (about June 2027): a seasonal pattern learned from part of a year would be a guess. Until then the model adapts through recency weighting and the weather inputs that drive seasonal change.

### Data quality — rows rejected (never learned from)
| reason | runway model | ETA model |
|---|--:|--:|
| no_runway | 58,883 | 0 |
| landed_elsewhere | 0 | 58,750 |
| eta_outlier | 0 | 205 |
| agl_negative | 1 | 19 |
| groundspeed | 1 | 17 |
| altitude | 0 | 1 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

Every comparison below is on the **most recent 21 days**, trained only on what came before — so it measures the season we're in now. The recency half-life is picked on a separate validation slice of the training data, never on the test window. A model is adopted only if its win is also significant on those same rows (paired z ≥ 1.64, counting only the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.

## Runway model

| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 26,577 | 4 | none | 92.7% | 63.1% | 73.2% | -40.9 | — |
| KJFK | 27,801 | 8 | none | 78.5% | 68.0% | 78.2% | -15.1 | — |
| KLAX | 32,087 | 8 | 14 d | 86.7% | 79.4% | 76.4% | -13.2 | — |

**Pooled, last 21 days:** engine 85.9% vs model 70.7% over 21,618 test rows.

**Adopt (model beats engine by ≥3.0 pts on the recent window, paired z ≥ 1.64):** none — the expert engine wins everywhere.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and adds it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard actually graded at the time; *online* = the tracker's online bias as it runs now (each error clipped to ±120 s, α 0.1), replayed over the same landings — the baseline a model must beat; *model* = raw + this correction (fitted on the same clipped errors). ok% = within ±2.5 min, the scorecard window. Only touchdowns confirmed at the airport itself train it — a Newark landing's timing says nothing about JFK's. 205 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 26,542 | none | 180s | 126s | 71.5% | 73.3% | 73.1% | 73.5% | +4.7 | — |
| KJFK | 27,809 | none | 99s | 73s | 81.1% | 89.0% | 88.3% | 90.4% | +11.5 | ✅ |
| KLAX | 32,007 | none | 92s | 52s | 90.5% | 90.7% | 90.8% | 90.8% | -0.3 | — |

**Pooled ETA within ±2.5 min, last 21 days:** raw 81.6% · online bias 84.6% · model 85.4% (+0.8 pts vs the online bias).

**Adopt (model beats the online bias by ≥2 pts, paired z ≥ 1.64):** KJFK.

## Seasonal trends

Month by month, per airport (UTC months): live engine runway accuracy, live ETA hits within ±2.5 min, median ETA error (positive = flights land later than the straight-line ETA), IFR share, mean surface wind, and the arrival runway used most. This is what the retrain watches as the seasons turn: wind patterns move the runway configuration, and weather and traffic move the ETA bias.

### EGLL

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 5,612 | 89.8% | 60.4% | 89 s | 0.0% | 7.9 kt | 27L (37%) |
| 2026-08 | 5,542 | 92.7% | 71.1% | 111 s | 0.2% | 8.4 kt | 27L (38%) |
| 2026-09 | 326 | 95.1% | 54.3% | 28 s | 1.2% | 10.8 kt | 27L (51%) |
| 2026-10 | 5,765 | 93.0% | 73.7% | 79 s | 12.5% | 10.8 kt | 27L (38%) |
| 2026-11 | 9,334 | 93.4% | 65.3% | 82 s | 18.9% | 5.9 kt | 09L (57%) |

Last 30 days vs the 30 before: runway accuracy 95.0% → 93.0%; ETA hits 83.6% → 66.9%; median ETA error 69 s → 83 s. **Shift flagged in ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KJFK

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 4,811 | 64.9% | 72.1% | 140 s | 5.8% | 8.7 kt | 22L (51%) |
| 2026-08 | 5,086 | 85.7% | 69.7% | 211 s | 4.2% | 7.8 kt | 22L (68%) |
| 2026-09 | 263 | 87.8% | 39.6% | 86 s | 4.9% | 9.8 kt | 04R (46%) |
| 2026-10 | 5,354 | 73.2% | 84.2% | 105 s | 0.1% | 7.7 kt | 31R (47%) |
| 2026-11 | 12,385 | 80.7% | 77.6% | 91 s | 3.7% | 9.3 kt | 31R (36%) |

Last 30 days vs the 30 before: runway accuracy 81.6% → 78.2%; ETA hits 79.5% → 79.5%; median ETA error 82 s → 98 s. No significant shift.

### KLAX

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 6,590 | 75.3% | 74.9% | 55 s | 3.6% | 7.7 kt | 25L (39%) |
| 2026-08 | 6,294 | 90.9% | 81.7% | 72 s | 5.1% | 8.3 kt | 25L (51%) |
| 2026-09 | 301 | 92.4% | 22.4% | 40 s | 2.0% | 8.2 kt | 25L (51%) |
| 2026-10 | 7,329 | 89.6% | 88.6% | 58 s | 0.0% | 6.9 kt | 25L (50%) |
| 2026-11 | 11,573 | 87.2% | 90.9% | 59 s | 0.2% | 6.6 kt | 25L (51%) |

Last 30 days vs the 30 before: runway accuracy 92.5% → 87.7%; ETA hits 77.4% → 91.2%; median ETA error 60 s → 59 s. **Shift flagged in ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

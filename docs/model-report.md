# Model training report

Generated 2026-10-22T23:34:23Z from the always-on tracker's full history: **57,806** graded landings over **98 days** (2026-07 → 2026-10, 3 pages). **35,893** passed the runway-model checks and **55,875** the ETA-model checks.

Seasons in the data: summer 2026 (54,670), autumn 2026 (3,136). Day-of-year features stay **off** until the data spans 330 days (about June 2027): a seasonal pattern learned from part of a year would be a guess. Until then the model adapts through recency weighting and the weather inputs that drive seasonal change.

### Data quality — rows rejected (never learned from)
| reason | runway model | ETA model |
|---|--:|--:|
| no_runway | 21,913 | 0 |
| eta_outlier | 0 | 1,923 |
| groundspeed | 0 | 5 |
| agl_negative | 0 | 2 |
| altitude | 0 | 1 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

Every comparison below is on the **most recent 21 days**, trained only on what came before — so it measures the season we're in now. The recency half-life is picked on a separate validation slice of the training data, never on the test window. A model is adopted only if its win is also significant on those same rows (paired z ≥ 1.64, counting only the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.

## Runway model

| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 11,703 | 4 | 14 d | 92.8% | 49.8% | 73.3% | -9.4 | — |
| KJFK | 10,565 | 8 | none | 85.4% | 70.2% | 87.8% | -6.4 | — |
| KLAX | 13,625 | 8 | 14 d | 94.3% | 93.0% | 75.7% | -0.9 | — |

**Pooled, last 21 days:** engine 90.6% vs model 75.4% over 1,064 test rows.

**Adopt (model beats engine by ≥3.0 pts on the recent window, paired z ≥ 1.64):** none — the expert engine wins everywhere.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and adds it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard actually graded at the time; *online* = the tracker's online bias as it runs now (each error clipped to ±120 s, α 0.1), replayed over the same landings — the baseline a model must beat; *model* = raw + this correction (fitted on the same clipped errors). ok% = within ±2.5 min, the scorecard window. Landings whose runway couldn't be classified still have a valid touchdown time, so they train the ETA model too. 1,923 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 14,169 | none | 165s | 145s | 73.7% | 41.1% | 75.8% | 78.0% | +1.9 | ✅ |
| KJFK | 18,794 | none | 240s | 191s | 55.5% | 54.8% | 69.0% | 66.7% | -2.5 | — |
| KLAX | 22,912 | none | 268s | 250s | 61.0% | 32.7% | 60.2% | 60.3% | +0.2 | — |

**Pooled ETA within ±2.5 min, last 21 days:** raw 60.5% · online bias 66.0% · model 65.4% (-0.6 pts vs the online bias).

**Adopt (model beats the online bias by ≥2 pts, paired z ≥ 1.64):** EGLL.

## Seasonal trends

Month by month, per airport (UTC months): live engine runway accuracy, live ETA hits within ±2.5 min, median ETA error (positive = flights land later than the straight-line ETA), IFR share, mean surface wind, and the arrival runway used most. This is what the retrain watches as the seasons turn: wind patterns move the runway configuration, and weather and traffic move the ETA bias.

### EGLL

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 7,125 | 89.8% | 53.5% | 80 s | 0.0% | 7.8 kt | 27L (37%) |
| 2026-08 | 6,597 | 92.7% | 66.4% | 105 s | 0.2% | 8.4 kt | 27L (38%) |
| 2026-09 | 365 | 95.1% | 52.6% | 31 s | 1.1% | 10.8 kt | 27L (51%) |
| 2026-10 | 252 | 92.4% | 40.8% | 43 s | 1.2% | 11.1 kt | 27L (47%) |

Last 30 days vs the 30 before: runway accuracy 96.8% → 91.7%; ETA hits 60.1% → 36.6%; median ETA error 44 s → 40 s. **Shift flagged in runway accuracy, ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KJFK

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 8,654 | 64.9% | 61.1% | 160 s | 4.9% | 8.8 kt | 22L (51%) |
| 2026-08 | 9,304 | 85.7% | 63.3% | 250 s | 3.8% | 7.8 kt | 22L (68%) |
| 2026-09 | 409 | 87.8% | 41.1% | 145 s | 4.9% | 9.7 kt | 04R (46%) |
| 2026-10 | 745 | 84.9% | 54.6% | 123 s | 1.2% | 9.5 kt | 04R (47%) |

Last 30 days vs the 30 before: runway accuracy 86.4% → 84.8%; ETA hits 43.5% → 54.3%; median ETA error 268 s → 123 s. **Shift flagged in ETA hit rate, ETA bias** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KLAX

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 11,909 | 75.3% | 54.7% | 54 s | 2.8% | 8.5 kt | 25L (39%) |
| 2026-08 | 11,081 | 90.9% | 64.2% | 77 s | 3.7% | 8.7 kt | 25L (51%) |
| 2026-09 | 538 | 92.4% | 20.7% | 72 s | 1.1% | 8.7 kt | 25L (51%) |
| 2026-10 | 827 | 94.3% | 32.7% | 59 s | 0.0% | 9.1 kt | 25L (51%) |

Last 30 days vs the 30 before: runway accuracy 92.8% → 94.2%; ETA hits 32.7% → 31.0%; median ETA error 96 s → 60 s. No significant shift.

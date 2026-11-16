# Model training report

Generated 2026-11-16T17:12:19Z from the always-on tracker's full history: **138,947** graded landings over **123 days** (2026-07 → 2026-11, 7 pages). **82,400** passed the runway-model checks and **134,918** the ETA-model checks.

Seasons in the data: summer 2026 (54,670), autumn 2026 (84,277). Day-of-year features stay **off** until the data spans 330 days (about June 2027): a seasonal pattern learned from part of a year would be a guess. Until then the model adapts through recency weighting and the weather inputs that drive seasonal change.

### Data quality — rows rejected (never learned from)
| reason | runway model | ETA model |
|---|--:|--:|
| no_runway | 56,545 | 0 |
| eta_outlier | 0 | 3,992 |
| agl_negative | 1 | 19 |
| groundspeed | 1 | 17 |
| altitude | 0 | 1 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

Every comparison below is on the **most recent 21 days**, trained only on what came before — so it measures the season we're in now. The recency half-life is picked on a separate validation slice of the training data, never on the test window. A model is adopted only if its win is also significant on those same rows (paired z ≥ 1.64, counting only the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.

## Runway model

| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 26,577 | 4 | none | 92.7% | 63.1% | 73.2% | -40.9 | — |
| KJFK | 23,736 | 8 | none | 81.4% | 77.2% | 79.6% | -6.3 | — |
| KLAX | 32,087 | 8 | 14 d | 86.7% | 79.4% | 76.4% | -13.2 | — |

**Pooled, last 21 days:** engine 87.1% vs model 73.5% over 20,601 test rows.

**Adopt (model beats engine by ≥3.0 pts on the recent window, paired z ≥ 1.64):** none — the expert engine wins everywhere.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and adds it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard actually graded at the time; *online* = the tracker's online bias as it runs now (each error clipped to ±120 s, α 0.1), replayed over the same landings — the baseline a model must beat; *model* = raw + this correction (fitted on the same clipped errors). ok% = within ±2.5 min, the scorecard window. Landings whose runway couldn't be classified still have a valid touchdown time, so they train the ETA model too. 3,992 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 32,229 | none | 188s | 140s | 70.6% | 72.3% | 71.6% | 72.8% | +8.2 | — |
| KJFK | 45,576 | none | 236s | 163s | 50.7% | 61.4% | 60.9% | 63.4% | +12.4 | ✅ |
| KLAX | 57,113 | none | 237s | 214s | 61.9% | 60.8% | 60.7% | 62.0% | +8.9 | — |

**Pooled ETA within ±2.5 min, last 21 days:** raw 60.2% · online bias 63.4% · model 65.0% (+1.7 pts vs the online bias).

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
| 2026-11 | 11,300 | 93.4% | 65.6% | 77 s | 16.8% | 6.1 kt | 09L (57%) |

### KJFK

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 8,654 | 64.9% | 61.1% | 160 s | 4.9% | 8.8 kt | 22L (51%) |
| 2026-08 | 9,304 | 85.7% | 63.3% | 250 s | 3.8% | 7.8 kt | 22L (68%) |
| 2026-09 | 409 | 87.8% | 41.1% | 145 s | 4.9% | 9.7 kt | 04R (46%) |
| 2026-10 | 11,010 | 73.2% | 61.0% | 137 s | 0.1% | 7.8 kt | 31R (47%) |
| 2026-11 | 16,809 | 81.8% | 51.4% | 157 s | 3.9% | 10.7 kt | 22L (46%) |

Last 30 days vs the 30 before: runway accuracy 81.9% → 78.4%; ETA hits 40.1% → 55.3%; median ETA error 63 s → 149 s. **Shift flagged in ETA hit rate, ETA bias** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KLAX

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 11,909 | 75.3% | 54.7% | 54 s | 2.8% | 8.5 kt | 25L (39%) |
| 2026-08 | 11,081 | 90.9% | 64.2% | 77 s | 3.7% | 8.7 kt | 25L (51%) |
| 2026-09 | 538 | 92.4% | 20.7% | 72 s | 1.1% | 8.7 kt | 25L (51%) |
| 2026-10 | 14,178 | 89.6% | 61.1% | 55 s | 0.0% | 7.1 kt | 25L (50%) |
| 2026-11 | 22,537 | 87.2% | 61.4% | 55 s | 0.1% | 7.0 kt | 25L (51%) |

Last 30 days vs the 30 before: runway accuracy 92.5% → 88.1%; ETA hits 18.3% → 61.4%; median ETA error 52 s → 55 s. **Shift flagged in ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

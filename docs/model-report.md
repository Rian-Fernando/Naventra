# Model training report

Generated 2026-11-02T17:16:52Z from the always-on tracker's full history: **93,158** graded landings over **109 days** (2026-07 → 2026-11, 5 pages). **56,476** passed the runway-model checks and **90,318** the ETA-model checks.

Seasons in the data: summer 2026 (54,670), autumn 2026 (38,488). Day-of-year features stay **off** until the data spans 330 days (about June 2027): a seasonal pattern learned from part of a year would be a guess. Until then the model adapts through recency weighting and the weather inputs that drive seasonal change.

### Data quality — rows rejected (never learned from)
| reason | runway model | ETA model |
|---|--:|--:|
| no_runway | 36,681 | 0 |
| eta_outlier | 0 | 2,816 |
| groundspeed | 0 | 12 |
| agl_negative | 1 | 11 |
| altitude | 0 | 1 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

Every comparison below is on the **most recent 21 days**, trained only on what came before — so it measures the season we're in now. The recency half-life is picked on a separate validation slice of the training data, never on the test window. A model is adopted only if its win is also significant on those same rows (paired z ≥ 1.64, counting only the landings where exactly one of the two was right) — a lucky few weeks can't switch it on.

## Runway model

| Airport | clean rows | runways | half-life | engine (recent) | model (recent) | model (random) | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 18,338 | 4 | 14 d | 93.4% | 69.9% | 71.2% | -35.7 | — |
| KJFK | 16,384 | 8 | none | 74.1% | 61.0% | 79.1% | -16.3 | — |
| KLAX | 21,754 | 8 | 14 d | 89.4% | 86.2% | 74.6% | -7.1 | — |

**Pooled, last 21 days:** engine 86.3% vs model 73.8% over 21,492 test rows.

**Adopt (model beats engine by ≥3.0 pts on the recent window, paired z ≥ 1.64):** none — the expert engine wins everywhere.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

## Touchdown ETA model

The engine's straight-line ETA is systematically early (flights hold, get vectored, fly into headwind). This learns the ETA error in seconds from lock-time features and adds it. *raw* = the straight-line ETA with no correction; *graded* = what the scorecard actually graded at the time; *online* = the tracker's online bias as it runs now (each error clipped to ±120 s, α 0.1), replayed over the same landings — the baseline a model must beat; *model* = raw + this correction (fitted on the same clipped errors). ok% = within ±2.5 min, the scorecard window. Landings whose runway couldn't be classified still have a valid touchdown time, so they train the ETA model too. 2,816 rows with |error| > 30 min (go-arounds / diversions / stale locks) were excluded as bad ETA labels.

| Airport | rows | half-life | raw MAE | model MAE | raw ok% | graded ok% | online ok% | model ok% | z | adopt |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|
| EGLL | 22,350 | none | 215s | 163s | 65.2% | 67.4% | 67.0% | 69.0% | +10.2 | — |
| KJFK | 30,610 | none | 240s | 169s | 52.3% | 59.4% | 59.5% | 62.0% | +10.7 | ✅ |
| KLAX | 37,358 | none | 216s | 192s | 66.1% | 65.2% | 65.2% | 66.0% | +4.9 | — |

**Pooled ETA within ±2.5 min, last 21 days:** raw 61.7% · online bias 64.1% · model 65.8% (+1.7 pts vs the online bias).

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
| 2026-11 | 1,361 | 95.3% | 47.8% | 109 s | 17.0% | 6.4 kt | 09L (93%) |

Last 30 days vs the 30 before: runway accuracy 93.4% → 93.4%; ETA hits 47.3% → 67.2%; median ETA error 17 s → 78 s. **Shift flagged in ETA hit rate, ETA bias** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KJFK

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 8,654 | 64.9% | 61.1% | 160 s | 4.9% | 8.8 kt | 22L (51%) |
| 2026-08 | 9,304 | 85.7% | 63.3% | 250 s | 3.8% | 7.8 kt | 22L (68%) |
| 2026-09 | 409 | 87.8% | 41.1% | 145 s | 4.9% | 9.7 kt | 04R (46%) |
| 2026-10 | 11,010 | 73.2% | 61.0% | 137 s | 0.1% | 7.8 kt | 31R (47%) |
| 2026-11 | 1,746 | 80.0% | 44.8% | 172 s | 0.0% | 6.4 kt | 22L (53%) |

Last 30 days vs the 30 before: runway accuracy 86.1% → 74.2%; ETA hits 40.9% → 58.8%; median ETA error 92 s → 139 s. **Shift flagged in runway accuracy, ETA hit rate, ETA bias** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

### KLAX

| month | landings | runway acc | ETA ±2.5 min | median ETA error | IFR | wind | top arrival runway |
|---|--:|--:|--:|--:|--:|--:|---|
| 2026-07 | 11,909 | 75.3% | 54.7% | 54 s | 2.8% | 8.5 kt | 25L (39%) |
| 2026-08 | 11,081 | 90.9% | 64.2% | 77 s | 3.7% | 8.7 kt | 25L (51%) |
| 2026-09 | 538 | 92.4% | 20.7% | 72 s | 1.1% | 8.7 kt | 25L (51%) |
| 2026-10 | 14,178 | 89.6% | 61.1% | 55 s | 0.0% | 7.1 kt | 25L (50%) |
| 2026-11 | 1,750 | 87.8% | 75.2% | 59 s | 0.2% | 10.2 kt | 25L (52%) |

Last 30 days vs the 30 before: runway accuracy 92.4% → 89.4%; ETA hits 20.6% → 62.7%; median ETA error 73 s → 56 s. **Shift flagged in ETA hit rate** — the recency weighting and the recent-window adoption test are what keep the model honest through it.

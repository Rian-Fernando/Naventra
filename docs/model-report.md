# Model training report

Dataset: **13,641** rows from the always-on tracker; **8,096** passed validation and were used.

### Data quality — rows rejected (never learned from)
| reason | rows |
|---|--:|
| no_runway | 5,545 |

Weather & traffic in the model: wind direction (with a VRB/calm flag), wind speed, head/crosswind, gusts, visibility, ceiling (with a no-ceiling flag), flight category, temperature, arrival rate and inbound/sector traffic density. Conflicts are a real-time safety monitor, not a determinant of runway choice, so they are not a feature — the congestion that drives them is captured by the traffic-density inputs.

| Airport | clean rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 2,647 | 4 | 91.5% | 14.2% | 85.5% | — |
| KJFK | 2,194 | 8 | 61.0% | 67.8% | 90.7% | ✅ |
| KLAX | 3,255 | 5 | 86.5% | 4.4% | 58.6% | — |

**Pooled time-split:** engine 81.2% vs model 24.8% over 2,025 recent test rows.

**Adopt (model beats engine by ≥3.0 pts on the time-split):** KJFK.

The engine reads which runways live traffic is actually using (observed-config inference), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. Regenerated weekly as data grows.

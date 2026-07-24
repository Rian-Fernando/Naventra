# Model training report

Dataset: **13,641** labeled rows from the always-on tracker.

| Airport | rows | runways | engine (time) | model (time) | model (random) | adopt |
|---|--:|--:|--:|--:|--:|:--:|
| EGLL | 2,647 | 4 | 91.5% | 12.5% | 82.3% | — |
| KJFK | 2,194 | 8 | 61.0% | 66.3% | 87.8% | ✅ |
| KLAX | 3,255 | 5 | 86.5% | 16.6% | 54.2% | — |

**Pooled time-split:** engine 81.2% vs model 28.7% over 2,025 recent test rows.

**Adopt (model beats engine by ≥3.0 pts, time-split):** KJFK.

The engine leans on observed-config inference (it reads which runways live traffic is actually using), which is near-unbeatable for absolute runway choice; the model only adds signal at complex multi-runway fields. This report is regenerated weekly as data grows.

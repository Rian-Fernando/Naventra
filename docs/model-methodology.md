# Modeling methodology — data, seasonality & safeguards

This documents *why* the training pipeline is built the way it is, and — importantly
— **why we do not freeze-and-deploy a model from a single week of data.** It answers
three questions directly: is a week enough, should we wait a year, and could we use
an existing online dataset instead.

## 1. What the model does (and doesn't) learn

The model predicts the **arrival runway** from features captured at *lock time* (when a
flight commits to final). It is a per-airport multinomial-softmax classifier — linear,
auditable, and serveable as plain JS.

Features (all validated, nulls handled explicitly):

- **Weather** — wind direction (with an explicit VRB/calm flag so variable wind is
  never misread as north), wind speed, head/crosswind components, gusts, visibility,
  ceiling (with a no-ceiling flag for clear skies), flight category, temperature.
- **Geometry/time** — approach octant, bearing to the field, local hour (diurnal).
- **Traffic** — arrival rate, inbound count, sector count (congestion density).

**Conflicts are deliberately *not* a feature.** A conflict is a real-time safety output
(closest-point-of-approach between two aircraft); it does not determine which runway a
flight is assigned. The *congestion* that produces conflicts is captured by the traffic
-density inputs. Learning "runway from conflicts" would be learning a non-causal
correlation — exactly the kind of incorrect signal we exclude.

## 2. Data quality — nothing incorrect or insufficient is learned

Every row is validated before training (`scripts/train_model.py::validate`, covered by
`scripts/test_train.py`). Rejected and never learned from:

- rows with no observed runway (departures / unclassifiable landings),
- missing or out-of-range approach octant,
- impossible altitude (bad barometric reading) or below-ground AGL artifacts,
- groundspeed outside a plausible approach range.

Of ~13,600 collected rows, ~8,100 are verified-clean labeled arrivals used for training.
Labels are internally consistent (`runway_ok` always agrees with actual-vs-predicted).

## 3. Is one week enough? Do we wait a year for four seasons?

**We neither wait a year nor freeze a week-old model. We deploy the *pipeline*, gated.**
The reasoning:

1. **The features are causal and season-independent.** "Aircraft land into the wind" is
   physics, not a summer artifact. The model learns *runway given wind* — a relationship
   that holds year-round. Seasons change *how often* each wind regime occurs, i.e. the
   **coverage** of the feature space, not the validity of the mapping.

2. **A week only covers summer wind regimes.** Winter regimes a July week never sees
   (e.g. sustained easterlies) are simply absent, so a July-only model would extrapolate
   there. This is a coverage gap, and it is exactly what the evaluation exposes: LHR and
   LAX collapse on the *time-split* (the recent test week runs a config the training
   portion barely saw) while scoring 85% / 59% on a *random* split.

3. **The weekly auto-retrain accumulates all four seasons on its own.** We do not "wait
   then train once" — `.github/workflows/train.yml` retrains every Monday on the full,
   growing dataset. Coverage improves continuously.

4. **The adopt-gate makes seasonality self-correcting.** A model is only flagged for use
   at an airport where it beats the engine on a **held-out time-split**. If a new season
   brings a regime the model hasn't learned, the time-split accuracy drops and the gate
   flips the model *off* — the expert engine (which *observes* the active config from
   live traffic and is therefore regime-agnostic) takes over automatically. The system
   cannot silently degrade in winter.

5. **For most airports seasonality is moot.** Where the engine already wins (LHR, LAX at
   ~86–92%), it does so by observing the live config, so more seasons wouldn't change the
   verdict — the model is redundant there regardless of data volume.

**Conclusion:** a week is enough to *stand up and validate the pipeline* and to find a
real, robust win at JFK (+6.8 pts, stable across both splits). It is **not** enough to
justify wiring a frozen model into the live control loop. Live adoption should wait until
the JFK `adopt` flag stays green across several weekly retrains spanning multiple wind
regimes (a few months). The weekly report is the readiness signal.

## 4. Could we use an existing online dataset instead?

Relevant free sources exist, but none match this system's schema, so none is a shortcut:

- **OpenSky Network** — years of free historical ADS-B. But it is raw positions, not our
  lock-time feature vectors and not the engine's baseline. Using it means re-deriving
  runway labels and re-running our engine over history — a real backfill project, worth
  doing later to accelerate seasonal coverage, not a drop-in dataset.
- **METAR archives** (NOAA / Iowa Mesonet) — decades of free weather, but only the weather
  half; the traffic + runway labels still have to be paired to it.
- **FAA ASPM / OPSNET** — historical runway usage, but not free/keyless (licensing).

No off-the-shelf dataset contains *(our features + observed-runway + engine prediction)*.
Our own continuously-collected dataset is the correct, matched source; an OpenSky backfill
is the option if we later want to pre-seed winter regimes, and is scoped separately.

## 5. Safeguards summary

- Self-tests (`scripts/test_train.py`) run before every training in CI.
- Strict row validation; only clean, sufficient rows train the model.
- Honest dual evaluation (time-split gates deployment; random-split shows the ceiling).
- Per-airport adopt-gate; the expert engine is the safe default everywhere else.
- Weekly retrain; the model improves and the gate re-evaluates as data grows.

The model is **not** in the live control loop yet — by design, pending seasonal coverage.

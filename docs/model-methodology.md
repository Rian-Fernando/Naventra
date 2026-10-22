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

The weekly report (`docs/model-report.md`) lists how many rows each check rejected.
Labels are internally consistent (`runway_ok` always agrees with actual-vs-predicted).
The ETA model has its own validator (`validate_eta`): it needs a usable touchdown time but
not a classified runway, so landings whose runway couldn't be told from the track still
teach it.

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
   growing dataset, walking every page of `/api/dataset.jsonl`. (Until October 2026 it
   silently trained on only the newest 20,000 rows — the API's per-request cap — so older
   seasons fell out of the window. Fixed; see §5.)

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

- **OpenSky Network** — years of historical ADS-B. But it is raw positions, not our
  lock-time feature vectors and not the engine's baseline, and its terms require a written
  license for use in a live product or automated system. Not used.
- **METAR archives** (NOAA / Iowa Mesonet) — decades of free weather, but only the weather
  half; the traffic + runway labels still have to be paired to it.
- **FAA ASPM / OPSNET** — historical runway usage, but not free/keyless (licensing).

No off-the-shelf dataset contains *(our features + observed-runway + engine prediction)*.
Our own continuously-collected dataset is the correct, matched source, and it grows into
every season by itself.

## 5. Staying right as the seasons turn

What changes between seasons is the wind regime (so the runway configuration), the
weather (IFR days, de-icing, convective holds) and traffic — all of which move the ETA
bias. The pipeline is built so a model trained in one season can't quietly misbehave in
the next:

- **Every season stays in the data.** Training walks the whole history page by page;
  nothing ages out.
- **Recency weighting, chosen honestly.** Older rows count less, with a half-life picked
  per airport from {no decay, 60, 30, 14 days} on an *inner* validation slice of the
  training data — never on the test window. A decay must beat "no decay" by ≥0.5 pts to
  be used, so it only kicks in when the recent regime really differs.
- **Adoption is judged on the season we're in.** The test window is the most recent 21
  days, trained only on what came before. A model that learned summer and fails in autumn
  is switched off by the next weekly run.
- **The ETA baseline is what's live.** The ETA model must beat the ETA that was actually
  graded (raw + the tracker's online bias), not the weaker raw estimate, by ≥2 pts.
- **Day-of-year features wait for a full year.** They exist in the feature vector (and in
  the JS server) from day one but stay at zero until the data spans 330 days: a seasonal
  curve fitted to part of a year would be a guess.
- **Trends are tracked.** The report tables every month per airport — engine runway
  accuracy, ETA hits, median ETA error, IFR share, wind, the runway used most — and flags
  any shift between the last 30 days and the 30 before. `model.json` carries the same
  monthly series (`trends`) for the UI.
- **Online priors forget.** The tracker's live learned priors (runway-per-approach-octant
  counts, departure cells) halve once they pass a cap, so they follow the last few hundred
  movements rather than being outvoted by months of old data.
- **The live tracker always runs the newest model** — it refreshes `model.json` from GitHub
  hourly — and emails if the weekly retrain stops (GitHub skips scheduled runs without
  notice; ours stopped silently after 7 Sep 2026).

## 6. Departure runways — experts chosen by results

Departure runways were the weakest category (JFK 26%, LAX 38%) because the engine dealt
departures round-robin across every runway arrivals weren't using. Replaying 18,880 graded
departures (Jul–Oct 2026) with an honest 25-minute taxi lag showed that simply following
the departure flow the airport is visibly using scores JFK ~81%, Heathrow ~89%, LAX ~43%
(LAX runs two departure runways at once, so it needs the aircraft's position).

So three predictors now name a runway for every taxiing flight
(`src/engine/departures.js`): **flow** (the departure runway in use, from recent
climb-outs), **near** (of those, the strip nearest the aircraft) and **learned** (of
those, the one flights from that spot on the field have used — counts per 0.3-nm cell).
Every graded departure scores all three, per airport and per situation, and the live call
comes from whichever has the best recent record there (with a minimum of 25 graded calls
and a 2-point margin before it takes over). In the regression simulator the planner
hands over from flow to the better expert and departure accuracy rises from ~45% to ~90%
within two simulated hours.

## 7. Safeguards summary

- Self-tests (`scripts/test_train.py`) run before every training in CI.
- Strict row validation; only clean, sufficient rows train the model.
- Honest dual evaluation (time-split gates deployment; random-split shows the ceiling).
- Per-airport adopt-gate; the expert engine is the safe default everywhere else.
- Weekly retrain on the full history; the gate re-evaluates on the most recent 21 days.
- The live tracker hot-reloads the model and alerts by email if it goes stale.

The model is **not** in the live control loop yet — by design, pending seasonal coverage.

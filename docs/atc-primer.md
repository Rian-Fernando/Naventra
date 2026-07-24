# Naventra ATC primer

A plain-English reference to the air-traffic-control concepts Naventra models, so
you never have to take the code on faith. It grows as features are built. Where a
concept is implemented, the file is named.

---

## The controllers (who owns which slice of a flight)

A flight is relayed between specialists, each owning a piece of airspace:

- **Clearance Delivery** — issues the IFR route before you move.
- **Ground** — taxiways and aprons: pushback, taxi, runway crossings.
- **Tower / Local Control** — the **runways**: take-off & landing clearances, go-arounds.
- **Approach / Departure (TRACON)** — the terminal bubble (~40 nm, surface to ~15,000 ft):
  sequences arrivals onto final, vectors, controls speed, launches departures. **Naventra models this layer.**
- **Center (ARTCC)** — enroute cruise.
- **Flow Management** — strategic: ground stops, metering, assigned take-off times (EDCT/CTOT).

**Key idea:** "which runway" is a *facility* decision (a runway **configuration** the
supervisor sets and changes a few times a day). "What order / which of the active
runways" is then decided per-flight by approach control. Naventra reads the active
config from live traffic (observed-config inference) rather than guessing it.

---

## The job, in priority order

1. **Safety = separation.** Keep aircraft apart. This is most of the job.
2. **Capacity** — how many arrivals/hour the field can accept (the *Airport Acceptance Rate*).
3. **Efficiency** — least delay, fuel and track-miles.
4. **Orderliness** — a predictable, sequenced flow.

### Separation standards
- Enroute: **5 nm** lateral / **1,000 ft** vertical.
- Terminal (TRACON): **3 nm** / **1,000 ft**.
- Aircraft are only *in conflict* if they'll be inside **both** minima at the same time.
  Naventra projects every pair's **closest point of approach (CPA)** 150 s ahead.
  *(src/engine/atc.js → detectConflicts)*
- VFR traffic, rotorcraft and slow low-level traffic are excluded, like real STCA.

### Wake turbulence — why final spacing isn't a flat 3 nm
Every aircraft trails two rotating vortices off its wingtips. A lighter aircraft
following too closely can be rolled. So controllers add distance behind heavier
aircraft, set by the **(leader, follower) weight pair**. Naventra uses the ICAO
4-category scheme *(src/engine/wake.js)*:

| Cat | Name | Roughly |
|---|---|---|
| J | **Super** | A380, An-124/225 |
| H | **Heavy** | MTOW ≥ 136 t — most widebodies (777, 787, 330, 350, 747, 767). The 757 is grouped here (medium weight, heavy-like wake). |
| M | **Medium** | 7–136 t — 737, A320 family, regional jets, turboprops |
| L | **Light** | < 7 t — light GA, small twins, most helicopters |

Required **in-trail spacing on final** (nm), leader → follower, floored at the 3 nm
radar minimum where wake adds nothing:

| leader ↓ / follower → | Super | Heavy | Medium | Light |
|---|--:|--:|--:|--:|
| **Super** | 4 | 6 | 7 | 8 |
| **Heavy** | 3 | 4 | 5 | 6 |
| **Medium** | 3 | 3 | 3 | 5 |
| **Light** | 3 | 3 | 3 | 3 |

This is the single biggest driver of **arrival capacity**: a stream of heavies behind
supers spaces out to 6–8 nm and the runway takes far fewer aircraft per hour than a
stream of mediums at 3 nm. Naventra computes the required spacing for every arrival
behind its leader, shows it on the strip and the aircraft card, and flags a pair that
is *compressing* below its wake minimum. *(src/engine/atc.js → annotateAircraft)*

---

## How runways are chosen (it is not just wind)

Wind is primary — land and take off into wind; typical limits are ~10 kt tailwind and
~20–35 kt crosswind. But the real configuration also weighs:

- **Noise abatement / preferential runways** — huge. London Heathrow *alternates*
  27L/27R at 15:00 local for community respite; many fields use noise-preferential
  runways even against light winds. (This is why a weather-only model can't predict
  Heathrow's runway — it's a schedule, not the wind.)
- **Capacity & the arrival/departure balance.**
- **Instrument approaches & visibility** — low visibility forces ILS-equipped ends and
  cuts the acceptance rate (low-visibility procedures).
- **Standard published configs**, adjacent airports, NOTAMs/construction, runway length,
  and contamination/braking action.

Naventra reads the **active** config from where live traffic is actually landing, then
assigns individual arrivals within it — mirroring how a real facility works.

---

## Arrival sequencing

Order arrivals by estimated time to the runway, then adjust for **wake spacing**, speed
differences (a jet catching a turboprop), runway assignment, **priority** (an emergency
jumps the queue), and time-based metering. Tools: speed control, path-stretching, and
holding (Heathrow's stacks). Naventra sequences by ETA, distributes across the active
parallel runways, and layers the wake spacing on top.

---

## Emergencies & priority

The transponder squawk flags an emergency to everyone: **7500** unlawful interference
(hijack), **7600** radio failure, **7700** general emergency. These get priority
handling — the airspace is protected and they move to the front of the sequence.
Naventra surfaces them as scope alerts and floats them to the top of the strips.

---

## Capacity — the Airport Acceptance Rate (AAR)

The AAR is how many arrivals per hour the field can accept — the TRACON's core
capacity number. Naventra estimates it from physics *(src/engine/capacity.js)*:

> rate per runway ≈ **final-approach speed ÷ mean required wake spacing**,
> then × the effective number of arrival streams × a weather factor.

So the three things that actually move capacity all show up correctly:

- **Wake mix** — a stream of heavies at 6 nm gives ~23/hr; mediums at 3 nm ~47/hr.
- **Runway config** — more active arrival runways = more streams (dependent parallels
  add ~0.65 of a stream each, not a full one).
- **Weather** — VFR ×1.0, MVFR ×0.9, IFR ×0.8, LIFR ×0.62 (low-visibility procedures
  force wider spacing and cut the rate).

The Tower Ops panel shows the AAR, the current inbound queue, a load bar (recent
landing rate ÷ AAR), the mean spacing and weather driving it, and — when the queue
runs beyond ~15 min of capacity — an estimated delay. Real AARs are declared by the
facility, so ours is clearly labelled an estimate; what matters is that it *reacts*
to config, wake and weather the way a real one does.

## Departures — the mirror of arrivals, but in time

Where arrival spacing is measured in **distance** (nm on final), departure spacing is
measured in **time**: the wake vortices sink and drift behind a departing aircraft, so a
following departure is held **~2 minutes behind a super/heavy** (less between equals),
floored at a ~60 s runway-occupancy minimum. *(src/engine/wake.js → wakeDepartureSepSec;
shown on the departure strips as the gap behind the aircraft ahead.)*

That time spacing gives the **Airport Departure Rate (ADR)** — the departures/hour the
field can push — the same way wake gives the AAR. A runway that also lands traffic
(DEP+ARR) shares its slots, so it adds only about half a departure stream. Tower Ops shows
the AAR and ADR side by side.

Two things we deliberately **don't** fake: real **SID routes** (the published departure
paths) and **EDCT/CTOT** slots from flow management aren't in free/keyless data, so they're
left out rather than invented.

## Surface safety — runway incursions

The most serious ground risk is a **runway incursion**: an aircraft (or vehicle) on a
runway when another is landing or departing on it. Real towers watch this with surface
radar (**ASDE-X**) and automated **Runway Status Lights**. Naventra flags the clearest
case — a ground aircraft sitting on or crossing an active runway while another is on
**short final (< 2.5 nm)** to it — as an advisory on the scope. *(src/engine/surface.js)*

**Honest limitation:** ADS-B ground coverage is **partial** — many aircraft stop
transmitting a position once on the surface, and MLAT fill-in is patchy. So this sees only
what's actually broadcasting; it's an advisory over available data, not a certified
surface-surveillance system. It is labelled as such and never presented as authoritative.

## Roadmap (what's modelled, what's next)

- ✅ TRACON layer, observed-config inference, CPA separation, ETA sequencing, gates, comms.
- ✅ **Wake turbulence** categories + wake-aware final spacing.
- ✅ **Airport Acceptance Rate (AAR)** — capacity from config + wake mix + weather, with
  load and an estimated delay.
- ✅ **Touchdown-ETA model — live** (worker-authoritative), feedback-safe; go-around ETAs voided.
- ✅ **Departure flow** — wake-on-departure time spacing + Airport Departure Rate (ADR).
  (SIDs and EDCT slots left out — not in free data.)
- ✅ **Surface safety** — runway-incursion advisory (partial ADS-B ground coverage).
- ⏭ Low-visibility capacity refinements; richer surface picture if better ground data appears.

## The touchdown-ETA model (why it, not runway)

The engine's ETA is straight-line distance ÷ speed, so it's blind to holding, vectoring
and headwind — flights land **late** (median +147s at Heathrow, which stacks). Pointing
the learning model at the **ETA error** (a regression on lock-time features) is where ML
genuinely helps: on held-out recent data it lifts "within ±2.5 min" from **75.8% → 89.8%
(+14 pts)** and cuts mean error roughly in half, at *every* airport. The dominant signal
is a stable per-airport bias (flights hold year-round — not a seasonal artifact); features
add a light adjustment. *(scripts/train_model.py; report in docs/model-report.md)*

**How it's served safely — a real ML-systems trap avoided.** If we applied the correction
to the *graded* prediction and then retrained on the newly-corrected data, the model would
see near-zero error, learn a near-zero bias, and on the next deploy the correction would
vanish — oscillating. So the always-on worker (the authoritative grader for JFK/LAX/LHR)
grades `predEtaTs = raw ETA + model correction`, but **records the raw error for training**
— the model always learns the full bias, and the correction stays stable. Go-arounds and
diversions (a landing >30 min off the raw estimate) are **not graded** as ETA misses.
*(src/engine/etaModel.js, worker/src/tracker.js, src/engine/grading.js)*

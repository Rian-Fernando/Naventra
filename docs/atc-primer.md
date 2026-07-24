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

## Roadmap (what's modelled, what's next)

- ✅ TRACON layer, observed-config inference, CPA separation, ETA sequencing, gates, comms.
- ✅ **Wake turbulence** categories + wake-aware final spacing (this section).
- ⏭ **Airport Acceptance Rate (AAR)** — capacity from config + weather + wake mix, with
  demand-vs-capacity and expected delay.
- ⏭ **ETA / spacing model** — point the learning model at touchdown-time prediction
  (where weather, wake, speed and congestion genuinely help) rather than absolute runway.
- ⏭ Departure flow (SIDs, wake-on-departure, EDCT), low-visibility capacity, surface movement.

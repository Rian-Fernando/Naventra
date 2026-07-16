import { ArrowLeft, Radar, Target, Cpu, CloudSun, Radio, AlertTriangle, Route, PlaneLanding } from 'lucide-react';

const TERMS = [
  ['ADS-B', 'Automatic Dependent Surveillance–Broadcast. Aircraft continuously broadcast their GPS position, altitude, speed and identity. This is the live data source for every target on the scope — the same returns real controllers and sites like flight trackers use.'],
  ['TRACON', 'Terminal Radar Approach Control — the facility working traffic in the ~50nm ring around an airport, between the enroute centers and the tower. This console models a TRACON position.'],
  ['METAR', 'The standardized hourly airport weather report (wind, visibility, clouds, temperature, pressure). The raw METAR is shown verbatim in the weather panel; the decision core decodes it to pick runways.'],
  ['ATIS', 'Automatic Terminal Information Service — a looped broadcast of current weather and active runways, labeled with a phonetic letter (Information ALPHA, BRAVO…) that increments with each update.'],
  ['Flight strip', 'One aircraft\'s summary card: callsign, type, altitude, speed, distance, ETA, assigned runway, stand and squawk. Paper strips are still used in real towers; ours are digital and update live.'],
  ['Phases', 'Every track is classified each sweep: ENROUTE (passing through) → ARRIVAL (inbound, descending) → APPROACH (committed, being sequenced) → FINAL (aligned with a runway) → GROUND. Departures run the ladder in reverse.'],
  ['Sequence (#1, #2…)', 'The landing order the AI maintains for the arrival flow, ordered by ETA and distributed across active arrival runways.'],
  ['Runway designator', 'Runways are named by magnetic heading ÷ 10: runway 22 points ~220°. Parallel runways get L/C/R suffixes. Every strip is one physical runway usable from both ends (04L one way is 22R the other).'],
  ['Headwind / Crosswind', 'Wind split into the component down the runway (headwind — you want this for landing) and across it (crosswind — limits operations). The allocator computes both for every runway end from live METAR wind.'],
  ['ILS', 'Instrument Landing System — the precision radio approach for a runway end. Arrival assignments prefer ILS-equipped ends.'],
  ['CPA', 'Closest Point of Approach — for every aircraft pair, the minimum separation their current velocity vectors will produce and when. The separation monitor projects 150 seconds ahead.'],
  ['LOS / minima', 'Loss of Separation — two IFR aircraft closer than the terminal minima of 3nm laterally and 1,000ft vertically at the same time. CRITICAL means minima are broken now; PREDICTED means the CPA math says they will be.'],
  ['Squawk', 'The 4-digit transponder code. 1200 means VFR (visual rules — not separated by ATC, so excluded from conflict grading). 7700 is an emergency.'],
  ['FL (Flight Level)', 'Pressure altitude in hundreds of feet: FL350 ≈ 35,000ft. Below 18,000ft we show feet directly.'],
  ['Ground speed (kt)', 'Speed over the ground in knots (1kt = 1.15mph). The velocity leader line on each target shows one minute of travel.'],
  ['Stand / Gate', 'The parking position assigned to an arrival, drawn from the airport\'s real terminal and gate layout.'],
  ['Go-around', 'An abandoned landing — the aircraft climbs away from short final and rejoins the sequence. Detected automatically; any locked predictions for that approach are voided, not graded.'],
  ['VFR / IFR', 'Visual vs Instrument Flight Rules. Airliners fly IFR and are separated by ATC; VFR traffic (small GA, helicopters) self-separates and is filtered out of the conflict monitor.'],
];

const PANELS = [
  [Radar, 'Radar / TRACON (center)', 'Live targets around the facility. 3D view: drag to orbit, scroll to zoom — each aircraft sits at its exaggerated true altitude with a stem down to the ground plane, so height is directly visible. 2D view is the classic top-down scope. Click any target for its full data card. Range buttons set 10–80nm; TRL toggles trails; AUTO/ALL/OFF controls data blocks.'],
  [Target, 'AI Scorecard (top right)', 'The honesty meter. When a flight commits to the approach, the AI locks its predictions (runway, ETA, landing order, config). At touchdown the actual outcome is measured from the data and each prediction is graded ✓/✗. The headline number is the all-time percentage over live traffic only — simulated traffic is graded on screen but never banked.'],
  [AlertTriangle, 'Separation Monitor (right)', 'Conflict pairs from the CPA projection: current separation, predicted minimum and time to it. CRITICAL (red, blinking) = minima broken now. Click a pair to select it on the scope.'],
  [Cpu, 'AI Decision Feed (right)', 'Every action the decision core takes, with its reasoning and a confidence score: radar contacts, sequence slots, approach clearances, runway configuration changes, conflict resolutions, prediction verifications.'],
  [CloudSun, 'METAR / ATIS (bottom right)', 'Live decoded weather driving the runway allocator, plus the raw METAR line and current ATIS information letter.'],
  [PlaneLanding, 'Flight Strips (left)', 'Arrivals / Departures / Ground tabs. Arrivals are ordered by landing sequence and carry their runway, stand and ETA.'],
  [Route, 'Runway Allocation (bottom left)', 'The active configuration chosen from live wind: each runway\'s active end, role (ARR / DEP / DEP+ARR), length, head/crosswind components and ILS availability.'],
  [Radio, 'Radio Communications (bottom)', 'The VHF transcript. Green = controller transmissions (NAVENTRA APP/TWR), cyan = pilot readbacks, on the facility\'s real frequencies.'],
];

export default function Guide() {
  return (
    <div className="guide-wrap">
      <div className="guide">
        <a className="guide-back" href="/"><ArrowLeft size={13} /> BACK TO CONSOLE</a>
        <h1>Operator's Guide</h1>
        <p className="guide-lede">
          Naventra is an AI-native air traffic control console. It ingests <b>real, live ADS-B
          transponder returns</b> around a real airport, pulls the current METAR, and runs an autonomous
          decision core that performs the controller's job — runway selection, arrival sequencing,
          separation monitoring, gate logistics and radio phraseology. Then it does something unusual:
          <b> it grades itself against reality</b> and publishes the score.
        </p>

        <h2>How the AI is scored</h2>
        <ol className="guide-steps">
          <li><b>Lock.</b> When an inbound flight enters the approach phase (~4–26nm out), the core's current plan is frozen as a prediction: <em>runway end, touchdown time, next-to-land order, and that the runway is in the active arrival set</em>. It cannot be revised afterwards.</li>
          <li><b>Observe.</b> The flight lands (or vanishes below radar coverage on short final, which counts as landed). The actual runway is derived purely from the observed final track and centerline alignment — never from the prediction.</li>
          <li><b>Grade.</b> Each locked item is scored ✓/✗: exact runway end; runway within the AI's active-arrival config; touchdown within ±2.5 minutes of the locked ETA; and whether the flight was next in the AI's landing queue for its runway when it touched down.</li>
        </ol>
        <p className="guide-note">
          Kept honest three ways: <b>only live traffic banks into the all-time score</b> (in SIM mode the AI
          steers the traffic, so grades are shown but never persisted) · go-arounds void their predictions
          rather than gaming them either direction · if the actual runway can't be determined confidently
          from the data, the prediction is discarded instead of guessed. Conflict advisories are
          deliberately not graded — when a predicted conflict fails to materialize it usually means a real
          controller resolved it, which isn't a miss.
        </p>

        <h2>What AI is this — and how it learns</h2>
        <p>
          Naventra's core is a <b>deterministic expert system</b> — transparent, auditable rules encoding
          real ATC procedures (wind-component runway selection, ETA sequencing, closest-point-of-approach
          separation math). It runs entirely in your browser: no external model, no API calls, no keys,
          zero cost. On top of it sits an <b>online learning layer</b>: every live landing the scorecard
          verifies feeds back into the predictor. It learns each facility's habits — <em>which runway
          traffic from each compass direction usually gets</em> (smoothed per-octant priors blended into the
          geometric runway score) and <em>how its ETA estimates are systematically biased</em> (an error
          moving-average that corrects future locks). The longer Naventra watches an airport, the sharper
          its predictions get — and the scorecard proves it either way.
        </p>
        <p>
          A companion <b>always-on tracker</b> (a Cloudflare Worker on a 1-minute cron) runs this same
          engine 24/7 against <b>JFK, LAX and London Heathrow</b> with no browser open, banking every graded
          landing and the learned model into a shared database. When you're viewing one of those hubs the
          scorecard shows the <em>global</em> figure — the model that has been continuously learning across
          all visitors — marked <b>GLOBAL · 24/7</b>. Other airports show your live session's own tally.
        </p>

        <h2>How the self-learning actually works</h2>
        <p>
          "Self-learning" here means something specific and verifiable, not a buzzword. Two learned
          parameters are updated by <b>every real landing the system grades</b>:
        </p>
        <ol className="guide-steps">
          <li>
            <b>Runway priors — P(runway | approach direction).</b> The approach bearing is bucketed into
            eight compass sectors. For each sector the model keeps a smoothed tally of which runway end
            arrivals from that direction actually landed on. Over time this encodes the facility's real
            habits — e.g. "traffic joining from the north-east at JFK almost always gets 22L" — and that
            learned probability is blended into the geometric runway score, so the next prediction leans the
            way reality has been leaning. Pure geometry from 16&nbsp;nm out can't see that; the data can.
          </li>
          <li>
            <b>ETA bias — a running error correction.</b> Each landing compares the predicted touchdown time
            to the actual one. The signed error feeds an exponential moving average, which is subtracted
            from future estimates. If this airport's approaches systematically run, say, 40&nbsp;s slower
            than the raw model expects, the system learns that offset and stops making the same mistake.
          </li>
        </ol>
        <p>
          The loop is <b>predict → observe → measure error → adjust → repeat</b>, running on live outcomes.
          It's <em>online</em> learning: no training run, no dataset to download — the model improves one
          real landing at a time, and the scorecard shows whether it's actually working. Only live landings
          update it (never the simulation), so it learns the real world, not itself.
        </p>

        <h2>No API keys · no paid model · $0</h2>
        <p>
          People assume "AI that learns" implies a large language model and a metered API bill. Naventra
          has neither. The decision core is a <b>deterministic expert system</b> — explicit, auditable rules
          that encode real ATC procedure (wind-component runway selection, closest-point-of-approach
          separation math, ETA sequencing) — wrapped in the online-learning loop above. There is <b>no LLM
          anywhere</b>, so there is nothing to hold an API key for and nothing to meter.
        </p>
        <p>
          Every data source is <b>free and keyless</b>: live traffic from the open <b>airplanes.live</b>
          ADS-B feed (with adsb.lol / adsb.fi as failovers), weather from the US government's
          <b> aviationweather.gov</b> METAR service. The browser app is static hosting; the always-on
          tracker is a <b>Cloudflare Worker</b> (free tier: a 1-minute cron is well under the limits) writing
          to a <b>free D1 database</b>. The math is a few hundred lines of plain JavaScript that runs the same
          in your browser and in the Worker. The result: a system that genuinely learns and runs around the
          clock, for nothing — because the intelligence is in the modelling and the feedback loop, not in
          renting someone else's model.
        </p>

        <h2>Screen map</h2>
        <div className="guide-map">
          <div className="gm gm-header">HEADER — facility selector · LIVE/SIM · traffic KPIs · UTC clock</div>
          <div className="gm gm-left">FLIGHT STRIPS<br /><span>+ RUNWAY ALLOCATION</span></div>
          <div className="gm gm-center">RADAR / TRACON<br /><span>3D · live targets · click to inspect</span></div>
          <div className="gm gm-right">AI SCORECARD<br /><span>+ SEPARATION · AI FEED · METAR</span></div>
          <div className="gm gm-bottom">RADIO COMMUNICATIONS — VHF transcript</div>
        </div>

        <h2>The panels</h2>
        <div className="guide-panels">
          {PANELS.map(([Icon, title, body]) => (
            <div className="guide-panel" key={title}>
              <h3><Icon size={14} /> {title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>

        <h2>Reading a target</h2>
        <p>
          Each target renders as a <b>top-down aircraft silhouette</b> pointing along its heading —
          airliners as fixed-wing shapes, rotorcraft as a distinct helicopter shape (cabin, rotor and tail
          boom) — with a <b>velocity leader</b> showing one minute of travel, a fading <b>history
          trail</b>, and a two-line data block:
          callsign on top; altitude (with ↑/↓ climb arrows), ground speed and type below. Colors follow the
          legend — greens are inbound, cyan outbound, dim gray passing through, purple on the ground, red in
          conflict. In 3D, the vertical <b>stem</b> under each aircraft drops to its position on the ground
          plane: stem height <em>is</em> altitude (exaggerated 5× so profiles are visible).
        </p>

        <h2>Glossary</h2>
        <dl className="guide-terms">
          {TERMS.map(([t, d]) => (
            <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
          ))}
        </dl>

        <h2>Data sources & cadence</h2>
        <p>
          Live traffic: <b>airplanes.live</b> (primary, ~6s polling), with <b>adsb.lol</b> and <b>adsb.fi </b>
          as automatic failovers. Weather: <b>aviationweather.gov</b> METARs (5-minute refresh), US fallback
          via api.weather.gov. Positions are dead-reckoned between polls for smooth motion. If every source
          is unreachable — or you press the LIVE OPS button — a physics simulation takes over, seeded with
          the airport's real runway geometry and carrier mix, and is clearly labeled SIM.
          All sources are free and keyless; the entire system, including the AI core, runs in your browser.
        </p>

        <p className="guide-credit">
          Naventra is designed and built by <a href="https://rianfernando.com" target="_blank" rel="noopener">Rian Fernando</a> —
          see more projects at <a href="https://rianfernando.com" target="_blank" rel="noopener">rianfernando.com</a>.
        </p>
      </div>
    </div>
  );
}

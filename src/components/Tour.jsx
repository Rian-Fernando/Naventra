import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { ArrowRight, ArrowLeft, Compass } from 'lucide-react';

// First-run guided tour: a moving spotlight over each panel with a plain-English
// explanation of what it is and what the colours/codes mean. Auto-starts on the
// first console visit (or ?tour=1), and can be replayed from the header.
const KEY = 'nv-tour-v1';

const STEPS = [
  { sel: '.facility', title: 'Choose an airport', body: 'Pick any of 15 major airports. The ◉ hubs (JFK / LAX / London Heathrow) run the always-on 24/7 model; the others learn during your session.' },
  { sel: '.radar-panel', title: 'The live radar', body: 'Every target is a real aircraft from live ADS-B. In 3D drag to orbit and scroll to zoom; in 2D scroll to zoom and drag to pan. Colours: green = arriving, cyan = departing, grey = enroute, purple = on the ground, red = conflict or emergency.' },
  { sel: '[data-tour="strips"]', title: 'Flight strips', body: 'Arrivals / departures / ground, ordered by landing sequence. Each strip shows altitude, speed, distance, ETA, runway and stand — and #1, #2… is the landing order. Emergencies float to the top.' },
  { sel: '[data-tour="runways"]', title: 'Runway allocation', body: 'The active configuration chosen from the live wind — each runway’s role (ARR / DEP), its head/crosswind components and whether it has an ILS.' },
  { sel: '[data-tour="ops"]', title: 'Tower operations', body: 'Live movement rates — arrivals and departures per hour, the busiest runway in use, and how many aircraft are airborne versus on the ground.' },
  { sel: '[data-tour="scorecard"]', title: 'The AI scorecard', body: 'The honesty meter. When a flight commits to final the AI locks its prediction, then grades it ✓/✗ against the real landing. You see all-time and last-24h accuracy, per category.' },
  { sel: '[data-tour="separation"]', title: 'Separation monitor', body: 'Conflict pairs from closest-point-of-approach maths, projected 150 seconds ahead. Red and blinking means the 3 nm / 1,000 ft minima are broken now.' },
  { sel: '[data-tour="forecast"]', title: 'Weather outlook', body: 'The live TAF forecast: when the wind will flip the runways, plus a disruption-risk estimate for each period. A HIGH chip means stressed operations likely.' },
  { sel: '[data-tour="feed"]', title: 'AI decision feed', body: 'Every action the engine takes, with its reasoning and a confidence score — clearances, sequencing, runway changes, conflict calls.' },
  { sel: '[data-tour="weather"]', title: 'Weather — METAR / ATIS', body: 'The decoded live weather that drives runway selection: wind, visibility, altimeter, temperature and ceiling — plus the raw METAR and the current ATIS information letter.' },
  { sel: '.comms-wrap', title: 'Radio communications', body: 'The VHF transcript on the facility’s real frequencies — green is the controller, cyan is the pilot readback.' },
  { sel: '.cmenu-btn', title: 'The menu — settings & more', body: 'Open this menu any time for Display settings (units: °C/°F, knots/mph/km-h, nm/km/mi), layout presets, which panels to show, and the full Operator’s Guide. You can replay this tour from here too. That’s it — enjoy the sector!' },
];

export default function Tour() {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  const finish = useCallback(() => {
    setActive(false);
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  }, []);

  const start = useCallback(() => {
    const visible = STEPS.filter((s) => document.querySelector(s.sel));
    if (!visible.length) return;
    setSteps(visible); setI(0); setActive(true);
  }, []);

  // auto-start on first visit or ?tour=1; manual replay via the nv-tour event
  useEffect(() => {
    const force = new URLSearchParams(window.location.search).get('tour') === '1';
    let done = false; try { done = !!localStorage.getItem(KEY); } catch { /* ignore */ }
    let t;
    if (force || !done) t = setTimeout(start, force ? 400 : 1500);
    const h = () => start();
    window.addEventListener('nv-tour', h);
    return () => { clearTimeout(t); window.removeEventListener('nv-tour', h); };
  }, [start]);

  useLayoutEffect(() => {
    if (!active || !steps[i]) return undefined;
    const el = document.querySelector(steps[i].sel);
    if (!el) { setI((n) => Math.min(steps.length - 1, n + 1)); return undefined; }
    // Bring the target into view first (panels can sit lower in a scrollable
    // column), then track its position on resize/scroll without re-scrolling.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const measure = () => { const e = document.querySelector(steps[i].sel); if (e) setRect(e.getBoundingClientRect()); };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [active, i, steps]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, steps.length, finish]);

  if (!active || !rect) return null;
  const step = steps[i];
  const pad = 6;
  const hx = rect.left - pad, hy = rect.top - pad, hw = rect.width + pad * 2, hh = rect.height + pad * 2;
  const tipW = 320, tipH = 200;
  const below = hy + hh + tipH < window.innerHeight;
  const tipTop = below ? hy + hh + 12 : Math.max(12, hy - tipH - 12);
  const tipLeft = Math.min(Math.max(12, hx), window.innerWidth - tipW - 12);

  return (
    <div className="tour">
      <div className="tour-hole" style={{ left: hx, top: hy, width: hw, height: hh }} />
      <div className="tour-tip" style={{ top: tipTop, left: tipLeft, width: tipW }}>
        <div className="tour-top"><span className="tour-badge"><Compass size={12} /> GUIDED TOUR</span><span className="tour-step">{i + 1} / {steps.length}</span></div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={finish}>Skip</button>
          <div className="tour-nav">
            {i > 0 && <button className="tour-back" onClick={() => setI(i - 1)} aria-label="Back"><ArrowLeft size={14} /></button>}
            {i < steps.length - 1
              ? <button className="tour-next" onClick={() => setI(i + 1)}>Next <ArrowRight size={14} /></button>
              : <button className="tour-next" onClick={finish}>Done</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Radar, Cpu, CloudSun, ShieldAlert, Boxes, Activity, ArrowRight, Github, Check } from 'lucide-react';
import LandingScene3D from '../components/LandingScene3D.jsx';
import { fetchGlobalScorecard } from '../lib/globalModel.js';
import { AIRPORT_LIST } from '../data/airports.js';
import '../styles/landing.css';

const AIRPORT_COUNT = AIRPORT_LIST.length;

const FEATURES = [
  [Radar, 'Real live traffic', 'Every target is a real aircraft, streamed from live ADS-B transponder feeds around the world’s busiest airports — not a simulation, not a replay.'],
  [Cpu, 'An AI that grades itself', 'When a flight commits to final, the engine locks its prediction — runway, touchdown time, landing order — then scores itself against what actually happened. Publicly. 24/7.'],
  [CloudSun, 'Forecast-aware runways', 'It reads the live METAR and TAF forecast, computes head/crosswind for every runway end, and predicts when the wind will flip the whole configuration — before it happens.'],
  [ShieldAlert, 'Separation monitoring', 'Closest-point-of-approach math projects every aircraft pair 150 seconds ahead, flagging losses of separation before they occur.'],
  [Boxes, '3D radar & airport layout', 'Orbit a true-to-scale 3D scope, zoom to the field to see real runways, terminals and gates, and follow any aircraft in a 3D chase cam.'],
  [Activity, 'Self-learning, always on', 'A cloud model runs every minute, learning runway patterns and timing bias from each real landing — the accuracy climbs on its own.'],
];

const STEPS = [
  ['01', 'Ingest live traffic', 'Naventra pulls real ADS-B returns and live weather every few seconds — the same raw data real controllers and flight-trackers use, from free, keyless sources.'],
  ['02', 'Decide like a controller', 'An autonomous engine allocates runways from the wind, sequences the arrival flow, assigns gates, monitors separation, and generates radio phraseology — no human, no scripted demo.'],
  ['03', 'Grade against reality', 'Each prediction is locked, then measured against the actual landing. The scorecard shows exactly how often the AI was right — and the model keeps learning from every outcome.'],
];

const CAT_LABEL = { runway: 'RWY', config: 'CFG', eta: 'ETA', sequence: 'SEQ', deprwy: 'DEP' };

// Tween to `target`. First reveal counts up from 0; later live updates tween
// smoothly from the previously shown value (not a jarring restart).
function useCountUp(target, run, ms = 1300) {
  const [v, setV] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (!run || fromRef.current === target) return undefined;
    const from = fromRef.current;
    let raf, start;
    const step = (t) => {
      start ??= t;
      const p = Math.min((t - start) / ms, 1);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

export default function Landing() {
  const [stats, setStats] = useState(null);
  const [seen, setSeen] = useState(false);
  const [progress, setProgress] = useState(0);
  const statRef = useRef(null);

  useEffect(() => {
    document.title = 'Naventra — AI Air Traffic Command';
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = 'https://naventra.rianfernando.com/';
    document.body.classList.add('landing-mode');
    let alive = true;
    const load = () => fetchGlobalScorecard().then((s) => alive && s && setStats(s)).catch(() => {});
    load();
    // Keep the stats + live ticker current without a page refresh.
    const poll = setInterval(load, 45000);
    return () => { alive = false; clearInterval(poll); document.body.classList.remove('landing-mode'); };
  }, []);

  // Scroll-reveal for any .reveal element + a top progress bar.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0.18 }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? window.scrollY / max : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, []);

  useEffect(() => {
    const el = statRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const pct = useCountUp(stats?.recent24?.pct ?? stats?.allTime?.pct ?? 0, seen);
  const ops = useCountUp(stats?.allTime?.n ?? 0, seen);
  const rows = useCountUp(stats?.samples ?? 0, seen);

  const scrollTo = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); };
  const ticker = (stats?.recent || []).filter((r) => r.items?.length).slice(0, 12);

  return (
    <div className="lp">
      <div className="lp-progress" style={{ transform: `scaleX(${progress})` }} />
      <LandingScene3D />
      <div className="lp-vignette" />

      {/* ---------------------------------------------------------- nav ---- */}
      <nav className="lp-nav">
        <a className="lp-brand" href="/">
          <img src="/naventra-mark.svg" width="26" height="26" alt="" />
          <span>Naventra</span>
        </a>
        <div className="lp-nav-links">
          <a href="#how" onClick={scrollTo('how')}>How it works</a>
          <a href="#live" onClick={scrollTo('live')}>Live</a>
          <a href="#features" onClick={scrollTo('features')}>Features</a>
          <a href="/guide">Guide</a>
          <a className="lp-cta-sm" href="/live">Launch console <ArrowRight size={14} /></a>
        </div>
      </nav>

      {/* --------------------------------------------------------- hero ---- */}
      <header className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-eyebrow">LIVE · AI-NATIVE · $0 — NO API KEYS</div>
          <h1>Air traffic control,<br /><span className="lp-grad">run by an AI that grades itself.</span></h1>
          <p className="lp-sub">
            Naventra works real, live ADS-B traffic around the world&rsquo;s busiest airports — sequencing
            arrivals, allocating runways from live weather, and monitoring separation. Then it does what no
            demo does: it predicts what happens next and <b>scores itself against reality, every minute.</b>
          </p>
          <div className="lp-cta-row">
            <a className="lp-cta" href="/live">Launch live console <ArrowRight size={18} /></a>
            <a className="lp-cta-ghost" href="#how" onClick={scrollTo('how')}>See how it works</a>
          </div>
        </div>
        <div className="lp-scroll-hint" onClick={scrollTo('stats')}><span>SCROLL</span><em>▾</em></div>
      </header>

      {/* -------------------------------------------------------- stats ---- */}
      <section className="lp-stats reveal" id="stats" ref={statRef}>
        <div className="lp-stat"><b>{pct}<span>%</span></b><span className="lp-stat-l">recent prediction accuracy</span></div>
        <div className="lp-stat"><b>{ops.toLocaleString()}</b><span className="lp-stat-l">real operations graded</span></div>
        <div className="lp-stat"><b>{rows.toLocaleString()}</b><span className="lp-stat-l">labeled training rows</span></div>
        <div className="lp-stat"><b>{AIRPORT_COUNT}</b><span className="lp-stat-l">airports · updated every minute</span></div>
      </section>

      {/* ---------------------------------------------------------- how ---- */}
      <section className="lp-section" id="how">
        <div className="lp-kicker reveal">HOW IT WORKS</div>
        <h2 className="reveal">Live data in. A controller&rsquo;s decisions out.<br />Graded against the real world.</h2>
        <div className="lp-steps">
          {STEPS.map(([n, t, d], i) => (
            <div className="lp-step reveal glass" key={n} style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="lp-step-n">{n}</div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- live ---- */}
      <section className="lp-live reveal" id="live">
        <div className="lp-kicker">LIVE RIGHT NOW</div>
        <h2>The AI is grading itself as you read this.</h2>
        <p className="lp-live-sub">
          These are real predictions the always-on model just locked and scored against actual landings and
          departures across JFK, LAX and London Heathrow.
        </p>
        {ticker.length > 0 ? (
          <div className="lp-ticker">
            <div className="lp-ticker-track">
              {[...ticker, ...ticker].map((r, i) => (
                <div className="lp-tick" key={i}>
                  <span className="lp-tick-cs">{r.callsign || '——'}</span>
                  <span className="lp-tick-ap">{r.airport}</span>
                  {r.items.slice(0, 4).map((it, j) => (
                    <span key={j} className={`lp-tick-chip ${it.ok ? 'ok' : 'no'}`}>{it.ok ? '✓' : '✗'}{CAT_LABEL[it.cat] || it.cat}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="lp-ticker-empty glass">Connecting to the live grading feed…</div>
        )}
      </section>

      {/* ------------------------------------------------------ features --- */}
      <section className="lp-section lp-features" id="features">
        <div className="lp-kicker reveal">WHAT&rsquo;S INSIDE</div>
        <h2 className="reveal">A working control room, not a mockup.</h2>
        <div className="lp-grid">
          {FEATURES.map(([Icon, t, d], i) => (
            <div className="lp-card reveal glass" key={t} style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <div className="lp-card-ico"><Icon size={20} /></div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- immersive ---- */}
      <section className="lp-immersive reveal">
        <div className="lp-kicker">BUILT IN WEBGL</div>
        <h2>Everything you&rsquo;re looking at is rendered live.</h2>
        <p>
          The airfield below you — runway edge lights, sequenced approach flashers, aircraft on final with
          nav and landing lights — is real-time 3D, the same engine that draws the console&rsquo;s radar. Zoom
          into any airport and the runways, thresholds and terminals are drawn from real public airport data.
        </p>
        <a className="lp-cta-ghost" href="/live">Open the live 3D radar <ArrowRight size={16} /></a>
      </section>

      {/* -------------------------------------------------------- trust ---- */}
      <section className="lp-trust reveal">
        <div className="lp-kicker">BUILT TO BE HONEST</div>
        <h2>No paid APIs. No fake data. No cherry-picking.</h2>
        <ul className="lp-checks">
          <li><Check size={16} /> Every source is <b>free and keyless</b> — live ADS-B, METAR/TAF weather, public airport data.</li>
          <li><Check size={16} /> Only <b>live traffic</b> is banked into the all-time score — the simulation is never graded.</li>
          <li><Check size={16} /> Predictions are <b>locked before</b> the outcome and measured from observation alone.</li>
          <li><Check size={16} /> The full training dataset is <b>downloadable</b> — the scorecard is auditable, not marketing.</li>
        </ul>
      </section>

      {/* --------------------------------------------------------- final --- */}
      <section className="lp-final reveal">
        <h2>Watch an AI work live traffic — right now.</h2>
        <p>Pick any of {AIRPORT_COUNT} airports and watch it sequence real arrivals, flip runways with the wind, and grade itself in real time.</p>
        <a className="lp-cta lp-cta-lg" href="/live">Launch live console <ArrowRight size={18} /></a>
      </section>

      {/* -------------------------------------------------------- footer --- */}
      <footer className="lp-footer">
        <div className="lp-foot-brand">
          <img src="/naventra-mark.svg" width="22" height="22" alt="" />
          <span>Naventra</span>
        </div>
        <div className="lp-foot-links">
          <a href="/live">Live console</a>
          <a href="/guide">Operator&rsquo;s guide</a>
          <a href="https://github.com/Rian-Fernando/Naventra" rel="external" target="_blank"><Github size={14} /> Source</a>
        </div>
        <div className="lp-foot-by">Designed &amp; built by <a href="https://rianfernando.com" rel="external" target="_blank">Rian Fernando</a></div>
      </footer>
    </div>
  );
}

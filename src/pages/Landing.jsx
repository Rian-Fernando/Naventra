import { useEffect, useRef, useState } from 'react';
import { Radar, Cpu, CloudSun, ShieldAlert, Boxes, Activity, ArrowRight, Github, Check } from 'lucide-react';
import LandingHero3D from '../components/LandingHero3D.jsx';
import { fetchGlobalScorecard } from '../lib/globalModel.js';
import '../styles/landing.css';

const FEATURES = [
  [Radar, 'Real live traffic', 'Every target is a real aircraft, streamed from live ADS-B transponder feeds around the world’s busiest airports — not a simulation, not a replay.'],
  [Cpu, 'An AI that grades itself', 'When a flight commits to final, the engine locks its prediction — runway, touchdown time, landing order — then scores itself against what actually happened. Publicly. 24/7.'],
  [CloudSun, 'Weather-driven runways', 'It reads the live METAR and TAF forecast, computes head/crosswind for every runway end, and flips the active configuration exactly like a real tower — before the wind even shifts.'],
  [ShieldAlert, 'Separation monitoring', 'Closest-point-of-approach math projects every aircraft pair 150 seconds ahead, flagging losses of separation before they happen.'],
  [Boxes, '3D radar & airport layout', 'Orbit a true-to-scale 3D scope, zoom to the field to see real runways, terminals and gates, and follow any aircraft in a 3D chase cam.'],
  [Activity, 'Self-learning, always on', 'A cloud model runs every minute, learning runway patterns and timing bias from each real landing — the accuracy climbs on its own.'],
];

const STEPS = [
  ['01', 'Ingest live traffic', 'Naventra pulls real ADS-B returns and live weather every few seconds — the same raw data real controllers and flight-trackers use, from free, keyless sources.'],
  ['02', 'Decide like a controller', 'An autonomous engine allocates runways from the wind, sequences the arrival flow, assigns gates, monitors separation, and generates radio phraseology — no human, no scripted demo.'],
  ['03', 'Grade against reality', 'Each prediction is locked, then measured against the actual landing. The scorecard shows exactly how often the AI was right — and the model keeps learning from every outcome.'],
];

function useCountUp(target, run, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run || !target) return undefined;
    let raf, start;
    const step = (t) => {
      start ??= t;
      const p = Math.min((t - start) / ms, 1);
      setV(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

export default function Landing() {
  const [stats, setStats] = useState(null);
  const [seen, setSeen] = useState(false);
  const statRef = useRef(null);

  useEffect(() => {
    document.title = 'Naventra — AI Air Traffic Command';
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = 'https://naventra.rianfernando.com/';
    // The console locks body scroll; the landing page needs it back.
    document.body.classList.add('landing-mode');
    fetchGlobalScorecard().then((s) => s && setStats(s)).catch(() => {});
    return () => document.body.classList.remove('landing-mode');
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

  return (
    <div className="lp">
      {/* ---------------------------------------------------------- nav ---- */}
      <nav className="lp-nav">
        <a className="lp-brand" href="/">
          <img src="/naventra-mark.svg" width="26" height="26" alt="" />
          <span>Naventra</span>
        </a>
        <div className="lp-nav-links">
          <a href="#how" onClick={scrollTo('how')}>How it works</a>
          <a href="#features" onClick={scrollTo('features')}>Features</a>
          <a href="/guide">Guide</a>
          <a className="lp-cta-sm" href="/live">Launch console <ArrowRight size={14} /></a>
        </div>
      </nav>

      {/* --------------------------------------------------------- hero ---- */}
      <header className="lp-hero">
        <LandingHero3D />
        <div className="lp-hero-scrim" />
        <div className="lp-hero-inner">
          <div className="lp-eyebrow"><span className="lp-live-dot" /> LIVE · AI-NATIVE · $0 — NO API KEYS</div>
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
        <div className="lp-scroll-hint" onClick={scrollTo('stats')}>▾</div>
      </header>

      {/* -------------------------------------------------------- stats ---- */}
      <section className="lp-stats" id="stats" ref={statRef}>
        <div className="lp-stat">
          <b>{pct}<span>%</span></b>
          <span className="lp-stat-l">recent prediction accuracy</span>
        </div>
        <div className="lp-stat">
          <b>{ops.toLocaleString()}</b>
          <span className="lp-stat-l">real operations graded</span>
        </div>
        <div className="lp-stat">
          <b>{rows.toLocaleString()}</b>
          <span className="lp-stat-l">labeled training rows</span>
        </div>
        <div className="lp-stat">
          <b>15</b>
          <span className="lp-stat-l">airports · updated every minute</span>
        </div>
      </section>

      {/* ---------------------------------------------------------- how ---- */}
      <section className="lp-section" id="how">
        <div className="lp-kicker">HOW IT WORKS</div>
        <h2>Live data in. A controller&rsquo;s decisions out. Graded against the real world.</h2>
        <div className="lp-steps">
          {STEPS.map(([n, t, d]) => (
            <div className="lp-step" key={n}>
              <div className="lp-step-n">{n}</div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ features --- */}
      <section className="lp-section lp-features" id="features">
        <div className="lp-kicker">WHAT&rsquo;S INSIDE</div>
        <h2>A working control room, not a mockup.</h2>
        <div className="lp-grid">
          {FEATURES.map(([Icon, t, d]) => (
            <div className="lp-card" key={t}>
              <div className="lp-card-ico"><Icon size={20} /></div>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- trust ---- */}
      <section className="lp-trust">
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
      <section className="lp-final">
        <h2>Watch an AI work live traffic — right now.</h2>
        <p>Pick any of 15 airports and watch it sequence real arrivals, flip runways with the wind, and grade itself in real time.</p>
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

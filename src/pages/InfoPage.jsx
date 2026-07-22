import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import '../styles/landing.css';

// Standalone document pages linked from the footer — Privacy, Data & Sources,
// About. Plain, official-looking, and all true. No 3D, no tracking scripts.

const SOURCES = [
  ['Live aircraft (ADS-B)', 'airplanes.live · adsb.lol · adsb.fi', 'Community ADS-B receiver networks. Free, keyless, and cross-checked against each other. Every target on the radar is a real aircraft broadcasting its own position.'],
  ['Weather (METAR & TAF)', 'NOAA / NWS Aviation Weather Center', 'The official U.S. government aviation weather service. Drives runway allocation and the forecast outlook.'],
  ['Flight routes', 'adsbdb.com', 'Free, keyless callsign → origin/destination lookups, reconciled against observed direction of flight.'],
  ['Airports & runways', 'OurAirports (public domain)', 'Runway thresholds, headings, lengths and frequencies. Exact geometry is generated from this dataset at build time — nothing is hand-entered.'],
];

function Privacy() {
  return (
    <>
      <h1>Privacy</h1>
      <p className="info-lede">Naventra is built to need as little of your data as possible — because it needs none of it.</p>
      <h2>No accounts, no personal data</h2>
      <p>There is no sign-up, no login, and no form anywhere on this site. Naventra never asks for or stores any personal information about you.</p>
      <h2>What is stored, and where</h2>
      <ul>
        <li><b>On your device only:</b> your layout preferences (which panels are open, column widths, radar view) live in your browser&rsquo;s <code>localStorage</code>. They never leave your machine and you can clear them any time.</li>
        <li><b>Anonymous analytics:</b> aggregate page views via Vercel Web Analytics, which does not use cookies to identify individuals.</li>
        <li><b>The learning model</b> stores operational flight data (public ADS-B positions, runways, timings) — never anything about the people viewing the site.</li>
      </ul>
      <h2>Third-party data</h2>
      <p>The console fetches live data from the public sources listed on the <a href="/data">Data &amp; Sources</a> page. Those requests are made from your browser to those services under their own terms.</p>
    </>
  );
}

function DataSources() {
  return (
    <>
      <h1>Data &amp; Sources</h1>
      <p className="info-lede">Every number on Naventra comes from a real, free, publicly available source. Here is exactly where each one comes from.</p>
      <div className="info-sources">
        {SOURCES.map(([t, s, d]) => (
          <div className="info-source" key={t}>
            <h3>{t}</h3>
            <div className="info-source-name">{s}</div>
            <p>{d}</p>
          </div>
        ))}
      </div>
      <h2>How the scorecard is graded</h2>
      <p>When an aircraft commits to final, the engine locks its prediction; at touchdown the actual outcome is measured purely from the observed track. Only live traffic is banked into the all-time accuracy. The full methodology is in the <a href="/guide">Operator&rsquo;s Guide</a>, and the complete labeled training set is downloadable so the score can be independently verified.</p>
      <h2>Attribution</h2>
      <p>Airport and runway data is derived from <a href="https://ourairports.com/data/" rel="external" target="_blank">OurAirports</a>, released into the public domain. ADS-B data is provided by the airplanes.live, adsb.lol and adsb.fi community networks. Weather is from the NOAA/NWS Aviation Weather Center. Naventra is grateful to these projects.</p>
      <p className="info-note">Naventra is an independent portfolio project. It is not affiliated with any aviation authority and must not be used for operational or navigational purposes.</p>
    </>
  );
}

function About() {
  return (
    <>
      <h1>About Naventra</h1>
      <p className="info-lede">An AI-native air traffic control console that works real, live traffic — and grades itself against reality, 24/7.</p>
      <p>Naventra ingests live ADS-B transponder data and current weather around the world&rsquo;s busiest airports, then runs an autonomous decision engine that does the controller&rsquo;s job: allocating runways from the wind, sequencing arrivals, monitoring separation, assigning gates and generating radio phraseology. Uniquely, it then locks each prediction and measures it against what actually happened, publishing an honest, auditable accuracy score.</p>
      <h2>How it&rsquo;s built</h2>
      <ul>
        <li><b>Frontend:</b> a Vite + React single-page app with a three.js 3D radar.</li>
        <li><b>Engine:</b> a deterministic expert system plus an online learning layer — no black-box LLM in the control loop.</li>
        <li><b>Always-on model:</b> a Cloudflare Worker + D1 database that tracks and grades real operations every minute, banking a shared self-learning model.</li>
        <li><b>Cost:</b> $0. Every data source is free and keyless.</li>
      </ul>
      <h2>Who built it</h2>
      <p>Designed and built by <a href="https://rianfernando.com" rel="external" target="_blank">Rian Fernando</a>. Source on <a href="https://github.com/Rian-Fernando/Naventra" rel="external" target="_blank">GitHub</a>.</p>
      <p className="info-note">Independent portfolio project · not affiliated with any aviation authority · not for operational use.</p>
    </>
  );
}

const PAGES = {
  '/privacy': { title: 'Privacy — Naventra', body: Privacy },
  '/data': { title: 'Data & Sources — Naventra', body: DataSources },
  '/about': { title: 'About — Naventra', body: About },
};

export default function InfoPage({ route }) {
  const key = Object.keys(PAGES).find((p) => route.startsWith(p)) || '/about';
  const { title, body: Body } = PAGES[key];

  useEffect(() => {
    document.title = title;
    document.body.classList.add('landing-mode');
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = `https://naventra.rianfernando.com${key}`;
    window.scrollTo(0, 0);
    return () => document.body.classList.remove('landing-mode');
  }, [title, key]);

  return (
    <div className="info-page">
      <nav className="lp-nav">
        <a className="lp-brand" href="/">
          <img src="/naventra-mark.svg" width="26" height="26" alt="" />
          <span>Naventra</span>
        </a>
        <div className="lp-nav-links">
          <a href="/guide">Guide</a>
          <a className="lp-cta-sm" href="/live">Launch console</a>
        </div>
      </nav>
      <article className="info-body">
        <a className="info-back" href="/"><ArrowLeft size={13} /> Back to home</a>
        <Body />
        <div className="info-foot">
          <a href="/privacy">Privacy</a><a href="/data">Data &amp; sources</a><a href="/about">About</a><a href="/guide">Guide</a>
        </div>
      </article>
    </div>
  );
}

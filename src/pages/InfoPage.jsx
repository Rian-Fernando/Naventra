import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { applyMeta } from '../lib/seo.js';
import '../styles/landing.css';

// Standalone document pages linked from the footer — Privacy, Data & Sources,
// About. Plain, official-looking, and all true. No 3D, no tracking scripts.

const SOURCES = [
  ['Live aircraft (ADS-B)', 'adsb.lol · adsb.fi', 'Community ADS-B receiver networks, free and keyless, with automatic failover between them. Every target on the radar is a real aircraft broadcasting its own position.'],
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
      <p>There is no sign-up and no login. Naventra never requires any personal information to use it.</p>
      <h2>What is stored, and where</h2>
      <ul>
        <li><b>On your device only:</b> your layout preferences (which panels are open, column widths, radar view) live in your browser&rsquo;s <code>localStorage</code>. They never leave your machine and you can clear them any time.</li>
        <li><b>Anonymous analytics:</b> aggregate page views via Vercel Web Analytics, which does not use cookies to identify individuals.</li>
        <li><b>The learning model</b> stores operational flight data (public ADS-B positions, runways, timings) — never anything about the people viewing the site.</li>
      </ul>
      <h2>Feedback</h2>
      <p>The only form on the site is the optional <b>Feedback</b> button (bottom-right), provided by Feedex. If you use it, it sends what you type, any file you choose to attach, and an email address only if you choose to add one — together with the page you were on and the app version, so the report is actionable. Nothing is sent unless you submit it.</p>
      <h2>Third-party data</h2>
      <p>The console uses the public sources listed on the <a href="/data">Data &amp; Sources</a> page. Live aircraft positions and weather are requested through Naventra&rsquo;s own relay, so those providers see our server rather than your browser. Flight-route lookups (adsbdb.com) and the US weather fallback (api.weather.gov) are requested directly from your browser, under those services&rsquo; own terms.</p>
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
      <p>Live aircraft positions come from the community ADS-B networks <a href="https://adsb.lol" rel="external" target="_blank">adsb.lol</a> (data licensed under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="external" target="_blank">Open Database License (ODbL) 1.0</a>) and <a href="https://adsb.fi" rel="external" target="_blank">adsb.fi</a>. Weather is from the <a href="https://aviationweather.gov" rel="external" target="_blank">NOAA/NWS Aviation Weather Center</a>. Callsign routes are from <a href="https://www.adsbdb.com" rel="external" target="_blank">adsbdb.com</a>. Airport and runway data is derived from <a href="https://ourairports.com/data/" rel="external" target="_blank">OurAirports</a>, released into the public domain. Naventra is grateful to these projects.</p>
      <h2>Dataset license</h2>
      <p>The downloadable training dataset is derived from the ADS-B data above, so it is offered under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="external" target="_blank">ODbL 1.0</a> — you may reuse it with attribution, and share adapted versions under the same license. Naventra&rsquo;s source code is separately <a href="https://github.com/Rian-Fernando/Naventra/blob/main/LICENSE" rel="external" target="_blank">MIT-licensed</a>.</p>
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
  '/privacy': {
    title: 'Privacy — Naventra',
    description: 'Naventra privacy: no accounts, no personal data, and no tracking cookies. Layout preferences stay in your browser; the learning model stores only public flight data, never anything about visitors.',
    body: Privacy,
  },
  '/data': {
    title: 'Data & Sources — Naventra',
    description: 'Every data source behind Naventra: live ADS-B (adsb.lol, adsb.fi), NOAA/NWS METAR & TAF weather, adsbdb.com routes, and OurAirports airport data — all free, keyless and public, with attribution.',
    body: DataSources,
  },
  '/about': {
    title: 'About — Naventra',
    description: 'About Naventra — an AI-native air traffic control console that ingests live ADS-B and weather, runs an autonomous controller engine, and grades its own predictions against real landings 24/7. Built by Rian Fernando.',
    body: About,
  },
};

export default function InfoPage({ route }) {
  const key = Object.keys(PAGES).find((p) => route.startsWith(p)) || '/about';
  const { title, description, body: Body } = PAGES[key];

  useEffect(() => {
    applyMeta({ path: key, title, description });
    document.body.classList.add('landing-mode');
    window.scrollTo(0, 0);
    return () => document.body.classList.remove('landing-mode');
  }, [title, description, key]);

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

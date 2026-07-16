import { useEffect, useState } from 'react';
import { useAtcSystem } from './hooks/useAtcSystem.js';
import Header from './components/Header.jsx';
import RadarPanel from './components/RadarPanel.jsx';
import FlightStrips from './components/FlightStrips.jsx';
import AIDecisionFeed from './components/AIDecisionFeed.jsx';
import ConflictPanel from './components/ConflictPanel.jsx';
import RunwayPanel from './components/RunwayPanel.jsx';
import WeatherPanel from './components/WeatherPanel.jsx';
import CommsLog from './components/CommsLog.jsx';
import AircraftDetail from './components/AircraftDetail.jsx';
import ScorecardPanel from './components/ScorecardPanel.jsx';
import Guide from './pages/Guide.jsx';

// Path-based routing so /guide is a real, crawlable URL. Internal <a href>
// clicks are intercepted into pushState; legacy #/guide links still land.
function usePathRoute() {
  const [route, setRoute] = useState(window.location.pathname);
  useEffect(() => {
    if (window.location.hash.startsWith('#/guide')) {
      window.history.replaceState(null, '', '/guide');
      setRoute('/guide');
    }
    const onPop = () => setRoute(window.location.pathname);
    const onClick = (e) => {
      const a = e.target.closest('a');
      if (!a || a.origin !== window.location.origin || a.target === '_blank') return;
      e.preventDefault();
      window.history.pushState(null, '', a.pathname);
      setRoute(a.pathname);
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return route;
}

export default function App() {
  const atc = useAtcSystem();
  const route = usePathRoute();
  const onGuide = route.startsWith('/guide');

  // Keep the canonical URL in step with the route.
  useEffect(() => {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = `https://naventra.rianfernando.com${onGuide ? '/guide' : '/'}`;
    document.title = onGuide ? "Operator's Guide — Naventra" : 'Naventra — AI Air Traffic Command';
  }, [onGuide]);

  return (
    <div className={`shell ${onGuide ? 'shell-guide' : ''}`}>
      <Header
        airport={atc.airport} icao={atc.icao} setIcao={atc.setIcao}
        mode={atc.mode} source={atc.source}
        forceSim={atc.forceSim} setForceSim={atc.setForceSim}
        kpis={atc.kpis} scorecard={atc.scorecard} onGuide={onGuide}
      />

      {onGuide ? (
        <Guide />
      ) : (
        <>
          <div className="main">
            <div className="col">
              <FlightStrips
                aircraft={atc.aircraft} conflicts={atc.conflicts}
                selectedId={atc.selectedId} onSelect={atc.setSelectedId}
              />
              <RunwayPanel runways={atc.runways} />
            </div>

            <div className="col" style={{ position: 'relative' }}>
              <RadarPanel
                airport={atc.airport} aircraft={atc.aircraft} conflicts={atc.conflicts}
                runways={atc.runways} selectedId={atc.selectedId} onSelect={atc.setSelectedId}
                mode={atc.mode}
              />
              <AircraftDetail aircraft={atc.selected} onClose={() => atc.setSelectedId(null)} />
            </div>

            <div className="col">
              <ScorecardPanel scorecard={atc.scorecard} mode={atc.mode} scope={atc.scoreScope} globalTotals={atc.globalTotals} />
              <ConflictPanel conflicts={atc.conflicts} onSelect={atc.setSelectedId} />
              <AIDecisionFeed decisions={atc.decisions} />
              <WeatherPanel weather={atc.weather} airport={atc.airport} />
            </div>
          </div>

          <CommsLog comms={atc.comms} airport={atc.airport} />
        </>
      )}
    </div>
  );
}

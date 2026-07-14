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

function useHashRoute() {
  const [route, setRoute] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export default function App() {
  const atc = useAtcSystem();
  const route = useHashRoute();
  const onGuide = route.startsWith('#/guide');

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
              <ScorecardPanel scorecard={atc.scorecard} mode={atc.mode} />
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

import { useEffect, useState } from 'react';
import { useAtcSystem } from './hooks/useAtcSystem.js';
import { useViewPrefs } from './hooks/useViewPrefs.js';
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
  const view = useViewPrefs();
  const route = usePathRoute();
  const onGuide = route.startsWith('/guide');

  useEffect(() => {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = `https://naventra.rianfernando.com${onGuide ? '/guide' : '/'}`;
    document.title = onGuide ? "Operator's Guide — Naventra" : 'Naventra — AI Air Traffic Command';
  }, [onGuide]);

  const { panels } = view.prefs;
  const leftV = panels.strips || panels.runways;
  const centerV = panels.radar;
  const rightV = panels.scorecard || panels.separation || panels.feed || panels.weather;
  const nCols = [leftV, centerV, rightV].filter(Boolean).length;
  const anyMain = nCols > 0;

  // Reflow the grid to fill whatever's visible; leave the default (all three
  // columns) to CSS so the responsive breakpoints keep working.
  const cols = [];
  if (leftV) cols.push(centerV ? '300px' : 'minmax(0, 1fr)');
  if (centerV) cols.push('minmax(0, 1fr)');
  if (rightV) cols.push(centerV ? '340px' : 'minmax(0, 1fr)');
  const customCols = !(leftV && centerV && rightV);
  const mainStyle = customCols ? { gridTemplateColumns: cols.join(' ') } : undefined;
  const shellStyle = panels.comms ? undefined : { gridTemplateRows: onGuide ? '54px 1fr' : '54px 1fr' };

  return (
    <div className={`shell ${onGuide ? 'shell-guide' : ''}`} style={onGuide ? undefined : shellStyle}>
      <Header
        airport={atc.airport} icao={atc.icao} setIcao={atc.setIcao}
        mode={atc.mode} source={atc.source}
        forceSim={atc.forceSim} setForceSim={atc.setForceSim}
        kpis={atc.kpis} scorecard={atc.scorecard} onGuide={onGuide}
        view={view}
      />

      {onGuide ? (
        <Guide />
      ) : (
        <>
          <div className="main" style={mainStyle}>
            {!anyMain && (
              <div className="empty-note" style={{ margin: 'auto' }}>
                All panels hidden — open the ☰ menu to bring panels back.
              </div>
            )}
            {leftV && (
              <div className="col">
                {panels.strips && (
                  <FlightStrips
                    aircraft={atc.aircraft} conflicts={atc.conflicts} airline={view.prefs.airline}
                    selectedId={atc.selectedId} onSelect={atc.setSelectedId}
                  />
                )}
                {panels.runways && <RunwayPanel runways={atc.runways} />}
              </div>
            )}

            {centerV && (
              <div className="col" style={{ position: 'relative' }}>
                <RadarPanel
                  airport={atc.airport} aircraft={atc.aircraft} conflicts={atc.conflicts}
                  runways={atc.runways} selectedId={atc.selectedId} onSelect={atc.setSelectedId}
                  mode={atc.mode} view={view}
                />
                <AircraftDetail aircraft={atc.selected} onClose={() => atc.setSelectedId(null)} />
              </div>
            )}

            {rightV && (
              <div className="col">
                {panels.scorecard && <ScorecardPanel scorecard={atc.scorecard} mode={atc.mode} scope={atc.scoreScope} globalTotals={atc.globalTotals} />}
                {panels.separation && <ConflictPanel conflicts={atc.conflicts} onSelect={atc.setSelectedId} />}
                {panels.feed && <AIDecisionFeed decisions={atc.decisions} />}
                {panels.weather && <WeatherPanel weather={atc.weather} airport={atc.airport} />}
              </div>
            )}
          </div>

          {panels.comms && <CommsLog comms={atc.comms} airport={atc.airport} />}
        </>
      )}
    </div>
  );
}

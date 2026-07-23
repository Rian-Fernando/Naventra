import { useEffect } from 'react';
import { useAtcSystem } from './hooks/useAtcSystem.js';
import { useViewPrefs } from './hooks/useViewPrefs.js';
import { AIRPORT_LIST } from './data/airports.js';
import { COLW } from './hooks/useViewPrefs.js';
import Header from './components/Header.jsx';
import RadarPanel from './components/RadarPanel.jsx';
import FlightStrips from './components/FlightStrips.jsx';
import AIDecisionFeed from './components/AIDecisionFeed.jsx';
import ConflictPanel from './components/ConflictPanel.jsx';
import RunwayPanel from './components/RunwayPanel.jsx';
import OpsStatsPanel from './components/OpsStatsPanel.jsx';
import WeatherPanel from './components/WeatherPanel.jsx';
import ForecastPanel from './components/ForecastPanel.jsx';
import CommsLog from './components/CommsLog.jsx';
import AircraftDetail from './components/AircraftDetail.jsx';
import ScorecardPanel from './components/ScorecardPanel.jsx';
import ResizablePanel, { ColResizer, RowResizer } from './components/ResizablePanel.jsx';
import Guide from './pages/Guide.jsx';
import Tour from './components/Tour.jsx';
import { SettingsProvider } from './hooks/useSettings.jsx';

// The live console (routes /live and /guide). Kept separate from the marketing
// landing page so visiting "/" never spins up the ADS-B engine or WebGL radar.
export default function Console({ route }) {
  const atc = useAtcSystem();
  const view = useViewPrefs();
  const onGuide = route.startsWith('/guide');

  useEffect(() => {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = `https://naventra.rianfernando.com${onGuide ? '/guide' : '/live'}`;
    document.title = onGuide ? "Operator's Guide — Naventra" : 'Live Console — Naventra';
  }, [onGuide]);

  // Keyboard shortcuts: [ ] cycle facility · 2/3 scope · f fullscreen.
  useEffect(() => {
    if (onGuide) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const list = AIRPORT_LIST.map((a) => a.icao);
      const i = list.indexOf(atc.icao);
      if (e.key === '[') atc.setIcao(list[(i - 1 + list.length) % list.length]);
      else if (e.key === ']') atc.setIcao(list[(i + 1) % list.length]);
      else if (e.key === '2') view.setRadarView('2D');
      else if (e.key === '3') view.setRadarView('3D');
      else if (e.key === 'f') {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else document.documentElement.requestFullscreen?.();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGuide, atc, view]);

  const { panels } = view.prefs;
  const leftV = panels.strips || panels.runways || panels.ops;
  const centerV = panels.radar;
  const rightV = panels.scorecard || panels.separation || panels.feed || panels.weather || panels.forecast;
  const nCols = [leftV, centerV, rightV].filter(Boolean).length;
  const anyMain = nCols > 0;

  // Reflow the grid to fill whatever's visible. For the full three-column case
  // we drive widths through --cw-* variables (set only once the user resizes a
  // column) so the responsive breakpoints keep working until then. Reduced
  // layouts set an explicit template.
  const customCols = !(leftV && centerV && rightV);
  let mainStyle;
  if (customCols) {
    const cols = [];
    if (leftV) cols.push(centerV ? `${view.colW.left}px` : 'minmax(0, 1fr)');
    if (centerV) cols.push('minmax(0, 1fr)');
    if (rightV) cols.push(centerV ? `${view.colW.right}px` : 'minmax(0, 1fr)');
    mainStyle = { gridTemplateColumns: cols.join(' ') };
  } else {
    mainStyle = {};
    if (view.colW.left !== COLW.left.def) mainStyle['--cw-left'] = `${view.colW.left}px`;
    if (view.colW.right !== COLW.right.def) mainStyle['--cw-right'] = `${view.colW.right}px`;
  }
  // The comms footer gets its own bounded, resizable row via the has-comms class
  // + --comms-h var (a bare inline row template would fight the mobile stacking).
  const shellStyle = { '--comms-h': `${view.commsH}px` };

  return (
    <SettingsProvider>
    <div className={`shell ${onGuide ? 'shell-guide' : ''} ${!onGuide && panels.comms ? 'has-comms' : ''}`} style={onGuide ? undefined : shellStyle}>
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
            {leftV && centerV && <ColResizer side="left" view={view} />}
            {rightV && centerV && <ColResizer side="right" view={view} />}
            {leftV && (
              <div className="col col-side">
                {panels.strips && (
                  <ResizablePanel id="strips">
                    <FlightStrips
                      aircraft={atc.aircraft} conflicts={atc.conflicts} airline={view.prefs.airline}
                      airport={atc.airport} selectedId={atc.selectedId} onSelect={atc.setSelectedId}
                    />
                  </ResizablePanel>
                )}
                {panels.runways && <ResizablePanel id="runways"><RunwayPanel runways={atc.runways} /></ResizablePanel>}
                {panels.ops && <ResizablePanel id="ops"><OpsStatsPanel opsStats={atc.opsStats} kpis={atc.kpis} /></ResizablePanel>}
              </div>
            )}

            {centerV && (
              <div className="col col-center" style={{ position: 'relative' }}>
                <RadarPanel
                  airport={atc.airport} aircraft={atc.aircraft} conflicts={atc.conflicts}
                  runways={atc.runways} selectedId={atc.selectedId} onSelect={atc.setSelectedId}
                  mode={atc.mode} view={view} weather={atc.weather}
                />
                <AircraftDetail aircraft={atc.selected} airport={atc.airport} onClose={() => atc.setSelectedId(null)} />
              </div>
            )}

            {rightV && (
              <div className="col col-side">
                {panels.scorecard && <ResizablePanel id="scorecard"><ScorecardPanel scorecard={atc.scorecard} mode={atc.mode} scope={atc.scoreScope} globalTotals={atc.globalTotals} /></ResizablePanel>}
                {panels.separation && <ResizablePanel id="separation"><ConflictPanel conflicts={atc.conflicts} onSelect={atc.setSelectedId} /></ResizablePanel>}
                {panels.forecast && <ResizablePanel id="forecast"><ForecastPanel forecast={atc.forecast} airport={atc.airport} runways={atc.runways} /></ResizablePanel>}
                {panels.feed && <ResizablePanel id="feed"><AIDecisionFeed decisions={atc.decisions} /></ResizablePanel>}
                {panels.weather && <ResizablePanel id="weather"><WeatherPanel weather={atc.weather} airport={atc.airport} /></ResizablePanel>}
              </div>
            )}
          </div>

          {panels.comms && (
            <div className="comms-wrap">
              <RowResizer view={view} />
              <CommsLog comms={atc.comms} airport={atc.airport} />
            </div>
          )}
          <Tour />
        </>
      )}
    </div>
    </SettingsProvider>
  );
}

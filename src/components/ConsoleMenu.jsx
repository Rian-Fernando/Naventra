import { useEffect, useRef, useState } from 'react';
import { Menu, X, BookOpen, ExternalLink, Github, LayoutGrid, Check, Maximize2 } from 'lucide-react';
import { PANELS, PRESETS } from '../hooks/useViewPrefs.js';

// Hamburger menu: navigation links + layout presets + per-panel show/hide.
export default function ConsoleMenu({ prefs, togglePanel, applyPreset, reset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const enterFullscreen = () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  return (
    <div className="cmenu" ref={ref}>
      <button className="cmenu-btn" onClick={() => setOpen(!open)} title="Menu" aria-label="Menu">
        {open ? <X size={17} /> : <Menu size={17} />}
      </button>

      {open && (
        <div className="cmenu-pop">
          <div className="cmenu-sec">
            <div className="cmenu-h">Navigate</div>
            <a className="cmenu-link" href="/guide"><BookOpen size={13} /> Operator&rsquo;s Guide</a>
            <a className="cmenu-link" href="https://rianfernando.com" target="_blank" rel="noopener"><ExternalLink size={13} /> rianfernando.com</a>
            <a className="cmenu-link" href="https://github.com/Rian-Fernando/Naventra" target="_blank" rel="noopener"><Github size={13} /> Source on GitHub</a>
            <button className="cmenu-link" onClick={enterFullscreen}><Maximize2 size={13} /> Toggle fullscreen</button>
          </div>

          <div className="cmenu-sec">
            <div className="cmenu-h"><LayoutGrid size={12} /> Layout presets</div>
            <div className="cmenu-presets">
              {Object.keys(PRESETS).map((name) => (
                <button key={name} className="cmenu-preset" onClick={() => applyPreset(name)}>{name}</button>
              ))}
            </div>
          </div>

          <div className="cmenu-sec">
            <div className="cmenu-h">Panels
              <button className="cmenu-reset" onClick={reset}>reset</button>
            </div>
            {PANELS.map(([key, label]) => (
              <button key={key} className={`cmenu-toggle ${prefs.panels[key] ? 'on' : ''}`} onClick={() => togglePanel(key)}>
                <span className="cmenu-box">{prefs.panels[key] && <Check size={11} />}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

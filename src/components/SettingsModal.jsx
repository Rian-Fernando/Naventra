import { X, Sliders } from 'lucide-react';
import { useSettings } from '../hooks/useSettings.jsx';

const GROUPS = [
  ['Temperature', 'temp', [['°C', 'C'], ['°F', 'F']]],
  ['Speed & wind', 'speed', [['Knots', 'kt'], ['mph', 'mph'], ['km/h', 'kmh']]],
  ['Distance', 'distance', [['Nautical mi', 'nm'], ['Kilometres', 'km'], ['Miles', 'mi']]],
  ['Altitude', 'altitude', [['Feet / FL', 'ft'], ['Metres', 'm']]],
  ['Clock', 'clock', [['24-hour', '24h'], ['12-hour', '12h']]],
];

export default function SettingsModal({ onClose }) {
  const { settings, setSetting, reset } = useSettings();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" role="dialog" aria-label="Display settings" onClick={(e) => e.stopPropagation()}>
        <div className="sm-head">
          <span><Sliders size={14} /> Display settings</span>
          <button className="sm-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="sm-body">
          {GROUPS.map(([label, key, opts]) => (
            <div className="sm-row" key={key}>
              <div className="sm-label">{label}</div>
              <div className="seg">
                {opts.map(([txt, val]) => (
                  <button key={val} className={settings[key] === val ? 'on' : ''} onClick={() => setSetting(key, val)}>{txt}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sm-foot">
          <button className="sm-reset" onClick={reset}>Reset to defaults</button>
          <span>Saved on this device</span>
        </div>
      </div>
    </div>
  );
}

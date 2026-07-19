import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Find a specific aircraft on the scope by callsign, registration, type or hex.
// Selecting a result highlights it on the radar and opens its detail card.
export default function SearchBox({ aircraft, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const query = q.trim().toUpperCase();
  const matches = query.length < 1 ? [] : aircraft
    .filter((a) =>
      (a.callsign || '').toUpperCase().includes(query) ||
      (a.reg || '').toUpperCase().includes(query) ||
      (a.type || '').toUpperCase().includes(query) ||
      (a.id || '').toUpperCase().includes(query))
    .sort((a, b) => a.distNm - b.distNm)
    .slice(0, 8);

  const pick = (a) => { onSelect(a.id); setOpen(false); setQ(''); };

  return (
    <div className="radar-search" ref={ref}>
      <button className="rs-btn" onClick={() => setOpen((o) => !o)} title="Find aircraft (callsign, reg, type)">
        {open ? <X size={13} /> : <Search size={13} />}
      </button>
      {open && (
        <div className="rs-panel">
          <input
            ref={inputRef}
            className="rs-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) pick(matches[0]); if (e.key === 'Escape') setOpen(false); }}
            placeholder="Find callsign / reg / type…"
            spellCheck={false}
          />
          {query.length >= 1 && (
            <div className="rs-results">
              {matches.length === 0 && <div className="rs-empty">No match in sector</div>}
              {matches.map((a) => (
                <button key={a.id} className="rs-row" onClick={() => pick(a)}>
                  <span className="rs-cs">{a.callsign}</span>
                  <span className="rs-meta">{a.type || '—'} · {a.phase}</span>
                  <span className="rs-dist">{a.distNm.toFixed(0)}nm</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

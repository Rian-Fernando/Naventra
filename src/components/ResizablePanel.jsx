import { useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { COLW } from '../hooks/useViewPrefs.js';

// Wraps a console panel to make it individually resizable (drag the bottom grip)
// and collapsible (chevron top-right, or double-click the header). Sizes persist
// per panel id. Until the user drags, the panel keeps its natural flex sizing —
// resizing is an opt-in override — so the default layout is unchanged.
const HMIN = 88, HMAX = 900;

function load(id) { try { return JSON.parse(localStorage.getItem(`nv-panel-${id}`)) || {}; } catch { return {}; } }
function save(id, v) { try { localStorage.setItem(`nv-panel-${id}`, JSON.stringify(v)); } catch { /* ignore */ } }

export default function ResizablePanel({ id, grow, children }) {
  const init = load(id);
  const [height, setHeight] = useState(init.height ?? null);
  const [collapsed, setCollapsed] = useState(init.collapsed ?? false);
  const ref = useRef(null);

  const toggle = () => setCollapsed((c) => { const n = !c; save(id, { height, collapsed: n }); return n; });

  const onGripDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = ref.current.getBoundingClientRect().height;
    let latest = startH;
    const move = (ev) => {
      latest = Math.max(HMIN, Math.min(HMAX, startH + (ev.clientY - startY)));
      setHeight(latest);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      save(id, { height: latest, collapsed });
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const onDblHead = (e) => { if (e.target.closest('.panel-head')) toggle(); };

  const sized = !collapsed && height != null;
  const style = collapsed ? { flex: 'none' } : sized ? { height, flex: 'none' } : (grow ? { flex: grow } : undefined);

  return (
    <div
      ref={ref}
      className={`rpanel ${collapsed ? 'collapsed' : ''} ${sized ? 'sized' : ''}`}
      style={style}
      onDoubleClick={onDblHead}
    >
      {children}
      <button className="rpanel-toggle" onClick={toggle} title={collapsed ? 'Expand panel' : 'Collapse panel'} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </button>
      {!collapsed && <div className="rpanel-grip" onPointerDown={onGripDown} title="Drag to resize" />}
    </div>
  );
}

// Draggable gutter that resizes a side column. Positioned over the grid gap,
// anchored to the column's inner edge; clamped to the column bounds.
export function ColResizer({ side, view }) {
  const onDown = (e) => {
    e.preventDefault();
    const main = e.currentTarget.closest('.main');
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const move = (ev) => {
      const v = side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX;
      view.setColW(side, v);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const pos = side === 'left'
    ? { left: `${view.colW.left}px` }
    : { right: `${view.colW.right}px` };
  return <div className={`col-resizer col-resizer-${side}`} style={pos} onPointerDown={onDown} title="Drag to resize column" />;
}

// Drag handle on the top edge of the comms footer to change its height.
export function RowResizer({ view }) {
  const onDown = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = view.commsH;
    const move = (ev) => view.setCommsH(startH - (ev.clientY - startY));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  return <div className="row-resizer" onPointerDown={onDown} title="Drag to resize" />;
}

export { COLW };

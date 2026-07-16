import { useEffect, useRef, useCallback } from 'react';
import { toLocalNm, deadReckon, fmtFL } from '../lib/geo.js';
import { iconKind } from '../lib/aircraftIcon.js';

const COLORS = {
  FINAL: '#57f2ae',
  APPROACH: '#3ddc97',
  ARRIVAL: '#2fae79',
  DEPARTURE: '#4cc9f0',
  GROUND: '#a78bfa',
  ENROUTE: '#4a6272',
  conflict: '#ff5c5c',
  selected: '#e8f6ee',
};

const SWEEP_PERIOD_MS = 4600;
const FT_PER_NM = 6076.12;

// Top-down airliner silhouette (swept wings, engine nacelles), nose up.
function drawPlane(ctx, x, y, trackDeg, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, -1.05);              // nose
  ctx.quadraticCurveTo(0.13, -0.9, 0.13, -0.55);
  ctx.lineTo(0.13, -0.2);
  ctx.lineTo(0.98, 0.28);            // right wing (swept back)
  ctx.lineTo(0.98, 0.46);
  ctx.lineTo(0.13, 0.16);
  ctx.lineTo(0.12, 0.66);
  ctx.lineTo(0.4, 0.9);             // right tailplane
  ctx.lineTo(0.4, 1.04);
  ctx.lineTo(0, 0.86);
  ctx.lineTo(-0.4, 1.04);           // left tailplane
  ctx.lineTo(-0.4, 0.9);
  ctx.lineTo(-0.12, 0.66);
  ctx.lineTo(-0.13, 0.16);
  ctx.lineTo(-0.98, 0.46);          // left wing
  ctx.lineTo(-0.98, 0.28);
  ctx.lineTo(-0.13, -0.2);
  ctx.lineTo(-0.13, -0.55);
  ctx.quadraticCurveTo(-0.13, -0.9, 0, -1.05);
  ctx.closePath();
  ctx.fill();
  // engine nacelles under the wings
  ctx.fillRect(0.38, 0.02, 0.14, 0.2);
  ctx.fillRect(-0.52, 0.02, 0.14, 0.2);
  ctx.restore();
}

// Light GA: straight (unswept) wings, stubbier body — reads as a small prop.
function drawLight(ctx, x, y, trackDeg, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, -0.95);
  ctx.lineTo(0.1, -0.5);
  ctx.lineTo(0.1, -0.12);
  ctx.lineTo(0.92, -0.02);          // straight wing, no sweep
  ctx.lineTo(0.92, 0.14);
  ctx.lineTo(0.1, 0.12);
  ctx.lineTo(0.1, 0.72);
  ctx.lineTo(0.34, 0.86);           // tailplane
  ctx.lineTo(0.34, 0.98);
  ctx.lineTo(0, 0.82);
  ctx.lineTo(-0.34, 0.98);
  ctx.lineTo(-0.34, 0.86);
  ctx.lineTo(-0.1, 0.72);
  ctx.lineTo(-0.1, 0.12);
  ctx.lineTo(-0.92, 0.14);
  ctx.lineTo(-0.92, -0.02);
  ctx.lineTo(-0.1, -0.12);
  ctx.lineTo(-0.1, -0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Rotorcraft: teardrop cabin + tail boom with a tail-rotor stub, and a main
// rotor drawn as two thin crossed blades over a hub.
function drawHeli(ctx, x, y, trackDeg, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.scale(size, size);
  const col = ctx.fillStyle;
  // cabin
  ctx.beginPath();
  ctx.ellipse(0, -0.18, 0.3, 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  // tail boom + tail rotor
  ctx.fillRect(-0.06, 0.22, 0.12, 0.72);
  ctx.fillRect(-0.22, 0.9, 0.44, 0.08);
  // main rotor: two thin blades crossed, with a small hub
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-0.95, -0.35); ctx.lineTo(0.95, -0.01);   // blade 1
  ctx.moveTo(-0.7, 0.55);   ctx.lineTo(0.7, -0.9);      // blade 2
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -0.18, 0.12, 0, Math.PI * 2);              // rotor hub
  ctx.fill();
  ctx.restore();
}

// Unknown emitter (no category, no type): a hollow chevron — clearly "raw
// contact, unclassified" versus the solid known-aircraft shapes.
function drawUnknown(ctx, x, y, trackDeg, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((trackDeg * Math.PI) / 180);
  ctx.scale(size, size);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 0.16;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.62, 0.5);
  ctx.lineTo(0, -0.7);
  ctx.lineTo(0.62, 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawIcon(ctx, kind, x, y, track, size) {
  if (kind === 'heli') return drawHeli(ctx, x, y, track, size);
  if (kind === 'light') return drawLight(ctx, x, y, track, size);
  if (kind === 'unknown') return drawUnknown(ctx, x, y, track, size);
  return drawPlane(ctx, x, y, track, size);
}

// Classic 2D top-down scope. Controlled by RadarPanel (range/labels/trails).
export default function RadarScope({ airport, aircraft, conflicts, runways, selectedId, onSelect, range, labels, showTrails }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef({ aircraft: [], conflicts: [], runways: [], selectedId: null, airport: null });
  const trailsRef = useRef(new Map());
  const rangeRef = useRef(range);
  const optsRef = useRef({ labels, showTrails });

  stateRef.current = { aircraft, conflicts, runways, selectedId, airport };
  rangeRef.current = range;
  optsRef.current = { labels, showTrails };

  // Reset trails when the facility changes.
  useEffect(() => { trailsRef.current = new Map(); }, [airport.icao]);

  const hitTest = useCallback((px, py) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radius = Math.min(cx, cy) - 18;
    const scale = radius / rangeRef.current;
    const { aircraft: acs, airport: ap } = stateRef.current;
    const now = Date.now();
    let best = null;
    let bestD = 16;
    for (const ac of acs) {
      const dr = deadReckon(ac.lat, ac.lon, ac.onGround ? 0 : ac.gs, ac.track, Math.min((now - ac.seenAt) / 1000, 60));
      const { x, y } = toLocalNm(ap.lat, ap.lon, dr.lat, dr.lon);
      const sx = cx + x * scale;
      const sy = cy - y * scale;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestD) { bestD = d; best = ac.id; }
    }
    return best;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let lastTrailSample = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const { aircraft: acs, conflicts: confl, runways: rwys, selectedId: selId, airport: ap } = stateRef.current;
      const rangeNm = rangeRef.current;
      const { labels: labelMode, showTrails: trailsOn } = optsRef.current;
      const now = Date.now();

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 18;
      const scale = radius / rangeNm;
      const toXY = (lat, lon) => {
        const { x, y } = toLocalNm(ap.lat, ap.lon, lat, lon);
        return [cx + x * scale, cy - y * scale];
      };

      // -- background
      ctx.clearRect(0, 0, width, height);
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      bgGrad.addColorStop(0, '#071310');
      bgGrad.addColorStop(0.75, '#05100d');
      bgGrad.addColorStop(1, '#03080a');
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = bgGrad;
      ctx.fill();

      // -- range rings + labels
      ctx.strokeStyle = 'rgba(61, 220, 151, 0.13)';
      ctx.fillStyle = 'rgba(143, 166, 177, 0.55)';
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const r = (radius * i) / 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${(rangeNm * i) / 4}`, cx + 4, cy - r + 11);
      }
      // crosshair
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = 'rgba(61, 220, 151, 0.07)';
      ctx.stroke();

      // -- compass ticks
      ctx.strokeStyle = 'rgba(61, 220, 151, 0.3)';
      for (let deg = 0; deg < 360; deg += 10) {
        const a = (deg - 90) * (Math.PI / 180);
        const len = deg % 30 === 0 ? 8 : 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (radius - len), cy + Math.sin(a) * (radius - len));
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(143, 166, 177, 0.7)';
      ctx.font = '10px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      for (const [t, deg] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
        const a = (deg - 90) * (Math.PI / 180);
        ctx.fillText(t, cx + Math.cos(a) * (radius - 18), cy + Math.sin(a) * (radius - 18) + 3);
      }
      ctx.textAlign = 'left';

      // -- sweep (phosphor wedge)
      const sweepAngle = ((now % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();
      if (ctx.createConicGradient) {
        const grad = ctx.createConicGradient(sweepAngle - Math.PI * 0.42, cx, cy);
        grad.addColorStop(0, 'rgba(61, 220, 151, 0)');
        grad.addColorStop(0.38, 'rgba(61, 220, 151, 0.1)');
        grad.addColorStop(0.42, 'rgba(87, 242, 174, 0.22)');
        grad.addColorStop(0.4201, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.strokeStyle = 'rgba(87, 242, 174, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
      ctx.stroke();
      ctx.restore();

      // -- runways + extended centerlines
      for (const rwy of rwys) {
        const halfNm = rwy.lenFt / FT_PER_NM / 2;
        // screen direction of the runway axis; y grows downward, hdg 0 = up
        const sdx = Math.sin(rwy.activeHdg * Math.PI / 180);
        const sdy = -Math.cos(rwy.activeHdg * Math.PI / 180);
        const ox = cx + (rwy.offX || 0) * scale;
        const oy = cy - (rwy.offY || 0) * scale;
        const ax = ox - sdx * halfNm * scale;
        const ay = oy - sdy * halfNm * scale;
        const bx = ox + sdx * halfNm * scale;
        const by = oy + sdy * halfNm * scale;

        if (rwy.role.includes('ARR')) {
          // dashed final-approach centerline out to 15nm from the approach end
          ctx.setLineDash([6, 7]);
          ctx.strokeStyle = 'rgba(61, 220, 151, 0.22)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - sdx * 15 * scale, ay - sdy * 15 * scale);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = rwy.status === 'X-WIND' ? 'rgba(255, 180, 84, 0.9)' : 'rgba(217, 230, 236, 0.85)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();

        if (rangeNm <= 20) {
          ctx.fillStyle = 'rgba(143, 166, 177, 0.9)';
          ctx.font = '9px "IBM Plex Mono", monospace';
          ctx.fillText(rwy.activeEnd, ax - sdx * 14 - 8, ay - sdy * 14 + 3);
        }
      }

      // -- airport symbol
      ctx.strokeStyle = 'rgba(217, 230, 236, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.stroke();

      // -- trails sampling (once per ~1.8s, dead-reckoned)
      const sampleTrails = now - lastTrailSample > 1800;
      if (sampleTrails) lastTrailSample = now;

      // -- conflict connectors (under blips)
      for (const c of confl) {
        const pa = deadReckon(c.a.lat, c.a.lon, c.a.gs, c.a.track, Math.min((now - c.a.seenAt) / 1000, 60));
        const pb = deadReckon(c.b.lat, c.b.lon, c.b.gs, c.b.track, Math.min((now - c.b.seenAt) / 1000, 60));
        const [x1c, y1c] = toXY(pa.lat, pa.lon);
        const [x2c, y2c] = toXY(pb.lat, pb.lon);
        ctx.strokeStyle = c.severity === 'critical' ? 'rgba(255, 92, 92, 0.75)' : 'rgba(255, 180, 84, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1c, y1c);
        ctx.lineTo(x2c, y2c);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const conflictIds = new Set(confl.flatMap((c) => [c.a.id, c.b.id]));
      const totalShown = acs.filter((a) => {
        const [sx, sy] = toXY(a.lat, a.lon);
        return Math.hypot(sx - cx, sy - cy) <= radius;
      }).length;

      // Sort so priority tracks (selected, conflict, on approach) claim their
      // label space first; enroute clutter yields when the centre is busy.
      const drawOrder = [...acs].sort((a, b) => rank(a) - rank(b));
      function rank(a) {
        if (a.id === selId) return 0;
        if (conflictIds.has(a.id)) return 1;
        return { FINAL: 2, APPROACH: 3, ARRIVAL: 4, DEPARTURE: 5, GROUND: 7 }[a.phase] ?? 6;
      }
      const labelRects = []; // occupied label boxes for collision suppression
      const collides = (x, y, w, h) =>
        labelRects.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);

      // -- aircraft
      for (const ac of drawOrder) {
        const extrapolate = Math.min((now - ac.seenAt) / 1000, 60);
        const dr = deadReckon(ac.lat, ac.lon, ac.onGround ? Math.min(ac.gs, 30) : ac.gs, ac.track, extrapolate);
        const [sx, sy] = toXY(dr.lat, dr.lon);
        const rFromC = Math.hypot(sx - cx, sy - cy);
        if (rFromC > radius - 2) continue;

        const isConflict = conflictIds.has(ac.id);
        const isSel = ac.id === selId;
        const color = isConflict ? COLORS.conflict : COLORS[ac.phase] || COLORS.ENROUTE;

        // trail
        if (trailsOn) {
          let trail = trailsRef.current.get(ac.id);
          if (!trail) { trail = []; trailsRef.current.set(ac.id, trail); }
          if (sampleTrails) {
            trail.push({ x: dr.lat, y: dr.lon });
            if (trail.length > 22) trail.shift();
          }
          const cr = parseInt(color.slice(1, 3), 16);
          const cg = parseInt(color.slice(3, 5), 16);
          const cb = parseInt(color.slice(5, 7), 16);
          for (let i = 0; i < trail.length; i++) {
            const [tx, ty] = toXY(trail[i].x, trail[i].y);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(i / trail.length) * 0.4})`;
            ctx.fillRect(tx - 1, ty - 1, 2, 2);
          }
        }

        // sweep illumination: brighter shortly after the beam passes
        let blipAngle = Math.atan2(sy - cy, sx - cx);
        let delta = (sweepAngle - blipAngle) % (Math.PI * 2);
        if (delta < 0) delta += Math.PI * 2;
        const illum = Math.max(0, 1 - delta / (Math.PI * 1.7)) * 0.5 + 0.62;

        ctx.save();
        ctx.globalAlpha = Math.min(1, illum + (isSel || isConflict ? 0.35 : 0));
        ctx.shadowColor = color;
        ctx.shadowBlur = isSel ? 14 : 8;

        // velocity leader — 60-second predictor
        if (!ac.onGround && ac.gs > 40) {
          const lead = (ac.gs / 60) * scale; // nm-per-minute → px
          const ang = (ac.track - 90) * (Math.PI / 180);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(ang) * lead, sy + Math.sin(ang) * lead);
          ctx.stroke();
        }

        // blip — real silhouettes by aircraft kind
        ctx.fillStyle = color;
        const kind = iconKind(ac);
        drawIcon(ctx, kind, sx, sy, ac.track, kind === 'heli' ? 5.5 : ac.onGround ? 4.5 : 6);

        if (isSel) {
          ctx.strokeStyle = COLORS.selected;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sx, sy, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (isConflict) {
          const pulse = 8 + Math.sin(now / 160) * 3;
          ctx.strokeStyle = 'rgba(255, 92, 92, 0.8)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        // data block — ground clutter only gets labels when zoomed in
        const important = ac.phase !== 'ENROUTE' && (ac.phase !== 'GROUND' || rangeNm <= 20);
        const showLabel =
          labelMode === 'ALL' ||
          (labelMode === 'AUTO' && (important || totalShown < 26)) ||
          isSel || isConflict;
        // Suppress labels that would overlap one already drawn (declutters the
        // busy centre); selected/conflict always win their space.
        const flipX = sx > width - 96;
        const flipY = sy < 46;
        const lx = flipX ? sx - 12 : sx + 12;
        const ly = flipY ? sy + 16 : sy - 16;
        const lblW = 74, lblH = 22;
        const boxX = flipX ? lx - lblW : lx;
        const boxY = ly - 11;
        const blocked = collides(boxX, boxY, lblW, lblH) && !isSel && !isConflict;
        if (showLabel && !blocked) {
          labelRects.push({ x: boxX, y: boxY, w: lblW, h: lblH });
          ctx.strokeStyle = 'rgba(143, 166, 177, 0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + (flipX ? -6 : 6), sy + (flipY ? 6 : -6));
          ctx.lineTo(lx + (flipX ? 2 : -2), ly + (flipY ? -12 : 10));
          ctx.stroke();

          ctx.font = '600 10px "IBM Plex Mono", monospace';
          ctx.textAlign = flipX ? 'right' : 'left';
          ctx.fillStyle = isConflict ? COLORS.conflict : isSel ? COLORS.selected : 'rgba(217, 230, 236, 0.92)';
          ctx.fillText(ac.callsign, lx, ly);
          ctx.font = '9px "IBM Plex Mono", monospace';
          ctx.fillStyle = 'rgba(143, 166, 177, 0.85)';
          const vsArrow = ac.vs > 250 ? '↑' : ac.vs < -250 ? '↓' : '';
          ctx.fillText(
            `${ac.onGround ? 'GND' : fmtFL(ac.altFt)}${vsArrow} ${Math.round(ac.gs)}kt${ac.type ? ' ' + ac.type : ''}`,
            lx, ly + 11
          );
          ctx.textAlign = 'left';
        }
      }

      // -- outer bezel
      ctx.strokeStyle = 'rgba(29, 50, 66, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  const onClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const id = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    onSelect(id);
  };

  return (
    <div className="radar-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} onClick={onClick} />
    </div>
  );
}

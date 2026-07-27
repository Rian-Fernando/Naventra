import { useEffect, useRef } from 'react';
import { classifyWeather } from '../lib/weatherFx.js';

// Ambient 2D weather for the flat scope — depth-layered rain, soft snow, drifting
// fog, wind streaks and occasional lightning, driven by the live METAR. A
// screen-space canvas over the 2D radar: pointer-events off and translucent, so
// the scope stays readable. (The 3D view renders its own in-scene weather.)
export default function WeatherFX({ weather }) {
  const ref = useRef(null);
  const fx = classifyWeather(weather);
  const fxRef = useRef(fx);
  fxRef.current = fx;

  useEffect(() => {
    const canvas = ref.current;
    const wrap = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts = [];
    let curKind = null;

    // Three depth layers give rain and snow real parallax — far particles are
    // slower, shorter and dimmer than near ones — so it reads as weather with
    // depth, not a flat sheet stretched over the panel.
    const LAYERS = [
      { sp: 0.55, len: 0.6, a: 0.32, w: 0.7 },
      { sp: 0.85, len: 0.9, a: 0.6, w: 1.0 },
      { sp: 1.25, len: 1.35, a: 0.95, w: 1.5 },
    ];
    const pickLayer = () => (Math.random() < 0.45 ? 0 : Math.random() < 0.72 ? 1 : 2);

    // Soft flake sprite, drawn once and blitted per snowflake (cheaper than a
    // radial gradient every frame).
    const flake = document.createElement('canvas');
    flake.width = flake.height = 18;
    {
      const g = flake.getContext('2d');
      const rg = g.createRadialGradient(9, 9, 0, 9, 9, 9);
      rg.addColorStop(0, 'rgba(245,250,255,1)');
      rg.addColorStop(0.5, 'rgba(230,242,252,0.6)');
      rg.addColorStop(1, 'rgba(230,242,252,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(9, 9, 9, 0, 6.2832); g.fill();
    }

    let vignette = null;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vignette = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.2, W / 2, H * 0.5, Math.max(W, H) * 0.72);
      vignette.addColorStop(0, 'rgba(5,10,15,0)');
      vignette.addColorStop(1, 'rgba(4,8,13,0.38)');
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const rnd = (a, b) => a + Math.random() * (b - a);
    const build = (kind, intensity) => {
      parts = [];
      if (kind === 'rain' || kind === 'thunder') {
        const n = Math.round(170 + intensity * 260);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(-40, W), y: rnd(-H, H), layer: pickLayer(), len: rnd(11, 20), sp: rnd(430, 680) });
      } else if (kind === 'snow') {
        const n = Math.round(90 + intensity * 150);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(0, W), y: rnd(0, H), layer: pickLayer(), r: rnd(1.5, 3.4), sp: rnd(20, 52), sway: rnd(0, 6.28), swf: rnd(0.6, 1.5) });
      } else if (kind === 'fog') {
        for (let i = 0; i < 7; i++) parts.push({ x: rnd(0, W), y: rnd(H * 0.15, H), r: rnd(90, 200), sp: rnd(6, 16) });
      } else if (kind === 'wind') {
        const n = Math.round(22 + intensity * 30);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(0, W), y: rnd(0, H), len: rnd(26, 66), sp: rnd(240, 440) });
      }
      curKind = kind;
    };

    // wind drift: METAR wind is where it blows FROM, so it pushes toward dir+180
    const drift = () => {
      const f = fxRef.current;
      const to = ((f.windDir ?? 0) + 180) * Math.PI / 180;
      return { dx: Math.sin(to), speed: Math.min(1, (f.windKt || 0) / 45) };
    };

    // ---- lightning: a jagged bolt with a glow, struck occasionally (no strobe) --
    let bolts = [], boltLife = 0, boltTimer = rnd(1.5, 4);
    const makeBolt = () => {
      const main = [];
      let x = rnd(W * 0.15, W * 0.85);
      const endY = H * rnd(0.5, 0.85);
      const segs = 8 + Math.floor(rnd(0, 5));
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        main.push({ x, y: -8 + (endY + 8) * t });
        x += rnd(-1, 1) * 26 * (1 - t * 0.4);
      }
      bolts = [main];
      if (Math.random() < 0.7) {                    // a branching fork
        const k = 2 + Math.floor(Math.random() * (main.length - 4));
        let fx2 = main[k].x, fy = main[k].y;
        const fork = [{ x: fx2, y: fy }];
        for (let j = 0, n = 3 + (Math.random() * 2 | 0); j < n; j++) { fx2 += rnd(-1, 1) * 24; fy += rnd(12, 26); fork.push({ x: fx2, y: fy }); }
        bolts.push(fork);
      }
      boltLife = 0.34;
    };
    const trace = (poly) => { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); };
    const drawBolts = (op) => {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = ctx.lineCap = 'round';
      for (const poly of bolts) {
        ctx.shadowColor = 'rgba(170,208,255,0.9)'; ctx.shadowBlur = 15;
        ctx.strokeStyle = `rgba(186,218,255,${0.85 * op})`; ctx.lineWidth = 2.4; trace(poly);
        ctx.shadowBlur = 0;                          // bright inner core
        ctx.strokeStyle = `rgba(255,255,255,${op})`; ctx.lineWidth = 1; trace(poly);
      }
      ctx.restore();
    };

    let raf, t0 = performance.now(), running = true;
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!running || document.hidden) return;
      const dt = Math.min((now - t0) / 1000, 0.05); t0 = now;
      const f = fxRef.current;
      if (f.kind !== curKind) build(f.kind, f.intensity);
      ctx.clearRect(0, 0, W, H);
      // Respect reduced-motion: no animated precipitation (the chip still labels it).
      if (f.kind === 'clear' || W === 0 || reduce) return;

      const { dx, speed } = drift();
      const windPx = dx * (30 + speed * 130);
      const storm = f.kind === 'rain' || f.kind === 'thunder';

      // Subtle storm vignette so heavy rain feels overcast (kept low; scope readable).
      if (storm && f.intensity > 0.45) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H); }

      if (storm) {
        for (const p of parts) {
          const L = LAYERS[p.layer];
          const vy = p.sp * L.sp, vx = windPx * (0.5 + L.sp * 0.5);
          p.x += vx * dt; p.y += vy * dt;
          if (p.y > H + 20) { p.y = rnd(-40, -4); p.x = rnd(-40, W); }
          if (p.x > W + 30) p.x = -20; else if (p.x < -40) p.x = W;
          const ll = p.len * L.len;
          ctx.strokeStyle = `rgba(168,203,232,${(0.2 + f.intensity * 0.2) * L.a})`;
          ctx.lineWidth = L.w;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (vx / vy) * ll, p.y - ll); ctx.stroke();
        }
        if (f.kind === 'thunder') {
          boltTimer -= dt;
          if (boltTimer <= 0) { makeBolt(); boltTimer = rnd(3.5, 8); }
          if (boltLife > 0) { boltLife -= dt; const e = Math.max(0, boltLife / 0.34); drawBolts(e > 0.75 ? 1 : e / 0.75); }
        }
      } else if (f.kind === 'snow') {
        for (const p of parts) {
          const L = LAYERS[p.layer];
          p.sway += p.swf * dt; p.y += p.sp * L.sp * dt;
          p.x += (Math.sin(p.sway) * 9 + windPx * 0.45) * dt;
          if (p.y > H + 6) { p.y = -6; p.x = rnd(0, W); }
          if (p.x > W + 6) p.x = -6; else if (p.x < -6) p.x = W;
          const s = p.r * (0.7 + L.sp * 0.5);
          ctx.globalAlpha = Math.min(1, (0.5 + f.intensity * 0.3) * L.a * 1.15);
          ctx.drawImage(flake, p.x - s, p.y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
      } else if (f.kind === 'fog') {
        for (const p of parts) {
          p.x += (p.sp + windPx * 0.3) * dt;
          if (p.x - p.r > W) p.x = -p.r;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(176,196,210,${0.05 + f.intensity * 0.09})`);
          g.addColorStop(1, 'rgba(176,196,210,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = `rgba(150,170,185,${0.05 + f.intensity * 0.09})`;
        ctx.fillRect(0, 0, W, H);
      } else if (f.kind === 'wind') {
        ctx.strokeStyle = 'rgba(150,190,220,0.22)'; ctx.lineWidth = 1;
        for (const p of parts) {
          p.x += (windPx * 3 + p.sp) * dt;
          if (p.x > W + 60) { p.x = -60; p.y = rnd(0, H); }
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.len, p.y); ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  return <canvas ref={ref} className="weather-fx" aria-hidden="true" />;
}

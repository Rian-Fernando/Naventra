import { useEffect, useRef } from 'react';
import { classifyWeather } from '../lib/weatherFx.js';

// Ambient weather overlay for the scope — rain, snow, fog, wind or a storm,
// driven by the live METAR. Screen-space canvas over the radar (works for both
// the 2D and 3D views); pointer-events off so it never blocks interaction, and
// kept translucent so the scope stays readable.
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
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let parts = [];
    let curKind = null;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const rnd = (a, b) => a + Math.random() * (b - a);
    const build = (kind, intensity) => {
      parts = [];
      if (kind === 'rain' || kind === 'thunder') {
        const n = Math.round(70 + intensity * 150);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(-40, W), y: rnd(0, H), len: rnd(9, 18) + intensity * 8, sp: rnd(360, 620) });
      } else if (kind === 'snow') {
        const n = Math.round(50 + intensity * 110);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.8, 2.2), sp: rnd(22, 55), sway: rnd(0, 6.28) });
      } else if (kind === 'fog') {
        for (let i = 0; i < 6; i++) parts.push({ x: rnd(0, W), y: rnd(H * 0.2, H), r: rnd(90, 190), sp: rnd(6, 16) });
      } else if (kind === 'wind') {
        const n = Math.round(18 + intensity * 26);
        for (let i = 0; i < n; i++) parts.push({ x: rnd(0, W), y: rnd(0, H), len: rnd(24, 60), sp: rnd(220, 420) });
      }
      curKind = kind;
    };

    // wind drift: METAR wind is where it blows FROM, so it pushes toward dir+180
    const drift = () => {
      const f = fxRef.current;
      const to = ((f.windDir ?? 0) + 180) * Math.PI / 180;
      return { dx: Math.sin(to), speed: Math.min(1, (f.windKt || 0) / 45) };
    };

    let raf, t0 = performance.now(), running = true, flash = 0, flashT = 0;
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!running || document.hidden) return;
      const dt = Math.min((now - t0) / 1000, 0.05); t0 = now;
      const f = fxRef.current;
      if (f.kind !== curKind) build(f.kind, f.intensity);
      ctx.clearRect(0, 0, W, H);
      if (f.kind === 'clear' || W === 0) return;

      const { dx, speed } = drift();
      const windPx = dx * (30 + speed * 120);

      if (f.kind === 'rain' || f.kind === 'thunder') {
        ctx.strokeStyle = `rgba(150, 190, 220, ${0.28 + f.intensity * 0.22})`;
        ctx.lineWidth = 1;
        for (const p of parts) {
          const vx = windPx, vy = p.sp;
          p.x += vx * dt; p.y += vy * dt;
          if (p.y > H) { p.y = -10; p.x = rnd(-40, W); }
          if (p.x > W + 20) p.x = -20; if (p.x < -40) p.x = W;
          const nx = -vx / vy * p.len, ny = -p.len;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + nx, p.y + ny); ctx.stroke();
        }
        if (f.kind === 'thunder') {
          flashT -= dt;
          if (flashT <= 0 && !reduce) { flash = 1; flashT = rnd(2.5, 7); }
          if (flash > 0) { ctx.fillStyle = `rgba(200, 220, 255, ${flash * 0.22})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 4); }
        }
      } else if (f.kind === 'snow') {
        ctx.fillStyle = `rgba(240, 246, 252, ${0.55 + f.intensity * 0.25})`;
        for (const p of parts) {
          p.sway += dt; p.y += p.sp * dt; p.x += (Math.sin(p.sway) * 8 + windPx * 0.4) * dt;
          if (p.y > H) { p.y = -6; p.x = rnd(0, W); }
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
      } else if (f.kind === 'fog') {
        for (const p of parts) {
          p.x += (p.sp + windPx * 0.3) * dt;
          if (p.x - p.r > W) p.x = -p.r;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(176, 196, 210, ${0.05 + f.intensity * 0.09})`);
          g.addColorStop(1, 'rgba(176, 196, 210, 0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = `rgba(150, 170, 185, ${0.04 + f.intensity * 0.08})`;
        ctx.fillRect(0, 0, W, H);
      } else if (f.kind === 'wind') {
        ctx.strokeStyle = 'rgba(150, 190, 220, 0.22)';
        ctx.lineWidth = 1;
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

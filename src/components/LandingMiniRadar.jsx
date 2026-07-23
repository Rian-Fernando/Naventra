import { useEffect, useRef, useState } from 'react';
import { fetchLiveTraffic } from '../lib/adsb.js';
import { toLocalNm, deadReckon } from '../lib/geo.js';

// A small, REAL radar scope for the landing hero: live ADS-B aircraft around a
// busy hub, dead-reckoned between polls, with a sweeping beam. Same data path as
// the console. Purely additive — if the feed is unreachable it still sweeps.
const HUB = { icao: 'JFK', lat: 40.6413, lon: -73.7781 };
const RANGE_NM = 40;
const SIZE = 320;

export default function LandingMiniRadar() {
  const canvasRef = useRef(null);
  const dataRef = useRef({ aircraft: [], fetchedAt: 0 });
  const [count, setCount] = useState(null);

  // poll live traffic
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { aircraft } = await fetchLiveTraffic(HUB.lat, HUB.lon, RANGE_NM);
        if (!alive) return;
        dataRef.current = { aircraft: aircraft || [], fetchedAt: Date.now() };
        setCount((aircraft || []).length);
      } catch { /* keep sweeping */ }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const cx = SIZE / 2, cy = SIZE / 2, radius = SIZE / 2 - 16;
    const scale = radius / RANGE_NM;
    let raf, running = true;
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!running || document.hidden) return;
      const now = Date.now();
      ctx.clearRect(0, 0, SIZE, SIZE);

      // face
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, '#06130f'); g.addColorStop(0.8, '#04100c'); g.addColorStop(1, '#03080a');
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();

      // rings + labels
      ctx.strokeStyle = 'rgba(61,220,151,0.13)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(143,166,177,0.4)'; ctx.font = '8px ui-monospace, Menlo, monospace';
      for (let i = 1; i <= 4; i++) {
        const r = (radius * i) / 4;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        if (i < 4) ctx.fillText(`${(RANGE_NM * i) / 4}`, cx + 3, cy - r + 10);
      }
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.strokeStyle = 'rgba(61,220,151,0.07)'; ctx.stroke();

      // sweep
      const sweep = ((now % 4200) / 4200) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
      if (ctx.createConicGradient) {
        const grad = ctx.createConicGradient(sweep, cx, cy);
        grad.addColorStop(0, 'rgba(87,242,174,0.22)');
        grad.addColorStop(0.1, 'rgba(61,220,151,0.03)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, SIZE, SIZE);
      }
      ctx.strokeStyle = 'rgba(87,242,174,0.55)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius); ctx.stroke();
      ctx.restore();

      // blips (dead-reckoned from last fetch)
      const { aircraft, fetchedAt } = dataRef.current;
      const dt = Math.min((now - fetchedAt) / 1000, 30);
      let labels = 0;
      for (const ac of aircraft) {
        if (ac.lat == null || ac.lon == null) continue;
        const p = ac.onGround ? ac : deadReckon(ac.lat, ac.lon, ac.gs || 0, ac.track || 0, dt);
        const { x, y } = toLocalNm(HUB.lat, HUB.lon, p.lat, p.lon);
        const sx = cx + x * scale, sy = cy - y * scale;
        if (Math.hypot(sx - cx, sy - cy) > radius - 3) continue;
        const descending = (ac.vs || 0) < -200;
        const color = ac.onGround ? '#7c6fb0' : descending ? '#3ddc97' : '#4cc9f0';
        // velocity leader
        if (!ac.onGround && ac.gs > 60) {
          const a = (ac.track - 90) * Math.PI / 180;
          ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * (ac.gs / 60) * scale, sy + Math.sin(a) * (ac.gs / 60) * scale); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(sx, sy, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        // a few callsign labels for close-in traffic
        if (labels < 3 && ac.callsign && Math.hypot(sx - cx, sy - cy) < radius * 0.7 && !ac.onGround) {
          ctx.fillStyle = 'rgba(217,230,236,0.8)'; ctx.font = '8px ui-monospace, Menlo, monospace';
          ctx.fillText(ac.callsign, sx + 5, sy - 4); labels++;
        }
      }

      // field marker
      ctx.fillStyle = '#57f2ae'; ctx.shadowColor = '#57f2ae'; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      // bezel
      ctx.strokeStyle = 'rgba(29,50,66,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  return (
    <div className="lp-radar">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      <div className="lp-radar-cap">
        <span className="lp-radar-dot" /> LIVE RADAR · {HUB.icao} · {RANGE_NM}NM
        {count != null && <em>{count} aircraft</em>}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Interactive 3D radar hero for the landing page: a tilted scope with range
// rings, a rotating sweep, and aircraft converging on the field along inbound
// vectors. Camera auto-orbits and responds to pointer parallax. Pure three.js,
// no postprocessing (glow is faked with additive sprites) so it stays light and
// can't crash the page — any WebGL failure falls back to the CSS scope in Landing.
export default function LandingHero3D() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      mount.classList.add('hero3d-failed');
      return undefined;
    }

    const W = () => mount.clientWidth;
    const H = () => mount.clientHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 100);
    camera.position.set(0, 7.4, 11);
    camera.lookAt(0, 0, 0);

    const CYAN = 0x4cc9f0;
    const GREEN = 0x3ddc97;
    const AMBER = 0xffb454;

    // --- soft glow sprite (shared) -----------------------------------------
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();

    const root = new THREE.Group();
    scene.add(root);

    // --- range rings --------------------------------------------------------
    for (let i = 1; i <= 4; i++) {
      const r = i * 1.5;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.012, r + 0.012, 128),
        new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: i === 4 ? 0.55 : 0.22, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      root.add(ring);
    }
    // filled disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(6, 96),
      new THREE.MeshBasicMaterial({ color: 0x06121c, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.02;
    root.add(disc);

    // cross axes
    const axisMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.18 });
    const axisG = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-6, 0, 0), new THREE.Vector3(6, 0, 0),
      new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 6),
    ]);
    root.add(new THREE.LineSegments(axisG, axisMat));

    // --- rotating sweep -----------------------------------------------------
    const sweepShape = new THREE.Shape();
    sweepShape.moveTo(0, 0);
    sweepShape.absarc(0, 0, 6, 0, Math.PI / 5, false);
    sweepShape.lineTo(0, 0);
    const sweepGeo = new THREE.ShapeGeometry(sweepShape, 48);
    // fade the wedge from bright at the leading edge to transparent
    const pos = sweepGeo.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const ang = Math.atan2(y, x);
      const t = 1 - ang / (Math.PI / 5); // 1 at leading edge → 0 at trailing
      colors.push(0.3 * t, 0.79 * t, 0.94 * t);
    }
    sweepGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sweep = new THREE.Mesh(
      sweepGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    sweep.rotation.x = -Math.PI / 2;
    root.add(sweep);

    // center field marker
    const field = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: GREEN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    field.scale.set(0.9, 0.9, 1);
    field.position.y = 0.05;
    root.add(field);

    // --- aircraft -----------------------------------------------------------
    const TRAIL = 26;
    const craft = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 11; i++) {
      const inbound = Math.random() > 0.32;
      const ang0 = rnd(0, Math.PI * 2);
      const speed = rnd(0.14, 0.26);
      const color = inbound ? CYAN : AMBER;
      const blip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      blip.scale.set(0.42, 0.42, 1);
      root.add(blip);
      // trail
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      root.add(trail);
      craft.push({
        blip, trail, inbound, ang: ang0, speed,
        dist: inbound ? rnd(5.5, 6) : rnd(0.6, 1.4),
        alt: rnd(0.4, 2.4), hist: [],
      });
    }

    // --- particle backdrop --------------------------------------------------
    const starGeo = new THREE.BufferGeometry();
    const starN = 220, sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      sp[i * 3] = rnd(-26, 26); sp[i * 3 + 1] = rnd(-4, 16); sp[i * 3 + 2] = rnd(-26, 10);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x2a4558, size: 0.06, transparent: true, opacity: 0.6 })));

    // --- interaction / animation -------------------------------------------
    let px = 0, py = 0, tpx = 0, tpy = 0;
    const onMove = (e) => {
      const r = mount.getBoundingClientRect();
      tpx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      tpy = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    mount.addEventListener('pointermove', onMove);

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    let raf, t0 = performance.now(), sweepAng = 0, orbit = 0, running = true;
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0.01 });
    io.observe(mount);

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!running) return;
      const dt = Math.min((now - t0) / 1000, 0.05);
      t0 = now;

      sweepAng -= dt * 0.9;
      sweep.rotation.z = sweepAng;

      px += (tpx - px) * 0.05; py += (tpy - py) * 0.05;
      orbit += dt * 0.06;
      const rad = 12.5;
      camera.position.set(Math.sin(orbit + px * 0.5) * rad, 7.4 - py * 1.5, Math.cos(orbit + px * 0.5) * rad);
      camera.lookAt(0, 0.2, 0);

      for (const c of craft) {
        if (c.inbound) {
          c.dist -= c.speed * dt; c.alt -= c.speed * 0.32 * dt;
          if (c.dist < 0.35) { c.dist = rnd(5.6, 6); c.alt = rnd(1.6, 2.6); c.ang = rnd(0, Math.PI * 2); c.hist = []; }
        } else {
          c.dist += c.speed * dt; c.alt += c.speed * 0.28 * dt;
          if (c.dist > 6) { c.dist = rnd(0.5, 1.1); c.alt = rnd(0.3, 0.7); c.ang = rnd(0, Math.PI * 2); c.hist = []; }
        }
        const x = Math.cos(c.ang) * c.dist, z = Math.sin(c.ang) * c.dist, y = Math.max(0.05, c.alt);
        c.blip.position.set(x, y, z);
        c.hist.push(new THREE.Vector3(x, y, z));
        if (c.hist.length > TRAIL) c.hist.shift();
        const arr = c.trail.geometry.attributes.position.array;
        for (let i = 0; i < TRAIL; i++) {
          const p = c.hist[Math.min(i, c.hist.length - 1)] || c.hist[0] || c.blip.position;
          arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
        }
        c.trail.geometry.attributes.position.needsUpdate = true;
      }

      root.rotation.y = px * 0.12;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      mount.removeEventListener('pointermove', onMove);
      renderer.dispose();
      glowTex.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="hero3d" ref={mountRef} aria-hidden="true" />;
}

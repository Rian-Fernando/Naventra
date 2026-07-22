import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Cinematic, scroll-driven WebGL backdrop for the landing page — a moonlit night
// airfield seen from the air: runway edge + threshold lights, sequenced approach
// flashers, aircraft on final with nav/landing lights, atmospheric haze. The
// camera flies a slow keyframed aerial path as the page scrolls. Deliberately
// restrained (dark palette, gentle bloom, no ground-skimming) so it reads real.

const CAM = [
  { pos: [-8, 46, 104], tgt: [0, 2, 0] },    // 0 — high, wide establishing
  { pos: [26, 34, 70], tgt: [-4, 2, -14] },  // 1 — slow push toward the approach
  { pos: [40, 30, 20], tgt: [0, 2, -26] },   // 2 — arc around the final corridor
  { pos: [-34, 52, 44], tgt: [0, 2, -8] },   // 3 — climb, reveal the whole field
  { pos: [-2, 40, 88], tgt: [0, 2, -2] },    // 4 — settle
];

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function sampleCam(p) {
  const seg = Math.min(CAM.length - 2, Math.floor(p * (CAM.length - 1)));
  const local = smooth(Math.min(1, Math.max(0, p * (CAM.length - 1) - seg)));
  const a = CAM[seg], b = CAM[seg + 1];
  return {
    pos: [0, 1, 2].map((i) => lerp(a.pos[i], b.pos[i], local)),
    tgt: [0, 1, 2].map((i) => lerp(a.tgt[i], b.tgt[i], local)),
  };
}

function glowTexture() {
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
}

export default function LandingScene3D() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      mount.classList.add('scene-failed');
      return undefined;
    }

    const W = () => mount.clientWidth || window.innerWidth;
    const H = () => mount.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 820 ? 1.5 : 2));
    renderer.setSize(W(), H());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020407);
    scene.fog = new THREE.FogExp2(0x03060b, 0.0085);

    const camera = new THREE.PerspectiveCamera(46, W() / H(), 0.1, 2000);
    camera.position.set(...CAM[0].pos);

    const CYAN = 0x4cc9f0, GREEN = 0x35e89a, RED = 0xff5555, WARM = 0xffca80;
    const glow = glowTexture();
    const mkSprite = (color, scale, opacity = 1) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
      s.scale.set(scale, scale, 1);
      return s;
    };

    // ---- sky dome — near-black, only the faintest horizon lift (no blue band) -
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x01020400 & 0xffffff) }, hz: { value: new THREE.Color(0x060a12) } },
        vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vp; uniform vec3 top; uniform vec3 hz;
          void main(){ float h = clamp(normalize(vp).y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(hz, top, h), 1.0); }`,
      })
    );
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0x24384f, 0x01030600 & 0xffffff, 0.4));
    const moon = new THREE.DirectionalLight(0x9fb6d4, 0.55);
    moon.position.set(-50, 70, 40);
    scene.add(moon);

    // ---- ground + distant city glow (dim, warm) ---------------------------
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(700, 64),
      new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    const cityN = reduce ? 700 : 2000;
    const cp = new Float32Array(cityN * 3), cc = new Float32Array(cityN * 3);
    const warm = new THREE.Color(WARM), cool = new THREE.Color(0x5a86ab);
    for (let i = 0; i < cityN; i++) {
      const a = Math.random() * Math.PI * 2, r = 70 + Math.pow(Math.random(), 0.7) * 440;
      cp[i * 3] = Math.cos(a) * r; cp[i * 3 + 1] = 0.1 + Math.random() * 1.1; cp[i * 3 + 2] = Math.sin(a) * r;
      const col = Math.random() > 0.18 ? warm : cool;
      cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b;
    }
    const cityGeo = new THREE.BufferGeometry();
    cityGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cityGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    scene.add(new THREE.Points(cityGeo, new THREE.PointsMaterial({ size: 0.7, map: glow, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })));

    // ---- stars -------------------------------------------------------------
    const starN = 600, stp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(600 + Math.random() * 250, Math.acos(Math.random()), Math.random() * Math.PI * 2);
      stp[i * 3] = v.x; stp[i * 3 + 1] = Math.abs(v.y) + 60; stp[i * 3 + 2] = v.z;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x7a9bbd, size: 0.9, transparent: true, opacity: 0.55, depthWrite: false })));

    // ---- runways with edge / threshold / approach lights ------------------
    const runwayX = [-7, 7];
    const RW_Z0 = -18, RW_Z1 = 16;
    const edgePos = [], edgeCol = [];
    const white = new THREE.Color(0xfff0cf), rlead = new THREE.Color(0xffdca8);
    const approachSets = [];
    for (const rx of runwayX) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.06, RW_Z1 - RW_Z0),
        new THREE.MeshStandardMaterial({ color: 0x0a0e13, roughness: 0.9, metalness: 0.05 })
      );
      strip.position.set(rx, 0.03, (RW_Z0 + RW_Z1) / 2);
      scene.add(strip);
      for (let z = RW_Z0 + 1; z < RW_Z1; z += 1.7) { edgePos.push(rx, 0.09, z); edgeCol.push(0.9, 0.85, 0.7); }
      for (let z = RW_Z0; z <= RW_Z1; z += 1.2) {
        for (const sx of [-1.25, 1.25]) { edgePos.push(rx + sx, 0.1, z); edgeCol.push(white.r, white.g, white.b); }
      }
      for (let sx = -1.2; sx <= 1.2; sx += 0.4) {
        edgePos.push(rx + sx, 0.11, RW_Z0); edgeCol.push(0.15, 1, 0.5);
        edgePos.push(rx + sx, 0.11, RW_Z1); edgeCol.push(1, 0.2, 0.2);
      }
      const appr = [];
      for (let i = 1; i <= 11; i++) {
        const z = RW_Z0 - i * 2.3;
        const spr = mkSprite(0xfff4e0, 1.1, 0.85);
        spr.position.set(rx, 0.25, z);
        scene.add(spr);
        appr.push(spr);
        if (i % 3 === 0) for (const sx of [-2, 2]) { edgePos.push(rx + sx, 0.12, z); edgeCol.push(rlead.r, rlead.g, rlead.b); }
      }
      approachSets.push(appr);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePos), 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(edgeCol), 3));
    scene.add(new THREE.Points(edgeGeo, new THREE.PointsMaterial({ size: 0.42, map: glow, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })));

    // ---- faint radar rings on the ground (subtle, not a neon hologram) -----
    const radar = new THREE.Group();
    radar.position.set(0, 0.05, -1);
    scene.add(radar);
    for (let i = 1; i <= 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(i * 3.2 - 0.02, i * 3.2 + 0.02, 96),
        new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      radar.add(ring);
    }
    const sweepShape = new THREE.Shape();
    sweepShape.moveTo(0, 0); sweepShape.absarc(0, 0, 12.8, 0, Math.PI / 7, false); sweepShape.lineTo(0, 0);
    const sweepGeo = new THREE.ShapeGeometry(sweepShape, 40);
    const spos = sweepGeo.attributes.position, scol = [];
    for (let i = 0; i < spos.count; i++) { const t = 1 - Math.atan2(spos.getY(i), spos.getX(i)) / (Math.PI / 7); scol.push(0.3 * t, 0.79 * t, 0.94 * t); }
    sweepGeo.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));
    const sweep = new THREE.Mesh(sweepGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sweep.rotation.x = -Math.PI / 2;
    radar.add(sweep);

    // ---- aircraft on final (spaced, glideslope, gentle bank) --------------
    const SLOPE = Math.tan(3 * Math.PI / 180);
    const craft = [];
    const acN = reduce ? 4 : 6;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0e131a, roughness: 0.45, metalness: 0.5 });
    for (let i = 0; i < acN; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.0, 4, 8), bodyMat);
      body.rotation.x = Math.PI / 2;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.36), bodyMat);
      wing.position.z = 0.12;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.24), bodyMat);
      tail.position.set(0, 0.12, 0.72);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.3), bodyMat);
      fin.position.set(0, 0.22, 0.74);
      g.add(body, wing, tail, fin);
      const navL = mkSprite(RED, 0.34), navR = mkSprite(GREEN, 0.34);
      navL.position.set(-1.15, 0, 0.12); navR.position.set(1.15, 0, 0.12);
      const strobe = mkSprite(0xffffff, 0.6, 0);
      strobe.position.set(0, 0.16, 0.3);
      const beacon = mkSprite(0xff4444, 0.4, 0);
      beacon.position.set(0, -0.16, 0.1);
      const land = mkSprite(0xfff2d6, 1.6, 0);
      land.position.set(0, -0.02, -0.55);
      g.add(navL, navR, strobe, beacon, land);
      scene.add(g);
      const TN = 46;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0x2b3f52, transparent: true, opacity: 0.5, depthWrite: false }));
      scene.add(trail);
      craft.push({
        g, strobe, beacon, land, trail, hist: [], TN,
        rx: runwayX[i % 2],
        z: RW_Z0 - 18 - (i * 26) - Math.random() * 14, // evenly spaced down the approach
        speed: 8.2 + Math.random() * 1.6,
        strobeT: Math.random() * 2, beaconT: Math.random() * 2,
      });
    }

    // ---- postprocessing (gentle bloom) ------------------------------------
    let composer = null;
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.5, 0.22));
      composer.addPass(new OutputPass());
      composer.setSize(W(), H());
    } catch { composer = null; }

    // ---- scroll progress + parallax ---------------------------------------
    let targetP = 0, curP = 0, px = 0, py = 0, tpx = 0, tpy = 0;
    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight;
      targetP = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    const onMove = (e) => { tpx = (e.clientX / window.innerWidth - 0.5) * 2; tpy = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onMove);
    onScroll();

    const onResize = () => {
      camera.aspect = W() / H(); camera.updateProjectionMatrix();
      renderer.setSize(W(), H()); composer?.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    let raf, t0 = performance.now(), running = true, sweepA = 0;
    const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; }, { threshold: 0 });
    io.observe(mount);
    const tgt = new THREE.Vector3();

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (!running || document.hidden) return;
      const dt = Math.min((now - t0) / 1000, 0.05); t0 = now;

      curP += (targetP - curP) * 0.045;
      px += (tpx - px) * 0.03; py += (tpy - py) * 0.03;
      const { pos, tgt: tg } = sampleCam(curP);
      camera.position.set(pos[0] + px * 2, pos[1] - py * 1.2, pos[2]);
      tgt.set(tg[0], tg[1], tg[2]);
      camera.lookAt(tgt);

      sweepA -= dt * 0.6; sweep.rotation.z = sweepA;

      const phase = (now / 1000) % 1.1 / 1.1;
      for (const set of approachSets) {
        for (let i = 0; i < set.length; i++) {
          const on = (set.length - i) / set.length;
          set[i].material.opacity = Math.abs(phase - on) < 0.08 ? 0.95 : 0.1;
        }
      }

      for (const c of craft) {
        c.z += c.speed * dt;
        if (c.z > 22) { c.z = RW_Z0 - 60 - Math.random() * 60; c.hist = []; }
        const onGround = c.z >= RW_Z0;
        const alt = onGround ? 0.32 : (RW_Z0 - c.z) * SLOPE + 0.32;
        c.g.position.set(c.rx, alt, c.z);
        // subtle bank easing to level as it nears the runway
        c.g.rotation.z = onGround ? 0 : Math.sin(c.z * 0.05) * 0.05;
        c.strobeT += dt; c.beaconT += dt;
        c.strobe.material.opacity = c.strobeT % 1.4 < 0.05 ? 1 : 0;
        c.beacon.material.opacity = (Math.sin(c.beaconT * 3.5) * 0.5 + 0.5) * 0.5;
        const near = c.z > -40 ? 1 : Math.max(0, 1 + (c.z + 40) / 60);
        c.land.material.opacity = 0.55 * near;
        c.hist.push(new THREE.Vector3(c.rx, alt, c.z));
        if (c.hist.length > c.TN) c.hist.shift();
        const arr = c.trail.geometry.attributes.position.array;
        for (let i = 0; i < c.TN; i++) { const p = c.hist[Math.min(i, c.hist.length - 1)] || c.g.position; arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; }
        c.trail.geometry.attributes.position.needsUpdate = true;
      }

      (composer || renderer).render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
      glow.dispose();
      renderer.dispose();
      composer?.dispose?.();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div className="scene3d" ref={mountRef} aria-hidden="true" />;
}

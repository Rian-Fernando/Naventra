import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Cinematic, scroll-driven WebGL backdrop for the landing page — a night airfield
// with glowing runway + sequenced approach lights, aircraft on final with nav
// lights and landing lights, a holographic radar, moonlit haze and real bloom.
// The camera flies a keyframed path as the page scrolls (à la scroll-scrubbed
// product sites). Everything is procedural: no external models, no CDN.

const CAM = [
  { pos: [0, 62, 96], tgt: [0, 3, -6] },     // 0 — establishing: field + radar from high
  { pos: [34, 20, 40], tgt: [-2, 2, -20] },  // 1 — bank down toward the approach corridor
  { pos: [7, 3.4, 8], tgt: [3, 1.2, -34] },  // 2 — low, skimming the numbers on final
  { pos: [-46, 30, 30], tgt: [0, 4, -8] },   // 3 — sweep up, reveal the whole TRACON
  { pos: [0, 24, 74], tgt: [0, 4, -4] },     // 4 — settle to a hero composition
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

// soft radial sprite texture (nav lights, landing lights, city glow)
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.85)');
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
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060a);
    scene.fog = new THREE.FogExp2(0x050a12, 0.0075);

    const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 2000);
    camera.position.set(...CAM[0].pos);

    const CYAN = 0x4cc9f0, GREEN = 0x38f5a6, RED = 0xff5c5c, WARM = 0xffcf8f;
    const glow = glowTexture();
    const mkSprite = (color, scale, opacity = 1) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
      s.scale.set(scale, scale, 1);
      return s;
    };

    // ---- sky dome (vertical gradient) -------------------------------------
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        uniforms: { top: { value: new THREE.Color(0x02040a) }, bot: { value: new THREE.Color(0x0a1826) }, hz: { value: new THREE.Color(0x123048) } },
        vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vp; uniform vec3 top; uniform vec3 bot; uniform vec3 hz;
          void main(){ float h = normalize(vp).y; vec3 c = mix(hz, top, clamp(h*1.4,0.0,1.0)); c = mix(bot, c, clamp((h+0.15)*3.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
      })
    );
    scene.add(sky);

    // ---- lighting for standard materials ----------------------------------
    scene.add(new THREE.HemisphereLight(0x334966, 0x02040a, 0.55));
    const moon = new THREE.DirectionalLight(0x9db8d6, 0.7);
    moon.position.set(-40, 60, 30);
    scene.add(moon);

    // ---- ground + distant city glow ---------------------------------------
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(700, 64),
      new THREE.MeshStandardMaterial({ color: 0x060b10, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    const cityN = reduce ? 900 : 2600;
    const cp = new Float32Array(cityN * 3), cc = new Float32Array(cityN * 3);
    const warm = new THREE.Color(WARM), cool = new THREE.Color(0x6fa0c8);
    for (let i = 0; i < cityN; i++) {
      const a = Math.random() * Math.PI * 2, r = 55 + Math.pow(Math.random(), 0.6) * 430;
      cp[i * 3] = Math.cos(a) * r; cp[i * 3 + 1] = 0.15 + Math.random() * 1.4; cp[i * 3 + 2] = Math.sin(a) * r;
      const col = Math.random() > 0.22 ? warm : cool;
      cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b;
    }
    const cityGeo = new THREE.BufferGeometry();
    cityGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cityGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    scene.add(new THREE.Points(cityGeo, new THREE.PointsMaterial({ size: 0.9, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })));

    // ---- stars -------------------------------------------------------------
    const starN = 700, stp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(600 + Math.random() * 250, Math.acos(Math.random()), Math.random() * Math.PI * 2);
      stp[i * 3] = v.x; stp[i * 3 + 1] = Math.abs(v.y) + 40; stp[i * 3 + 2] = v.z;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8fb4d6, size: 1.1, transparent: true, opacity: 0.7, depthWrite: false })));

    // ---- runways with edge / threshold / approach lights ------------------
    const runwayX = [-7, 7];
    const RW_Z0 = -16, RW_Z1 = 16; // threshold(approach) → far end
    const edgePos = [], edgeCol = [];
    const white = new THREE.Color(0xfff2d0), rlead = new THREE.Color(0xffe0b0);
    const approachSets = []; // for sequenced flash animation
    for (const rx of runwayX) {
      // asphalt
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.08, RW_Z1 - RW_Z0),
        new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.85, metalness: 0.1 })
      );
      strip.position.set(rx, 0.04, (RW_Z0 + RW_Z1) / 2);
      scene.add(strip);
      // centerline dashes (emissive)
      for (let z = RW_Z0 + 1; z < RW_Z1; z += 1.6) { edgePos.push(rx, 0.11, z); edgeCol.push(1, 0.95, 0.8); }
      // edge lights
      for (let z = RW_Z0; z <= RW_Z1; z += 1.1) {
        for (const sx of [-1.25, 1.25]) { edgePos.push(rx + sx, 0.12, z); edgeCol.push(white.r, white.g, white.b); }
      }
      // threshold (green) + far end (red)
      for (let sx = -1.2; sx <= 1.2; sx += 0.4) {
        edgePos.push(rx + sx, 0.13, RW_Z0); edgeCol.push(0.2, 1, 0.55);
        edgePos.push(rx + sx, 0.13, RW_Z1); edgeCol.push(1, 0.25, 0.25);
      }
      // approach lead-in bars beyond the threshold (sequenced flashers)
      const appr = [];
      for (let i = 1; i <= 12; i++) {
        const z = RW_Z0 - i * 2.2;
        const spr = mkSprite(0xffffff, 1.5, 0.9);
        spr.position.set(rx, 0.3, z);
        scene.add(spr);
        appr.push(spr);
        // side bars every 3rd
        if (i % 3 === 0) for (const sx of [-2, 2]) { edgePos.push(rx + sx, 0.15, z); edgeCol.push(rlead.r, rlead.g, rlead.b); }
      }
      approachSets.push(appr);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePos), 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(edgeCol), 3));
    scene.add(new THREE.Points(edgeGeo, new THREE.PointsMaterial({ size: 0.5, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));

    // ---- holographic radar disc -------------------------------------------
    const radar = new THREE.Group();
    radar.position.set(0, 0.2, 2);
    scene.add(radar);
    for (let i = 1; i <= 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(i * 3 - 0.03, i * 3 + 0.03, 96),
        new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      radar.add(ring);
    }
    const sweepShape = new THREE.Shape();
    sweepShape.moveTo(0, 0); sweepShape.absarc(0, 0, 12, 0, Math.PI / 6, false); sweepShape.lineTo(0, 0);
    const sweepGeo = new THREE.ShapeGeometry(sweepShape, 40);
    const spos = sweepGeo.attributes.position, scol = [];
    for (let i = 0; i < spos.count; i++) { const t = 1 - Math.atan2(spos.getY(i), spos.getX(i)) / (Math.PI / 6); scol.push(0.3 * t, 0.79 * t, 0.94 * t); }
    sweepGeo.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));
    const sweep = new THREE.Mesh(sweepGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sweep.rotation.x = -Math.PI / 2;
    radar.add(sweep);

    // ---- aircraft on final -------------------------------------------------
    const SLOPE = Math.tan(3.2 * Math.PI / 180);
    const craft = [];
    const acN = reduce ? 4 : 7;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x11161d, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < acN; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 4, 8), bodyMat);
      body.rotation.x = Math.PI / 2;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.34), bodyMat);
      wing.position.z = 0.1;
      g.add(body, wing);
      const navL = mkSprite(RED, 0.5), navR = mkSprite(GREEN, 0.5);
      navL.position.set(-1.05, 0, 0.1); navR.position.set(1.05, 0, 0.1);
      const strobe = mkSprite(0xffffff, 0.8, 0);
      strobe.position.set(0, 0.14, 0.2);
      const land1 = mkSprite(0xfff4d8, 2.2), land2 = mkSprite(0xfff4d8, 2.2);
      land1.position.set(-1.05, -0.02, -0.4); land2.position.set(1.05, -0.02, -0.4);
      g.add(navL, navR, strobe, land1, land2);
      scene.add(g);
      // trail
      const TN = 40;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(trail);
      craft.push({
        g, strobe, land1, land2, trail, hist: [], TN,
        rx: runwayX[i % 2],
        z: -30 - Math.random() * 130,
        speed: 9 + Math.random() * 4,
        strobeT: Math.random() * 2,
      });
    }

    // ---- postprocessing (bloom) -------------------------------------------
    let composer = null;
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.85, 0.62, 0.18);
      composer.addPass(bloom);
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

      curP += (targetP - curP) * 0.06;
      px += (tpx - px) * 0.04; py += (tpy - py) * 0.04;
      const { pos, tgt: tg } = sampleCam(curP);
      camera.position.set(pos[0] + px * 3, pos[1] - py * 2, pos[2]);
      tgt.set(tg[0], tg[1], tg[2]);
      camera.lookAt(tgt);

      sweepA -= dt * 0.8; sweep.rotation.z = sweepA;

      // sequenced approach flashers ("the rabbit")
      const phase = (now / 1000) % 1;
      for (const set of approachSets) {
        for (let i = 0; i < set.length; i++) {
          const on = ((set.length - i) / set.length);
          const lit = Math.abs(phase - on) < 0.09 ? 1 : 0.12;
          set[i].material.opacity = lit;
        }
      }

      for (const c of craft) {
        c.z += c.speed * dt;
        if (c.z > 24) { c.z = -30 - Math.random() * 150; c.hist = []; }
        const alt = c.z < RW_Z0 ? (RW_Z0 - c.z) * SLOPE + 0.35 : 0.35;
        c.g.position.set(c.rx, alt, c.z);
        c.strobeT += dt;
        const flash = c.strobeT % 1.3 < 0.06 ? 1 : 0;
        c.strobe.material.opacity = flash;
        const near = c.z > -60 ? 1 : Math.max(0.2, 1 + (c.z + 60) / 90);
        c.land1.material.opacity = c.land2.material.opacity = 0.65 * near;
        // trail
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

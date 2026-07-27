import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toLocalNm, deadReckon } from '../lib/geo.js';
import { iconKind } from '../lib/aircraftIcon.js';
import { emergencyInfo } from '../lib/filters.js';
import { fmtAltScope, fmtSpeed } from '../lib/units.js';
import { classifyWeather } from '../lib/weatherFx.js';

// Merge mixed primitives: ExtrudeGeometry is non-indexed while Box/Cylinder/
// Sphere are indexed, so normalise everything to non-indexed first.
function mergeParts(parts) {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

// Extruded top-down silhouette from a 2D shape (nose +Z after the flat-lay).
function extrudeSilhouette(shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); // lie flat; shape +Y → world +Z (nose forward)
  geo.center();
  return geo;
}

// Airliner: swept wings + a raised fuselage spine so it reads as a jet in 3D.
function buildPlaneGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 1.05);
  s.quadraticCurveTo(0.13, 0.9, 0.13, 0.55);
  s.lineTo(0.13, 0.2);
  s.lineTo(0.98, -0.28); s.lineTo(0.98, -0.46); s.lineTo(0.13, -0.16);
  s.lineTo(0.12, -0.66);
  s.lineTo(0.4, -0.9); s.lineTo(0.4, -1.04); s.lineTo(0, -0.86);
  s.lineTo(-0.4, -1.04); s.lineTo(-0.4, -0.9); s.lineTo(-0.12, -0.66);
  s.lineTo(-0.13, -0.16); s.lineTo(-0.98, -0.46); s.lineTo(-0.98, -0.28);
  s.lineTo(-0.13, 0.2); s.lineTo(-0.13, 0.55);
  s.quadraticCurveTo(-0.13, 0.9, 0, 1.05);
  const wings = extrudeSilhouette(s, 0.12);
  // raised fuselage tube down the centerline
  const fuse = new THREE.CylinderGeometry(0.16, 0.13, 1.9, 8);
  fuse.rotateX(Math.PI / 2);
  fuse.translate(0, 0.12, 0);
  const tail = new THREE.BoxGeometry(0.05, 0.34, 0.34); // vertical stabilizer
  tail.translate(0, 0.2, -0.82);
  const geo = mergeParts([wings, fuse, tail]);
  geo.scale(2.1, 2.1, 2.1);
  return geo;
}

// Light GA: straight wings, small body.
function buildLightGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.95);
  s.lineTo(0.1, 0.5); s.lineTo(0.1, 0.12);
  s.lineTo(0.92, 0.02); s.lineTo(0.92, -0.14); s.lineTo(0.1, -0.12);
  s.lineTo(0.1, -0.72);
  s.lineTo(0.34, -0.86); s.lineTo(0.34, -0.98); s.lineTo(0, -0.82);
  s.lineTo(-0.34, -0.98); s.lineTo(-0.34, -0.86); s.lineTo(-0.1, -0.72);
  s.lineTo(-0.1, -0.12); s.lineTo(-0.92, -0.14); s.lineTo(-0.92, 0.02);
  s.lineTo(-0.1, 0.12); s.lineTo(-0.1, 0.5);
  const wings = extrudeSilhouette(s, 0.1);
  const fuse = new THREE.CylinderGeometry(0.12, 0.1, 1.5, 7);
  fuse.rotateX(Math.PI / 2);
  fuse.translate(0, 0.08, 0);
  const geo = mergeParts([wings, fuse]);
  geo.scale(1.7, 1.7, 1.7);
  return geo;
}

// Rotorcraft: proper fuselage + tail boom + tail rotor. The MAIN ROTOR is a
// separate geometry (child mesh) so it can spin in the render loop.
function buildHeliGeo() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.42, 10, 8);
  body.scale(1, 0.8, 1.6);
  parts.push(body);
  const boom = new THREE.BoxGeometry(0.12, 0.12, 1.25);
  boom.translate(0, 0.05, -1.05);
  parts.push(boom);
  const fin = new THREE.BoxGeometry(0.05, 0.34, 0.22); // tail fin
  fin.translate(0, 0.18, -1.62);
  parts.push(fin);
  const tailRotor = new THREE.BoxGeometry(0.5, 0.05, 0.08); // tail rotor
  tailRotor.translate(0.12, 0.12, -1.62);
  parts.push(tailRotor);
  const mast = new THREE.CylinderGeometry(0.05, 0.05, 0.34, 6);
  mast.translate(0, 0.5, 0.1);
  parts.push(mast);
  const geo = mergeParts(parts);
  geo.scale(1.5, 1.5, 1.5);
  return geo;
}

// Four thin main-rotor blades in a cross, centered on the hub so the child
// mesh can rotate about Y (mounted at the mast top in getObj).
function buildRotorGeo() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.BoxGeometry(2.5, 0.04, 0.18);
    blade.rotateY((i * Math.PI) / 2);
    parts.push(blade);
  }
  const geo = mergeParts(parts);
  geo.scale(1.5, 1.5, 1.5);
  return geo;
}

// Unknown emitter: a simple octahedron — obviously "raw contact, unclassified".
function buildUnknownGeo() {
  const geo = new THREE.OctahedronGeometry(1.3, 0);
  return geo;
}

// 3D TRACON view. World units: 1 unit = 1 px-space; RADIUS spans the selected
// range. Altitude is exaggerated (ALT_EXAG× true scale) and every target drops
// a stem to the ground plane so height reads at a glance.

const RADIUS = 100;
const ALT_EXAG = 5;
const FT_PER_NM = 6076.12;
const SWEEP_PERIOD_MS = 4600;

const PHASE_COLORS = {
  FINAL: 0x57f2ae,
  APPROACH: 0x3ddc97,
  ARRIVAL: 0x2fae79,
  DEPARTURE: 0x4cc9f0,
  GROUND: 0xa78bfa,
  ENROUTE: 0x4a6272,
  conflict: 0xff5c5c,
  selected: 0xe8f6ee,
};

function makeMaterials() {
  const mats = {};
  for (const [k, c] of Object.entries(PHASE_COLORS)) {
    mats[k] = new THREE.MeshBasicMaterial({ color: c });
    mats[`line_${k}`] = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.5 });
    mats[`trail_${k}`] = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.35 });
  }
  return mats;
}

export default function Radar3D({ airport, aircraft, conflicts, runways, selectedId, onSelect, range, labels, showTrails, units, onUnavailable, weather, wxEnabled = true }) {
  const wrapRef = useRef(null);
  const dataRef = useRef({});
  dataRef.current = { airport, aircraft, conflicts, runways, selectedId, range, labels, showTrails, units, weather, wxEnabled };

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    const wrap = wrapRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x04070a, 300, 520);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);
    camera.position.set(0, RADIUS * 0.85, RADIUS * 1.15);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL (old browser / software rendering disabled) — hand the panel
      // back to the 2D scope instead of crashing the console.
      onUnavailableRef.current?.();
      return undefined;
    }
    renderer.setClearColor(0x000000, 0);
    wrap.appendChild(renderer.domElement);

    // 2D overlay for data blocks / axis labels (canvas text beats DOM churn).
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    wrap.appendChild(overlay);
    const octx = overlay.getContext('2d');

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 8;   // allow zooming right down to the field / gates
    controls.maxDistance = 320;
    controls.maxPolarAngle = 1.46;

    const mats = makeMaterials();

    // ---- static ground furniture -------------------------------------------
    const ground = new THREE.Group();
    scene.add(ground);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS, 96),
      new THREE.MeshBasicMaterial({ color: 0x061009, transparent: true, opacity: 0.92 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.05;
    ground.add(disc);

    const ringMat = new THREE.LineBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.16 });
    for (let i = 1; i <= 4; i++) {
      const pts = new THREE.EllipseCurve(0, 0, (RADIUS * i) / 4, (RADIUS * i) / 4).getPoints(90)
        .map((p) => new THREE.Vector3(p.x, 0, p.y));
      ground.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
    const spokeMat = new THREE.LineBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.07 });
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180;
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(a) * RADIUS, 0, -Math.cos(a) * RADIUS)];
      ground.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), spokeMat));
    }

    // sweep wedge
    const sweepGroup = new THREE.Group();
    const wedge = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS, 28, 0, 0.55),
      new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
    );
    wedge.rotation.x = -Math.PI / 2;
    sweepGroup.add(wedge);
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(RADIUS, 0.1, 0)]),
      new THREE.LineBasicMaterial({ color: 0x57f2ae, transparent: true, opacity: 0.5 })
    );
    sweepGroup.add(beam);
    scene.add(sweepGroup);

    // runway group (rebuilt when airport/range changes)
    const rwyGroup = new THREE.Group();
    scene.add(rwyGroup);
    let rwySignature = '';

    function rebuildRunways(rwys, k, ap, rangeNm) {
      rwyGroup.clear();
      // schematic terminal blocks on the apron at deep zoom (footprints aren't
      // in public data — arranged around the field, sized by real gate counts)
      if (rangeNm <= 5 && ap?.terminals?.length) {
        const terms = ap.terminals;
        terms.forEach((term, i) => {
          const ang = (i / terms.length) * Math.PI * 2 - Math.PI / 2;
          const ring = 0.34 * k;
          const gates = term.gates?.length || 4;
          const w = Math.min(0.9 * k, (0.02 + gates * 0.004) * k);
          const blk = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(0.5, w), 0.16, Math.max(0.4, 0.05 * k)),
            new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.28 })
          );
          blk.position.set(Math.cos(ang) * ring, 0.02, Math.sin(ang) * ring);
          blk.rotation.y = -ang;
          rwyGroup.add(blk);
        });
      }
      for (const rwy of rwys) {
        const lenU = (rwy.lenFt / FT_PER_NM) * k;
        const hdg = (rwy.activeHdg * Math.PI) / 180;
        const ox = (rwy.offX || 0) * k;
        const oz = -(rwy.offY || 0) * k;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.6, k * 0.06), 0.12, Math.max(lenU, 1.4)),
          new THREE.MeshBasicMaterial({ color: rwy.status === 'X-WIND' ? 0xffb454 : 0xd9e6ec })
        );
        box.rotation.y = -hdg;
        box.position.set(ox, 0, oz);
        rwyGroup.add(box);

        if (rwy.role.includes('ARR')) {
          const dx = Math.sin(hdg);
          const dz = -Math.cos(hdg);
          const start = new THREE.Vector3(ox - dx * lenU * 0.5, 0.05, oz - dz * lenU * 0.5);
          const end = new THREE.Vector3(ox - dx * 15 * k, 0.05, oz - dz * 15 * k);
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([start, end]),
            new THREE.LineDashedMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.35, dashSize: 1.6, gapSize: 1.8 })
          );
          line.computeLineDistances();
          rwyGroup.add(line);
        }
      }
    }

    // ---- per-aircraft pooled objects ---------------------------------------
    const pool = new Map(); // id → { group, body, stem, base, trailLine }
    const trailsData = new Map(); // id → [{x,y,z}...]
    const GEO = {
      jet: buildPlaneGeo(),
      light: buildLightGeo(),
      heli: buildHeliGeo(),
      glider: buildLightGeo(),
      unknown: buildUnknownGeo(),
    };
    const rotorGeo = buildRotorGeo();
    // Generous invisible raycast target — clicking a 6px silhouette precisely
    // is unreasonable; the hit sphere is what selection actually tests.
    const hitGeo = new THREE.SphereGeometry(2.6, 6, 4);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    function getObj(id, kind) {
      let o = pool.get(id);
      if (o) { // swap geometry if the classified kind changed
        if (o.kind !== kind) {
          o.cone.geometry = GEO[kind] || GEO.jet;
          o.kind = kind;
          o.rotor.visible = kind === 'heli';
        }
        return o;
      }
      const group = new THREE.Group();
      const cone = new THREE.Mesh(GEO[kind] || GEO.jet, mats.ENROUTE);
      // spinning main rotor, mounted at the mast top; visible for helis only
      const rotor = new THREE.Mesh(rotorGeo, mats.ENROUTE);
      rotor.position.set(0, 0.99, 0.15);
      rotor.visible = kind === 'heli';
      cone.add(rotor);
      const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const stem = new THREE.Line(stemGeo, mats.line_ENROUTE);
      const base = new THREE.Mesh(new THREE.CircleGeometry(0.55, 10), new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.35 }));
      base.rotation.x = -Math.PI / 2;
      const selRing = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.1, 24), new THREE.MeshBasicMaterial({ color: 0xe8f6ee, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      selRing.visible = false;
      const hit = new THREE.Mesh(hitGeo, hitMat);
      group.add(cone, stem, base, selRing, hit);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const trailLine = new THREE.Line(trailGeo, mats.trail_ENROUTE);
      trailLine.frustumCulled = false;
      scene.add(group, trailLine);
      o = { group, cone, rotor, stem, base, selRing, hit, trailLine, kind };
      pool.set(id, o);
      return o;
    }

    // conflict connectors
    const conflGeo = new THREE.BufferGeometry();
    conflGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 6), 3));
    const conflLines = new THREE.LineSegments(conflGeo, new THREE.LineBasicMaterial({ color: 0xff5c5c, transparent: true, opacity: 0.7 }));
    conflLines.frustumCulled = false;
    scene.add(conflLines);

    // ---- live weather, rendered in the 3D scene (on the grid) --------------
    // Precipitation is real world-space geometry falling onto the scope, so it
    // has depth and perspective and orbits with the camera — not a flat overlay
    // stretched across the panel. Driven by the live METAR each frame.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const WX_TOP = RADIUS * 0.9;          // particle ceiling above the grid
    const R2 = RADIUS * RADIUS;
    const spawnInDisc = (p, top) => {
      const r = Math.sqrt(Math.random()) * RADIUS, a = Math.random() * 6.2832;
      p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.y = top;
    };
    const windTo = (f) => {
      // METAR wind is where it blows FROM; particles drift toward dir+180.
      const b = (((f.windDir ?? 0) + 180) * Math.PI) / 180;
      return { x: Math.sin(b), z: -Math.cos(b), spd: Math.min(1, (f.windKt || 0) / 45) };
    };

    // Rain / drizzle / wind — line streaks (two verts each), one shared buffer.
    const N_RAIN = 850;
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_RAIN * 6), 3));
    const rainMat = new THREE.LineBasicMaterial({ color: 0x9fc4dc, transparent: true, opacity: 0.26, depthWrite: false });
    const rain = new THREE.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false; rain.visible = false;
    scene.add(rain);
    const rainP = Array.from({ length: N_RAIN }, () => {
      const p = { s: 0.8 + Math.random() * 0.5 }; spawnInDisc(p, Math.random() * WX_TOP); return p;
    });

    // Snow — soft round sprites that sway as they fall.
    const flake = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d');
      const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.45, 'rgba(255,255,255,0.7)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(16, 16, 16, 0, 6.2832); g.fill();
      return new THREE.CanvasTexture(c);
    })();
    const N_SNOW = 650;
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SNOW * 3), 3));
    const snowMat = new THREE.PointsMaterial({ color: 0xeef4fb, size: 1.7, map: flake, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
    const snow = new THREE.Points(snowGeo, snowMat);
    snow.frustumCulled = false; snow.visible = false;
    scene.add(snow);
    const snowP = Array.from({ length: N_SNOW }, () => {
      const p = { s: 7 + Math.random() * 8, ph: Math.random() * 6.28, pv: 0.6 + Math.random() * 0.9 };
      spawnInDisc(p, Math.random() * WX_TOP); return p;
    });

    // Fog / mist — pull the scene murk in and lay a low haze over the grid.
    const fogHaze = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: 0x9fb4c0, transparent: true, opacity: 0, depthWrite: false })
    );
    fogHaze.rotation.x = -Math.PI / 2; fogHaze.position.y = 5;
    scene.add(fogHaze);
    const fogBase = { near: scene.fog.near, far: scene.fog.far };

    // Lightning — occasional jagged strikes to the grid. A single bolt appears,
    // holds briefly, then fades: an actual strike, not a full-screen strobe.
    const BOLT_DUR = 0.34;
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3)); // ≤48 segments
    const boltMat = new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const bolt = new THREE.LineSegments(boltGeo, boltMat);
    bolt.frustumCulled = false; bolt.visible = false;
    scene.add(bolt);
    const boltGlow = new THREE.Mesh(
      new THREE.CircleGeometry(18, 24),
      new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    boltGlow.rotation.x = -Math.PI / 2; boltGlow.position.y = 0.3; boltGlow.visible = false;
    scene.add(boltGlow);
    let boltLife = 0, boltTimer = 2 + Math.random() * 4;

    function strike() {
      const rr = Math.sqrt(Math.random()) * RADIUS * 0.8, aa = Math.random() * 6.2832;
      const gx = Math.cos(aa) * rr, gz = Math.sin(aa) * rr;   // ground strike point on the grid
      const steps = 11 + Math.floor(Math.random() * 4);
      const tx = gx + (Math.random() * 2 - 1) * 20, tz = gz + (Math.random() * 2 - 1) * 20; // cloud origin
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;                 // 0 = cloud top → 1 = ground
        const jit = (1 - t) * 9;             // wander tightens toward the strike point
        pts.push(new THREE.Vector3(
          tx * (1 - t) + gx * t + (Math.random() * 2 - 1) * jit,
          WX_TOP * (1 - t),
          tz * (1 - t) + gz * t + (Math.random() * 2 - 1) * jit
        ));
      }
      const seg = [];
      for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i], pts[i + 1]);
      for (let b = 0, forks = 1 + (Math.random() < 0.6 ? 1 : 0); b < forks; b++) {
        const k = 2 + Math.floor(Math.random() * (pts.length - 4));
        let p = pts[k].clone();
        for (let j = 0, bl = 2 + Math.floor(Math.random() * 3); j < bl; j++) {
          const np = p.clone().add(new THREE.Vector3((Math.random() * 2 - 1) * 16, -4 - Math.random() * 9, (Math.random() * 2 - 1) * 16));
          seg.push(p.clone(), np); p = np;
        }
      }
      const attr = boltGeo.getAttribute('position');
      const n = Math.min(seg.length, attr.count);
      for (let i = 0; i < n; i++) attr.setXYZ(i, seg[i].x, Math.max(0, seg[i].y), seg[i].z);
      attr.needsUpdate = true;
      boltGeo.setDrawRange(0, n);
      boltGlow.position.set(gx, 0.3, gz);
      boltLife = BOLT_DUR;
    }

    function updateWeather(f, dt) {
      const rainOn = !reduce && (f.kind === 'rain' || f.kind === 'thunder' || f.kind === 'wind');
      const snowOn = !reduce && f.kind === 'snow';
      const fogOn = f.kind === 'fog';
      rain.visible = rainOn; snow.visible = snowOn;

      // Ease fog density in/out (not motion, so it applies under reduced-motion too).
      const near = fogOn ? 22 : fogBase.near;
      const far = fogOn ? 128 - f.intensity * 44 : fogBase.far;
      scene.fog.near += (near - scene.fog.near) * 0.05;
      scene.fog.far += (far - scene.fog.far) * 0.05;
      fogHaze.material.opacity += ((fogOn ? 0.1 + f.intensity * 0.14 : 0) - fogHaze.material.opacity) * 0.05;

      if (rainOn) {
        const w = windTo(f);
        const wind = f.kind === 'wind';
        const fall = wind ? 6 : 150 + f.intensity * 150;
        const horiz = wind ? 130 + f.intensity * 150 : 18 + w.spd * 95;
        const len = wind ? 15 : 3.5 + f.intensity * 3;
        const vx = w.x * horiz, vy = -fall, vz = w.z * horiz;
        const vl = Math.hypot(vx, vy, vz) || 1;
        const ux = (vx / vl) * len, uy = (vy / vl) * len, uz = (vz / vl) * len;
        const active = wind ? 240 : N_RAIN;   // wind = sparse, long streaks
        const attr = rainGeo.getAttribute('position');
        for (let i = 0; i < N_RAIN; i++) {
          const p = rainP[i];
          if (i < active) {
            p.x += vx * dt; p.z += vz * dt; p.y -= fall * p.s * dt;
            if (p.y < 0 || p.x * p.x + p.z * p.z > R2) spawnInDisc(p, WX_TOP);
            attr.setXYZ(i * 2, p.x, p.y, p.z);
            attr.setXYZ(i * 2 + 1, p.x - ux, p.y - uy, p.z - uz);
          } else { attr.setXYZ(i * 2, 0, -9, 0); attr.setXYZ(i * 2 + 1, 0, -9, 0); }
        }
        attr.needsUpdate = true;
        rainMat.opacity = wind ? 0.16 : 0.22 + f.intensity * 0.2;
      }

      if (snowOn) {
        const w = windTo(f);
        const attr = snowGeo.getAttribute('position');
        for (let i = 0; i < N_SNOW; i++) {
          const p = snowP[i];
          p.ph += p.pv * dt; p.y -= p.s * dt;
          p.x += (Math.sin(p.ph) * 3 + w.x * w.spd * 34) * dt;
          p.z += (Math.cos(p.ph * 0.8) * 3 + w.z * w.spd * 34) * dt;
          if (p.y < 0 || p.x * p.x + p.z * p.z > R2) spawnInDisc(p, WX_TOP);
          attr.setXYZ(i, p.x, p.y, p.z);
        }
        attr.needsUpdate = true;
        snowMat.opacity = 0.6 + f.intensity * 0.25;
      }

      // Lightning strikes for thunderstorms — occasional bolts, never a strobe.
      if (f.kind === 'thunder' && !reduce) {
        boltTimer -= dt;
        if (boltTimer <= 0) { strike(); boltTimer = 3 + Math.random() * 6; }
      }
      if (boltLife > 0) {
        boltLife -= dt;
        const e = Math.max(0, boltLife / BOLT_DUR);
        const op = e > 0.75 ? 1 : e / 0.75;   // brief hold, then a smooth fade
        bolt.visible = true; boltMat.opacity = op;
        boltGlow.visible = true; boltGlow.material.opacity = op * 0.5;
      } else if (bolt.visible) { bolt.visible = false; boltGlow.visible = false; }
    }

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 2 };

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);
      overlay.width = width * dpr;
      overlay.height = height * dpr;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const onClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      const targets = [];
      for (const [id, o] of pool) if (o.group.visible) { o.hit.userData.id = id; targets.push(o.hit); }
      const hits = raycaster.intersectObjects(targets, false);
      onSelectRef.current(hits.length ? hits[0].object.userData.id : null);
    };
    renderer.domElement.addEventListener('click', onClick);

    let raf;
    let lastTrailSample = 0;
    let lastIcao = null;
    let wxLast = performance.now();

    const animate = () => {
      const { airport: ap, aircraft: acs, conflicts: confl, runways: rwys, selectedId: selId, range: rangeNm, labels: labelMode, showTrails: trailsOn, units: u } = dataRef.current;
      const now = Date.now();
      const tnow = performance.now();
      const dt = Math.min((tnow - wxLast) / 1000, 0.05);
      wxLast = tnow;
      const k = RADIUS / rangeNm;
      const { width, height } = wrap.getBoundingClientRect();

      if (ap.icao !== lastIcao) {
        lastIcao = ap.icao;
        trailsData.clear();
        for (const [, o] of pool) { o.group.visible = false; o.trailLine.visible = false; }
      }

      const sig = ap.icao + rangeNm + rwys.map((r) => r.activeEnd + r.status).join('');
      if (sig !== rwySignature) { rwySignature = sig; rebuildRunways(rwys, k, ap, rangeNm); }

      sweepGroup.rotation.y = -((now % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) * Math.PI * 2;

      updateWeather(dataRef.current.wxEnabled === false
        ? { kind: 'clear', intensity: 0, windDir: 0, windKt: 0 }
        : classifyWeather(dataRef.current.weather), dt);

      const conflictIds = new Set(confl.flatMap((c) => [c.a.id, c.b.id]));
      const liveIds = new Set();
      let selPos = null; // world position of the selected track, for follow-cam
      const sampleTrails = now - lastTrailSample > 1800;
      if (sampleTrails) lastTrailSample = now;

      const labelJobs = [];
      let shown = 0;

      for (const ac of acs) {
        const dr = deadReckon(ac.lat, ac.lon, ac.onGround ? Math.min(ac.gs, 30) : ac.gs, ac.track, Math.min((now - ac.seenAt) / 1000, 60));
        const { x: e, y: n } = toLocalNm(ap.lat, ap.lon, dr.lat, dr.lon);
        if (Math.hypot(e, n) > rangeNm) continue;
        shown++;
        liveIds.add(ac.id);

        const o = getObj(ac.id, iconKind(ac));
        const y = ac.onGround ? 0.3 : Math.max(0.3, (ac.altFt ?? 0) / FT_PER_NM * ALT_EXAG * k);
        const px = e * k;
        const pz = -n * k;
        o.group.visible = true;
        o.group.position.set(px, y, pz);
        if (ac.id === selId) selPos = new THREE.Vector3(px, y, pz);

        const isConflict = conflictIds.has(ac.id);
        const isSel = ac.id === selId;
        const isEmerg = !!emergencyInfo(ac);
        const key = isEmerg || isConflict ? 'conflict' : (PHASE_COLORS[ac.phase] ? ac.phase : 'ENROUTE');
        o.cone.material = mats[isSel ? 'selected' : key];
        o.stem.material = mats[`line_${key}`];
        o.trailLine.material = mats[`trail_${key}`];
        // Ground traffic recedes when zoomed out (a small marker in the busy
        // centre) and grows when you zoom in, so aircraft lined up at gates and
        // on taxiways become legible at close range.
        // Ground traffic clusters at gates/taxiways; scale it up as you zoom in
        // so individual aircraft separate out and stay identifiable.
        const gScale = rangeNm >= 60 ? 0.28 : rangeNm >= 40 ? 0.36 : rangeNm >= 20 ? 0.52 : rangeNm >= 10 ? 0.8 : rangeNm >= 5 ? 1.05 : 1.35;
        o.cone.scale.setScalar(ac.onGround ? gScale : 1);
        // Heading (yaw) + a pitch tilt from vertical speed: nose-up climbing,
        // nose-down descending — reads as realistic climb/approach attitude.
        o.cone.rotation.order = 'YXZ';
        o.cone.rotation.y = Math.atan2(Math.sin(ac.track * Math.PI / 180), -Math.cos(ac.track * Math.PI / 180));
        const pitch = ac.onGround || o.kind === 'heli' || o.kind === 'unknown'
          ? 0 : Math.max(-0.38, Math.min(0.38, (ac.vs || 0) / 3500));
        o.cone.rotation.x = -pitch;
        // spinning main rotor — faster airborne, idle on the ground
        if (o.rotor.visible) {
          o.rotor.material = o.cone.material;
          o.rotor.rotation.y = ((now / 1000) * (ac.onGround ? 3 : 9)) % (Math.PI * 2);
        }
        o.selRing.visible = isSel || isConflict || isEmerg;
        o.selRing.material.color.setHex(isSel ? PHASE_COLORS.selected : PHASE_COLORS.conflict);
        o.selRing.rotation.x = -Math.PI / 2;
        if (isConflict && !isSel) {
          const s = 1 + 0.25 * Math.sin(now / 160);
          o.selRing.scale.set(s, s, s);
        } else o.selRing.scale.set(1, 1, 1);

        // stem + ground base
        o.stem.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -y + 0.1, 0)]);
        o.base.position.y = -y + 0.12;
        o.base.material.color.setHex(PHASE_COLORS[key] ?? PHASE_COLORS.ENROUTE);

        // trail
        if (trailsOn) {
          let t = trailsData.get(ac.id);
          if (!t) { t = []; trailsData.set(ac.id, t); }
          if (sampleTrails) {
            t.push({ e, n, alt: ac.onGround ? 0.3 : (ac.altFt ?? 0) / FT_PER_NM * ALT_EXAG });
            if (t.length > 24) t.shift();
          }
          const attr = o.trailLine.geometry.getAttribute('position');
          for (let i = 0; i < t.length; i++) attr.setXYZ(i, t[i].e * k, Math.max(0.3, t[i].alt * k), -t[i].n * k);
          attr.needsUpdate = true;
          o.trailLine.geometry.setDrawRange(0, t.length);
          o.trailLine.visible = t.length > 1;
        } else o.trailLine.visible = false;

        // queue label (enroute labels in AUTO only kept if the scope is quiet)
        const important = ac.phase !== 'ENROUTE' && (ac.phase !== 'GROUND' || rangeNm <= 20);
        if (labelMode !== 'OFF' || isSel || isConflict) {
          labelJobs.push({
            ac, pos: new THREE.Vector3(px, y + 1.6, pz), isSel, isConflict,
            optional: labelMode === 'AUTO' ? !important : labelMode === 'OFF',
          });
        }
      }

      // hide stale objects
      for (const [id, o] of pool) {
        if (!liveIds.has(id)) { o.group.visible = false; o.trailLine.visible = false; }
      }

      // conflict connectors
      {
        const attr = conflGeo.getAttribute('position');
        let i = 0;
        for (const c of confl.slice(0, 20)) {
          for (const acX of [c.a, c.b]) {
            const dr = deadReckon(acX.lat, acX.lon, acX.gs, acX.track, Math.min((now - acX.seenAt) / 1000, 60));
            const { x: e, y: n } = toLocalNm(ap.lat, ap.lon, dr.lat, dr.lon);
            attr.setXYZ(i++, e * k, Math.max(0.3, (acX.altFt ?? 0) / FT_PER_NM * ALT_EXAG * k), -n * k);
          }
        }
        attr.needsUpdate = true;
        conflGeo.setDrawRange(0, i);
      }

      // Follow-cam: ease the orbit target onto the selected aircraft (and back
      // to the field centre when nothing is selected). The user can still orbit.
      const want = selPos || new THREE.Vector3(0, 0, 0);
      controls.target.lerp(want, 0.06);
      controls.update();
      renderer.render(scene, camera);

      // ---- overlay labels ---------------------------------------------------
      octx.clearRect(0, 0, width, height);
      octx.textAlign = 'left';

      // ring distance labels along north axis
      octx.font = '9px "IBM Plex Mono", monospace';
      octx.fillStyle = 'rgba(143,166,177,0.6)';
      for (let i = 1; i <= 4; i++) {
        const v = new THREE.Vector3(0, 0, -(RADIUS * i) / 4).project(camera);
        if (v.z < 1) octx.fillText(`${(rangeNm * i) / 4}nm`, (v.x * 0.5 + 0.5) * width + 4, (-v.y * 0.5 + 0.5) * height - 3);
      }
      octx.font = '11px "Barlow Condensed", sans-serif';
      for (const [t, ang] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
        const a = (ang * Math.PI) / 180;
        const v = new THREE.Vector3(Math.sin(a) * (RADIUS + 6), 0, -Math.cos(a) * (RADIUS + 6)).project(camera);
        if (v.z < 1) octx.fillText(t, (v.x * 0.5 + 0.5) * width - 3, (-v.y * 0.5 + 0.5) * height + 3);
      }

      // Priority order + screen-space collision so the busy centre declutters:
      // selected/conflict/approach claim label space first, clutter yields.
      const rank3 = (j) => (j.isSel ? 0 : j.isConflict ? 1 : ({ FINAL: 2, APPROACH: 3, ARRIVAL: 4, DEPARTURE: 5, GROUND: 8 }[j.ac.phase] ?? 6));
      labelJobs.sort((a, b) => rank3(a) - rank3(b));
      const skipOptional = shown >= 26;
      const rects = [];
      const hit3 = (x, y, w, h) => rects.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
      for (const job of labelJobs) {
        if (job.optional && skipOptional && !job.isSel && !job.isConflict) continue;
        const v = job.pos.project(camera);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * width;
        const sy = (-v.y * 0.5 + 0.5) * height;
        if (hit3(sx + 6, sy - 20, 72, 22) && !job.isSel && !job.isConflict) continue;
        rects.push({ x: sx + 6, y: sy - 20, w: 72, h: 22 });
        const ac = job.ac;
        octx.font = '600 10px "IBM Plex Mono", monospace';
        octx.fillStyle = job.isConflict ? '#ff5c5c' : job.isSel ? '#e8f6ee' : 'rgba(217,230,236,0.92)';
        octx.fillText(ac.callsign, sx + 6, sy - 12);
        octx.font = '9px "IBM Plex Mono", monospace';
        octx.fillStyle = 'rgba(143,166,177,0.85)';
        const vsArrow = ac.vs > 250 ? '↑' : ac.vs < -250 ? '↓' : '';
        octx.fillText(`${fmtAltScope(ac.altFt, u?.altitude, ac.onGround)}${vsArrow} ${fmtSpeed(ac.gs, u?.speed)}`, sx + 6, sy - 2);
      }

      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      rainGeo.dispose(); rainMat.dispose();
      snowGeo.dispose(); snowMat.dispose(); flake.dispose();
      fogHaze.geometry.dispose(); fogHaze.material.dispose();
      boltGeo.dispose(); boltMat.dispose();
      boltGlow.geometry.dispose(); boltGlow.material.dispose();
      renderer.dispose();
      wrap.removeChild(renderer.domElement);
      wrap.removeChild(overlay);
    };
  }, []);

  return <div className="radar-canvas-wrap radar3d" ref={wrapRef} />;
}

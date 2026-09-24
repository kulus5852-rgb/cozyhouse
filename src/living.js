// =====================================================================================================================
//  LIVING ROOM — module "living", order 60.  (SPEC §4.9 fireplace, §8 interactables, §9 living)
//  Fireplace (stone breast, sooty firebox, oak-beam mantel + decor, hearth, grate, logs, shader flames, sparks, ember
//  bed, flickering shadow-casting fire light), rust velvet sofa, wingback armchair, coffee table + tea tray, rugs,
//  bookcase, floor + table lamps, window seat with cushions, curtains, roman blinds, record player + vinyl crate,
//  plants, paintings, baskets.
//  Interactables: fireplace, sofa, armchair, window_seat, record_player, lamp_living_floor, lamp_living_table.
//  Lights: fire (Point #ff8a3d ~9 cd flicker, shadows on high), lamp_living_floor (3.6 cd), lamp_living_table (2.4 cd).
//  Exposes C.living = { catSpots, seats, fire: { level, target, light(), addLog(), putOut() } }.
// =====================================================================================================================
import * as THREE from 'three';

const C = window.COZY;
const PI = Math.PI;
const FIRE_CD = 9;

const FLAME_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FLAME_FS = /* glsl */`
uniform float uTime; uniform float uLevel; uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; } return v; }
void main() {
  float lv = clamp(uLevel, 0.0, 1.6);
  float t = uTime * 1.3;
  float n1 = fbm(vec2(vUv.x * 3.2 + uSeed * 7.0, vUv.y * 2.6 - t * 1.9));
  float n2 = fbm(vec2(vUv.x * 6.5 - uSeed * 3.0, vUv.y * 4.8 - t * 3.1));
  float x = (vUv.x - 0.5) * 2.0;
  float top = mix(0.3, 0.85, clamp(lv, 0.0, 1.0)) + 0.25 * clamp(lv - 1.0, 0.0, 0.6);
  float yy = vUv.y / max(top, 0.05);
  float sway = (n1 - 0.5) * 0.6 * yy;
  float w = mix(0.95, 0.06, pow(clamp(yy, 0.0, 1.0), 0.7));
  float body = 1.0 - smoothstep(w * 0.4, w, abs(x + sway));
  float fade = 1.0 - smoothstep(0.4, 1.05, yy + (n2 - 0.5) * 0.55);
  float f = body * fade * smoothstep(0.0, 0.1, vUv.y) * (0.5 + 0.95 * n2);
  f = clamp(f, 0.0, 1.25);
  vec3 col = mix(vec3(0.5, 0.05, 0.01), vec3(1.0, 0.34, 0.05), smoothstep(0.05, 0.45, f));
  col = mix(col, vec3(1.0, 0.8, 0.45), smoothstep(0.6, 1.05, f) * (1.0 - yy * 0.55));
  float a = smoothstep(0.03, 0.25, f) * min(lv, 1.0);
  gl_FragColor = vec4(col * f * 1.55 * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPARK_VS = /* glsl */`
uniform float uTime; uniform float uLevel; uniform float uPx;
attribute float aSeed;
varying float vA;
void main() {
  float speed = 0.3 + aSeed * 0.35;
  float cyc = uTime * speed + aSeed * 7.13;
  float life = fract(cyc);
  vec3 p = position;
  p.y += life * (0.45 + aSeed * 0.55);
  p.x += sin(aSeed * 40.0 + uTime * 3.0) * 0.05 * life;
  p.z += cos(aSeed * 23.0 + uTime * 2.3) * 0.08 * life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float on = step(0.6, fract(aSeed * 13.7 + floor(cyc) * 0.618));
  vA = (1.0 - life) * smoothstep(0.0, 0.06, life) * on * clamp(uLevel - 0.15, 0.0, 1.4);
  gl_PointSize = (0.006 + 0.014 * (1.0 - life)) * uPx / max(0.2, -mv.z);
}`;

const SPARK_FS = /* glsl */`
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
  if (d > 0.25 || vA < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * (1.0 - d * 4.0) * vA * 2.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const st = { ready: false };
const _cam = new THREE.Vector3();
// a door hides what is behind it only once the leaf has actually swung shut
const doorShut = d => !!d && !d.isOpen && Math.abs(d.angle || 0) < 0.03;

// invisible pick volume (material.visible = false → never drawn, still raycastable, survives baking)
function proxyBox(parent, mat, x0, y0, z0, x1, y1, z1, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.name = name;
  m.userData.dynamic = true;
  parent.add(m);
  return m;
}

// pillow inside its own yaw group so the lean happens about the pillow's own X axis
function pillowAt(parent, x, y, z, yaw, lean, o) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  parent.add(g);
  C.props.pillow(Object.assign({ parent: g, position: [0, 0, 0], rotation: [lean, 0, o.roll || 0] }, o));
  return g;
}

// log lying along local Z (then yawed): bark side + two end-grain caps
function logMesh(parent, M, len, r, x, y, z, ry, tilt) {
  const U = C.util;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(0, ry || 0, tilt || 0);
  const inner = new THREE.Group();
  inner.rotation.x = PI / 2;
  g.add(inner);
  U.cyl(inner, r, r * 1.05, len, M.bark, 0, 0, 0, { radial: 12, open: true, uv: 'world', uvScale: 3 });
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99 * (s > 0 ? 1 : 1.05), 12), M.logEnd);
    cap.position.y = s * len / 2;
    cap.rotation.x = -s * PI / 2;
    cap.receiveShadow = true;
    inner.add(cap);
  }
  parent.add(g);
  return g;
}

function curtainGeo(width, height, folds, amp, seed) {
  const g = new THREE.PlaneGeometry(width, height, Math.max(16, folds * 8), 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / width + 0.5, v = p.getY(i) / height + 0.5;
    const z = Math.sin(u * folds * 2 * PI + seed) * amp * (0.8 + 0.35 * (1 - v)) + C.util.noise2D(u * 5 + seed, v * 3) * 0.006;
    p.setZ(i, z);
  }
  g.computeVertexNormals();
  return g;
}

function buildSofa(parent, M, x, z, ry) {
  const U = C.util;
  const g = new THREE.Group();
  g.name = 'living.sofa';
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
  const W = 2.1, D = 0.92, f = M.sofa;
  U.box(g, W - 0.06, 0.2, D - 0.08, f, 0, 0.19, 0, { round: 0.04, segments: 3 });
  for (const s of [-1, 1]) {
    U.box(g, 0.22, 0.46, D, f, s * (W / 2 - 0.11), 0.33, 0, { round: 0.06, segments: 3 });
    U.cyl(g, 0.11, 0.11, D - 0.01, f, s * (W / 2 - 0.11), 0.56, 0, { rx: PI / 2, radial: 20 });
  }
  U.box(g, W - 0.38, 0.58, 0.22, f, 0, 0.56, -D / 2 + 0.12, { round: 0.07, segments: 3 });
  const cw = (W - 0.44) / 3;
  for (let i = 0; i < 3; i++) {
    const cx = -W / 2 + 0.22 + cw * (i + 0.5);
    U.box(g, cw - 0.012, 0.16, D - 0.27, f, cx, 0.37, 0.1, { round: 0.055, segments: 3 });
    U.box(g, cw - 0.02, 0.4, 0.17, f, cx, 0.64, -D / 2 + 0.31, { round: 0.075, segments: 3, rx: -0.13 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.cyl(g, 0.024, 0.017, 0.09, M.dark, sx * (W / 2 - 0.09), 0.045, sz * (D / 2 - 0.09), { radial: 10 });
  pillowAt(g, -0.7, 0.63, -0.06, 0.7, -0.25, { w: 0.44, h: 0.44, t: 0.14, color: 0xd09a3a });
  pillowAt(g, 0.7, 0.63, -0.06, -0.7, -0.25, { w: 0.44, h: 0.44, t: 0.14, color: 0xefe6d4 });
  pillowAt(g, 0.42, 0.6, -0.1, -0.25, -0.2, { w: 0.36, h: 0.3, t: 0.12, color: 0x2f3d5a });
  // knit throw draped over the back (hangs down the back side, visible from the hall)
  C.props.throwBlanket({ parent: g, w: 0.95, d: 0.5, material: 'knit', position: [0.28, 0.84, -0.514], rotationY: PI, drapeOver: 0.35, seed: 3 });
  U.blobShadow(g, 0, 0, 0, W + 0.25, D + 0.25, 0.45);
  castShadows(g);
  return g;
}

function buildArmchair(parent, M, x, z, ry) {
  const U = C.util;
  const g = new THREE.Group();
  g.name = 'living.armchair';
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
  const W = 0.88, D = 0.86, f = M.chair;
  U.box(g, W - 0.06, 0.2, D - 0.08, f, 0, 0.22, 0.01, { round: 0.04, segments: 3 });
  U.box(g, W - 0.32, 0.14, D - 0.26, f, 0, 0.385, 0.09, { round: 0.05, segments: 3 });
  for (const s of [-1, 1]) {
    U.box(g, 0.16, 0.4, D - 0.1, f, s * (W / 2 - 0.08), 0.34, 0.04, { round: 0.06, segments: 3 });
    U.cyl(g, 0.08, 0.08, D - 0.12, f, s * (W / 2 - 0.08), 0.54, 0.04, { rx: PI / 2, radial: 16 });
  }
  const back = new THREE.Group();
  back.position.set(0, 0.12, -D / 2 + 0.1);
  back.rotation.x = -0.1;
  g.add(back);
  U.box(back, W - 0.1, 0.98, 0.17, f, 0, 0.49, 0, { round: 0.07, segments: 3 });
  for (const s of [-1, 1]) U.box(back, 0.12, 0.46, 0.34, f, s * (W / 2 - 0.07), 0.74, 0.16, { round: 0.05, segments: 3, ry: -s * 0.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.cyl(g, 0.022, 0.016, 0.12, M.dark, sx * (W / 2 - 0.08), 0.06, sz * (D / 2 - 0.08), { radial: 10 });
  pillowAt(g, 0, 0.64, -D / 2 + 0.27, 0, -0.18, { w: 0.4, h: 0.3, t: 0.12, color: 0x3d5a45 });
  U.blobShadow(g, 0, 0, 0, W + 0.2, D + 0.2, 0.42);
  castShadows(g);
  return g;
}

// big furniture facing the fire casts shadows from the fire light (quality high)
function castShadows(g) {
  g.traverse(o => { if (o.isMesh && o.name !== 'blobShadow') o.castShadow = true; });
}

// bookcase in local space: back at z = 0, front at z = D, facing +Z
function buildBookcase(parent, M, x, zWall, ry, W, D, H, seed) {
  const U = C.util, P = C.props;
  const g = new THREE.Group();
  g.name = 'living.bookcase';
  g.position.set(x, 0, zWall);
  g.rotation.y = ry;
  parent.add(g);
  const t = 0.03, wood = M.dark;
  U.boxAt(g, -W / 2, 0, 0, -W / 2 + t, H, D, wood);
  U.boxAt(g, W / 2 - t, 0, 0, W / 2, H, D, wood);
  U.boxAt(g, -W / 2 - 0.02, H, 0, W / 2 + 0.02, H + 0.04, D + 0.025, wood, { round: 0.008 });
  U.boxAt(g, -W / 2 + t, 0, D - 0.025, W / 2 - t, 0.09, D - 0.005, wood);
  U.boxAt(g, -W / 2 + t, 0.09, 0, W / 2 - t, H, 0.012, M.oak);
  U.boxAt(g, -0.015, 0.09, 0.012, 0.015, H, D, wood);
  const levels = [0.09, 0.5, 0.91, 1.32, 1.73];
  for (const y of levels) U.boxAt(g, -W / 2 + t, y, 0.012, W / 2 - t, y + 0.025, D, wood);
  const bayW = W / 2 - t - 0.015, zc = D - 0.13;
  const bay = side => side * (0.015 + bayW / 2);
  let k = 0;
  const row = (side, y, len, off = 0, o = {}) => P.books(Object.assign({ parent: g, length: len, depth: 0.2, position: [bay(side) + off, y, zc], seed: seed * 17 + (k++) }, o));
  const L = levels.map(y => y + 0.025);
  // bottom: basket + tall atlases
  P.basket({ parent: g, position: [bay(-1) - 0.2, L[0], D * 0.52], radius: 0.16, height: 0.22, oval: 0.8, contents: 'blanket' });
  row(-1, L[0], 0.42, 0.18, { minH: 0.24, maxH: 0.31 });
  row(1, L[0], bayW - 0.05, 0, { minH: 0.22, maxH: 0.3 });
  row(-1, L[1], bayW - 0.04);
  row(1, L[1], 0.52, -0.14);
  P.frame({ parent: g, position: [bay(1) + 0.28, L[1], D * 0.55], rotationY: -0.25, w: 0.13, h: 0.18, seed: seed + 1 });
  row(-1, L[2], 0.44, -0.18);
  P.bookStack({ parent: g, count: 3, position: [bay(-1) + 0.2, L[2], D * 0.55], rotationY: 0.2, seed: seed + 2 });
  row(1, L[2], bayW - 0.04, 0, { fill: 0.9 });
  row(-1, L[3], bayW - 0.06);
  row(1, L[3], 0.5, -0.16);
  P.plant({ parent: g, type: 'succulent', position: [bay(1) + 0.27, L[3], D * 0.55], seed: seed + 3 });
  row(-1, L[4], 0.42, 0.2);
  P.vase({ parent: g, position: [bay(-1) - 0.24, L[4], D * 0.55], flowers: 'lavender', height: 0.16, color: 0x6f8a9a, seed: seed + 4 });
  row(1, L[4], bayW - 0.05, 0, { fill: 0.85 });
  P.plant({ parent: g, type: 'pothos', position: [W * 0.28, H + 0.04, D * 0.5], seed: seed + 5 });
  P.bookStack({ parent: g, count: 2, position: [-W * 0.3, H + 0.04, D * 0.5], rotationY: -0.15, seed: seed + 6 });
  U.blobShadow(g, 0, 0, D * 0.5, W + 0.15, D + 0.2, 0.35);
  return g;
}

C.register({
  name: 'living',
  order: 60,
  init(C) {
    const U = C.util, P = C.physics, PR = C.props;
    const root = new THREE.Group(); root.name = 'living';
    C.scene.add(root);
    const S = new THREE.Group(); S.name = 'living.static'; root.add(S);
    st.S = S;
    const D = new THREE.Group(); D.name = 'living.dynamic'; D.userData.dynamic = true; root.add(D);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const errs = [];
    const section = (name, fn) => {
      try { fn(); } catch (e) {
        errs.push(name);
        C.debug.errors.push({ module: 'living', phase: 'init:' + name, message: e.message, stack: String(e.stack || '').slice(0, 1500) });
        console.error(`[living] ${name} failed: ${e.message}`);
      }
    };
    const M = {
      stone: C.mat('stone'), flag: C.mat('flagstone'), brick: C.mat('brick'), dark: C.mat('woodDark'), oak: C.mat('woodMedium'),
      light: C.mat('woodLight'), painted: C.mat('woodPainted'), iron: C.mat('ironBlack'), brass: C.mat('brass'), chrome: C.mat('chrome'),
      sofa: C.mat('fabricSofa'), chair: C.mat('fabricChair'), cream: C.mat('fabricCream'), green: C.mat('fabricGreen'),
      rose: C.mat('fabricRose'), bark: C.mat('bark'), logEnd: C.mat('logEnd'),
    };
    const soot = M.brick.clone(); soot.name = 'living.soot'; soot.color.multiplyScalar(0.26);
    const curtainMat = M.rose.clone(); curtainMat.name = 'living.curtain'; curtainMat.side = THREE.DoubleSide;
    const blindMat = M.cream;
    const addBox = (x0, y0, z0, x1, y1, z1, name, tag = 'furniture') => P.addBox([x0, y0, z0], [x1, y1, z1], { tag, name: 'living.' + name });

    st.seats = {
      sofa: { id: 'sofa', position: [-2.16, 1.1, 2.5], yaw: PI / 2, pitch: -0.1, yawRange: 1.35, pitchMin: -0.9, pitchMax: 0.9, exit: [-2.95, 0, 2.5], label: 'Stand up' },
      armchair: { id: 'armchair', position: [-5.04, 1.1, 0.96], yaw: -PI + 0.45, pitch: -0.12, yawRange: 1.3, exit: [-4.65, 0, 1.77], label: 'Stand up' },
      window_seat: { id: 'window_seat', position: [-4.85, 1.1, 4.4], yaw: -2.3, pitch: -0.04, yawRange: 1.3, pitchMin: -0.8, pitchMax: 0.9, exit: [-4.6, 0, 3.72], label: 'Stand up' },
    };

    // ---------------------------------------------------------------------------------------------------------------
    // Fireplace: stone chimney breast x −6.75→−6.2, z 1.6→3.4; firebox opening z 2.0→3.0, y 0.15→1.0
    // ---------------------------------------------------------------------------------------------------------------
    section('fireplace', () => {
      const bx0 = -6.75, bx1 = -6.2;
      U.boxAt(S, bx0, 0, 1.6, bx1, 2.8, 2.0, M.stone);
      U.boxAt(S, bx0, 0, 3.0, bx1, 2.8, 3.4, M.stone);
      U.boxAt(S, bx0, 1.0, 2.0, bx1, 2.8, 3.0, M.stone);
      U.boxAt(S, -6.7, 0, 2.0, bx1, 0.15, 3.0, M.stone);
      U.boxAt(S, -6.2, 0.98, 1.9, -6.16, 1.16, 3.1, M.stone, { round: 0.01 });           // proud lintel
      U.boxAt(S, bx0, 0.15, 2.0, -6.7, 1.0, 3.0, soot);                                   // firebox back
      U.boxAt(S, -6.7, 0.15, 2.0, -6.205, 1.0, 2.02, soot);
      U.boxAt(S, -6.7, 0.15, 2.98, -6.205, 1.0, 3.0, soot);
      U.boxAt(S, -6.7, 0.975, 2.0, -6.205, 1.0, 3.0, soot);
      U.boxAt(S, -6.24, 1.28, 1.45, -5.97, 1.42, 3.55, M.dark, { round: 0.012 });        // oak beam mantel
      for (const z of [1.63, 3.37]) U.boxAt(S, -6.2, 1.1, z - 0.06, -6.06, 1.28, z + 0.06, M.dark, { round: 0.01 });
      U.boxAt(S, -6.2, 0, 1.7, -5.7, 0.08, 3.3, M.flag, { round: 0.008 });                // hearth slab
      U.blobShadow(S, -6.35, 0.15, 2.5, 0.6, 1.0, 0.5);
      // basket grate + andirons
      const gx0 = -6.62, gx1 = -6.3, gy = 0.25;
      for (const x of [gx0, gx1]) U.boxAt(S, x - 0.012, gy - 0.012, 2.12, x + 0.012, gy + 0.012, 2.88, M.iron);
      for (let i = 0; i <= 6; i++) { const z = 2.14 + i * 0.12; U.boxAt(S, gx0, gy - 0.01, z - 0.008, gx1, gy + 0.01, z + 0.008, M.iron); }
      for (let i = 0; i < 5; i++) { const z = 2.2 + i * 0.15; U.boxAt(S, gx1 - 0.01, gy, z - 0.007, gx1 + 0.01, gy + 0.12, z + 0.007, M.iron); }
      for (const x of [gx0, gx1]) for (const z of [2.14, 2.86]) U.boxAt(S, x - 0.012, 0.15, z - 0.012, x + 0.012, gy, z + 0.012, M.iron);
      for (const z of [2.1, 2.9]) {
        U.boxAt(S, -6.3, 0.15, z - 0.016, -6.26, 0.42, z + 0.016, M.iron);
        U.sphere(S, 0.026, M.brass, -6.28, 0.445, z, { w: 12, h: 8 });
      }
      // logs
      logMesh(S, M, 0.56, 0.066, -6.48, 0.32, 2.5, 0.05);
      logMesh(S, M, 0.5, 0.058, -6.37, 0.315, 2.44, -0.18);
      logMesh(S, M, 0.48, 0.052, -6.44, 0.42, 2.55, 0.62, 0.08);
      st.extraLog = logMesh(D, M, 0.46, 0.055, -6.38, 0.44, 2.4, -0.5, -0.06);
      st.extraLog.visible = false;
      // glowing ember bed under the grate
      const emberTex = U.canvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#140804'; ctx.fillRect(0, 0, w, h);
        const r = U.rng(77);
        for (let i = 0; i < 160; i++) {
          const x = r() * w, y = r() * h, s = 2 + r() * 8;
          const gr = ctx.createRadialGradient(x, y, 0, x, y, s);
          gr.addColorStop(0, `rgba(255,${(150 + r() * 90) | 0},70,1)`); gr.addColorStop(1, 'rgba(255,60,10,0)');
          ctx.fillStyle = gr; ctx.fillRect(x - s, y - s, s * 2, s * 2);
        }
      });
      st.emberMat = new THREE.MeshStandardMaterial({ color: 0x241208, roughness: 0.95, emissive: 0xff5a1e, emissiveMap: emberTex, emissiveIntensity: 1.2 });
      st.emberMat.name = 'living.embers';
      const bed = U.sphere(D, 1, st.emberMat, -6.46, 0.19, 2.5, { w: 18, h: 8, sx: 0.2, sy: 0.04, sz: 0.36, name: 'living.emberBed' });
      bed.userData.dynamic = true;
      // shader flames: camera-facing (yaw) cards
      st.flameU = { uTime: { value: 0 }, uLevel: { value: 1 } };
      st.flames = [];
      const defs = [[-6.47, 0.27, 2.34, 0.42, 0.5, 0.13], [-6.44, 0.3, 2.52, 0.5, 0.62, 0.71], [-6.47, 0.28, 2.7, 0.4, 0.48, 0.37], [-6.52, 0.3, 2.47, 0.34, 0.42, 0.93]];
      for (const [x, y, z, w, h, seed] of defs) {
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: st.flameU.uTime, uLevel: st.flameU.uLevel, uSeed: { value: seed } },
          vertexShader: FLAME_VS, fragmentShader: FLAME_FS,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        mat.name = 'living.flame';
        const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z); m.renderOrder = 5; m.name = 'living.flame'; m.userData.dynamic = true;
        m.raycast = () => {};
        D.add(m);
        st.flames.push(m);
      }
      // sparks
      const N = 44, pos = new Float32Array(N * 3), seeds = new Float32Array(N);
      const r = U.rng(99);
      for (let i = 0; i < N; i++) { pos[i * 3] = -6.46 + (r() - 0.5) * 0.2; pos[i * 3 + 1] = 0.35; pos[i * 3 + 2] = 2.5 + (r() - 0.5) * 0.5; seeds[i] = r(); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
      sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(-6.46, 0.8, 2.5), 1.2);
      st.sparkU = { uTime: st.flameU.uTime, uLevel: st.flameU.uLevel, uPx: { value: 400 } };
      const sm = new THREE.ShaderMaterial({ uniforms: st.sparkU, vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      sm.name = 'living.sparks';
      const sparks = new THREE.Points(sg, sm);
      sparks.name = 'living.sparks'; sparks.renderOrder = 6; sparks.raycast = () => {};
      D.add(sparks);
      st.fireGlow = U.glowSprite(0xff7a2a, 1.1, 0.24);
      st.fireGlow.position.set(-6.25, 0.5, 2.5);
      st.fireGlow.raycast = () => {};
      D.add(st.fireGlow);
      // fire light (in front of the opening so the breast does not trap it when shadows are off)
      const fl = new THREE.PointLight(0xff8a3d, FIRE_CD, 0, 2);
      fl.name = 'light.fire';
      fl.position.set(-6.05, 0.6, 2.5);
      fl.castShadow = true;
      fl.shadow.mapSize.set(512, 512);
      fl.shadow.bias = -0.003;
      fl.shadow.normalBias = 0.03;
      fl.shadow.camera.near = 0.08;
      fl.shadow.camera.far = 14;
      D.add(fl);
      C.registerLight(fl, { id: 'fire', room: 'living', kind: 'fire' });
      st.fireLight = fl;
      // fire tools stand
      const tx = -5.98, tz = 1.42;
      U.cyl(S, 0.1, 0.11, 0.02, M.iron, tx, 0.01, tz, { radial: 16 });
      U.cyl(S, 0.009, 0.009, 0.72, M.iron, tx, 0.37, tz, { radial: 8 });
      U.sphere(S, 0.022, M.brass, tx, 0.745, tz, { w: 10, h: 8 });
      U.boxAt(S, tx - 0.09, 0.66, tz - 0.006, tx + 0.09, 0.672, tz + 0.006, M.iron);
      for (const [dx, kind] of [[-0.075, 'poker'], [0, 'brush'], [0.075, 'shovel']]) {
        U.cyl(S, 0.006, 0.006, 0.58, M.iron, tx + dx, 0.37, tz + 0.012, { radial: 6 });
        U.sphere(S, 0.014, M.brass, tx + dx, 0.675, tz + 0.012, { w: 8, h: 6 });
        if (kind === 'brush') U.cyl(S, 0.026, 0.02, 0.1, M.dark, tx + dx, 0.1, tz + 0.012, { radial: 10 });
        else if (kind === 'shovel') U.boxAt(S, tx + dx - 0.04, 0.03, tz + 0.002, tx + dx + 0.04, 0.12, tz + 0.022, M.iron);
        else U.cyl(S, 0.004, 0.009, 0.06, M.iron, tx + dx, 0.07, tz + 0.012, { radial: 6 });
      }
      PR.basket({ parent: S, position: [-6.3, 0, 3.72], radius: 0.2, height: 0.3, oval: 0.85, contents: 'logs' });
      addBox(-6.75, 0, 1.6, -5.75, 2.8, 3.4, 'fireplace', 'wall');
      P.addCylinder(-6.3, 3.72, 0.2, 0, 0.45, { tag: 'furniture', name: 'living.logBasket' });
      P.addCylinder(tx, tz, 0.12, 0, 0.8, { tag: 'furniture', name: 'living.fireTools' });

      st.fire = { level: 1, target: 1, roar: 0, out: 0 };
      const fireLabel = () => st.fire.target <= 0 ? 'Light the fire' : st.fire.target < 1.25 ? 'Add a log to the fire' : 'Let the fire burn down';
      const setTarget = v => { st.fire.target = v; C.emit('fire', { level: v }); };
      st.fireApi = {
        get level() { return st.fire.level; }, get target() { return st.fire.target; },
        light() { st.extraLog.visible = false; st.fire.roar = 0; setTarget(1); C.audio.play('match', { x: -6.1, y: 0.5, z: 2.5 }); },
        addLog() { st.extraLog.visible = true; st.fire.roar = 75; setTarget(1.5); C.audio.play('thud', { x: -6.3, y: 0.4, z: 2.5, volume: 0.6 }); },
        putOut() { st.fire.roar = 0; st.fire.out = 0; setTarget(0); C.audio.play('whoosh', { x: -6.3, y: 0.5, z: 2.5, volume: 0.5 }); },
      };
      const fp = proxyBox(D, hidden, -6.72, 0, 1.95, -5.7, 1.05, 3.05, 'living.fireplace.pick');
      C.interact.add({
        id: 'fireplace', object: fp, label: fireLabel, range: 2.6,
        onUse: () => { const f = st.fire; if (f.target <= 0) st.fireApi.light(); else if (f.target < 1.25) st.fireApi.addLog(); else st.fireApi.putOut(); },
      });
    });

    section('mantel', () => {
      PR.painting({ parent: S, width: 0.95, height: 0.62, style: 'landscape', frame: 'gold', position: [-6.2, 1.99, 2.5], rotationY: PI / 2, seed: 11 });
      PR.clock({ parent: S, position: [-6.1, 1.42, 3.08], rotationY: PI / 2 });
      PR.candle({ parent: S, position: [-6.1, 1.42, 1.68], height: 0.24, radius: 0.012, holder: 'brass' });
      PR.candle({ parent: S, position: [-6.1, 1.42, 1.82], height: 0.18, radius: 0.012, holder: 'brass' });
      PR.vase({ parent: S, position: [-6.1, 1.42, 2.02], flowers: 'wild', height: 0.17, color: 0xe8e0d0, seed: 21 });
      PR.frame({ parent: S, position: [-6.08, 1.42, 2.72], rotationY: PI / 2 - 0.25, w: 0.12, h: 0.16, seed: 22 });
      PR.plant({ parent: S, type: 'ivy', position: [-6.1, 1.42, 3.42], scale: 0.8, seed: 23 });
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Seating group: sofa facing the fire, armchair, coffee table, side table, rugs, lamps
    // ---------------------------------------------------------------------------------------------------------------
    section('seating', () => {
      PR.rug({ parent: S, w: 3.0, d: 2.6, style: 'persian', position: [-3.85, 0, 2.5] });
      PR.rug({ parent: S, w: 0.95, d: 0.65, style: 'sheepskin', position: [-5.02, 0.007, 2.5], rotationY: PI / 2 + 0.12, tag: false });
      buildSofa(S, M, -2.14, 2.5, -PI / 2);
      addBox(-2.62, 0, 1.43, -1.66, 0.9, 3.57, 'sofa');
      C.interact.add({ id: 'sofa', object: proxyBox(D, hidden, -2.62, 0, 1.45, -1.66, 0.88, 3.55, 'living.sofa.pick'), label: 'Sit on the sofa', onUse: () => C.player.sitAt(st.seats.sofa) });

      buildArmchair(S, M, -5.0, 1.05, 0.45);
      P.addCylinder(-5.0, 1.05, 0.5, 0, 1.1, { tag: 'furniture', name: 'living.armchair' });
      const ap = proxyBox(D, hidden, -0.42, 0, -0.42, 0.42, 1.05, 0.42, 'living.armchair.pick');
      ap.position.set(-5.0, 0.525, 1.05); ap.rotation.y = 0.45;
      C.interact.add({ id: 'armchair', object: ap, label: 'Sit in the armchair', onUse: () => C.player.sitAt(st.seats.armchair) });
      PR.basket({ parent: S, position: [-4.42, 0, 0.8], radius: 0.16, height: 0.2, contents: 'yarn' });
      P.addCylinder(-4.42, 0.8, 0.17, 0, 0.5, { tag: 'furniture', name: 'living.knitBasket' });

      // coffee table (long axis along z)
      const x0 = -3.95, x1 = -3.35, z0 = 1.95, z1 = 3.05;
      U.boxAt(S, x0, 0.4, z0, x1, 0.44, z1, M.oak, { round: 0.01 });
      for (const x of [x0 + 0.04, x1 - 0.04]) for (const z of [z0 + 0.04, z1 - 0.04]) U.boxAt(S, x - 0.025, 0, z - 0.025, x + 0.025, 0.4, z + 0.025, M.oak);
      U.boxAt(S, x0 + 0.03, 0.34, z0 + 0.05, x0 + 0.05, 0.4, z1 - 0.05, M.oak);
      U.boxAt(S, x1 - 0.05, 0.34, z0 + 0.05, x1 - 0.03, 0.4, z1 - 0.05, M.oak);
      U.boxAt(S, x0 + 0.04, 0.1, z0 + 0.04, x1 - 0.04, 0.12, z1 - 0.04, M.oak);
      U.blobShadow(S, (x0 + x1) / 2, 0.006, (z0 + z1) / 2, 0.8, 1.3, 0.4);
      PR.bookStack({ parent: S, count: 3, position: [-3.62, 0.12, 2.75], rotationY: 0.1, seed: 31 });
      PR.basket({ parent: S, position: [-3.65, 0.12, 2.2], radius: 0.13, height: 0.12, oval: 0.8, contents: 'none' });
      U.box(S, 0.42, 0.018, 0.3, M.dark, -3.64, 0.449, 2.22, { round: 0.006, ry: 0.08 });          // tea tray
      PR.teapot({ parent: S, position: [-3.66, 0.458, 2.15], color: 0x5f7f8f, rotationY: 0.4 });
      PR.mug({ parent: S, position: [-3.52, 0.458, 2.33], color: 0xefe6d4, fill: 'tea', rotationY: 1.2 });
      PR.mug({ parent: S, position: [-3.76, 0.458, 2.34], color: 0xa4492f, fill: 'tea', rotationY: -0.6 });
      U.cyl(S, 0.09, 0.1, 0.015, M.brass, -3.66, 0.4475, 2.78, { radial: 20 });
      PR.candle({ parent: S, position: [-3.7, 0.455, 2.74], height: 0.12, radius: 0.028 });
      PR.candle({ parent: S, position: [-3.62, 0.455, 2.8], height: 0.08, radius: 0.026 });
      PR.candle({ parent: S, position: [-3.7, 0.455, 2.83], height: 0.06, radius: 0.024 });
      PR.bookStack({ parent: S, count: 2, position: [-3.6, 0.44, 2.52], rotationY: -0.35, seed: 32 });
      addBox(x0, 0, z0, x1, 0.46, z1, 'coffeeTable');

      // side table by the sofa + table lamp
      const sx = -2.12, sz = 1.05;
      U.cyl(S, 0.25, 0.25, 0.03, M.oak, sx, 0.535, sz, { radial: 28 });
      U.cyl(S, 0.035, 0.045, 0.5, M.oak, sx, 0.27, sz, { radial: 12 });
      U.cyl(S, 0.16, 0.18, 0.03, M.oak, sx, 0.015, sz, { radial: 24 });
      U.blobShadow(S, sx, 0.004, sz, 0.55, 0.55, 0.38);
      PR.lamp({ id: 'lamp_living_table', type: 'table', position: [sx + 0.04, 0.55, sz - 0.05], intensity: 2.4, room: 'living', parent: D });
      PR.bookStack({ parent: S, count: 2, position: [sx - 0.1, 0.55, sz + 0.12], rotationY: 0.5, seed: 33 });
      P.addCylinder(sx, sz, 0.26, 0, 0.6, { tag: 'furniture', name: 'living.sideTable' });

      // just past the sofa arm, kept ~0.8 m from the curtain so its light does not scorch it
      PR.lamp({ id: 'lamp_living_floor', type: 'floor', position: [-2.05, 0, 3.8], intensity: 3.6, room: 'living', parent: D });
      U.blobShadow(S, -2.05, 0.004, 3.8, 0.42, 0.42, 0.4);
      P.addCylinder(-2.05, 3.8, 0.19, 0, 1.6, { tag: 'furniture', name: 'living.floorLamp' });
    });

    // ---------------------------------------------------------------------------------------------------------------
    // Window seat under w_living_s (x −5.2→−2.6), cushions, curtains; roman blinds on the west windows
    // ---------------------------------------------------------------------------------------------------------------
    section('windowSeat', () => {
      const X0 = -5.45, X1 = -2.35, Z0 = 4.12;
      U.boxAt(S, X0, 0, Z0, X1, 0.4, 4.75, M.painted);
      for (let i = 0; i < 3; i++) {
        const w = (X1 - X0 - 0.2) / 3, a = X0 + 0.1 + i * w;
        U.boxAt(S, a + 0.04, 0.08, Z0 - 0.014, a + w - 0.04, 0.32, Z0, M.painted, { round: 0.004 });
      }
      U.boxAt(S, X0 - 0.02, 0.4, Z0 - 0.03, X1 + 0.02, 0.425, 4.75, M.oak, { round: 0.005 });
      for (const [a, b] of [[X0 - 0.06, X0], [X1, X1 + 0.06]]) U.boxAt(S, a, 0, Z0 - 0.02, b, 0.8, 4.75, M.painted, { round: 0.012 });
      U.box(S, X1 - X0 - 0.04, 0.07, 0.58, M.green, (X0 + X1) / 2, 0.46, 4.435, { round: 0.03, segments: 3 });
      U.blobShadow(S, (X0 + X1) / 2, 0.004, 4.4, X1 - X0 + 0.3, 0.9, 0.35);
      pillowAt(S, -5.3, 0.68, 4.42, PI / 2, -0.2, { w: 0.42, h: 0.42, t: 0.14, color: 0xc98f8a });
      pillowAt(S, -5.1, 0.62, 4.28, PI / 2 + 0.5, -0.3, { w: 0.34, h: 0.34, t: 0.12, color: 0x2f3d5a, shape: 'round' });
      pillowAt(S, -4.5, 0.69, 4.6, PI, -0.25, { w: 0.42, h: 0.4, t: 0.14, color: 0xd09a3a });
      pillowAt(S, -2.47, 0.68, 4.45, -PI / 2, -0.2, { w: 0.4, h: 0.4, t: 0.14, color: 0xefe6d4 });
      PR.blanket({ parent: S, w: 0.46, d: 0.34, material: 'knit', position: [-3.62, 0.495, 4.33], rotationY: 0.12, folds: 3 });
      PR.bookStack({ parent: S, count: 3, position: [-4.12, 0.495, 4.56], rotationY: 0.3, seed: 41 });
      PR.mug({ parent: S, position: [-4.35, 0.55, 4.8], color: 0x8fa487, fill: 'tea', rotationY: 2.2 });
      PR.candle({ parent: S, position: [-2.82, 0.55, 4.8], height: 0.07, radius: 0.03, holder: 'saucer' });
      PR.plant({ parent: S, type: 'succulent', position: [-5.0, 0.55, 4.8], seed: 42 });
      PR.plant({ parent: S, type: 'herb', position: [-3.35, 0.55, 4.8], scale: 0.7, seed: 43 });
      addBox(X0 - 0.06, 0, Z0 - 0.03, X1 + 0.06, 0.5, 4.75, 'windowSeat');
      C.interact.add({ id: 'window_seat', object: proxyBox(D, hidden, X0, 0, Z0, X1, 0.5, 4.72, 'living.windowSeat.pick'), label: 'Curl up on the window seat', onUse: () => C.player.sitAt(st.seats.window_seat) });

      // curtains flanking the window seat, brass rod
      const rodY = 2.47, rodZ = 4.64;
      U.cyl(S, 0.013, 0.013, 4.1, M.brass, -3.9, rodY, rodZ, { rz: PI / 2, radial: 12 });
      for (const x of [-5.95, -1.85]) U.sphere(S, 0.03, M.brass, x, rodY, rodZ, { w: 12, h: 8 });
      for (const x of [-5.75, -2.05]) U.boxAt(S, x - 0.012, rodY - 0.012, rodZ, x + 0.012, rodY + 0.012, 4.75, M.brass);
      for (const [cx, seed] of [[-5.7, 0.4], [-2.1, 1.9]]) {
        const h = rodY - 0.05;
        const cm = new THREE.Mesh(curtainGeo(0.42, h, 4, 0.03, seed), curtainMat);
        cm.position.set(cx, h / 2 + 0.03, rodZ - 0.01);
        cm.name = 'living.curtain'; cm.receiveShadow = true;
        S.add(cm);
        for (let k = 0; k < 7; k++) U.cyl(S, 0.018, 0.018, 0.008, M.brass, cx - 0.18 + k * 0.06, rodY - 0.005, rodZ, { rx: PI / 2, radial: 10 });
      }
      // roman blinds tucked into the west window recesses
      for (const [a0, a1] of [[0.75, 1.35], [3.65, 4.25]]) {
        for (let k = 0; k < 3; k++) U.box(S, 0.1, 0.055, a1 - a0 - 0.14, blindMat, -6.83, 2.1 - k * 0.05, (a0 + a1) / 2, { round: 0.02, segments: 2 });
      }
    });

    // ---------------------------------------------------------------------------------------------------------------
    // South wall east of the window: bookcase, record player cabinet + vinyl crate; plants
    // ---------------------------------------------------------------------------------------------------------------
    section('bookcase', () => {
      buildBookcase(S, M, -0.85, 4.75, PI, 1.8, 0.34, 2.1, 5);
      addBox(-1.77, 0, 4.39, 0.07, 2.15, 4.75, 'bookcase');
    });

    section('recordPlayer', () => {
      const X0 = 0.35, X1 = 1.55, Zf = 4.33, Zb = 4.75, Hc = 0.62, Lg = 0.16;
      U.boxAt(S, X0, Lg, Zf, X1, Hc - 0.025, Zb, M.oak);
      U.boxAt(S, X0 - 0.012, Hc - 0.025, Zf - 0.015, X1 + 0.012, Hc, Zb, M.oak, { round: 0.006 });
      const dw = (X1 - X0 - 0.06) / 2;
      for (let i = 0; i < 2; i++) {
        const a = X0 + 0.03 + i * dw;
        U.boxAt(S, a + 0.008, Lg + 0.03, Zf - 0.012, a + dw - 0.008, Hc - 0.055, Zf, M.dark);
        for (let s = 0; s < 9; s++) U.boxAt(S, a + 0.03 + s * (dw - 0.06) / 8 - 0.004, Lg + 0.06, Zf - 0.016, a + 0.03 + s * (dw - 0.06) / 8 + 0.004, Hc - 0.085, Zf - 0.012, M.oak);
        U.sphere(S, 0.014, M.brass, i === 0 ? a + dw - 0.04 : a + 0.04, (Lg + Hc) / 2, Zf - 0.02, { w: 10, h: 8 });
      }
      for (const x of [X0 + 0.06, X1 - 0.06]) for (const z of [Zf + 0.06, Zb - 0.06]) U.cyl(S, 0.02, 0.012, Lg, M.dark, x, Lg / 2, z, { radial: 10 });
      U.blobShadow(S, (X0 + X1) / 2, 0.004, (Zf + Zb) / 2, X1 - X0 + 0.2, 0.6, 0.35);
      // turntable
      const tcx = 0.72, tcz = 4.54;
      U.box(S, 0.46, 0.08, 0.35, M.dark, tcx, Hc + 0.04, tcz, { round: 0.012 });
      U.cyl(S, 0.15, 0.15, 0.018, M.chrome, tcx - 0.05, Hc + 0.089, tcz, { radial: 36 });
      for (const [dx, dz] of [[0.19, -0.14], [0.19, 0.12]]) U.cyl(S, 0.012, 0.012, 0.012, M.chrome, tcx + dx, Hc + 0.086, tcz + dz, { radial: 12 });
      const rec = new THREE.Group(); rec.name = 'living.record'; rec.userData.dynamic = true;
      rec.position.set(tcx - 0.05, Hc + 0.099, tcz);
      D.add(rec);
      const grooves = U.canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, w, h);
        for (let r = 30; r < 127; r += 1.5) { ctx.strokeStyle = r % 9 < 1.5 ? 'rgba(80,80,80,0.5)' : 'rgba(40,40,40,0.55)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, PI * 2); ctx.stroke(); }
        ctx.fillStyle = '#b8452f'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 40, 0, PI * 2); ctx.fill();
        ctx.fillStyle = '#f0dcae'; ctx.font = 'bold 13px Georgia'; ctx.textAlign = 'center'; ctx.fillText('RAINY DAY', w / 2, h / 2 - 12); ctx.font = '10px Georgia'; ctx.fillText('lo-fi · side A', w / 2, h / 2 + 20);
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, PI * 2); ctx.fill();
      }, { wrap: false });
      const recMat = new THREE.MeshStandardMaterial({ map: grooves, roughness: 0.28, metalness: 0.1 });
      recMat.name = 'living.vinyl';
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.148, 48), recMat);
      disc.rotation.x = -PI / 2; disc.name = 'living.vinyl';
      rec.add(disc);
      U.cyl(rec, 0.004, 0.004, 0.02, M.chrome, 0, 0.008, 0, { radial: 8 });
      st.record = rec;
      // tonearm (pivot back right); rest angle 0 points toward the front (−Z), play angle swings over the record
      const arm = new THREE.Group(); arm.name = 'living.tonearm'; arm.userData.dynamic = true;
      arm.position.set(tcx + 0.17, Hc + 0.08, tcz + 0.11);
      D.add(arm);
      U.cyl(arm, 0.018, 0.02, 0.03, M.chrome, 0, 0.015, 0, { radial: 14 });
      U.cyl(arm, 0.004, 0.004, 0.23, M.chrome, 0, 0.038, -0.115, { rx: PI / 2, radial: 8 });
      U.box(arm, 0.018, 0.01, 0.035, M.dark, 0, 0.034, -0.235);
      U.cyl(arm, 0.014, 0.014, 0.03, M.iron, 0, 0.038, 0.04, { rx: PI / 2, radial: 12 });
      st.arm = arm; st.armAngle = 0;
      U.boxAt(S, tcx + 0.12, Hc + 0.08, tcz - 0.02, tcx + 0.15, Hc + 0.1, tcz + 0.0, M.chrome);        // arm rest
      PR.vase({ parent: S, position: [1.38, Hc, 4.6], flowers: 'daisy', height: 0.2, color: 0xb86b45, shape: 'jug', seed: 51 });
      st.playing = false;
      const musicPos = [tcx, Hc + 0.2, tcz];
      try { C.audio.music.setPosition(musicPos[0], musicPos[1], musicPos[2]); } catch (e) { /* stub */ }
      C.on('music', p => { if (p && typeof p.playing === 'boolean') st.playing = p.playing; });
      C.on('start', () => { try { C.audio.music.setPosition(musicPos[0], musicPos[1], musicPos[2]); } catch (e) { /* stub */ } });
      C.interact.add({
        id: 'record_player', object: proxyBox(D, hidden, tcx - 0.25, Hc, tcz - 0.19, tcx + 0.25, Hc + 0.16, tcz + 0.19, 'living.recordPlayer.pick'),
        label: () => st.playing ? 'Lift the needle' : 'Play a record',
        onUse: () => {
          const before = st.playing;
          try { C.audio.music.setPosition(musicPos[0], musicPos[1], musicPos[2]); C.audio.music.toggle(); } catch (e) { /* stub */ }
          if (st.playing === before) {            // audio module absent → keep the visuals + event in sync ourselves
            st.playing = !before; C.env.musicPlaying = st.playing; C.emit('music', { playing: st.playing });
          }
          C.audio.play('click', { x: tcx, y: Hc + 0.1, z: tcz, volume: 0.5 });
        },
      });
      addBox(X0 - 0.02, 0, Zf - 0.03, X1 + 0.02, 0.85, Zb, 'recordCabinet');
      // vinyl crate with sleeves (vertex-coloured → one draw call)
      const cx0 = 1.575, cx1 = 1.915, cz0 = 4.3, cz1 = 4.74, ch = 0.26;
      U.boxAt(S, cx0, 0, cz0, cx1, 0.02, cz1, M.light);
      for (const [a, b] of [[cx0, cx0 + 0.018], [cx1 - 0.018, cx1]]) U.boxAt(S, a, 0, cz0, b, ch, cz1, M.light);
      for (const [a, b] of [[cz0, cz0 + 0.018], [cz1 - 0.018, cz1]]) U.boxAt(S, cx0, 0, a, cx1, ch, b, M.light);
      const sleeveMat = U.stdMat(0xffffff, 0.75, 0, { vertexColors: true });
      const pal = [0xc0392b, 0x2c3e50, 0xe0b04a, 0x16a085, 0x8e44ad, 0xd35400, 0xf1ede4, 0x1a1a1a, 0x7f8c8d, 0xb0413e, 0x3d6b8c, 0xe7c9a0];
      const sr = U.rng(61), col = new THREE.Color();
      for (let i = 0; i < 17; i++) {
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.005);
        col.setHex(pal[Math.floor(sr() * pal.length)]);
        const n = geo.attributes.position.count, c = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) { c[j * 3] = col.r; c[j * 3 + 1] = col.g; c[j * 3 + 2] = col.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
        const m = new THREE.Mesh(geo, sleeveMat);
        m.position.set((cx0 + cx1) / 2, 0.17, cz0 + 0.035 + i * 0.021);
        m.rotation.x = -0.18 + sr() * 0.08;
        S.add(m);
      }
      addBox(cx0, 0, cz0, cx1, 0.4, cz1, 'vinylCrate');
    });

    section('decor', () => {
      PR.plant({ parent: S, type: 'fiddle', position: [-6.22, 0, 4.4], seed: 71 });
      P.addCylinder(-6.22, 4.4, 0.24, 0, 1.4, { tag: 'furniture', name: 'living.fiddle' });
      PR.plant({ parent: S, type: 'monstera', position: [1.5, 0, 3.8], seed: 72 });
      P.addCylinder(1.5, 3.8, 0.22, 0, 1.0, { tag: 'furniture', name: 'living.monstera' });
      PR.plant({ parent: S, type: 'fern', position: [-6.38, 0, 0.62], seed: 73 });
      P.addCylinder(-6.38, 0.62, 0.2, 0, 0.6, { tag: 'furniture', name: 'living.fern' });
      PR.plant({ parent: S, type: 'snake', position: [0.21, 0, 4.55], scale: 0.9, seed: 74 });
      P.addCylinder(0.21, 4.55, 0.13, 0, 0.7, { tag: 'furniture', name: 'living.snake' });
      PR.painting({ parent: S, width: 0.75, height: 0.55, style: 'seascape', frame: 'wood', position: [0.95, 1.5, 4.75], rotationY: PI, seed: 12 });
      PR.painting({ parent: S, width: 0.34, height: 0.44, style: 'botanical', frame: 'white', position: [1.925, 1.55, 3.3], rotationY: -PI / 2, seed: 13 });
      PR.painting({ parent: S, width: 0.34, height: 0.44, style: 'botanical', frame: 'white', position: [1.925, 1.55, 3.85], rotationY: -PI / 2, seed: 14 });
      PR.painting({ parent: S, width: 0.62, height: 0.46, style: 'map', frame: 'black', position: [1.925, 1.55, 0.85], rotationY: -PI / 2, seed: 15 });
      PR.painting({ parent: S, width: 0.42, height: 0.52, style: 'portrait', frame: 'gold', position: [-5.9, 1.62, 4.75], rotationY: PI, seed: 16 });
    });

    C.living = {
      catSpots: [
        { name: 'window_seat', position: [-3.0, 0.495, 4.45], rotationY: PI },
        { name: 'fire_rug', position: [-5.02, 0.02, 2.5], rotationY: PI / 2 },
        { name: 'sofa', position: [-2.2, 0.45, 3.05], rotationY: -PI / 2 },
      ],
      seats: st.seats,
      fire: st.fireApi,
    };

    U.bakeStatic(S);
    const updatePx = () => { if (st.sparkU) st.sparkU.uPx.value = C.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(C.camera.fov) / 2)); };
    updatePx();
    C.on('resize', updatePx);
    C.on('settings', updatePx);
    st.ready = !!st.fire;
    if (errs.length) C.log('living', 'sections failed: ' + errs.join(', '));
  },

  update(dt, t, C) {
    if (!st.ready) return;
    // skip the baked meshes where the room cannot be seen (lights stay → no recompiles): from the loft, and from the
    // study while both study doors are shut (through D3 + the D1 archway a sliver of the living room shows)
    const cp = C.camera.position;
    const hd = C.house && C.house.doors;
    const inStudy = cp.x > 2.0 && cp.z < -0.7 && hd && doorShut(hd.kitchenStudy) && doorShut(hd.hallStudy);
    st.S.visible = !(cp.x > -7 && cp.x < 7 && cp.z > -5 && cp.z < 5) || (cp.y < 3.8 && !inStudy);
    const U = C.util, f = st.fire;
    if (f.roar > 0) { f.roar -= dt; if (f.roar <= 0 && f.target > 1.2) { f.target = 1; C.emit('fire', { level: 1 }); } }
    const rate = f.target > f.level ? 0.9 : 0.22;
    f.level = U.damp(f.level, f.target, rate, dt);
    if (Math.abs(f.level - f.target) < 0.003) f.level = f.target;
    if (f.target <= 0) f.out += dt; else f.out = 0;
    C.env.fireLevel = f.level;
    const lv = Math.min(f.level, 1.6);
    const n = U.noise2D(t * 5.3, 0.7) * 0.6 + U.noise2D(t * 13.1, 3.1) * 0.4;
    st.fireLight.intensity = FIRE_CD * lv * (1 + 0.22 * n);
    st.fireLight.position.y = 0.6 + 0.035 * n;
    st.flameU.uTime.value = t;
    st.flameU.uLevel.value = lv;
    const after = f.target <= 0 ? 0.35 * Math.exp(-f.out / 45) : 0;
    st.emberMat.emissiveIntensity = 0.1 + after + 0.85 * Math.min(lv, 1.2) * (0.9 + 0.12 * n);
    st.fireGlow.material.opacity = 0.24 * Math.min(1, lv) * (0.9 + 0.15 * n);
    st.fireGlow.visible = lv > 0.02;
    C.camera.getWorldPosition(_cam);
    for (let i = 0; i < st.flames.length; i++) {
      const m = st.flames[i];
      m.rotation.y = Math.atan2(_cam.x - m.position.x, _cam.z - m.position.z);
      m.visible = lv > 0.02;
    }
    if (st.playing) st.record.rotation.y -= dt * 3.49;
    const want = st.playing ? 0.45 : 0;
    if (st.armAngle !== want) {
      st.armAngle = U.damp(st.armAngle, want, 4, dt);
      if (Math.abs(st.armAngle - want) < 0.002) st.armAngle = want;
      st.arm.rotation.y = st.armAngle;
    }
  },
});

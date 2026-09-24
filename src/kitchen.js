// =====================================================================================================================
//  KITCHEN + DINING — module "kitchen", order 60.  (SPEC §4.3, §8, §9 kitchen)
//  L-shaped sage cabinets with butcher-block tops, subway-tile backsplash, farmhouse sink + bridge faucet under
//  w_kitchen_n, vintage cream range with the kettle, retro fridge, hutch with plates and cups, open shelves with jars,
//  hanging copper pans, herbs on the sill, bread and fruit; dining table + 4 chairs, runner, candles, pendant, rug.
//  Tea ritual: "Put the kettle on" → boil → whistle → "Make a cup of tea" → steaming mug in hand;
//  Q / left click sips, E (nothing focused) sets it down on the surface under the crosshair.
//  Interactables: kettle, lamp_dining_pendant, lamp_kitchen, dining_chair.
//  Lights: lamp_dining_pendant (Point #ffc27a 6.5 cd), lamp_kitchen (Point #ffd29a 4 cd).
// =====================================================================================================================
import * as THREE from 'three';

const C = window.COZY;
const PI = Math.PI;
const KETTLE_POS = [-2.36, 0.925, -4.3];
const HELD_REST = new THREE.Vector3(0.24, -0.25, -0.58);
const HELD_SIP = new THREE.Vector3(0.05, -0.12, -0.3);

const st = { ready: false };
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const doorShut = d => !!d && !d.isOpen && Math.abs(d.angle || 0) < 0.03;

function proxyBox(parent, mat, x0, y0, z0, x1, y1, z1, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.name = name;
  m.userData.dynamic = true;
  parent.add(m);
  return m;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// Windsor-style chair in local space (sitter faces +Z)
function buildChair(parent, M, x, z, ry) {
  const U = C.util;
  const g = new THREE.Group();
  g.name = 'kitchen.chair';
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  parent.add(g);
  const w = M.dark;
  U.box(g, 0.44, 0.04, 0.42, w, 0, 0.45, 0, { round: 0.015 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.cyl(g, 0.015, 0.02, 0.45, w, sx * 0.17, 0.225, sz * 0.15, { rx: -sz * 0.06, rz: sx * 0.06, radial: 8 });
  U.cyl(g, 0.008, 0.008, 0.36, w, 0, 0.17, 0.15, { rz: PI / 2, radial: 6 });
  U.cyl(g, 0.008, 0.008, 0.36, w, 0, 0.17, -0.15, { rz: PI / 2, radial: 6 });
  for (const sx of [-1, 1]) U.cyl(g, 0.008, 0.008, 0.3, w, sx * 0.175, 0.2, 0, { rx: PI / 2, radial: 6 });
  for (let i = 0; i < 5; i++) U.cyl(g, 0.008, 0.009, 0.42, w, -0.13 + i * 0.065, 0.68, -0.18, { rx: -0.08, radial: 6 });
  for (const sx of [-1, 1]) U.cyl(g, 0.015, 0.015, 0.46, w, sx * 0.19, 0.68, -0.18, { rx: -0.08, radial: 8 });
  U.box(g, 0.46, 0.055, 0.04, w, 0, 0.9, -0.2, { round: 0.015, rx: -0.08 });
  U.box(g, 0.38, 0.035, 0.36, M.cushion, 0, 0.487, 0.015, { round: 0.015, segments: 2 });
  U.blobShadow(g, 0, 0, 0, 0.62, 0.6, 0.3);
  return g;
}

function buildKettle(parent, M, color) {
  const U = C.util;
  const g = new THREE.Group();
  g.name = 'kitchen.kettle';
  const enamel = U.stdMat(color, 0.22, 0.05);
  U.lathe(g, [[0, 0], [0.085, 0], [0.095, 0.012], [0.098, 0.06], [0.09, 0.11], [0.068, 0.15], [0.04, 0.168], [0.032, 0.172], [0.032, 0.18], [0, 0.182]], enamel, 0, 0, 0, { segments: 28 });
  U.cyl(g, 0.088, 0.088, 0.006, M.chrome, 0, 0.003, 0, { radial: 28 });
  U.sphere(g, 0.015, M.dark, 0, 0.192, 0, { w: 10, h: 8 });
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.009, 6, 18, PI), M.dark);
  handle.position.set(0, 0.168, 0);
  g.add(handle);
  for (const s of [-1, 1]) U.cyl(g, 0.007, 0.007, 0.03, M.chrome, s * 0.066, 0.158, 0, { radial: 6 });
  U.cyl(g, 0.012, 0.021, 0.1, enamel, 0, 0.1, 0.1, { rx: 0.9, radial: 12 });
  U.cyl(g, 0.014, 0.014, 0.022, M.chrome, 0, 0.138, 0.142, { rx: 0.9, radial: 10 });
  parent.add(g);
  return g;
}

C.register({
  name: 'kitchen',
  order: 60,
  init(C) {
    const U = C.util, P = C.physics, PR = C.props;
    const root = new THREE.Group(); root.name = 'kitchen';
    C.scene.add(root);
    const S = new THREE.Group(); S.name = 'kitchen.static'; root.add(S);
    st.S = S;
    const D = new THREE.Group(); D.name = 'kitchen.dynamic'; D.userData.dynamic = true; root.add(D);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const section = (name, fn) => {
      try { fn(); } catch (e) {
        C.debug.errors.push({ module: 'kitchen', phase: 'init:' + name, message: e.message, stack: String(e.stack || '').slice(0, 1500) });
        console.error(`[kitchen] ${name} failed: ${e.message}`);
      }
    };
    const M = {
      sage: C.mat('woodPaintedSage'), block: C.mat('woodLight'), oak: C.mat('woodMedium'), dark: C.mat('woodDark'), cream: C.mat('woodPainted'),
      tile: C.mat('tileKitchen'), ceramic: C.mat('ceramic'), blue: C.mat('ceramicBlue'), brass: C.mat('brass'), copper: C.mat('copper'),
      chrome: C.mat('chrome'), iron: C.mat('ironBlack'), linen: C.mat('fabricCream'), cushion: C.mat('fabricGreen'),
      enamel: U.stdMat(0xede3cc, 0.28, 0.02), enamelDark: U.stdMat(0x1c1a18, 0.35, 0.3), glassDark: U.stdMat(0x1a1612, 0.08, 0.2),
      fridge: U.stdMat(0xe3e9dc, 0.26, 0.02), crust: U.stdMat(0xb27434, 0.75), crumb: U.stdMat(0xe8d2a6, 0.9),
    };
    const addBox = (x0, y0, z0, x1, y1, z1, name) => P.addBox([x0, y0, z0], [x1, y1, z1], { tag: 'furniture', name: 'kitchen.' + name });
    st.seat = { id: 'dining_chair', position: [-3.0, 1.13, -0.74], yaw: 0, pitch: -0.12, yawRange: 1.4, exit: [-3.0, 0, -0.05], label: 'Stand up' };

    // north-wall base cabinet section: front face z = −4.13, doors + drawers with brass knobs
    const baseRun = (x0, x1, doors = true) => {
      U.boxAt(S, x0, 0.1, -4.73, x1, 0.86, -4.15, M.sage);
      U.boxAt(S, x0 + 0.02, 0, -4.7, x1 - 0.02, 0.1, -4.2, M.dark);
      const n = Math.max(1, Math.round((x1 - x0) / 0.5)), w = (x1 - x0) / n;
      for (let i = 0; i < n; i++) {
        const a = x0 + i * w;
        U.boxAt(S, a + 0.012, 0.7, -4.15, a + w - 0.012, 0.84, -4.132, M.sage, { round: 0.004 });
        U.sphere(S, 0.012, M.brass, a + w / 2, 0.77, -4.125, { w: 8, h: 6 });
        if (!doors) continue;
        U.boxAt(S, a + 0.012, 0.13, -4.15, a + w - 0.012, 0.68, -4.132, M.sage, { round: 0.004 });
        U.boxAt(S, a + 0.06, 0.19, -4.132, a + w - 0.06, 0.62, -4.126, M.sage, { round: 0.003 });
        U.sphere(S, 0.012, M.brass, i % 2 ? a + 0.05 : a + w - 0.05, 0.6, -4.12, { w: 8, h: 6 });
      }
    };
    const top = (x0, z0, x1, z1) => U.boxAt(S, x0, 0.86, z0, x1, 0.9, z1, M.block, { round: 0.004 });

    // -------------------------------------------------------------------------------------------------------------
    // North counter run: counter A (x −6.75→−4.6), sink (−4.6→−2.6), range (−2.55→−1.75), counter B (−1.7→−0.9)
    // -------------------------------------------------------------------------------------------------------------
    section('counters', () => {
      baseRun(-6.75, -4.6);
      top(-6.75, -4.75, -4.6, -4.1);
      // sink cabinet (gingham skirt under the apron sink)
      U.boxAt(S, -4.6, 0.1, -4.73, -4.0, 0.86, -4.15, M.sage);
      U.boxAt(S, -3.2, 0.1, -4.73, -2.6, 0.86, -4.15, M.sage);
      U.boxAt(S, -4.0, 0.1, -4.73, -3.2, 0.64, -4.2, M.sage);
      U.boxAt(S, -4.58, 0, -4.7, -2.62, 0.1, -4.2, M.dark);
      for (const [a, b] of [[-4.6, -4.0], [-3.2, -2.6]]) {
        U.boxAt(S, a + 0.012, 0.13, -4.15, b - 0.012, 0.84, -4.132, M.sage, { round: 0.004 });
        U.boxAt(S, a + 0.07, 0.2, -4.132, b - 0.07, 0.77, -4.126, M.sage, { round: 0.003 });
        U.sphere(S, 0.012, M.brass, a < -4 ? b - 0.06 : a + 0.06, 0.62, -4.12, { w: 8, h: 6 });
      }
      const skirt = C.mat('fabricRose').clone(); skirt.side = THREE.DoubleSide; skirt.name = 'kitchen.skirt';
      const sg = new THREE.PlaneGeometry(0.8, 0.5, 40, 4), sp = sg.attributes.position;
      for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin((sp.getX(i) + 0.4) * 50) * 0.012);
      sg.computeVertexNormals();
      const sk = new THREE.Mesh(sg, skirt); sk.position.set(-3.6, 0.37, -4.13); sk.name = 'kitchen.sinkSkirt'; S.add(sk);
      top(-4.6, -4.75, -4.0, -4.1); top(-3.2, -4.75, -2.6, -4.1); top(-4.0, -4.75, -3.2, -4.63);
      // farmhouse sink
      const sx0 = -4.0, sx1 = -3.2, sz0 = -4.63, sz1 = -4.1, sy0 = 0.64, sy1 = 0.915;
      U.boxAt(S, sx0, sy0, sz1 - 0.035, sx1, sy1, sz1 + 0.012, M.ceramic, { round: 0.008 });
      U.boxAt(S, sx0, sy0, sz0, sx1, sy1, sz0 + 0.03, M.ceramic);
      U.boxAt(S, sx0, sy0, sz0, sx0 + 0.035, sy1, sz1, M.ceramic, { round: 0.006 });
      U.boxAt(S, sx1 - 0.035, sy0, sz0, sx1, sy1, sz1, M.ceramic, { round: 0.006 });
      U.boxAt(S, sx0, sy0, sz0, sx1, sy0 + 0.035, sz1, M.ceramic);
      U.cyl(S, 0.03, 0.03, 0.004, M.chrome, -3.6, sy0 + 0.037, (sz0 + sz1) / 2, { radial: 16 });
      // brass bridge faucet
      for (const x of [-3.74, -3.46]) {
        U.cyl(S, 0.013, 0.015, 0.1, M.brass, x, 0.95, -4.69, { radial: 10 });
        U.boxAt(S, x - 0.035, 1.0, -4.695, x + 0.035, 1.012, -4.685, M.brass);
        U.boxAt(S, x - 0.005, 1.0, -4.725, x + 0.005, 1.012, -4.655, M.brass);
      }
      U.cyl(S, 0.011, 0.011, 0.28, M.brass, -3.6, 0.99, -4.69, { rz: PI / 2, radial: 8 });
      U.cyl(S, 0.012, 0.012, 0.2, M.brass, -3.6, 1.09, -4.69, { radial: 8 });
      U.cyl(S, 0.011, 0.011, 0.22, M.brass, -3.6, 1.19, -4.58, { rx: PI / 2, radial: 8 });
      U.cyl(S, 0.012, 0.009, 0.06, M.brass, -3.6, 1.16, -4.47, { radial: 8 });
      // subway tile backsplash
      U.boxAt(S, -6.75, 0.9, -4.75, -4.39, 1.45, -4.735, M.tile);
      U.boxAt(S, -4.39, 0.9, -4.75, -2.81, 0.955, -4.735, M.tile);
      U.boxAt(S, -2.81, 0.9, -4.75, -0.9, 1.78, -4.735, M.tile);
      U.boxAt(S, -6.75, 0.9, -4.73, -6.735, 1.45, -2.85, M.tile);
      // counter B (right of the range) with open shelves
      baseRun(-1.7, -0.9);
      top(-1.7, -4.75, -0.9, -4.1);
      for (const y of [1.52, 1.88]) {
        U.boxAt(S, -1.72, y, -4.75, -0.88, y + 0.03, -4.5, M.block, { round: 0.004 });
        for (const x of [-1.6, -1.0]) U.boxAt(S, x - 0.012, y - 0.12, -4.735, x + 0.012, y, -4.56, M.iron);
      }
      PR.jar({ parent: S, position: [-1.58, 1.55, -4.62], contents: 'flour', radius: 0.055, height: 0.18 });
      PR.jar({ parent: S, position: [-1.44, 1.55, -4.62], contents: 'sugar', radius: 0.05, height: 0.15 });
      PR.jar({ parent: S, position: [-1.3, 1.55, -4.62], contents: 'tea', radius: 0.045, height: 0.13, lid: 'wood' });
      PR.jar({ parent: S, position: [-1.15, 1.55, -4.62], contents: 'cookies', radius: 0.06, height: 0.16 });
      PR.jar({ parent: S, position: [-1.0, 1.55, -4.62], contents: 'pasta', radius: 0.045, height: 0.2 });
      for (let i = 0; i < 5; i++) U.cyl(S, 0.11, 0.1, 0.012, i % 2 ? M.blue : M.ceramic, -1.52, 1.917 + i * 0.013, -4.62, { radial: 24 });
      for (let i = 0; i < 3; i++) PR.mug({ parent: S, position: [-1.26 + i * 0.12, 1.91, -4.62], color: [0xefe6d4, 0x8fa487, 0xc98f8a][i], fill: 'none', rotationY: 0.4 + i });
      PR.plant({ parent: S, type: 'pothos', position: [-0.98, 1.91, -4.62], scale: 0.7, seed: 81 });
      // bread on a board, utensil crock
      U.box(S, 0.42, 0.022, 0.26, M.block, -1.34, 0.911, -4.38, { round: 0.006, ry: 0.12 });
      U.sphere(S, 0.1, M.crust, -1.36, 0.965, -4.38, { w: 18, h: 10, sx: 1.55, sy: 0.62, sz: 0.85 });
      U.sphere(S, 0.05, M.crumb, -1.2, 0.935, -4.36, { w: 12, h: 8, sx: 0.4, sy: 0.9, sz: 0.85 });
      U.cyl(S, 0.055, 0.05, 0.14, M.ceramic, -0.99, 0.97, -4.6, { radial: 16 });
      for (let i = 0; i < 4; i++) {
        const a = i * 1.6;
        U.cyl(S, 0.005, 0.005, 0.3, M.oak, -0.99 + Math.cos(a) * 0.02, 1.1, -4.6 + Math.sin(a) * 0.02, { rx: Math.sin(a) * 0.15, rz: -Math.cos(a) * 0.15, radial: 5 });
        U.sphere(S, 0.022, M.oak, -0.99 + Math.cos(a) * 0.04, 1.26, -4.6 + Math.sin(a) * 0.04, { w: 8, h: 6, sy: 0.4 });
      }
      // counter A decor: dish rack side, teapot, jars, bottles, cookbook
      PR.teapot({ parent: S, position: [-5.2, 0.9, -4.45], color: 0xefe6d4, rotationY: 0.5 });
      PR.jar({ parent: S, position: [-5.9, 0.9, -4.6], contents: 'beans', radius: 0.055, height: 0.2 });
      PR.jar({ parent: S, position: [-5.75, 0.9, -4.62], contents: 'rice', radius: 0.05, height: 0.17 });
      PR.bottle({ parent: S, position: [-6.45, 0.9, -4.55], kind: 'oil' });
      PR.bottle({ parent: S, position: [-6.35, 0.9, -4.62], kind: 'wine' });
      PR.books({ parent: S, length: 0.3, depth: 0.2, position: [-4.95, 0.9, -4.62], seed: 83, lean: true });
      // dish rack with plates (right of the sink)
      for (const x of [-3.1, -2.72]) U.boxAt(S, x - 0.005, 0.9, -4.55, x + 0.005, 0.96, -4.25, M.chrome);
      for (const z of [-4.52, -4.28]) U.boxAt(S, -3.1, 0.9, z - 0.005, -2.72, 0.905, z + 0.005, M.chrome);
      for (let i = 0; i < 4; i++) U.cyl(S, 0.105, 0.105, 0.012, i % 2 ? M.blue : M.ceramic, -3.02 + i * 0.07, 1.0, -4.4, { rz: PI / 2 - 0.12, radial: 24 });
      // herbs on the kitchen window sill (sill top y 1.1, z −4.70→−4.885)
      for (const [x, s] of [[-4.05, 0.8], [-3.6, 0.9], [-3.15, 0.75]]) PR.plant({ parent: S, type: 'herb', position: [x, 1.1, -4.79], scale: s, seed: 90 + x });
      addBox(-6.75, 0, -4.75, -0.9, 0.95, -4.08, 'northCounter');
    });

    // upper cabinets over counter A + west run with open shelves
    section('uppers', () => {
      U.boxAt(S, -6.75, 1.45, -4.75, -4.6, 2.25, -4.42, M.sage);
      U.boxAt(S, -6.77, 2.25, -4.75, -4.58, 2.3, -4.39, M.cream, { round: 0.006 });
      const n = 4, w = 2.15 / n;
      for (let i = 0; i < n; i++) {
        const a = -6.75 + i * w;
        U.boxAt(S, a + 0.012, 1.47, -4.42, a + w - 0.012, 2.23, -4.402, M.sage, { round: 0.004 });
        U.boxAt(S, a + 0.06, 1.53, -4.402, a + w - 0.06, 2.17, -4.396, M.sage, { round: 0.003 });
        U.sphere(S, 0.012, M.brass, i % 2 ? a + 0.05 : a + w - 0.05, 1.55, -4.39, { w: 8, h: 6 });
      }
      // west base run (front face x = −6.13)
      U.boxAt(S, -6.73, 0.1, -4.13, -6.15, 0.86, -2.87, M.sage);
      U.boxAt(S, -6.7, 0, -4.1, -6.2, 0.1, -2.9, M.dark);
      for (let i = 0; i < 3; i++) {
        const a = -4.13 + i * (1.26 / 3), b = a + 1.26 / 3;
        U.boxAt(S, -6.15, 0.7, a + 0.012, -6.132, 0.84, b - 0.012, M.sage, { round: 0.004 });
        U.boxAt(S, -6.15, 0.13, a + 0.012, -6.132, 0.68, b - 0.012, M.sage, { round: 0.004 });
        U.boxAt(S, -6.132, 0.19, a + 0.06, -6.126, 0.62, b - 0.06, M.sage, { round: 0.003 });
        U.sphere(S, 0.012, M.brass, -6.12, 0.77, (a + b) / 2, { w: 8, h: 6 });
        U.sphere(S, 0.012, M.brass, -6.12, 0.6, i % 2 ? a + 0.05 : b - 0.05, { w: 8, h: 6 });
      }
      U.boxAt(S, -6.75, 0.86, -4.13, -6.1, 0.9, -2.85, M.block, { round: 0.004 });
      for (const y of [1.45, 1.8]) {
        U.boxAt(S, -6.75, y, -4.1, -6.5, y + 0.03, -2.9, M.block, { round: 0.004 });
        for (const z of [-3.95, -3.05]) U.boxAt(S, -6.735, y - 0.12, z - 0.012, -6.56, y, z + 0.012, M.iron);
      }
      PR.books({ parent: S, length: 0.42, depth: 0.2, position: [-6.63, 1.48, -3.8], rotationY: PI / 2, seed: 84 });
      PR.jar({ parent: S, position: [-6.62, 1.48, -3.35], contents: 'honey', radius: 0.05, height: 0.12 });
      PR.jar({ parent: S, position: [-6.62, 1.48, -3.2], contents: 'jam', radius: 0.045, height: 0.1 });
      PR.jar({ parent: S, position: [-6.62, 1.48, -3.05], contents: 'jam', radius: 0.045, height: 0.11, lid: 'metal' });
      for (let i = 0; i < 4; i++) U.cyl(S, 0.1, 0.09, 0.012, M.ceramic, -6.62, 1.837 + i * 0.013, -3.85, { radial: 24 });
      PR.vase({ parent: S, position: [-6.62, 1.83, -3.45], flowers: false, height: 0.22, shape: 'jug', color: 0x4f6d9a, seed: 85 });
      PR.plant({ parent: S, type: 'ivy', position: [-6.62, 1.83, -3.05], scale: 0.7, seed: 86 });
      U.box(S, 0.34, 0.02, 0.24, M.block, -6.42, 0.911, -3.5, { round: 0.005, ry: PI / 2 + 0.1 });
      PR.basket({ parent: S, position: [-6.45, 0.9, -3.05], radius: 0.13, height: 0.1, contents: 'apples' });
      addBox(-6.75, 0, -4.13, -6.1, 0.95, -2.85, 'westCounter');
    });

    // -------------------------------------------------------------------------------------------------------------
    // Vintage range + kettle, copper pans
    // -------------------------------------------------------------------------------------------------------------
    section('range', () => {
      const x0 = -2.55, x1 = -1.75, z0 = -4.72, z1 = -4.1;
      U.boxAt(S, x0, 0.1, z0, x1, 0.88, z1, M.enamel, { round: 0.02 });
      for (const x of [x0 + 0.05, x1 - 0.05]) for (const z of [z0 + 0.05, z1 - 0.05]) U.cyl(S, 0.02, 0.025, 0.1, M.chrome, x, 0.05, z, { radial: 10 });
      U.boxAt(S, x0 + 0.05, 0.16, z1, x1 - 0.05, 0.7, z1 + 0.018, M.enamel, { round: 0.012 });
      U.boxAt(S, x0 + 0.17, 0.36, z1 + 0.018, x1 - 0.17, 0.58, z1 + 0.022, M.glassDark, { round: 0.01 });
      U.cyl(S, 0.01, 0.01, 0.56, M.chrome, (x0 + x1) / 2, 0.66, z1 + 0.05, { rz: PI / 2, radial: 8 });
      for (const x of [x0 + 0.13, x1 - 0.13]) U.boxAt(S, x - 0.01, 0.65, z1 + 0.015, x + 0.01, 0.67, z1 + 0.05, M.chrome);
      U.boxAt(S, x0 + 0.05, 0.74, z1, x1 - 0.05, 0.85, z1 + 0.012, M.chrome, { round: 0.004 });
      for (let i = 0; i < 4; i++) U.cyl(S, 0.02, 0.02, 0.025, M.enamelDark, x0 + 0.16 + i * 0.16, 0.795, z1 + 0.024, { rx: PI / 2, radial: 12 });
      U.boxAt(S, x0, 0.88, z0, x1, 0.915, z1, M.enamelDark, { round: 0.006 });
      for (const [bx, bz] of [[-2.36, -4.3], [-1.94, -4.3], [-2.36, -4.55], [-1.94, -4.55]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 20), M.iron);
        ring.rotation.x = PI / 2; ring.position.set(bx, 0.918, bz); S.add(ring);
        U.boxAt(S, bx - 0.085, 0.915, bz - 0.006, bx + 0.085, 0.925, bz + 0.006, M.iron);
        U.boxAt(S, bx - 0.006, 0.915, bz - 0.085, bx + 0.006, 0.925, bz + 0.085, M.iron);
      }
      U.boxAt(S, x0, 0.915, z0, x1, 1.24, z0 + 0.1, M.enamel, { round: 0.015 });
      U.boxAt(S, x0 + 0.02, 1.2, z0 + 0.02, x1 - 0.02, 1.25, z0 + 0.12, M.chrome, { round: 0.006 });
      U.cyl(S, 0.055, 0.055, 0.01, M.chrome, (x0 + x1) / 2, 1.08, z0 + 0.1, { rx: PI / 2, radial: 24 });
      U.cyl(S, 0.048, 0.048, 0.012, M.ceramic, (x0 + x1) / 2, 1.08, z0 + 0.1, { rx: PI / 2, radial: 24 });
      U.boxAt(S, (x0 + x1) / 2 - 0.003, 1.08, z0 + 0.106, (x0 + x1) / 2 + 0.003, 1.12, z0 + 0.108, M.iron);
      // tea towel over the oven handle
      U.box(S, 0.2, 0.28, 0.012, C.mat('fabricBlue'), -2.25, 0.54, z1 + 0.058, { round: 0.004 });
      U.box(S, 0.2, 0.02, 0.05, C.mat('fabricBlue'), -2.25, 0.675, z1 + 0.05, { round: 0.006 });
      // copper pans on a rail between the window and the range
      U.cyl(S, 0.008, 0.008, 0.78, M.iron, -2.15, 1.66, -4.7, { rz: PI / 2, radial: 8 });
      for (const x of [-2.52, -1.78]) U.boxAt(S, x - 0.01, 1.64, -4.735, x + 0.01, 1.68, -4.69, M.iron);
      for (const [x, r, depth] of [[-2.42, 0.1, 0.07], [-2.16, 0.085, 0.09], [-1.92, 0.07, 0.08]]) {
        const hy = 1.63, cy = hy - 0.19 - r;
        U.boxAt(S, x - 0.008, cy + r - 0.01, -4.706, x + 0.008, hy, -4.696, M.brass);
        U.cyl(S, r, r * 0.95, depth, M.copper, x, cy, -4.735 + depth / 2 + 0.008, { rx: PI / 2, radial: 24 });
        U.cyl(S, r * 0.99, r * 0.99, 0.004, M.copper, x, cy, -4.735 + depth + 0.008, { rx: PI / 2, radial: 24 });
        U.cyl(S, 0.008, 0.008, 0.03, M.iron, x, 1.645, -4.7, { radial: 6 });
      }
      // kettle + steam + tea ritual
      const k = buildKettle(D, M, 0xb8452f);
      k.position.set(KETTLE_POS[0], KETTLE_POS[1], KETTLE_POS[2]);
      k.rotation.y = -0.45;
      k.updateMatrixWorld(true);
      const spout = new THREE.Vector3(0, 0.15, 0.15).applyMatrix4(k.matrixWorld);
      st.steam = PR.steam(D, [spout.x, spout.y, spout.z], { count: 22, height: 0.4, size: 0.07, spread: 0.02, strength: 0, opacity: 0.4 });
      st.tea = { state: 'idle', t: 0, heard: false };
      C.on('kettle', p => {
        if (!p) return;
        if (p.state === 'whistle' && st.tea.state === 'boiling') { st.tea.state = 'ready'; st.tea.heard = true; }
        else if (p.state === 'off' && st.tea.state === 'ready') st.tea.state = 'idle';
      });
      const labels = { idle: 'Put the kettle on', boiling: 'The kettle is heating…', ready: 'Make a cup of tea' };
      C.interact.add({
        id: 'kettle', object: proxyBox(D, hidden, KETTLE_POS[0] - 0.13, KETTLE_POS[1], KETTLE_POS[2] - 0.13, KETTLE_POS[0] + 0.13, KETTLE_POS[1] + 0.24, KETTLE_POS[2] + 0.15, 'kitchen.kettle.pick'),
        label: () => labels[st.tea.state],
        onUse: () => {
          const tea = st.tea;
          if (tea.state === 'idle') {
            tea.state = 'boiling'; tea.t = 0; tea.heard = false;
            C.audio.play('click', { x: KETTLE_POS[0], y: KETTLE_POS[1], z: KETTLE_POS[2], volume: 0.6 });
            C.audio.kettle.start(KETTLE_POS[0], KETTLE_POS[1] + 0.15, KETTLE_POS[2]);
          } else if (tea.state === 'boiling') {
            C.hud.toast('A watched pot never boils…', 2.5);
          } else {
            tea.state = 'idle';
            C.audio.kettle.stop();
            C.audio.play('pour', { x: KETTLE_POS[0], y: KETTLE_POS[1], z: KETTLE_POS[2] });
            giveMug();
          }
        },
      });
    });

    // -------------------------------------------------------------------------------------------------------------
    // Retro fridge (NE corner) + hutch with plates
    // -------------------------------------------------------------------------------------------------------------
    section('fridgeHutch', () => {
      const fx0 = 1.05, fx1 = 1.8, fz0 = -4.72, fz1 = -4.08;
      U.boxAt(S, fx0, 0.08, fz0, fx1, 1.62, fz1, M.fridge, { round: 0.06, segments: 3 });
      U.boxAt(S, fx0 + 0.04, 0, fz0 + 0.04, fx1 - 0.04, 0.08, fz1 - 0.04, M.enamelDark);
      U.boxAt(S, fx0 + 0.03, 1.19, fz1 - 0.01, fx1 - 0.03, 1.2, fz1 + 0.004, M.enamelDark);
      U.cyl(S, 0.013, 0.013, 0.28, M.chrome, fx0 + 0.09, 0.98, fz1 + 0.035, { radial: 10 });
      U.cyl(S, 0.013, 0.013, 0.16, M.chrome, fx0 + 0.09, 1.38, fz1 + 0.035, { radial: 10 });
      for (const y of [0.85, 1.11, 1.31, 1.45]) U.boxAt(S, fx0 + 0.08, y - 0.01, fz1 - 0.005, fx0 + 0.1, y + 0.01, fz1 + 0.04, M.chrome);
      U.box(S, 0.16, 0.035, 0.008, M.chrome, (fx0 + fx1) / 2, 1.28, fz1 + 0.004, { round: 0.004 });
      const mag = U.stdMat(0xffffff, 0.6, 0, { vertexColors: true });
      for (const [x, y, c, w, h] of [[1.5, 0.95, 0xf3ecd8, 0.14, 0.18], [1.36, 1.05, 0xd8a24a, 0.035, 0.035], [1.62, 1.09, 0xb8452f, 0.03, 0.03], [1.55, 0.72, 0xf3ecd8, 0.12, 0.1], [1.46, 0.79, 0x3d6b8c, 0.03, 0.03]]) {
        const m = new THREE.Mesh(colored(new THREE.BoxGeometry(w, h, 0.005), c), mag);
        m.position.set(x, y, fz1 + 0.006); m.rotation.z = (x * 7 % 1 - 0.5) * 0.2; S.add(m);
      }
      PR.basket({ parent: S, position: [1.3, 1.62, -4.45], radius: 0.14, height: 0.12, contents: 'bread' });
      PR.plant({ parent: S, type: 'snake', position: [1.62, 1.62, -4.45], scale: 0.5, seed: 87 });
      U.blobShadow(S, (fx0 + fx1) / 2, 0.004, (fz0 + fz1) / 2, 0.95, 0.85, 0.4);
      addBox(fx0 - 0.02, 0, -4.75, fx1 + 0.02, 1.7, fz1 + 0.05, 'fridge');

      // hutch / dresser: base cabinet + open plate rack
      const hx0 = -0.6, hx1 = 0.6, hz0 = -4.75, hzB = -4.3, hzT = -4.47;
      U.boxAt(S, hx0, 0.08, hz0, hx1, 0.86, hzB, M.cream);
      U.boxAt(S, hx0 + 0.03, 0, hz0, hx1 - 0.03, 0.08, hzB - 0.03, M.dark);
      U.boxAt(S, hx0 - 0.02, 0.86, hz0, hx1 + 0.02, 0.9, hzB + 0.02, M.oak, { round: 0.005 });
      for (let i = 0; i < 2; i++) {
        const a = hx0 + i * 0.6;
        U.boxAt(S, a + 0.015, 0.68, hzB, a + 0.585, 0.84, hzB + 0.018, M.cream, { round: 0.004 });
        U.boxAt(S, a + 0.015, 0.12, hzB, a + 0.585, 0.66, hzB + 0.018, M.cream, { round: 0.004 });
        U.boxAt(S, a + 0.07, 0.18, hzB + 0.018, a + 0.53, 0.6, hzB + 0.024, M.cream, { round: 0.003 });
        U.sphere(S, 0.013, M.brass, a + 0.3, 0.76, hzB + 0.03, { w: 8, h: 6 });
        U.sphere(S, 0.013, M.brass, i ? a + 0.06 : a + 0.54, 0.58, hzB + 0.03, { w: 8, h: 6 });
      }
      U.boxAt(S, hx0, 0.9, hz0, hx0 + 0.03, 2.02, hzT, M.cream);
      U.boxAt(S, hx1 - 0.03, 0.9, hz0, hx1, 2.02, hzT, M.cream);
      U.boxAt(S, hx0 + 0.03, 0.9, hz0, hx1 - 0.03, 2.02, hz0 + 0.012, M.sage);
      U.boxAt(S, hx0 - 0.03, 2.02, hz0, hx1 + 0.03, 2.08, hzT + 0.03, M.cream, { round: 0.008 });
      for (const y of [1.3, 1.68]) {
        U.boxAt(S, hx0 + 0.03, y, hz0 + 0.012, hx1 - 0.03, y + 0.022, hzT, M.cream);
        U.boxAt(S, hx0 + 0.03, y + 0.04, hzT - 0.02, hx1 - 0.03, y + 0.055, hzT - 0.008, M.cream);
      }
      // standing plates (vertex coloured) + cups on hooks
      const plateMat = U.stdMat(0xffffff, 0.2, 0, { vertexColors: true });
      const pcols = [0xf4f1ea, 0x4f6d9a, 0xf4f1ea, 0xc98f8a, 0xf4f1ea, 0x4f6d9a, 0x8fa487];
      for (const [y, n] of [[1.322, 5], [1.702, 4]]) for (let i = 0; i < n; i++) {
        const r = 0.11 - (i % 2) * 0.015;
        const g = colored(new THREE.CylinderGeometry(r, r * 0.9, 0.014, 28), pcols[(i + n) % pcols.length]);
        const m = new THREE.Mesh(g, plateMat);
        m.position.set(hx0 + 0.14 + i * (1.0 / n), y + r * 0.96, hz0 + 0.07);
        m.rotation.x = PI / 2 - 0.2; S.add(m);
      }
      for (let i = 0; i < 5; i++) {
        PR.mug({ parent: S, position: [hx0 + 0.15 + i * 0.22, 1.13, hzT - 0.08], color: [0xefe6d4, 0x4f6d9a, 0xc98f8a, 0x8fa487, 0xd09a3a][i], fill: 'none', rotationY: PI / 2 });
        U.boxAt(S, hx0 + 0.15 + i * 0.22 - 0.003, 1.23, hzT - 0.04, hx0 + 0.15 + i * 0.22 + 0.003, 1.3, hzT - 0.034, M.brass);
      }
      PR.teapot({ parent: S, position: [-0.3, 0.9, -4.5], color: 0x4f6d9a, rotationY: 0.8 });
      PR.vase({ parent: S, position: [0.3, 0.9, -4.52], flowers: 'tulip', height: 0.2, color: 0xf4f1ea, seed: 88 });
      PR.frame({ parent: S, position: [0.05, 0.9, -4.6], rotationY: 0.1, w: 0.15, h: 0.2, seed: 89 });
      U.blobShadow(S, 0, 0.004, -4.52, 1.4, 0.6, 0.35);
      addBox(hx0 - 0.03, 0, hz0, hx1 + 0.03, 2.1, hzB + 0.03, 'hutch');
    });

    // -------------------------------------------------------------------------------------------------------------
    // Dining: table (−3.4, −1.5), 4 chairs, runner, candles, fruit, pendant, rug; kitchen light
    // -------------------------------------------------------------------------------------------------------------
    section('dining', () => {
      const cx = -3.4, cz = -1.5;
      PR.rug({ parent: S, w: 2.8, d: 2.1, style: 'braided', round: true, position: [cx, 0, cz] });
      U.box(S, 1.6, 0.045, 0.9, M.oak, cx, 0.7375, cz, { round: 0.012 });
      U.boxAt(S, cx - 0.72, 0.62, cz - 0.4, cx + 0.72, 0.715, cz - 0.38, M.oak);
      U.boxAt(S, cx - 0.72, 0.62, cz + 0.38, cx + 0.72, 0.715, cz + 0.4, M.oak);
      U.boxAt(S, cx - 0.72, 0.62, cz - 0.38, cx - 0.7, 0.715, cz + 0.38, M.oak);
      U.boxAt(S, cx + 0.7, 0.62, cz - 0.38, cx + 0.72, 0.715, cz + 0.38, M.oak);
      const leg = [[0, 0], [0.028, 0], [0.03, 0.04], [0.022, 0.09], [0.026, 0.28], [0.034, 0.42], [0.024, 0.56], [0.034, 0.62], [0.034, 0.715], [0, 0.715]];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.lathe(S, leg, M.oak, cx + sx * 0.72, 0, cz + sz * 0.37, { segments: 12 });
      U.blobShadow(S, cx, 0.006, cz, 1.9, 1.2, 0.35);
      addBox(cx - 0.8, 0, cz - 0.45, cx + 0.8, 0.78, cz + 0.45, 'table');
      U.box(S, 1.25, 0.004, 0.3, C.mat('rugRunner'), cx, 0.762, cz, { round: 0.001 });
      U.cyl(S, 0.075, 0.09, 0.012, M.brass, cx - 0.3, 0.766, cz, { radial: 16 });
      PR.candle({ parent: S, position: [cx - 0.3, 0.772, cz - 0.03], height: 0.22, radius: 0.012, holder: 'brass' });
      PR.candle({ parent: S, position: [cx - 0.3, 0.772, cz + 0.05], height: 0.16, radius: 0.012, holder: 'brass' });
      U.lathe(S, [[0, 0], [0.06, 0], [0.13, 0.05], [0.15, 0.09], [0.14, 0.092], [0.12, 0.055], [0, 0.012]], M.blue, cx + 0.22, 0.764, cz, { segments: 28 });
      const fruit = U.stdMat(0xffffff, 0.45, 0, { vertexColors: true });
      for (const [dx, dz, dy, r, col] of [[0, 0, 0.07, 0.042, 0xa8322a], [0.06, 0.03, 0.065, 0.04, 0x8aa04a], [-0.05, 0.04, 0.065, 0.04, 0xb8452f], [0.02, -0.06, 0.066, 0.038, 0xd9b53a], [-0.03, -0.02, 0.11, 0.04, 0xa8322a]]) {
        const m = new THREE.Mesh(colored(new THREE.SphereGeometry(r, 14, 10), col), fruit);
        m.position.set(cx + 0.22 + dx, 0.764 + dy, cz + dz); m.scale.y = col === 0xd9b53a ? 0.75 : 0.92; S.add(m);
      }
      PR.vase({ parent: S, position: [cx + 0.55, 0.76, cz + 0.08], flowers: 'daisy', height: 0.15, color: 0xefe6d4, seed: 91 });
      for (const [px, pz] of [[cx - 0.4, cz - 0.28], [cx + 0.4, cz + 0.28]]) {
        U.cyl(S, 0.12, 0.1, 0.014, M.ceramic, px, 0.767, pz, { radial: 28 });
        PR.mug({ parent: S, position: [px + 0.17, 0.76, pz], color: 0xefe6d4, fill: 'none', rotationY: 0.8 });
      }
      const chairs = [[cx - 0.4, cz - 0.82, 0.05], [cx + 0.4, cz - 0.8, -0.08], [cx - 0.4, cz + 0.82, PI - 0.06], [cx + 0.4, cz + 0.8, PI + 0.04]];
      for (const [x, z, ry] of chairs) {
        buildChair(S, M, x, z, ry);
        addBox(x - 0.24, 0, z - 0.24, x + 0.24, 0.95, z + 0.24, 'chair');
      }
      const cp = proxyBox(D, hidden, -0.23, 0, -0.23, 0.23, 0.95, 0.23, 'kitchen.diningChair.pick');
      cp.position.set(cx + 0.4, 0.475, cz + 0.8); cp.rotation.y = PI + 0.04;
      C.interact.add({ id: 'dining_chair', object: cp, label: 'Sit at the table', onUse: () => C.player.sitAt(st.seat) });
      PR.lamp({ id: 'lamp_dining_pendant', type: 'pendant', style: 'dome', position: [cx, 2.8, cz], height: 1.02, intensity: 6.5, color: 0xffc27a, room: 'kitchen', parent: D, label: 'pendant lamp' });
      PR.lamp({ id: 'lamp_kitchen', type: 'pendant', style: 'glass', position: [-1.9, 2.8, -3.55], height: 0.68, intensity: 4, color: 0xffd29a, room: 'kitchen', parent: D, label: 'kitchen light' });
      PR.plant({ parent: S, type: 'monstera', position: [-6.2, 0, -0.35], scale: 0.9, seed: 92 });
      P.addCylinder(-6.2, -0.35, 0.22, 0, 1.0, { tag: 'furniture', name: 'kitchen.monstera' });
      PR.painting({ parent: S, width: 0.55, height: 0.42, style: 'cottage', frame: 'wood', position: [-6.75, 1.6, -0.4], rotationY: PI / 2, seed: 93 });
      PR.painting({ parent: S, width: 0.4, height: 0.5, style: 'botanical', frame: 'gold', position: [1.925, 1.55, -1.5], rotationY: -PI / 2, seed: 94 });
    });

    // -------------------------------------------------------------------------------------------------------------
    // Mug in hand (parented to the camera) + a pool of mugs that can be set down
    // -------------------------------------------------------------------------------------------------------------
    section('mug', () => {
      const held = new THREE.Group(); held.name = 'kitchen.heldMug'; held.visible = false; held.userData.dynamic = true;
      held.position.copy(HELD_REST);
      held.scale.setScalar(0.85);
      C.camera.add(held);
      const mg = PR.mug({ parent: held, position: [0, 0, 0], color: 0xefe6d4, steam: true, fill: 'tea', rotationY: -0.5 });
      mg.traverse(o => { o.userData.dynamic = true; o.raycast = () => {}; });
      st.held = held; st.heldSteam = mg.userData.steam; st.holding = false; st.sip = 0; st.sips = 0;
      st.pool = [];
      for (let i = 0; i < 4; i++) {
        const m = PR.mug({ parent: D, position: [0, -10, 0], color: [0xefe6d4, 0x8fa487, 0xc98f8a, 0x4f6d9a][i], steam: true, fill: 'tea' });
        m.visible = false;
        st.pool.push({ g: m, steam: m.userData.steam, t: 0 });
      }
      st.poolNext = 0;
      st.ray = new THREE.Raycaster();
      C.input.onKey('KeyQ', () => sip());
      C.input.onKey('KeyE', () => { if (st.holding && !C.interact.focused && st.lastMode !== 'sit') putDown(); });
      C.renderer.domElement.addEventListener('mousedown', e => {
        if (e.button === 0 && st.holding && C.state.started && !C.state.paused && C.input.pointerLocked && !C.interact.focused) sip();
      });
    });

    function giveMug() {
      if (!st.held) return;
      st.holding = true; st.sips = 0; st.sip = 0;
      st.held.visible = true;
      st.heldSteam && st.heldSteam.setStrength(1);
      C.hud.toast('A fresh cup of tea.  Q or click to sip · E to set it down', 4.5);
    }
    function sip() {
      if (!st.holding || st.sip > 0 || C.state.paused) return;
      st.sip = 0.0001; st.sips++;
      C.audio.play('sip', { volume: 0.7 });
      if (st.sips === 1) C.hud.toast('Mmm. Just right.', 2.5);
      if (st.sips >= 7) { C.hud.toast('The last sip. Lovely.', 3); st.finish = true; }
    }
    function putDown() {
      if (!st.holding) return;
      const cam = C.camera;
      cam.getWorldPosition(_v); cam.getWorldDirection(_d);
      st.ray.set(_v, _d); st.ray.far = 2.2;
      const targets = ['living', 'kitchen', 'hallstudy', 'loft', 'house', 'outdoor'].map(n => C.scene.getObjectByName(n)).filter(Boolean);
      let spot = null;
      for (const h of st.ray.intersectObjects(targets, true)) {
        const o = h.object, m = o.material;
        if (!o.isMesh || !h.face || !m || Array.isArray(m) || m.visible === false || m.transparent || !o.visible) continue;
        _n.copy(h.face.normal).transformDirection(o.matrixWorld);
        if (_n.y < 0.75) break;
        spot = h.point; break;
      }
      st.holding = false; st.held.visible = false; st.sip = 0;
      if (!spot || st.finish) {
        C.hud.toast(st.finish ? 'You finish your tea.' : 'You finish your tea.', 2.5);
        st.finish = false;
        return;
      }
      const p = st.pool[st.poolNext]; st.poolNext = (st.poolNext + 1) % st.pool.length;
      p.g.position.set(spot.x, spot.y + 0.001, spot.z);
      p.g.rotation.y = Math.random() * PI * 2;
      p.g.visible = true; p.t = 90;
      p.steam && p.steam.setStrength(Math.max(0.2, 1 - st.sips / 7));
      C.audio.play('clink', { x: spot.x, y: spot.y, z: spot.z, volume: 0.5 });
    }
    st.putDown = putDown;
    st.giveMug = giveMug;

    C.kitchen = { seat: st.seat, tea: { get state() { return st.tea && st.tea.state; }, get holding() { return !!st.holding; }, giveMug, sip, putDown } };
    U.bakeStatic(S);
    st.ready = !!st.tea;
  },

  update(dt, t, C) {
    if (!st.ready) return;
    const cp = C.camera.position;
    // hidden from the loft, and from the study while the kitchen–study door is shut
    const hd = C.house && C.house.doors;
    const inStudy = cp.x > 2.0 && cp.z < -0.7 && hd && doorShut(hd.kitchenStudy);
    st.S.visible = !(cp.x > -7 && cp.x < 7 && cp.z > -5 && cp.z < 5) || (cp.y < 3.8 && !inStudy);
    const tea = st.tea;
    if (tea.state === 'boiling') {
      tea.t += dt;
      if (!tea.heard && tea.t > 6.8) tea.state = 'ready';         // no audio module → no whistle event
    }
    const want = tea.state === 'boiling' ? Math.min(0.7, 0.1 + tea.t * 0.1) : tea.state === 'ready' ? 1 : 0;
    const cur = st.steam.strength !== undefined ? st.steam.strength : 0;
    const nxt = C.util.damp(cur, want, want > cur ? 1.5 : 0.6, dt);
    if (Math.abs(nxt - cur) > 0.002) st.steam.setStrength(nxt);
    st.lastMode = C.player.mode;
    if (st.held && st.holding) {
      if (st.sip > 0) {
        st.sip += dt;
        const ph = Math.min(1, st.sip / 1.5), k = Math.sin(ph * PI);
        st.held.position.lerpVectors(HELD_REST, HELD_SIP, k);
        st.held.rotation.x = k * 0.85;
        if (ph >= 1) { st.sip = 0; if (st.finish) st.putDown(); }
      } else {
        st.held.position.y = HELD_REST.y + Math.sin(t * 1.6) * 0.004;
      }
    }
    for (let i = 0; i < st.pool.length; i++) {
      const p = st.pool[i];
      if (p.t > 0) { p.t -= dt; if (p.steam) p.steam.setStrength(Math.max(0, Math.min(p.steam.strength, p.t / 90))); }
    }
  },
});

// =====================================================================================================================
//  LOFT BEDROOM — module "loft", order 60.  (SPEC §4.5, §8, §9 loft)  Upper floor y = 3.0, walkable |z| ≤ 3.7.
//  West end: bed against the gable (patchwork quilt, pillows, lie-down looking up at skylight sk_1), nightstands +
//  bedside lamp, wardrobe, clothes rail, dresser + mirror, blanket chest, rugs.  Ridge: twinkling string lights.
//  East nook by w_loft_e: reading chair + floor lamp, beanbag, floor cushions, low bookshelf, telescope, hanging plant.
//  Eaves: low bookshelves + trunks behind the eave colliders.  Middle: little writing desk + stool.
//  Interactables: bed, lamp_loft_bedside, lights_loft_string, lamp_loft_nook, loft_chair.
//  Lights: lamp_loft_bedside (Point 2.0 cd, decay 1.5: it stands near the gable wall), lamp_loft_nook (Point 3.2 cd),
//  lights_loft_string (2 × Point #ffcf8a 1.8 cd).
//  Exposes C.loft = { catSpots, seats, stringLights: { on, toggle() } }.
// =====================================================================================================================
import * as THREE from 'three';

const C = window.COZY;
const PI = Math.PI;
const Y = 3.0;
const STRING_CD = 1.8;

const st = { ready: false };

function proxyBox(parent, mat, x0, y0, z0, x1, y1, z1, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.name = name;
  m.userData.dynamic = true;
  parent.add(m);
  return m;
}

function group(parent, name, x, y, z, ry) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  g.rotation.y = ry || 0;
  parent.add(g);
  return g;
}

function pillowAt(parent, x, y, z, yaw, lean, o) {
  const g = group(parent, 'loft.pillow', x, y, z, yaw);
  C.props.pillow(Object.assign({ parent: g, position: [0, 0, 0], rotation: [lean, 0, o.roll || 0] }, o));
  return g;
}

C.register({
  name: 'loft',
  order: 60,
  init(C) {
    const U = C.util, P = C.physics, PR = C.props;
    const root = new THREE.Group(); root.name = 'loft';
    C.scene.add(root);
    const S = new THREE.Group(); S.name = 'loft.static'; root.add(S);
    st.S = S;
    const D = new THREE.Group(); D.name = 'loft.dynamic'; D.userData.dynamic = true; root.add(D);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const section = (name, fn) => {
      try { fn(); } catch (e) {
        C.debug.errors.push({ module: 'loft', phase: 'init:' + name, message: e.message, stack: String(e.stack || '').slice(0, 1500) });
        console.error(`[loft] ${name} failed: ${e.message}`);
      }
    };
    const M = {
      oak: C.mat('woodMedium'), dark: C.mat('woodDark'), light: C.mat('woodLight'), cream: C.mat('woodPainted'), brass: C.mat('brass'),
      iron: C.mat('ironBlack'), linen: C.mat('fabricCream'), quilt: C.mat('quilt'), knit: C.mat('knit'), blue: C.mat('fabricBlue'),
      green: C.mat('fabricGreen'), rose: C.mat('fabricRose'), mustard: C.mat('fabricChair'), leather: C.mat('leather'), paper: C.mat('paper'),
      sheet: U.stdMat(0xf4efe4, 0.9, 0), wicker: C.mat('wickerBasket'),
    };
    const addBox = (x0, y0, z0, x1, y1, z1, name) => P.addBox([x0, y0, z0], [x1, y1, z1], { tag: 'furniture', name: 'loft.' + name });
    st.seats = {
      bed: { id: 'bed', lie: true, position: [-6.05, Y + 0.8, 0.1], yaw: -2.75, pitch: 0.95, yawRange: 1.5, pitchMin: -0.3, pitchMax: 1.45, exit: [-5.2, Y, 1.42], label: 'Get up' },
      loft_chair: { id: 'loft_chair', position: [4.52, Y + 1.12, -2.75], yaw: -PI / 2, pitch: -0.05, yawRange: 1.4, exit: [5.33, Y, -2.75], label: 'Stand up' },
    };

    // -------------------------------------------------------------------------------------------------------------
    // Bed (x −6.75→−4.6, z −0.85→0.85), nightstands, bedside lamp
    // -------------------------------------------------------------------------------------------------------------
    section('bed', () => {
      const hx = -6.75, fx = -4.58;
      U.boxAt(S, hx, Y, -0.95, hx + 0.08, Y + 1.3, 0.95, M.oak);
      for (let i = 0; i < 3; i++) { const z0 = -0.82 + i * 0.56; U.boxAt(S, hx + 0.08, Y + 0.62, z0, hx + 0.095, Y + 1.15, z0 + 0.52, M.oak, { round: 0.004 }); }
      U.boxAt(S, hx - 0.01, Y + 1.3, -1.0, hx + 0.11, Y + 1.36, 1.0, M.oak, { round: 0.012 });
      for (const z of [-0.95, 0.95]) {
        U.boxAt(S, hx, Y, z - 0.04, hx + 0.1, Y + 1.42, z + 0.04, M.oak, { round: 0.01 });
        U.sphere(S, 0.045, M.oak, hx + 0.05, Y + 1.46, z, { w: 12, h: 8 });
        U.boxAt(S, fx - 0.08, Y, z - 0.04, fx, Y + 0.78, z + 0.04, M.oak, { round: 0.01 });
        U.sphere(S, 0.04, M.oak, fx - 0.04, Y + 0.81, z, { w: 12, h: 8 });
        U.boxAt(S, hx + 0.08, Y + 0.14, z - 0.025, fx - 0.08, Y + 0.32, z + 0.025, M.oak);
      }
      U.boxAt(S, fx - 0.07, Y + 0.14, -0.92, fx - 0.01, Y + 0.64, 0.92, M.oak);
      for (let i = 0; i < 7; i++) U.boxAt(S, fx - 0.075, Y + 0.3, -0.72 + i * 0.24 - 0.02, fx - 0.005, Y + 0.6, -0.72 + i * 0.24 + 0.02, M.oak);
      U.box(S, 2.0, 0.22, 1.72, M.sheet, -5.66, Y + 0.42, 0, { round: 0.06, segments: 3 });
      // patchwork quilt: top + side drapes, turned-down edge showing the sheet
      U.box(S, 1.6, 0.06, 1.8, M.quilt, -5.38, Y + 0.555, 0, { round: 0.03, segments: 2 });
      for (const s of [-1, 1]) U.boxAt(S, -6.18, Y + 0.3, s * 0.88 - 0.025, -4.62, Y + 0.585, s * 0.88 + 0.025, M.quilt, { round: 0.01 });
      U.boxAt(S, -4.64, Y + 0.3, -0.9, -4.6, Y + 0.585, 0.9, M.quilt, { round: 0.01 });
      U.cyl(S, 0.045, 0.045, 1.8, M.quilt, -6.19, Y + 0.575, 0, { rx: PI / 2, radial: 14 });
      U.box(S, 0.3, 0.02, 1.7, M.sheet, -6.38, Y + 0.54, 0, { round: 0.008 });
      PR.blanket({ parent: S, w: 0.46, d: 1.5, material: 'knit', position: [-4.93, Y + 0.585, 0.02], folds: 2 });
      pillowAt(S, -6.5, Y + 0.76, -0.42, PI / 2, -0.4, { w: 0.72, h: 0.46, t: 0.17, color: 0xf4efe4 });
      pillowAt(S, -6.5, Y + 0.76, 0.42, PI / 2, -0.4, { w: 0.72, h: 0.46, t: 0.17, color: 0xf4efe4 });
      pillowAt(S, -6.32, Y + 0.7, -0.22, PI / 2 + 0.1, -0.32, { w: 0.42, h: 0.42, t: 0.13, color: 0x3d5a45 });
      pillowAt(S, -6.32, Y + 0.7, 0.24, PI / 2 - 0.12, -0.32, { w: 0.42, h: 0.42, t: 0.13, color: 0xc98f8a });
      pillowAt(S, -6.18, Y + 0.64, 0.0, PI / 2, -0.15, { w: 0.46, h: 0.2, t: 0.16, color: 0xd09a3a, shape: 'bolster' });
      U.blobShadow(S, -5.66, Y + 0.004, 0, 2.4, 2.1, 0.45);
      addBox(-6.75, Y, -1.0, -4.55, Y + 0.72, 1.0, 'bed');
      C.interact.add({ id: 'bed', object: proxyBox(D, hidden, -6.65, Y, -0.92, -4.6, Y + 0.72, 0.92, 'loft.bed.pick'), label: 'Lie down for a while', onUse: () => C.player.sitAt(st.seats.bed) });
      // nightstands
      for (const [z0, z1] of [[-1.48, -1.03], [1.03, 1.48]]) {
        U.boxAt(S, -6.73, Y + 0.08, z0, -6.27, Y + 0.54, z1, M.dark);
        U.boxAt(S, -6.75, Y + 0.54, z0 - 0.015, -6.25, Y + 0.57, z1 + 0.015, M.dark, { round: 0.006 });
        U.boxAt(S, -6.27, Y + 0.36, z0 + 0.03, -6.255, Y + 0.51, z1 - 0.03, M.oak, { round: 0.003 });
        U.sphere(S, 0.013, M.brass, -6.245, Y + 0.435, (z0 + z1) / 2, { w: 8, h: 6 });
        for (const x of [-6.7, -6.3]) for (const z of [z0 + 0.03, z1 - 0.03]) U.cyl(S, 0.015, 0.012, 0.08, M.dark, x, Y + 0.04, z, { radial: 8 });
        addBox(-6.75, Y, z0 - 0.02, -6.24, Y + 0.6, z1 + 0.02, 'nightstand');
      }
      PR.lamp({ id: 'lamp_loft_bedside', type: 'table', position: [-6.4, Y + 0.57, 1.32], height: 0.5, intensity: 2.0, decay: 1.5, bodyColor: 0xc98f8a, room: 'loft', parent: D, label: 'bedside lamp' });
      PR.bookStack({ parent: S, count: 2, position: [-6.47, Y + 0.57, 1.1], rotationY: 0.4, seed: 121 });
      PR.clock({ parent: S, position: [-6.55, Y + 0.57, -1.32], rotationY: PI / 2 - 0.3, scale: 0.55 });
      PR.mug({ parent: S, position: [-6.4, Y + 0.57, -1.12], color: 0x8fa487, fill: 'cocoa' });
      PR.bookStack({ parent: S, count: 3, position: [-6.5, Y + 0.08, -1.25], rotationY: 0.1, seed: 122 });
      PR.rug({ parent: S, w: 0.9, d: 0.62, style: 'sheepskin', position: [-5.55, Y, 1.3], rotationY: 0.2 });
      PR.rug({ parent: S, w: 0.9, d: 0.62, style: 'sheepskin', position: [-5.55, Y, -1.3], rotationY: -0.25 });
    });

    section('storage', () => {
      // wardrobe on the gable wall (north side)
      const wz0 = -3.15, wz1 = -2.0, wx0 = -6.75, wx1 = -6.15;
      U.boxAt(S, wx0, Y + 0.08, wz0, wx1, Y + 1.98, wz1, M.cream);
      U.boxAt(S, wx0, Y + 1.98, wz0 - 0.03, wx1 + 0.04, Y + 2.05, wz1 + 0.03, M.cream, { round: 0.01 });
      U.boxAt(S, wx0 + 0.02, Y, wz0 + 0.02, wx1 - 0.02, Y + 0.08, wz1 - 0.02, M.dark);
      const dw = (wz1 - wz0 - 0.04) / 2;
      for (let i = 0; i < 2; i++) {
        const a = wz0 + 0.02 + i * dw;
        U.boxAt(S, wx1, Y + 0.12, a + 0.008, wx1 + 0.018, Y + 1.94, a + dw - 0.008, M.cream, { round: 0.004 });
        for (const [y0, y1] of [[0.2, 0.9], [1.0, 1.86]]) U.boxAt(S, wx1 + 0.018, Y + y0, a + 0.07, wx1 + 0.024, Y + y1, a + dw - 0.07, M.cream, { round: 0.003 });
        U.sphere(S, 0.014, M.brass, wx1 + 0.035, Y + 1.0, i ? a + 0.05 : a + dw - 0.05, { w: 8, h: 6 });
      }
      PR.basket({ parent: S, position: [-6.45, Y + 2.05, -2.55], radius: 0.18, height: 0.2, oval: 0.8, contents: 'blanket' });
      U.blobShadow(S, (wx0 + wx1) / 2, Y + 0.004, (wz0 + wz1) / 2, 0.8, 1.3, 0.4);
      addBox(wx0, Y, wz0 - 0.03, wx1 + 0.05, Y + 2.05, wz1 + 0.03, 'wardrobe');
      // clothes rail against the north eave line
      const rz = -3.35;
      for (const x of [-5.72, -4.62]) { U.cyl(S, 0.014, 0.014, 1.62, M.iron, x, Y + 0.81, rz, { radial: 8 }); U.boxAt(S, x - 0.02, Y, rz - 0.2, x + 0.02, Y + 0.03, rz + 0.2, M.iron); }
      U.cyl(S, 0.012, 0.012, 1.14, M.iron, -5.17, Y + 1.6, rz, { rz: PI / 2, radial: 8 });
      const clothes = [[-5.5, M.rose, 0.95, 0.42], [-5.27, M.linen, 0.7, 0.44], [-5.05, M.green, 1.05, 0.4], [-4.84, M.blue, 0.72, 0.46]];
      for (const [x, mat, len, wid] of clothes) {
        const g = group(S, 'loft.garment', x, Y + 1.6, rz, PI / 2);
        const hg = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 4, 10, PI * 1.4), M.iron); hg.position.y = 0.012; hg.rotation.z = -0.2; g.add(hg);
        U.box(g, 0.012, 0.012, wid * 0.9, M.dark, 0, -0.04, 0, { rx: 0 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(wid * 0.45, wid * 0.62, len, 10), mat);
        body.scale.x = 0.28; body.position.y = -0.06 - len / 2; body.rotation.y = PI / 2; g.add(body);
      }
      addBox(-5.78, Y, rz - 0.22, -4.56, Y + 1.7, rz + 0.22, 'clothesRail');
      // dresser + mirror on the gable wall (south side)
      const dz0 = 2.0, dz1 = 3.15, dx1 = -6.28;
      U.boxAt(S, -6.75, Y + 0.08, dz0, dx1, Y + 0.82, dz1, M.dark);
      U.boxAt(S, -6.75, Y + 0.82, dz0 - 0.02, dx1 + 0.02, Y + 0.855, dz1 + 0.02, M.dark, { round: 0.006 });
      for (let i = 0; i < 3; i++) {
        const y0 = Y + 0.12 + i * 0.235;
        U.boxAt(S, dx1, y0, dz0 + 0.03, dx1 + 0.016, y0 + 0.215, dz1 - 0.03, M.oak, { round: 0.004 });
        for (const z of [dz0 + 0.28, dz1 - 0.28]) U.sphere(S, 0.014, M.brass, dx1 + 0.028, y0 + 0.11, z, { w: 8, h: 6 });
      }
      for (const x of [-6.7, dx1 - 0.04]) for (const z of [dz0 + 0.04, dz1 - 0.04]) U.cyl(S, 0.018, 0.014, 0.08, M.dark, x, Y + 0.04, z, { radial: 8 });
      const mirTex = U.canvasTexture(128, 128, (ctx, w, h) => {
        const gr = ctx.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#9aa3ab'); gr.addColorStop(0.5, '#6d747c'); gr.addColorStop(1, '#474c53');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,225,170,0.2)'; ctx.beginPath(); ctx.ellipse(w * 0.7, h * 0.65, 14, 18, 0, 0, PI * 2); ctx.fill();
        const hl = ctx.createLinearGradient(0, 0, w, 0); hl.addColorStop(0.25, 'rgba(255,255,255,0)'); hl.addColorStop(0.38, 'rgba(255,255,255,0.2)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl; ctx.fillRect(0, 0, w, h);
      }, { wrap: false });
      const mirMat = new THREE.MeshStandardMaterial({ map: mirTex, roughness: 0.1, metalness: 0.2 }); mirMat.name = 'loft.mirror';
      const mg = group(S, 'loft.mirror', -6.75, Y + 1.42, 2.58, PI / 2);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 10, 40), M.brass); frame.position.z = 0.03; mg.add(frame);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.26, 40), mirMat); glass.position.z = 0.028; mg.add(glass);
      PR.vase({ parent: S, position: [-6.55, Y + 0.855, 2.2], flowers: 'tulip', height: 0.18, color: 0xefe6d4, seed: 123 });
      PR.candle({ parent: S, position: [-6.5, Y + 0.855, 2.95], height: 0.12, radius: 0.03, holder: 'saucer' });
      U.box(S, 0.18, 0.08, 0.26, M.oak, -6.55, Y + 0.895, 2.6, { round: 0.01 });
      U.box(S, 0.184, 0.012, 0.264, M.brass, -6.55, Y + 0.935, 2.6, { round: 0.004 });
      PR.bottle({ parent: S, position: [-6.45, Y + 0.855, 2.78], kind: 'green', height: 0.1 });
      addBox(-6.75, Y, dz0 - 0.03, dx1 + 0.04, Y + 0.9, dz1 + 0.03, 'dresser');
      // blanket chest at the foot of the bed
      U.boxAt(S, -4.47, Y + 0.05, -0.56, -4.05, Y + 0.46, 0.56, M.oak, { round: 0.01 });
      U.boxAt(S, -4.49, Y + 0.46, -0.58, -4.03, Y + 0.5, 0.58, M.oak, { round: 0.012 });
      for (const z of [-0.4, 0.4]) U.boxAt(S, -4.5, Y + 0.12, z - 0.02, -4.02, Y + 0.44, z + 0.02, M.iron);
      U.boxAt(S, -4.03, Y + 0.34, -0.05, -4.02, Y + 0.44, 0.05, M.brass);
      for (const x of [-4.43, -4.09]) for (const z of [-0.52, 0.52]) U.boxAt(S, x - 0.03, Y, z - 0.03, x + 0.03, Y + 0.05, z + 0.03, M.dark);
      PR.blanket({ parent: S, w: 0.36, d: 0.5, material: 'quilt', position: [-4.26, Y + 0.5, 0.2], folds: 3 });
      PR.bookStack({ parent: S, count: 2, position: [-4.25, Y + 0.5, -0.3], rotationY: 0.3, seed: 124 });
      addBox(-4.5, Y, -0.6, -4.02, Y + 0.55, 0.6, 'chest');
      PR.rug({ parent: S, w: 3.0, d: 2.5, style: 'braided', position: [-2.7, Y, 0] });
      // eave storage (behind the eave colliders, |z| > 3.7)
      for (const [x0, x1] of [[-3.3, -1.3], [1.0, 3.0]]) {
        const z0 = 4.3;
        U.boxAt(S, x0, Y, z0, x1, Y + 0.74, 4.75, M.dark);
        U.boxAt(S, x0 + 0.03, Y + 0.05, z0 - 0.005, x1 - 0.03, Y + 0.7, z0, U.stdMat(0x1f140e, 0.9));
        U.boxAt(S, x0 + 0.03, Y + 0.37, z0, x1 - 0.03, Y + 0.39, 4.72, M.dark);
        PR.books({ parent: S, length: x1 - x0 - 0.1, depth: 0.2, position: [(x0 + x1) / 2, Y + 0.05, z0 + 0.14], rotationY: PI, seed: 125 + x0 });
        PR.books({ parent: S, length: x1 - x0 - 0.1, depth: 0.2, position: [(x0 + x1) / 2, Y + 0.39, z0 + 0.14], rotationY: PI, seed: 126 + x0, fill: 0.8 });
        PR.plant({ parent: S, type: 'pothos', position: [x0 + 0.35, Y + 0.74, 4.5], scale: 0.8, seed: 127 + x0 });
      }
      for (const [x, c] of [[-2.3, M.oak], [2.2, M.dark]]) {
        U.boxAt(S, x - 0.5, Y, -4.5, x + 0.5, Y + 0.45, -3.95, c, { round: 0.02 });
        U.boxAt(S, x - 0.51, Y + 0.42, -4.51, x + 0.51, Y + 0.48, -3.94, c, { round: 0.02 });
        for (const dx of [-0.35, 0.35]) U.boxAt(S, x + dx - 0.02, Y + 0.05, -3.945, x + dx + 0.02, Y + 0.46, -3.94, M.brass);
      }
    });

    // -------------------------------------------------------------------------------------------------------------
    // String lights along the ridge beam (bottom y 7.12): catenary swags, emissive bulbs in 3 twinkle groups
    // -------------------------------------------------------------------------------------------------------------
    section('stringLights', () => {
      const pts = [];
      const hooks = []; for (let x = -6.3; x <= 5.4; x += 1.46) hooks.push(x);
      for (let h = 0; h < hooks.length - 1; h++) {
        for (let k = 0; k < 10; k++) { const s = k / 10, x = hooks[h] + (hooks[h + 1] - hooks[h]) * s; pts.push(new THREE.Vector3(x, 7.1 - 0.24 * Math.sin(PI * s), 0.0)); }
      }
      pts.push(new THREE.Vector3(hooks[hooks.length - 1], 7.1, 0));
      const curve = new THREE.CatmullRomCurve3(pts);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.004, 4, false), U.stdMat(0x1f2a1f, 0.6, 0));
      wire.name = 'loft.stringWire'; S.add(wire);
      st.bulbMats = [0, 1, 2].map(i => { const m = new THREE.MeshStandardMaterial({ color: 0xffe6c0, emissive: 0xffc070, emissiveIntensity: 2.2, roughness: 0.3 }); m.name = 'loft.bulb' + i; return m; });
      const geos = [[], [], []];
      const len = curve.getLength(), n = Math.floor(len / 0.2);
      const tmp = new THREE.Vector3();
      for (let i = 1; i < n; i++) {
        curve.getPointAt(i / n, tmp);
        const g = new THREE.SphereGeometry(0.016, 8, 6); g.scale(1, 1.35, 1); g.translate(tmp.x, tmp.y - 0.028, tmp.z);
        const cap = new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6); cap.translate(tmp.x, tmp.y - 0.008, tmp.z);
        geos[i % 3].push(g, cap);
      }
      st.bulbs = [];
      for (let i = 0; i < 3; i++) {
        const merged = geos[i].length ? mergeAll(geos[i]) : null;
        if (!merged) continue;
        const m = new THREE.Mesh(merged, st.bulbMats[i]); m.name = 'loft.stringBulbs'; m.userData.dynamic = true; D.add(m);
        st.bulbs.push(m);
      }
      st.stringLights = [];
      for (const x of [-2.6, 2.4]) {
        const l = new THREE.PointLight(0xffcf8a, STRING_CD, 0, 2);
        l.position.set(x, 6.75, 0); l.name = 'light.lights_loft_string';
        D.add(l);
        C.registerLight(l, { id: 'lights_loft_string', room: 'loft', kind: 'string' });
        st.stringLights.push(l);
      }
      st.stringOn = true; st.stringLevel = 1;
      const toggle = () => {
        st.stringOn = !st.stringOn;
        // audio plays the switch click for every 'lamp' event
        C.emit('lamp', { id: 'lights_loft_string', on: st.stringOn, x: 0, y: 6.9, z: 0 });
        return st.stringOn;
      };
      st.stringApi = { get on() { return st.stringOn; }, toggle, setOn(v) { if (!!v !== st.stringOn) toggle(); } };
      C.interact.add({ id: 'lights_loft_string', object: proxyBox(D, hidden, -6.3, 6.7, -0.14, 5.4, 7.12, 0.14, 'loft.stringLights.pick'), range: 3.6, label: () => `Turn ${st.stringOn ? 'off' : 'on'} the string lights`, onUse: toggle });
    });

    // -------------------------------------------------------------------------------------------------------------
    // East reading nook (x 3.8→6.75, z −3.7→−1.85): chair + floor lamp, beanbag, cushions, shelf, telescope
    // -------------------------------------------------------------------------------------------------------------
    section('nook', () => {
      const g = group(S, 'loft.readingChair', 4.6, Y, -2.75, PI / 2);
      const f = M.blue;
      U.box(g, 0.82, 0.22, 0.78, f, 0, 0.2, 0, { round: 0.05, segments: 3 });
      U.box(g, 0.56, 0.13, 0.58, f, 0, 0.375, 0.07, { round: 0.05, segments: 3 });
      for (const s of [-1, 1]) { U.box(g, 0.14, 0.34, 0.74, f, s * 0.34, 0.4, 0.02, { round: 0.06, segments: 3 }); U.cyl(g, 0.07, 0.07, 0.72, f, s * 0.34, 0.57, 0.02, { rx: PI / 2, radial: 14 }); }
      U.box(g, 0.78, 0.62, 0.16, f, 0, 0.66, -0.32, { round: 0.07, segments: 3, rx: -0.12 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.cyl(g, 0.02, 0.015, 0.09, M.dark, sx * 0.33, 0.045, sz * 0.31, { radial: 8 });
      pillowAt(g, 0, 0.62, -0.18, 0, -0.2, { w: 0.38, h: 0.3, t: 0.12, color: 0xd09a3a });
      C.props.throwBlanket({ parent: g, w: 0.5, d: 0.5, material: 'knit', position: [-0.12, 0.44, 0.05], rotationY: -0.2, drapeOver: 0.3, seed: 11 });
      U.blobShadow(g, 0, 0.004, 0, 1.0, 0.95, 0.4);
      P.addCylinder(4.6, -2.75, 0.47, Y, Y + 1.0, { tag: 'furniture', name: 'loft.readingChair' });
      const cp = proxyBox(D, hidden, -0.4, 0, -0.4, 0.4, 0.95, 0.4, 'loft.chair.pick'); cp.position.set(4.6, Y + 0.475, -2.75);
      C.interact.add({ id: 'loft_chair', object: cp, label: 'Sit in the reading chair', onUse: () => C.player.sitAt(st.seats.loft_chair) });
      PR.lamp({ id: 'lamp_loft_nook', type: 'floor', position: [4.15, Y, -3.3], height: 1.5, intensity: 3.2, room: 'loft', parent: D, label: 'reading lamp', shadeColor: 0xe8d2a8 });
      P.addCylinder(4.15, -3.3, 0.18, Y, Y + 1.5, { tag: 'furniture', name: 'loft.nookLamp' });
      // little side table + mug + book
      U.cyl(S, 0.18, 0.18, 0.025, M.oak, 4.95, Y + 0.5, -3.35, { radial: 20 });
      U.cyl(S, 0.025, 0.035, 0.49, M.oak, 4.95, Y + 0.245, -3.35, { radial: 10 });
      U.cyl(S, 0.13, 0.14, 0.02, M.oak, 4.95, Y + 0.01, -3.35, { radial: 18 });
      PR.mug({ parent: S, position: [4.9, Y + 0.5125, -3.3], color: 0xc98f8a, fill: 'tea' });
      PR.bookStack({ parent: S, count: 2, position: [5.0, Y + 0.5125, -3.42], rotationY: 0.6, seed: 128 });
      P.addCylinder(4.95, -3.35, 0.19, Y, Y + 0.55, { tag: 'furniture', name: 'loft.sideTable' });
      // beanbag + floor cushions
      const bb = new THREE.SphereGeometry(0.42, 24, 16), bp = bb.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
        let yy = y * 0.58; if (y > 0.12) yy -= Math.max(0, 0.13 - Math.hypot(x + 0.06, z) * 0.35);
        bp.setXYZ(i, x * (1 + 0.08 * (y < 0 ? 1 : 0)), yy, z);
      }
      bb.computeVertexNormals(); U.worldUV(bb, 1.5);
      const bean = new THREE.Mesh(bb, M.mustard); bean.position.set(6.05, Y + 0.24, -2.33); bean.name = 'loft.beanbag'; S.add(bean);
      U.blobShadow(S, 6.05, Y + 0.004, -2.33, 1.0, 1.0, 0.45);
      P.addCylinder(6.05, -2.33, 0.4, Y, Y + 0.5, { tag: 'furniture', name: 'loft.beanbag' });
      for (const [x, z, c, r] of [[5.85, -3.35, 0x3d5a45, 0.3], [5.45, -3.5, 0xc98f8a, -0.4]]) {
        const pg = group(S, 'loft.floorCushion', x, Y + 0.06, z, r);
        C.props.pillow({ parent: pg, position: [0, 0, 0], rotation: [-PI / 2, 0, 0], w: 0.55, h: 0.55, t: 0.12, color: c });
      }
      PR.rug({ parent: S, w: 2.2, d: 1.6, style: 'kilim', position: [5.4, Y, -2.75] });
      // low bookshelf on the east wall (north of the window)
      U.boxAt(S, 6.4, Y, -3.65, 6.75, Y + 0.9, -2.62, M.oak);
      U.boxAt(S, 6.4, Y + 0.05, -3.62, 6.405, Y + 0.87, -2.65, U.stdMat(0x1f140e, 0.9));
      U.boxAt(S, 6.405, Y + 0.44, -3.62, 6.73, Y + 0.46, -2.65, M.oak);
      PR.books({ parent: S, length: 0.9, depth: 0.2, position: [6.55, Y + 0.05, -3.13], rotationY: -PI / 2, seed: 129 });
      PR.books({ parent: S, length: 0.9, depth: 0.2, position: [6.55, Y + 0.46, -3.13], rotationY: -PI / 2, seed: 130, fill: 0.75 });
      PR.plant({ parent: S, type: 'fern', position: [6.55, Y + 0.9, -3.35], scale: 0.75, seed: 131 });
      PR.candle({ parent: S, position: [6.55, Y + 0.9, -2.85], height: 0.1, radius: 0.03, holder: 'saucer' });
      addBox(6.38, Y, -3.67, 6.75, Y + 0.95, -2.6, 'lowShelf');
      // telescope on a brass tripod aimed out of the east window
      const tx = 6.2, tz = -3.05, ty = Y + 1.1;
      for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3 + 0.3; U.cyl(S, 0.01, 0.012, 1.14, M.brass, tx + Math.cos(a) * 0.16, Y + 0.55, tz + Math.sin(a) * 0.16, { rx: -Math.sin(a) * 0.28, rz: Math.cos(a) * 0.28, radial: 6 }); }
      const tg = group(S, 'loft.telescope', tx, ty, tz, 0.45);
      const tube = new THREE.Group(); tube.rotation.x = -0.35; tg.add(tube);
      U.cyl(tube, 0.045, 0.05, 0.75, M.brass, 0, 0, 0.1, { rx: PI / 2, radial: 16 });
      U.cyl(tube, 0.056, 0.056, 0.06, M.dark, 0, 0, 0.45, { rx: PI / 2, radial: 16 });
      U.cyl(tube, 0.018, 0.022, 0.12, M.dark, 0, 0, -0.32, { rx: PI / 2, radial: 10 });
      U.sphere(S, 0.03, M.brass, tx, ty, tz, { w: 10, h: 8 });
      P.addCylinder(tx, tz, 0.26, Y, Y + 1.3, { tag: 'furniture', name: 'loft.telescope' });
      // hanging pothos from the collar tie at x = 3.7
      const hx = 3.7, hz = -1.15, hy = 5.3;
      for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3; U.cyl(S, 0.003, 0.003, 1.0, M.linen, hx + Math.cos(a) * 0.06, hy + 0.5, hz + Math.sin(a) * 0.06, { rx: -Math.sin(a) * 0.12, rz: Math.cos(a) * 0.12, radial: 4 }); }
      PR.plant({ parent: S, type: 'pothos', position: [hx, hy - 0.05, hz], scale: 0.9, pot: 'basket', seed: 132 });
      PR.plant({ parent: S, type: 'fiddle', position: [6.3, Y, 3.15], scale: 0.8, seed: 133 });
      P.addCylinder(6.3, 3.15, 0.2, Y, Y + 1.2, { tag: 'furniture', name: 'loft.fiddle' });
    });

    // middle: little writing desk + stool under the south slope, framed prints
    section('middle', () => {
      const x0 = 1.5, x1 = 2.7, z0 = 2.85, z1 = 3.4;
      U.boxAt(S, x0, Y + 0.72, z0, x1, Y + 0.75, z1, M.light, { round: 0.006 });
      for (const x of [x0 + 0.04, x1 - 0.04]) for (const z of [z0 + 0.04, z1 - 0.04]) U.cyl(S, 0.018, 0.014, 0.72, M.light, x, Y + 0.36, z, { radial: 8 });
      U.boxAt(S, x0 + 0.05, Y + 0.62, z0 + 0.02, x1 - 0.05, Y + 0.72, z0 + 0.04, M.light);
      U.box(S, 0.26, 0.15, 0.13, U.stdMat(0x7a4a2a, 0.5), 2.35, Y + 0.825, 3.22, { round: 0.02 });
      U.cyl(S, 0.035, 0.035, 0.01, U.stdMat(0xd8c9a0, 0.6), 2.3, Y + 0.84, 3.155, { rx: PI / 2, radial: 16 });
      U.cyl(S, 0.004, 0.004, 0.22, M.iron, 2.44, Y + 0.95, 3.25, { rz: 0.3, radial: 5 });
      PR.plant({ parent: S, type: 'succulent', position: [1.72, Y + 0.75, 3.2], seed: 134 });
      PR.bookStack({ parent: S, count: 3, position: [1.95, Y + 0.75, 3.18], rotationY: -0.2, seed: 135 });
      PR.frame({ parent: S, position: [2.1, Y + 0.75, 3.3], rotationY: 0.2, w: 0.12, h: 0.16, seed: 136 });
      U.cyl(S, 0.17, 0.17, 0.04, M.light, 2.05, Y + 0.46, 2.55, { radial: 20 });
      for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3; U.cyl(S, 0.014, 0.016, 0.46, M.light, 2.05 + Math.cos(a) * 0.12, Y + 0.225, 2.55 + Math.sin(a) * 0.12, { rx: -Math.sin(a) * 0.1, rz: Math.cos(a) * 0.1, radial: 6 }); }
      addBox(x0, Y, z0, x1, Y + 0.8, z1, 'writingDesk');
      P.addCylinder(2.05, 2.55, 0.2, Y, Y + 0.5, { tag: 'furniture', name: 'loft.stool' });
      PR.rug({ parent: S, w: 2.2, d: 2.2, style: 'persian', round: true, position: [2.2, Y, 0.0] });
    });

    C.loft = {
      catSpots: [
        { name: 'loft_bed', position: [-5.1, Y + 0.585, 0.35], rotationY: 0.4 },
        { name: 'beanbag', position: [6.05, Y + 0.42, -2.33], rotationY: 1.0 },
      ],
      seats: st.seats,
      stringLights: st.stringApi,
    };
    U.bakeStatic(S);
    st.ready = !!st.stringLights;

    function mergeAll(list) {
      const base = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; });
      let count = 0; for (const g of base) count += g.attributes.position.count;
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
      let o = 0;
      for (const g of base) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.computeBoundingSphere();
      return out;
    }
  },

  update(dt, t, C) {
    if (!st.ready) return;
    // from the ground floor the loft is only visible up the stairwell (hall / stairs)
    const cp = C.camera.position;
    st.S.visible = !(cp.x > -7 && cp.x < 7 && cp.z > -5 && cp.z < 5) || cp.y > 2.2 || (cp.x > 2.0 && cp.z > -0.75);
    const want = st.stringOn ? 1 : 0;
    if (st.stringLevel !== want) {
      st.stringLevel += Math.sign(want - st.stringLevel) * Math.min(Math.abs(want - st.stringLevel), dt / 0.2);
    }
    const k = st.stringLevel;
    for (let i = 0; i < st.bulbMats.length; i++) st.bulbMats[i].emissiveIntensity = k * (0.8 + 0.3 * Math.sin(t * (0.9 + i * 0.37) + i * 2.1));
    for (let i = 0; i < st.stringLights.length; i++) st.stringLights[i].intensity = STRING_CD * k * (0.94 + 0.06 * Math.sin(t * 1.1 + i));
  },
});

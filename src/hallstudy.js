// =====================================================================================================================
//  HALL + STUDY — module "hallstudy", order 60.  (SPEC §4.3, §8, §9 hallstudy)
//  Hall: grandfather clock (swinging pendulum, real-time hands, chime), console table + lamp + key bowl + mirror,
//  coat pegs with coats / scarf / hat, bench under the hall window with wellies, umbrella stand dripping into a tray,
//  runner rug, plant, pictures.
//  Study: desk under w_study_n (typewriter, open journal, ink, papers, banker's lamp), captain's desk chair,
//  floor-to-ceiling bookshelves on P1, leather reading chair by the east window, globe, map chest, framed maps,
//  kilim rug, plants, cat bed.
//  Interactables: clock, lamp_hall, lamp_study_desk, desk_chair.  Lights: lamp_hall (Point 4 cd), lamp_study_desk
//  (Spot 7 cd).  Exposes C.hallstudy = { catBed, seat }.
// =====================================================================================================================
import * as THREE from 'three';

const C = window.COZY;
const PI = Math.PI;
const CLOCK_PHRASES = ['Time for another cup of tea.', 'The rain shows no sign of stopping.', 'No need to be anywhere.',
  'Just right for a nap by the fire.', 'The cat would say it is dinner time.', 'The afternoon is stretching out nicely.'];

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

// tall bookshelf in local space: back at z = 0, front at z = D, facing +Z; `slots(level, bay)` may return decor
function buildShelves(parent, M, x, z, ry, W, D, H, levels, bays, seed, decor) {
  const U = C.util, P = C.props;
  const g = group(parent, 'hallstudy.shelves', x, 0, z, ry);
  const t = 0.03, wood = M.dark;
  U.boxAt(g, -W / 2, 0, 0, -W / 2 + t, H, D, wood);
  U.boxAt(g, W / 2 - t, 0, 0, W / 2, H, D, wood);
  U.boxAt(g, -W / 2 - 0.02, H, 0, W / 2 + 0.02, H + 0.05, D + 0.03, wood, { round: 0.008 });
  U.boxAt(g, -W / 2 + t, 0, D - 0.025, W / 2 - t, 0.09, D - 0.005, wood);
  U.boxAt(g, -W / 2 + t, 0.09, 0, W / 2 - t, H, 0.012, M.oak);
  const bw = (W - 2 * t - (bays - 1) * 0.025) / bays;
  for (let b = 1; b < bays; b++) { const cx = -W / 2 + t + b * bw + (b - 0.5) * 0.025; U.boxAt(g, cx - 0.0125, 0.09, 0.012, cx + 0.0125, H, D, wood); }
  for (const y of levels) U.boxAt(g, -W / 2 + t, y, 0.012, W / 2 - t, y + 0.025, D, wood);
  let k = 0;
  for (let li = 0; li < levels.length; li++) for (let b = 0; b < bays; b++) {
    const y = levels[li] + 0.025, cx = -W / 2 + t + b * (bw + 0.025) + bw / 2;
    const d = decor && decor(li, b);
    if (d) {
      P.books({ parent: g, length: bw * 0.55, depth: 0.2, position: [cx - bw * 0.2, y, D - 0.13], seed: seed * 31 + (k++) });
      const px = cx + bw * 0.3, pz = D * 0.55;
      if (d === 'plant') P.plant({ parent: g, type: 'succulent', position: [px, y, pz], seed: seed + k });
      else if (d === 'frame') P.frame({ parent: g, position: [px, y, pz], rotationY: -0.2, w: 0.12, h: 0.16, seed: seed + k });
      else if (d === 'stack') P.bookStack({ parent: g, count: 3, position: [px, y, pz], rotationY: 0.3, seed: seed + k });
      else if (d === 'vase') P.vase({ parent: g, position: [px, y, pz], flowers: false, height: 0.18, shape: 'bottle', color: 0x7a8f6a, seed: seed + k });
      else if (d === 'candle') P.candle({ parent: g, position: [px, y, pz], height: 0.1, radius: 0.03, holder: 'saucer' });
    } else {
      P.books({ parent: g, length: bw - 0.03, depth: 0.2, position: [cx, y, D - 0.13], seed: seed * 31 + (k++), fill: 0.82 + ((k * 37) % 17) / 100 });
    }
  }
  U.blobShadow(g, 0, 0, D * 0.5, W + 0.15, D + 0.2, 0.35);
  return g;
}

C.register({
  name: 'hallstudy',
  order: 60,
  init(C) {
    const U = C.util, P = C.physics, PR = C.props;
    const root = new THREE.Group(); root.name = 'hallstudy';
    C.scene.add(root);
    const S = new THREE.Group(); S.name = 'hallstudy.static'; root.add(S);
    st.S = S;
    const D = new THREE.Group(); D.name = 'hallstudy.dynamic'; D.userData.dynamic = true; root.add(D);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const section = (name, fn) => {
      try { fn(); } catch (e) {
        C.debug.errors.push({ module: 'hallstudy', phase: 'init:' + name, message: e.message, stack: String(e.stack || '').slice(0, 1500) });
        console.error(`[hallstudy] ${name} failed: ${e.message}`);
      }
    };
    const M = {
      dark: C.mat('woodDark'), oak: C.mat('woodMedium'), light: C.mat('woodLight'), cream: C.mat('woodPainted'), brass: C.mat('brass'),
      iron: C.mat('ironBlack'), chrome: C.mat('chrome'), ceramic: C.mat('ceramic'), blue: C.mat('ceramicBlue'), paper: C.mat('paper'),
      leather: C.mat('leather'), navy: C.mat('fabricBlue'), rose: C.mat('fabricRose'), green: C.mat('fabricGreen'), cream2: C.mat('fabricCream'),
      knit: C.mat('knit'), glass: C.mat('glassClear'),
      slicker: U.stdMat(0xd9a52e, 0.38, 0), welly: U.stdMat(0x2f4a36, 0.32, 0), wellyY: U.stdMat(0xd9a52e, 0.32, 0),
      water: U.stdMat(0x9fb4bc, 0.04, 0.1, { transparent: true, opacity: 0.55, depthWrite: false }),
      inkGlass: U.stdMat(0x1b2230, 0.08, 0.1), typer: U.stdMat(0x1d1f22, 0.3, 0.35), keyCap: U.stdMat(0xe9e2d0, 0.4, 0),
    };
    const addBox = (x0, y0, z0, x1, y1, z1, name) => P.addBox([x0, y0, z0], [x1, y1, z1], { tag: 'furniture', name: 'hallstudy.' + name });

    // -------------------------------------------------------------------------------------------------------------
    // Grandfather clock at (2.25, 0, −0.3) against P1, facing +X
    // -------------------------------------------------------------------------------------------------------------
    section('clock', () => {
      const g = group(S, 'hallstudy.grandfatherClock', 2.25, 0, -0.3, PI / 2);
      const w = M.dark;
      U.box(g, 0.5, 0.42, 0.3, w, 0, 0.21, 0, { round: 0.01 });
      U.box(g, 0.54, 0.05, 0.33, w, 0, 0.44, 0.005, { round: 0.012 });
      // hollow trunk so the pendulum shows through the glass door
      U.box(g, 0.4, 1.02, 0.02, w, 0, 0.97, -0.125);
      for (const s of [-1, 1]) U.box(g, 0.03, 1.02, 0.25, w, s * 0.185, 0.97, -0.01);
      U.box(g, 0.4, 0.1, 0.25, w, 0, 0.51, -0.01);
      U.box(g, 0.4, 0.08, 0.25, w, 0, 1.44, -0.01);
      U.box(g, 0.5, 0.05, 0.31, w, 0, 1.5, 0, { round: 0.012 });
      U.box(g, 0.48, 0.52, 0.29, w, 0, 1.78, 0, { round: 0.01 });
      U.box(g, 0.54, 0.06, 0.33, w, 0, 2.07, 0.005, { round: 0.015 });
      const bonnet = new THREE.Shape();
      bonnet.moveTo(-0.26, 0); bonnet.lineTo(0.26, 0); bonnet.lineTo(0.26, 0.05);
      bonnet.quadraticCurveTo(0.14, 0.05, 0.08, 0.14); bonnet.quadraticCurveTo(0, 0.2, -0.08, 0.14); bonnet.quadraticCurveTo(-0.14, 0.05, -0.26, 0.05);
      const bg = new THREE.ExtrudeGeometry(bonnet, { depth: 0.3, bevelEnabled: false });
      bg.translate(0, 2.1, -0.15); U.worldUV(bg, 1);
      const bm = new THREE.Mesh(bg, w); g.add(bm);
      for (const sx of [-0.23, 0, 0.23]) U.sphere(g, 0.025, M.brass, sx, sx ? 2.19 : 2.34, 0.1, { w: 10, h: 8 });
      // dial (real time hands are dynamic)
      const face = U.canvasTexture(256, 256, (ctx, W, H) => {
        ctx.fillStyle = '#efe4c8'; ctx.fillRect(0, 0, W, H);
        const gr = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 140); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(90,60,20,0.35)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W / 2, H / 2, 112, 0, PI * 2); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(W / 2, H / 2, 86, 0, PI * 2); ctx.stroke();
        ctx.fillStyle = '#2a1d12'; ctx.font = 'bold 22px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
        for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; ctx.fillText(R[i], W / 2 + Math.sin(a) * 99, H / 2 - Math.cos(a) * 99); }
        for (let i = 0; i < 60; i++) { const a = i / 60 * PI * 2; ctx.fillRect(W / 2 + Math.sin(a) * 84 - 1, H / 2 - Math.cos(a) * 84 - 1, 2, 2); }
        ctx.font = 'italic 13px Georgia'; ctx.fillText('Hartley & Sons', W / 2, H / 2 + 42);
      }, { wrap: false });
      const dialMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.6 });
      dialMat.name = 'hallstudy.dial';
      const dial = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), dialMat);
      dial.position.set(0, 1.8, 0.146); g.add(dial);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.012, 8, 40), M.brass);
      ring.position.set(0, 1.8, 0.148); g.add(ring);
      const dg = group(D, 'hallstudy.clockDynamic', 2.25, 0, -0.3, PI / 2);
      const hand = (len, wid) => { const p = new THREE.Group(); p.position.set(0, 1.8, 0.153); dg.add(p); U.box(p, wid, len, 0.004, M.iron, 0, len / 2 - 0.02, 0); return p; };
      st.hourHand = hand(0.1, 0.012); st.minHand = hand(0.145, 0.008);
      U.sphere(dg, 0.01, M.brass, 0, 1.8, 0.158, { w: 8, h: 6 });
      // pendulum behind the glass trunk door
      const pend = new THREE.Group(); pend.position.set(0, 1.44, 0.02); dg.add(pend);
      U.box(pend, 0.012, 0.72, 0.006, M.brass, 0, -0.36, 0);
      U.cyl(pend, 0.07, 0.07, 0.014, M.brass, 0, -0.74, 0, { rx: PI / 2, radial: 28 });
      st.pendulum = pend;
      const glassDoor = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.82), M.glass);
      glassDoor.position.set(0, 0.98, 0.117); glassDoor.name = 'hallstudy.clockGlass'; dg.add(glassDoor);
      U.box(g, 0.32, 0.03, 0.012, w, 0, 0.56, 0.118); U.box(g, 0.32, 0.03, 0.012, w, 0, 1.4, 0.118);
      U.box(g, 0.03, 0.84, 0.012, w, -0.155, 0.98, 0.118); U.box(g, 0.03, 0.84, 0.012, w, 0.155, 0.98, 0.118);
      U.box(g, 0.3, 0.86, 0.01, U.stdMat(0x1a120c, 0.8), 0, 0.98, -0.12);
      U.blobShadow(S, 2.25, 0.004, -0.3, 0.45, 0.65, 0.45);
      addBox(2.075, 0, -0.57, 2.42, 2.4, -0.03, 'clock');
      const tellTime = () => {
        const d = new Date(), h = d.getHours(), m = d.getMinutes();
        const hh = ((h + 11) % 12) + 1, mm = String(m).padStart(2, '0');
        C.hud.toast(`It's ${hh}:${mm} ${h < 12 ? 'in the morning' : h < 18 ? 'in the afternoon' : 'in the evening'}. ${CLOCK_PHRASES[(h * 7 + m) % CLOCK_PHRASES.length]}`, 4);
        C.audio.play('chime', { x: 2.35, y: 1.8, z: -0.3 });
      };
      C.interact.add({ id: 'clock', object: proxyBox(D, hidden, 2.1, 0, -0.56, 2.42, 2.4, -0.04, 'hallstudy.clock.pick'), label: 'Check the time', onUse: tellTime });
      st.lastSec = -1;
    });

    // -------------------------------------------------------------------------------------------------------------
    // Hall: console + lamp + mirror, coat pegs, bench + wellies, umbrella stand + drips, runner, plant, pictures
    // -------------------------------------------------------------------------------------------------------------
    section('console', () => {
      const x0 = 2.08, x1 = 2.42, z0 = 0.55, z1 = 1.28;
      U.boxAt(S, x0, 0.76, z0, x1, 0.8, z1, M.oak, { round: 0.008 });
      U.boxAt(S, x0 + 0.02, 0.66, z0 + 0.03, x1 - 0.02, 0.76, z1 - 0.03, M.oak);
      U.boxAt(S, x1 - 0.021, 0.68, (z0 + z1) / 2 - 0.15, x1 - 0.017, 0.74, (z0 + z1) / 2 + 0.15, M.dark);
      U.sphere(S, 0.012, M.brass, x1 - 0.012, 0.71, (z0 + z1) / 2, { w: 8, h: 6 });
      for (const x of [x0 + 0.04, x1 - 0.04]) for (const z of [z0 + 0.04, z1 - 0.04]) U.cyl(S, 0.016, 0.012, 0.66, M.oak, x, 0.33, z, { radial: 8 });
      U.boxAt(S, x0 + 0.04, 0.14, z0 + 0.04, x1 - 0.04, 0.16, z1 - 0.04, M.oak);
      PR.basket({ parent: S, position: [(x0 + x1) / 2, 0.16, 0.8], radius: 0.12, height: 0.12, oval: 0.9, contents: 'none' });
      PR.lamp({ id: 'lamp_hall', type: 'table', position: [2.24, 0.8, 1.08], height: 0.55, intensity: 4, bodyColor: 0x4f6d9a, room: 'hall', parent: D, label: 'hall lamp' });
      U.lathe(S, [[0, 0], [0.04, 0], [0.085, 0.03], [0.095, 0.05], [0.088, 0.052], [0.075, 0.035], [0, 0.008]], M.blue, 2.26, 0.8, 0.72, { segments: 24 });
      for (const [dx, dz, r] of [[0.01, 0.0, 0.3], [-0.02, 0.02, 1.2]]) U.boxAt(S, 2.26 + dx - 0.004, 0.81, 0.72 + dz - 0.025, 2.26 + dx + 0.004, 0.814, 0.72 + dz + 0.025, M.brass, { ry: r });
      U.box(S, 0.2, 0.004, 0.14, M.paper, 2.26, 0.803, 0.9, { ry: 0.3 });
      U.box(S, 0.18, 0.004, 0.12, U.stdMat(0xe8d7b0, 0.9), 2.27, 0.807, 0.92, { ry: 0.1 });
      // antique mirror (painted reflection: there is no env map to reflect)
      const mirTex = U.canvasTexture(128, 256, (ctx, w, h) => {
        const gr = ctx.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#8d8676'); gr.addColorStop(0.45, '#5d584e'); gr.addColorStop(1, '#3c3830');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
        const hl = ctx.createLinearGradient(0, 0, w, 0); hl.addColorStop(0.2, 'rgba(255,240,210,0)'); hl.addColorStop(0.35, 'rgba(255,240,210,0.22)'); hl.addColorStop(0.5, 'rgba(255,240,210,0)');
        ctx.fillStyle = hl; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,200,120,0.18)'; ctx.beginPath(); ctx.ellipse(w * 0.62, h * 0.72, 16, 22, 0, 0, PI * 2); ctx.fill();
        const r = U.rng(5); for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(40,30,20,${0.05 + r() * 0.1})`; const x = r() < 0.5 ? r() * 18 : w - r() * 18; ctx.fillRect(x, r() * h, 2 + r() * 4, 2 + r() * 4); }
      }, { wrap: false });
      const mirMat = new THREE.MeshStandardMaterial({ map: mirTex, roughness: 0.12, metalness: 0.2 });
      mirMat.name = 'hallstudy.mirror';
      const mg = group(S, 'hallstudy.mirror', 2.075, 1.55, 0.92, PI / 2);
      U.box(mg, 0.5, 0.72, 0.03, M.brass, 0, 0, 0.015, { round: 0.008 });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.64), mirMat); glass.position.z = 0.031; mg.add(glass);
      U.blobShadow(S, 2.25, 0.004, 0.92, 0.45, 0.85, 0.35);
      addBox(x0, 0, z0, x1 + 0.02, 0.85, z1, 'console');
    });

    section('coats', () => {
      U.boxAt(S, 2.075, 1.62, 2.75, 2.1, 1.72, 3.9, M.dark, { round: 0.006 });
      const pegs = [2.9, 3.18, 3.46, 3.74];
      for (const z of pegs) { U.cyl(S, 0.012, 0.015, 0.09, M.brass, 2.14, 1.67, z, { rz: PI / 2 - 0.3, radial: 8 }); U.sphere(S, 0.017, M.brass, 2.18, 1.69, z, { w: 8, h: 6 }); }
      const coat = (z, mat, len, wid, lean) => {
        const g = group(S, 'hallstudy.coat', 2.2, 1.67, z, PI / 2);
        g.rotation.z = lean;
        U.box(g, wid, 0.1, 0.13, mat, 0, -0.07, 0, { round: 0.045, segments: 3 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(wid * 0.47, wid * 0.6, len, 12, 1), mat);
        body.scale.z = 0.32; body.position.y = -0.1 - len / 2; g.add(body);
        U.box(g, 0.012, len * 0.9, 0.01, U.stdMat(0x2a2016, 0.8), 0, -0.12 - len * 0.45, wid * 0.19);
        for (const s of [-1, 1]) {
          const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, len * 0.72, 8), mat);
          sl.position.set(s * wid * 0.45, -0.12 - len * 0.36, 0); sl.rotation.z = s * 0.1; g.add(sl);
        }
      };
      coat(2.9, M.slicker, 0.95, 0.46, 0.02);
      coat(3.18, M.navy, 1.05, 0.44, -0.02);
      // scarf hanging from a peg, hat on the last peg
      U.box(S, 0.03, 0.8, 0.16, M.rose, 2.19, 1.28, 3.46, { round: 0.012, rz: 0.03 });
      U.box(S, 0.03, 0.6, 0.15, M.rose, 2.22, 1.36, 3.53, { round: 0.012, rz: -0.05, rx: 0.08 });
      const hat = group(S, 'hallstudy.hat', 2.21, 1.66, 3.74, 0);
      hat.rotation.z = 0.5;
      U.cyl(hat, 0.15, 0.15, 0.012, C.mat('fabricChair'), 0, 0, 0, { radial: 24 });
      U.cyl(hat, 0.085, 0.095, 0.1, C.mat('fabricChair'), 0, 0.055, 0, { radial: 20 });
      U.cyl(hat, 0.096, 0.096, 0.022, M.navy, 0, 0.02, 0, { radial: 20 });
      addBox(2.075, 0.9, 2.72, 2.45, 1.75, 3.9, 'coats');
    });

    section('bench', () => {
      const x0 = 2.15, x1 = 3.05, z0 = 4.36, z1 = 4.73;
      U.boxAt(S, x0, 0.42, z0, x1, 0.46, z1, M.oak, { round: 0.008 });
      for (const x of [x0 + 0.04, x1 - 0.06]) U.boxAt(S, x, 0, z0 + 0.02, x + 0.03, 0.42, z1 - 0.02, M.oak);
      U.boxAt(S, x0 + 0.04, 0.12, z0 + 0.03, x1 - 0.04, 0.14, z1 - 0.03, M.oak);
      U.box(S, 0.86, 0.05, 0.34, M.green, (x0 + x1) / 2, 0.485, (z0 + z1) / 2, { round: 0.02, segments: 2 });
      PR.basket({ parent: S, position: [2.85, 0.51, 4.55], radius: 0.12, height: 0.12, oval: 0.85, contents: 'yarn' });
      U.box(S, 0.24, 0.05, 0.2, M.knit, 2.4, 0.535, 4.55, { round: 0.02, ry: 0.2 });
      // wellies on a boot tray
      U.boxAt(S, 2.2, 0, 4.0, 2.98, 0.015, 4.33, U.stdMat(0x2a2a2a, 0.5, 0.2));
      const boot = (x, z, ry, mat, slump) => {
        const g = group(S, 'hallstudy.welly', x, 0.015, z, ry);
        U.box(g, 0.1, 0.07, 0.25, mat, 0, 0.035, 0.04, { round: 0.03, segments: 2 });
        U.cyl(g, 0.052, 0.058, 0.3, mat, 0, 0.2, -0.03, { radial: 14, rx: slump || 0 });
        U.cyl(g, 0.056, 0.056, 0.015, mat, 0, 0.35, -0.03 - (slump || 0) * 0.15, { radial: 14, open: true });
      };
      boot(2.33, 4.14, 0.1, M.welly); boot(2.47, 4.16, -0.05, M.welly, 0.25);
      boot(2.7, 4.15, 0.2, M.wellyY); boot(2.84, 4.18, 0.05, M.wellyY);
      addBox(x0, 0, z0, x1, 0.5, z1, 'bench');
    });

    section('umbrella', () => {
      const ux = 2.28, uz = 4.08;
      U.boxAt(S, ux - 0.2, 0, uz - 0.19, ux + 0.2, 0.012, uz + 0.19, M.brass, { round: 0.004 });
      for (const [a, b, c, d] of [[-0.2, -0.19, 0.2, -0.18], [-0.2, 0.18, 0.2, 0.19], [-0.2, -0.19, -0.19, 0.19], [0.19, -0.19, 0.2, 0.19]]) U.boxAt(S, ux + a, 0, uz + b, ux + c, 0.03, uz + d, M.brass);
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), M.water);
      puddle.rotation.x = -PI / 2; puddle.position.set(ux + 0.03, 0.014, uz + 0.02); puddle.scale.set(1.1, 0.8, 1); puddle.renderOrder = 2;
      D.add(puddle);
      U.lathe(S, [[0, 0.012], [0.1, 0.012], [0.11, 0.05], [0.115, 0.46], [0.122, 0.5], [0.105, 0.5], [0.1, 0.06], [0, 0.06]], M.blue, ux - 0.04, 0, uz - 0.03, { segments: 24 });
      // furled umbrella leaning in the stand
      const ug = group(S, 'hallstudy.umbrella', ux - 0.04, 0.06, uz - 0.03, 0.4);
      ug.rotation.z = 0.12;
      U.cyl(ug, 0.006, 0.006, 0.82, M.iron, 0, 0.41, 0, { radial: 6 });
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.055, 0.58, 8, 1), U.stdMat(0x2f3d5a, 0.25, 0));
      canopy.position.y = 0.52; ug.add(canopy);
      const crook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 14, PI), M.dark);
      crook.position.set(0.045, 0.82, 0); crook.rotation.z = 0; ug.add(crook);
      // drips: fall from the canopy edge into the puddle, expanding ripple on impact
      st.drips = [];
      const dropMat = U.stdMat(0xd8e6ea, 0.03, 0.1, { transparent: true, opacity: 0.75, depthWrite: false });
      const dropGeo = new THREE.SphereGeometry(0.006, 8, 6); dropGeo.scale(1, 1.7, 1);
      for (let i = 0; i < 3; i++) {
        const drop = new THREE.Mesh(dropGeo, dropMat); drop.renderOrder = 3; D.add(drop);
        const rm = new THREE.MeshBasicMaterial({ color: 0xe8f0f2, transparent: true, opacity: 0, depthWrite: false });
        const ripple = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 24), rm);
        ripple.rotation.x = -PI / 2; ripple.renderOrder = 3; D.add(ripple);
        const a = 0.6 + i * 2.1;
        st.drips.push({ drop, ripple, x: ux + Math.cos(a) * 0.075, z: uz + Math.sin(a) * 0.075 + 0.02, period: 1.7 + i * 0.63, phase: i * 0.71, y0: 0.5 });
      }
      P.addCylinder(ux - 0.04, uz - 0.03, 0.16, 0, 0.9, { tag: 'furniture', name: 'hallstudy.umbrellaStand' });
    });

    section('hallDecor', () => {
      PR.rug({ parent: S, w: 0.9, d: 3.3, style: 'runner', position: [3.75, 0, 2.05] });
      PR.plant({ parent: S, type: 'fiddle', position: [5.0, 0, 4.35], scale: 0.85, seed: 101 });
      P.addCylinder(5.0, 4.35, 0.22, 0, 1.3, { tag: 'furniture', name: 'hallstudy.hallPlant' });
      PR.painting({ parent: S, width: 0.55, height: 0.42, style: 'landscape', frame: 'gold', position: [4.5, 1.62, -0.625], rotationY: 0, seed: 102 });
      PR.painting({ parent: S, width: 0.3, height: 0.38, style: 'portrait', frame: 'black', position: [4.95, 1.65, 4.75], rotationY: PI, seed: 103 });
      // P1 east face between the coat pegs (end z 3.9) and the south wall — z 1.4→2.6 is the open D1 archway
      PR.painting({ parent: S, width: 0.46, height: 0.34, style: 'cottage', frame: 'white', position: [2.075, 1.62, 4.28], rotationY: PI / 2, seed: 104 });
    });

    // -------------------------------------------------------------------------------------------------------------
    // Study
    // -------------------------------------------------------------------------------------------------------------
    section('desk', () => {
      const x0 = 3.42, x1 = 5.18, z0 = -4.75, z1 = -4.05, top = 0.76;
      U.boxAt(S, x0, top - 0.035, z0, x1, top, z1, M.dark, { round: 0.008 });
      U.boxAt(S, x0 + 0.08, top, z0 + 0.06, x1 - 0.08, top + 0.003, z1 - 0.05, U.stdMat(0x2f4a36, 0.55, 0));
      for (const [a, b] of [[x0 + 0.02, x0 + 0.47], [x1 - 0.47, x1 - 0.02]]) {
        U.boxAt(S, a, 0.04, z0 + 0.02, b, top - 0.035, z1 - 0.02, M.dark);
        for (let i = 0; i < 3; i++) {
          const y0 = 0.07 + i * 0.21;
          U.boxAt(S, a + 0.02, y0, z1 - 0.02, b - 0.02, y0 + 0.19, z1 - 0.006, M.oak, { round: 0.004 });
          U.boxAt(S, (a + b) / 2 - 0.045, y0 + 0.09, z1 - 0.006, (a + b) / 2 + 0.045, y0 + 0.105, z1 + 0.01, M.brass);
        }
      }
      U.boxAt(S, x0 + 0.47, top - 0.12, z1 - 0.03, x1 - 0.47, top - 0.035, z1 - 0.01, M.oak);
      U.boxAt(S, x0 + 0.47, 0.1, z0 + 0.02, x1 - 0.47, top - 0.035, z0 + 0.04, M.dark);
      U.blobShadow(S, (x0 + x1) / 2, 0.004, (z0 + z1) / 2, 2.0, 0.9, 0.4);
      // typewriter
      const tw = group(S, 'hallstudy.typewriter', 4.22, top + 0.003, -4.36, 0.12);
      U.box(tw, 0.32, 0.07, 0.24, M.typer, 0, 0.035, 0, { round: 0.02 });
      U.box(tw, 0.36, 0.05, 0.08, M.typer, 0, 0.1, -0.07, { round: 0.02 });
      U.cyl(tw, 0.022, 0.022, 0.4, M.typer, 0, 0.135, -0.07, { rz: PI / 2, radial: 14 });
      for (const s of [-1, 1]) U.cyl(tw, 0.018, 0.018, 0.02, M.chrome, s * 0.21, 0.135, -0.07, { rz: PI / 2, radial: 12 });
      U.box(tw, 0.012, 0.012, 0.09, M.chrome, -0.2, 0.15, -0.03, { ry: 0.3 });
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.24), M.paper);
      sheet.position.set(0, 0.25, -0.095); sheet.rotation.x = -0.18; tw.add(sheet);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 10 - (r === 3 ? 3 : 0); c++) {
        U.cyl(tw, 0.009, 0.009, 0.008, M.keyCap, -0.12 + c * 0.026 + r * 0.008 + (r === 3 ? 0.04 : 0), 0.078 + r * 0.012, 0.09 - r * 0.028, { radial: 8, rx: -0.35 });
      }
      U.box(tw, 0.14, 0.008, 0.02, M.keyCap, 0, 0.07, 0.11, { round: 0.003 });
      // open journal with handwriting, fountain pen, ink, papers
      const pageTex = U.canvasTexture(256, 180, (ctx, w, h) => {
        ctx.fillStyle = '#f1e7cf'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(120,140,170,0.35)'; for (let y = 20; y < h; y += 12) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(30,40,70,0.8)'; ctx.lineWidth = 1.1;
        const r = U.rng(9);
        for (let y = 18; y < h - 20; y += 12) {
          let x = 14 + (y % 36 === 18 ? 10 : 0); const end = w / 2 - 12 - r() * 40;
          ctx.beginPath(); ctx.moveTo(x, y);
          while (x < end) { x += 2 + r() * 3; ctx.lineTo(x, y - 2 - r() * 5 + 3); }
          ctx.stroke();
          if (y < h - 60) { x = w / 2 + 12; const e2 = w - 14 - r() * 30; ctx.beginPath(); ctx.moveTo(x, y); while (x < e2) { x += 2 + r() * 3; ctx.lineTo(x, y - 2 - r() * 5 + 3); } ctx.stroke(); }
        }
        ctx.fillStyle = 'rgba(80,50,20,0.25)'; ctx.fillRect(w / 2 - 2, 0, 4, h);
      }, { wrap: false });
      const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 }); pageMat.name = 'hallstudy.journal';
      const jg = group(S, 'hallstudy.journal', 3.75, top + 0.004, -4.28, -0.25);
      U.box(jg, 0.34, 0.012, 0.24, U.stdMat(0x6b3f24, 0.6), 0, 0.006, 0, { round: 0.004 });
      for (const s of [-1, 1]) {
        const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), pageMat);
        pg.rotation.x = -PI / 2; pg.rotation.y = s * 0.06; pg.position.set(s * 0.082, 0.02, 0); jg.add(pg);
        pg.geometry = pg.geometry.clone();
        const uv = pg.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, s < 0 ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
      }
      U.cyl(jg, 0.006, 0.006, 0.14, U.stdMat(0x1a1a1a, 0.3, 0.4), 0.05, 0.03, 0.06, { rz: PI / 2, ry: 0.5, radial: 8 });
      U.cyl(S, 0.028, 0.03, 0.05, M.inkGlass, 3.6, top + 0.028, -4.55, { radial: 12 });
      U.cyl(S, 0.014, 0.014, 0.02, M.iron, 3.6, top + 0.063, -4.55, { radial: 10 });
      const pr = U.rng(17);
      for (let i = 0; i < 5; i++) U.box(S, 0.21, 0.002, 0.29, i % 2 ? M.paper : U.stdMat(0xebdfc4, 0.9), 4.72 + pr() * 0.1, top + 0.004 + i * 0.002, -4.35 + pr() * 0.08, { ry: (pr() - 0.5) * 0.6 });
      const ball = new THREE.IcosahedronGeometry(0.03, 1), bp = ball.attributes.position;
      for (let i = 0; i < bp.count; i++) { const s = 0.75 + pr() * 0.45; bp.setXYZ(i, bp.getX(i) * s, bp.getY(i) * s, bp.getZ(i) * s); }
      ball.computeVertexNormals();
      const bm = new THREE.Mesh(ball, M.paper); bm.position.set(3.95, top + 0.028, -4.14); S.add(bm);
      PR.mug({ parent: S, position: [4.62, top, -4.62], color: 0x4f6d9a, fill: 'none' });
      for (let i = 0; i < 4; i++) U.cyl(S, 0.004, 0.004, 0.17, [M.brass, U.stdMat(0xd9b53a, 0.6), U.stdMat(0x3d6b8c, 0.6), M.dark][i], 4.62 + (i - 1.5) * 0.012, top + 0.1, -4.62 + (i % 2) * 0.01, { rz: (i - 1.5) * 0.08, radial: 6 });
      PR.bookStack({ parent: S, count: 4, position: [3.55, top, -4.6], rotationY: 0.15, seed: 105 });
      PR.lamp({ id: 'lamp_study_desk', type: 'desk', position: [4.95, top, -4.55], rotationY: -0.15, intensity: 7, room: 'study', parent: D, label: 'desk lamp' });
      addBox(x0, 0, z0, x1, 0.85, z1 + 0.02, 'desk');

      // captain's chair at the desk (sitter faces −Z)
      const cg = group(S, 'hallstudy.deskChair', 4.3, 0, -3.62, PI);
      U.cyl(cg, 0.23, 0.22, 0.045, M.oak, 0, 0.46, 0, { radial: 24 });
      U.cyl(cg, 0.2, 0.2, 0.035, M.leather, 0, 0.5, 0.01, { radial: 24 });
      for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2; U.cyl(cg, 0.017, 0.022, 0.46, M.oak, Math.cos(a) * 0.17, 0.23, Math.sin(a) * 0.17, { rx: -Math.sin(a) * 0.08, rz: Math.cos(a) * 0.08, radial: 8 }); }
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 24, PI * 1.1), M.oak);
      rail.rotation.x = PI / 2; rail.rotation.z = PI - PI * 0.05; rail.position.y = 0.75; cg.add(rail);
      for (let i = 0; i < 7; i++) { const a = PI + PI * 0.12 + i * (PI * 0.76 / 6); U.cyl(cg, 0.008, 0.009, 0.27, M.oak, Math.cos(a) * 0.21, 0.615, Math.sin(a) * 0.21, { radial: 6 }); }
      U.blobShadow(cg, 0, 0, 0, 0.6, 0.6, 0.3);
      addBox(4.05, 0, -3.87, 4.55, 0.95, -3.37, 'deskChair');
      st.seat = { id: 'desk_chair', position: [4.3, 1.14, -3.66], yaw: 0, pitch: -0.4, yawRange: 1.3, pitchMin: -1.0, pitchMax: 0.8, exit: [4.3, 0, -2.95], label: 'Stand up' };
      C.interact.add({ id: 'desk_chair', object: proxyBox(D, hidden, 4.06, 0, -3.86, 4.54, 0.95, -3.38, 'hallstudy.deskChair.pick'), label: 'Sit at the desk', onUse: () => C.player.sitAt(st.seat) });
    });

    section('shelves', () => {
      const levels = [0.09, 0.47, 0.85, 1.23, 1.61, 1.99, 2.37];
      const decorA = (l, b) => ({ '2,1': 'plant', '4,0': 'frame', '5,1': 'stack', '1,0': 'vase' })[l + ',' + b];
      const decorB = (l, b) => ({ '3,1': 'candle', '5,0': 'plant', '2,0': 'stack' })[l + ',' + b];
      buildShelves(S, M, 2.075, -4.0, PI / 2, 1.44, 0.32, 2.72, levels, 2, 7, decorA);
      addBox(2.075, 0, -4.75, 2.42, 2.8, -3.25, 'shelvesA');
      buildShelves(S, M, 2.075, -1.42, PI / 2, 1.16, 0.32, 2.72, levels, 2, 8, decorB);
      addBox(2.075, 0, -2.03, 2.42, 2.8, -0.8, 'shelvesB');
    });

    section('reading', () => {
      // leather club chair by the east window, facing into the room
      const g = group(S, 'hallstudy.readingChair', 5.95, 0, -2.25, -PI / 2 - 0.5);
      const L = M.leather;
      U.box(g, 0.84, 0.24, 0.8, L, 0, 0.2, 0, { round: 0.05, segments: 3 });
      U.box(g, 0.56, 0.12, 0.6, L, 0, 0.37, 0.07, { round: 0.05, segments: 3 });
      for (const s of [-1, 1]) U.box(g, 0.15, 0.36, 0.78, L, s * 0.345, 0.4, 0.01, { round: 0.07, segments: 3 });
      U.box(g, 0.78, 0.48, 0.16, L, 0, 0.56, -0.32, { round: 0.07, segments: 3, rx: -0.12 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.cyl(g, 0.02, 0.016, 0.08, M.dark, sx * 0.34, 0.04, sz * 0.32, { radial: 8 });
      C.props.throwBlanket({ parent: g, w: 0.5, d: 0.45, material: 'knit', position: [0.12, 0.44, 0.08], rotationY: 0.3, drapeOver: 0.28, seed: 7 });
      U.blobShadow(g, 0, 0, 0, 1.0, 0.95, 0.4);
      P.addCylinder(5.95, -2.25, 0.48, 0, 0.9, { tag: 'furniture', name: 'hallstudy.readingChair' });
      // side table + book + tea
      U.cyl(S, 0.2, 0.2, 0.025, M.oak, 6.35, 0.55, -1.55, { radial: 24 });
      U.cyl(S, 0.03, 0.04, 0.54, M.oak, 6.35, 0.275, -1.55, { radial: 10 });
      U.cyl(S, 0.14, 0.15, 0.025, M.oak, 6.35, 0.012, -1.55, { radial: 20 });
      PR.bookStack({ parent: S, count: 2, position: [6.3, 0.5625, -1.6], rotationY: 0.4, seed: 106 });
      PR.mug({ parent: S, position: [6.42, 0.5625, -1.45], color: 0xefe6d4, fill: 'tea' });
      P.addCylinder(6.35, -1.55, 0.21, 0, 0.6, { tag: 'furniture', name: 'hallstudy.sideTable' });
      // globe on a stand
      const globeTex = U.canvasTexture(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#b9c7b0'; ctx.fillRect(0, 0, w, h);
        const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(120,90,50,0.25)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(120,90,50,0.25)');
        const r = U.rng(23);
        ctx.fillStyle = '#6d8a93';
        ctx.fillRect(0, 0, w, h);
        for (let c = 0; c < 7; c++) {
          const cx = r() * w, cy = 25 + r() * 78, n = 30;
          ctx.fillStyle = ['#c9b48a', '#b4a36f', '#a8b07a'][c % 3];
          ctx.beginPath();
          for (let i = 0; i <= n; i++) { const a = i / n * PI * 2, rr = 12 + r() * 22; ctx.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr); }
          ctx.fill();
        }
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(60,40,20,0.25)'; for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * w / 8, 0); ctx.lineTo(i * w / 8, h); ctx.stroke(); }
        for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * h / 6); ctx.lineTo(w, i * h / 6); ctx.stroke(); }
      });
      const globeMat = new THREE.MeshStandardMaterial({ map: globeTex, roughness: 0.45 }); globeMat.name = 'hallstudy.globe';
      const gx = 6.2, gz = -4.2;
      for (let i = 0; i < 3; i++) { const a = i * PI * 2 / 3; U.cyl(S, 0.012, 0.016, 0.62, M.dark, gx + Math.cos(a) * 0.14, 0.3, gz + Math.sin(a) * 0.14, { rx: -Math.sin(a) * 0.25, rz: Math.cos(a) * 0.25, radial: 8 }); }
      U.cyl(S, 0.03, 0.05, 0.08, M.dark, gx, 0.6, gz, { radial: 12 });
      const gs = new THREE.Mesh(new THREE.SphereGeometry(0.18, 32, 20), globeMat);
      gs.position.set(gx, 0.84, gz); gs.rotation.set(0, 1.2, 0.41); S.add(gs);
      const mer = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.006, 6, 40), M.brass);
      mer.position.set(gx, 0.84, gz); mer.rotation.set(0, 0.6, 0.41); S.add(mer);
      P.addCylinder(gx, gz, 0.24, 0, 1.05, { tag: 'furniture', name: 'hallstudy.globe' });
      // cat bed
      const bx = 6.2, bz = -1.0;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 10, 28), M.cream2);
      rim.rotation.x = PI / 2; rim.position.set(bx, 0.07, bz); rim.scale.set(1, 1, 0.9); S.add(rim);
      U.cyl(S, 0.22, 0.24, 0.06, M.rose, bx, 0.03, bz, { radial: 24 });
      U.blobShadow(S, bx, 0.004, bz, 0.75, 0.7, 0.35);
      P.addCylinder(bx, bz, 0.3, 0, 0.5, { tag: 'furniture', name: 'hallstudy.catBed' });
      st.catBed = { name: 'cat_bed', position: [bx, 0.062, bz], rotationY: -PI / 2 };
    });

    section('studyDecor', () => {
      PR.rug({ parent: S, w: 2.5, d: 1.9, style: 'kilim', position: [4.3, 0, -2.75] });
      // map chest against P2 (north face z = −0.775), rolled maps on top
      const x0 = 3.75, x1 = 5.05, z0 = -1.2, z1 = -0.775;
      U.boxAt(S, x0, 0.06, z0, x1, 0.78, z1, M.oak);
      U.boxAt(S, x0 - 0.015, 0.78, z0 - 0.015, x1 + 0.015, 0.81, z1, M.oak, { round: 0.006 });
      U.boxAt(S, x0 + 0.03, 0, z0 + 0.03, x1 - 0.03, 0.06, z1, M.dark);
      for (let i = 0; i < 5; i++) {
        const y0 = 0.09 + i * 0.135;
        U.boxAt(S, x0 + 0.02, y0, z0 - 0.012, x1 - 0.02, y0 + 0.12, z0, M.oak, { round: 0.003 });
        for (const x of [x0 + 0.25, x1 - 0.25]) U.boxAt(S, x - 0.05, y0 + 0.05, z0 - 0.024, x + 0.05, y0 + 0.068, z0 - 0.012, M.brass);
      }
      for (const [dz, len, rot] of [[0, 0.5, 0.1], [0.1, 0.44, -0.05], [0.05, 0.38, 0.3]]) U.cyl(S, 0.025, 0.025, len, dz === 0.05 ? U.stdMat(0xe8d7b0, 0.9) : M.paper, 4.15 + dz, 0.835 + (dz === 0.05 ? 0.045 : 0), -1.0 + dz * 0.5, { rz: PI / 2, ry: rot, radial: 12 });
      PR.plant({ parent: S, type: 'fern', position: [4.8, 0.81, -1.0], scale: 0.7, seed: 107 });
      PR.candle({ parent: S, position: [3.9, 0.81, -0.95], height: 0.16, radius: 0.012, holder: 'brass' });
      addBox(x0 - 0.02, 0, z0 - 0.03, x1 + 0.02, 0.9, z1, 'mapChest');
      PR.painting({ parent: S, width: 0.5, height: 0.38, style: 'map', frame: 'wood', position: [4.1, 1.62, -0.775], rotationY: PI, seed: 108 });
      PR.painting({ parent: S, width: 0.42, height: 0.56, style: 'map', frame: 'gold', position: [4.75, 1.62, -0.775], rotationY: PI, seed: 109 });
      PR.painting({ parent: S, width: 0.36, height: 0.46, style: 'botanical', frame: 'black', position: [6.75, 1.6, -4.15], rotationY: -PI / 2, seed: 110 });
      PR.plant({ parent: S, type: 'snake', position: [2.6, 0, -4.45], seed: 111 });
      P.addCylinder(2.6, -4.45, 0.14, 0, 0.8, { tag: 'furniture', name: 'hallstudy.snake' });
      PR.plant({ parent: S, type: 'monstera', position: [6.3, 0, -3.95], scale: 0.75, seed: 112 });
      P.addCylinder(6.3, -3.95, 0.2, 0, 0.9, { tag: 'furniture', name: 'hallstudy.monstera' });
    });

    C.hallstudy = { catBed: st.catBed, seat: st.seat };
    U.bakeStatic(S);
    st.ready = true;
  },

  update(dt, t, C) {
    if (!st.ready) return;
    // visible from the loft only near the stairwell
    const cp = C.camera.position;
    st.S.visible = !(cp.x > -7 && cp.x < 7 && cp.z > -5 && cp.z < 5) || cp.y < 3.8 || cp.x > 3.0;
    if (st.pendulum) st.pendulum.rotation.z = Math.sin(t * PI) * 0.075;
    if (st.minHand) {
      const d = new Date(), s = d.getSeconds();
      if (s !== st.lastSec) {
        st.lastSec = s;
        const m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
        st.minHand.rotation.z = -m / 60 * PI * 2;
        st.hourHand.rotation.z = -h / 12 * PI * 2;
      }
    }
    if (st.drips) {
      for (let i = 0; i < st.drips.length; i++) {
        const d = st.drips[i];
        const c = ((t + d.phase) % d.period);
        if (c < 0.32) {
          const k = c / 0.32;
          d.drop.visible = true;
          d.drop.position.set(d.x, d.y0 - (d.y0 - 0.016) * k * k, d.z);
        } else d.drop.visible = false;
        const r = c - 0.32;
        if (r >= 0 && r < 0.7) {
          const k = r / 0.7;
          d.ripple.visible = true;
          d.ripple.position.set(d.x, 0.0165, d.z);
          const s = 0.4 + k * 1.6;
          d.ripple.scale.set(s, s, s);
          d.ripple.material.opacity = 0.45 * (1 - k);
        } else d.ripple.visible = false;
      }
    }
  },
});

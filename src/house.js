// =====================================================================================================================
//  HOUSE — all architecture of the Rainy Day Cottage (SPEC §4, §9 house).
//  Floors + physics, exterior walls with openings, partitions, doors (interactables), stairs, loft slab, knee walls,
//  sloped board ceiling + rafters, roof with skylights, gutters/downspouts, chimney stack, porch, windows + glass panes.
//  Fills C.house = { doors, windows, glassPanes, roofY(x,z), ... }.
// =====================================================================================================================
import * as THREE from 'three';
const C = window.COZY;

// ---------------------------------------------------------------------------------------------------------------------
// Layout constants (SPEC §4)
// ---------------------------------------------------------------------------------------------------------------------
const ANG = Math.atan(0.7), SA = Math.sin(ANG), CA = Math.cos(ANG);      // roof pitch (35°)
const ROOF_T = 0.27 * CA;                                                 // perpendicular roof thickness (vertical 0.27)
const yu = z => 7.5 - 0.7 * Math.abs(z);                                  // roof underside
const S_EAVE = 5.6 / CA;                                                  // slope distance ridge → eave (underside)
const S_RIDGE = -ROOF_T * 0.7;                                            // top surfaces meet over the ridge
const sOf = z => Math.abs(z) / CA;

// Exterior walls: plane coordinate = out + dir * d, d measured inward from the outer face (0 … 0.25 = interior face)
const WALLS = {
  S: { key: 'S', name: 'south', axis: 'x', out: 5.0, dir: -1, normal: [0, 0, 1] },
  N: { key: 'N', name: 'north', axis: 'x', out: -5.0, dir: 1, normal: [0, 0, -1] },
  E: { key: 'E', name: 'east', axis: 'z', out: 7.0, dir: -1, normal: [1, 0, 0] },
  W: { key: 'W', name: 'west', axis: 'z', out: -7.0, dir: 1, normal: [-1, 0, 0] },
};
const WT = 0.25;       // wall thickness
const SID = 0.03;      // siding skin thickness
const G_D = 0.075;     // glass plane depth from outer face

const WINDOWS = [
  { id: 'w_living_s', wall: 'S', a0: -5.2, a1: -2.6, y0: 0.55, y1: 2.3, shutters: true, box: true },
  { id: 'w_living_w1', wall: 'W', a0: 0.75, a1: 1.35, y0: 1.0, y1: 2.2 },
  { id: 'w_living_w2', wall: 'W', a0: 3.65, a1: 4.25, y0: 1.0, y1: 2.2, shutters: true },
  { id: 'w_kitchen_n', wall: 'N', a0: -4.3, a1: -2.9, y0: 1.1, y1: 2.2, shutters: true, box: true },
  { id: 'w_dining_w', wall: 'W', a0: -2.2, a1: -1.0, y0: 0.9, y1: 2.2 },
  { id: 'w_study_n', wall: 'N', a0: 3.2, a1: 5.4, y0: 0.85, y1: 2.25, shutters: true, box: true },
  { id: 'w_study_e', wall: 'E', a0: -3.6, a1: -2.4, y0: 0.9, y1: 2.2, shutters: true, box: true },
  { id: 'w_hall_s', wall: 'S', a0: 2.35, a1: 2.95, y0: 0.9, y1: 2.1 },
  { id: 'w_loft_e', wall: 'E', a0: -2.5, a1: -1.3, y0: 3.6, y1: 5.3 },
  { id: 'w_loft_w_round', wall: 'W', round: true, a: 0, y: 5.1, r: 0.55 },
  { id: 'w_loft_e_round', wall: 'E', round: true, a: 0, y: 6.2, r: 0.35 },
];
const SKYLIGHTS = [
  { id: 'sk_1', side: 1, x0: -5.9, x1: -5.0, z0: 1.1, z1: 2.4 },
  { id: 'sk_2', side: 1, x0: -3.3, x1: -2.4, z0: 1.1, z1: 2.4 },
  { id: 'sk_3', side: -1, x0: 3.8, x1: 4.7, z0: -2.4, z1: -1.1 },
];
// ground-floor exposed beams (north–south joists) + girder at z = 0.3
const BEAMS_MAIN = [-5.5, -4.05, -2.6, -1.15, 0.3];
const BEAMS_EAST = [3.15, 4.6];
const RAFTERS = [-6.0, -4.9, -3.4, -2.3, -1.15, 0, 1.15, 2.3, 3.7, 4.8, 6.0];
const COLLARS = [-3.4, 0, 3.7];

// stairs
const ST = { x0: 5.52, x1: 6.75, zBot: 3.6, zTop: -0.45, n: 15, rise: 0.2, run: 0.27 };
const noseY = z => 0.2 + (ST.zBot - z) * (0.2 / 0.27);                   // line through the tread nosings

C.register({
  name: 'house',
  order: 20,
  init(C) {
    const U = C.util, P = C.physics;
    const root = new THREE.Group(); root.name = 'house';
    C.scene.add(root);
    const S = new THREE.Group(); S.name = 'house.static'; root.add(S);         // baked
    const DYN = new THREE.Group(); DYN.name = 'house.dynamic'; DYN.userData.dynamic = true; root.add(DYN);
    const GLASS = new THREE.Group(); GLASS.name = 'house.glass'; GLASS.userData.dynamic = true; root.add(GLASS);

    // -----------------------------------------------------------------------------------------------------------------
    // Materials
    // -----------------------------------------------------------------------------------------------------------------
    const M = {
      plaster: C.mat('plaster'), wallpaper: C.mat('wallpaper'), wallpaperBlue: C.mat('wallpaperBlue'),
      floor: C.mat('woodFloor'), tile: C.mat('tileFloor'), dark: C.mat('woodDark'), oak: C.mat('woodMedium'),
      trim: C.mat('woodPainted'), green: C.mat('woodPaintedGreen'), porch: C.mat('woodPorch'),
      ceil: C.mat('ceilingBoards'), siding: C.mat('siding'), shingles: C.mat('shingles'), stone: C.mat('stone'),
      concrete: C.mat('concrete'), brass: C.mat('brass'), iron: C.mat('ironBlack'), soil: C.mat('soil'),
    };
    M.metal = U.stdMat(0x5b6166, 0.38, 0.65);
    M.metalDark = U.stdMat(0x3a3f44, 0.45, 0.6);
    M.ridge = U.stdMat(0x2c3136, 0.5, 0.05);
    M.void = U.stdMat(0x14110e, 1, 0);
    // sage shutters (#5f7a63) from the sage painted wood, tinted
    M.shutter = tintClone(C.mat('woodPaintedSage'), '#5f7a63', '#8fa487');
    M.flowerRed = U.stdMat(0xb8413a, 0.7); M.flowerPink = U.stdMat(0xd98c9a, 0.7);
    M.flowerWhite = U.stdMat(0xeee8dc, 0.7); M.flowerPurple = U.stdMat(0x6b5a9e, 0.7);
    M.leaf = U.stdMat(0x3b5a30, 0.75); M.leafDark = U.stdMat(0x2c4526, 0.8);
    // procedural plank-ish materials (vertical boards)
    M.bead = plankMaterial({ base: '#ece4d2', boards: 10, bead: true, seed: 401, rough: 0.55 });            // wainscot / under-stair
    M.doorCream = plankMaterial({ base: '#efe7d6', boards: 6, bead: false, seed: 402, rough: 0.5 });
    M.doorGreen = plankMaterial({ base: '#2e4a3b', boards: 6, bead: false, seed: 403, rough: 0.42 });
    M.haint = plankMaterial({ base: '#b5ccc8', boards: 10, bead: true, seed: 404, rough: 0.6 });            // porch ceiling
    M.lattice = latticeMaterial();
    const glassBase = C.mat('glass');
    M.glass = glassBase.clone(); M.glass.side = THREE.DoubleSide; M.glass.name = 'house.glass';

    function tintClone(src, target, base) {
      const m = src.clone();
      const t = new THREE.Color(target), b = new THREE.Color(base);
      if (m.map) m.color.setRGB(t.r / Math.max(1e-3, b.r), t.g / Math.max(1e-3, b.g), t.b / Math.max(1e-3, b.b));
      else m.color.copy(t);
      m.name = 'shutterSage';
      return m;
    }
    function plankMaterial({ base, boards = 8, bead = false, seed = 1, rough = 0.5 }) {
      const G = C.matgen;
      if (!G || !G.pixelMaterial) return U.stdMat(new THREE.Color(base).getHex(), rough);
      const B = G.hex(base), w = 512, h = 512, bw = w / boards;
      const n = G.vnoise(w, h, boards, 28, seed, 3, 0.5), f = G.vnoise(w, h, 64, 64, seed + 1, 2, 0.5);
      const rnd = U.rng(seed), tint = [];
      for (let i = 0; i < boards; i++) tint.push(0.95 + rnd() * 0.08);
      const m = G.pixelMaterial({ w, h, repeat: [1, 1], normal: 2.5, normalScale: 0.8, gen(x, y, i, o) {
        const b = Math.floor(x / bw), lx = x - b * bw;
        let v = tint[b] * (1 + (n[i] - 0.5) * 0.06 + (f[i] - 0.5) * 0.03), hh = 1;
        if (lx < 2.5) { hh = 0.05; v *= 0.62; }
        else if (lx < 4) { hh = 0.55; v *= 0.9; }
        else if (bead && Math.abs(lx - bw * 0.5) < 1.6) { hh = 0.7; v *= 0.93; }
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v; o.h = hh; o.r = rough + (n[i] - 0.5) * 0.08;
      } });
      return m;
    }
    function latticeMaterial() {
      const tex = U.canvasTexture(256, 256, (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = 'butt';
        const draw = (dir, col, lw) => {
          ctx.strokeStyle = col; ctx.lineWidth = lw;
          for (let k = -2; k <= 2; k++) {
            ctx.beginPath();
            if (dir > 0) { ctx.moveTo(k * w / 2 - w, h * 2); ctx.lineTo(k * w / 2 + w, -h); }
            else { ctx.moveTo(k * w / 2 - w, -h); ctx.lineTo(k * w / 2 + w, h * 2); }
            ctx.stroke();
          }
        };
        draw(1, '#d9d3c4', 30); draw(-1, '#e8e2d4', 30);
        draw(-1, 'rgba(120,110,95,0.35)', 2);
      });
      tex.repeat.set(2, 2);
      const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
      m.name = 'lattice';
      return m;
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Geometry helpers
    // -----------------------------------------------------------------------------------------------------------------
    const box = (x0, y0, z0, x1, y1, z1, mat, opts = {}) =>
      U.boxAt(opts.parent || S, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat, opts);
    const wp = (W, d) => W.out + W.dir * d;
    function wallAABB(W, a0, a1, y0, y1, d0, d1) {
      const p0 = wp(W, d0), p1 = wp(W, d1), pa = Math.min(p0, p1), pb = Math.max(p0, p1);
      const A = Math.min(a0, a1), B = Math.max(a0, a1);
      return W.axis === 'x' ? { min: [A, y0, pa], max: [B, y1, pb] } : { min: [pa, y0, A], max: [pb, y1, B] };
    }
    function wallBox(W, a0, a1, y0, y1, d0, d1, mat, opts) {
      const bb = wallAABB(W, a0, a1, y0, y1, d0, d1);
      return box(bb.min[0], bb.min[1], bb.min[2], bb.max[0], bb.max[1], bb.max[2], mat, opts);
    }
    const wallPoint = (W, a, y, d) => W.axis === 'x' ? [a, y, wp(W, d)] : [wp(W, d), y, a];
    // rotated/centred box on a wall (rotation about the wall-normal axis = in-plane rotation)
    function wallBoxRot(W, a, y, d, w, h, depth, ang, mat, opts = {}) {
      const p = wallPoint(W, a, y, d);
      if (W.axis === 'x') return U.box(opts.parent || S, w, h, depth, mat, p[0], p[1], p[2], Object.assign({ rz: ang }, opts));
      return U.box(opts.parent || S, depth, h, w, mat, p[0], p[1], p[2], Object.assign({ rx: -ang * W.dir * (W.key === 'E' ? -1 : 1) }, opts));
    }
    // louver-style rotation: rotate about the wall's horizontal in-plane axis
    function wallBoxTilt(W, a, y, d, w, h, depth, ang, mat, opts = {}) {
      const p = wallPoint(W, a, y, d);
      if (W.axis === 'x') return U.box(opts.parent || S, w, h, depth, mat, p[0], p[1], p[2], Object.assign({ rx: ang * (W.key === 'S' ? 1 : -1) }, opts));
      return U.box(opts.parent || S, depth, h, w, mat, p[0], p[1], p[2], Object.assign({ rz: ang * (W.key === 'E' ? -1 : 1) }, opts));
    }

    // Extruded vertical slab with holes. axis 'x' → runs along x, thickness along z in [p0,p1];
    // axis 'z' → runs along z, thickness along x in [p0,p1]. outline [[a,y],...]; holes: {a0,a1,y0,y1} | {a,y,r}
    const _mx = new THREE.Matrix4(), _mz = new THREE.Matrix4();
    function extrudeWall(axis, p0, p1, outline, holes, mat, opts = {}) {
      const f = axis === 'z' ? -1 : 1;
      const shape = new THREE.Shape(outline.map(([a, y]) => new THREE.Vector2(a * f, y)));
      for (const h of holes || []) shape.holes.push(holePath(h, f));
      const g = new THREE.ExtrudeGeometry(shape, { depth: p1 - p0, bevelEnabled: false, curveSegments: opts.curve || 40 });
      if (axis === 'x') _mx.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, p0, 0, 0, 0, 1), g.applyMatrix4(_mx);
      else _mz.set(0, 0, 1, p0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1), g.applyMatrix4(_mz);
      if (opts.uv !== false) U.worldUV(g, opts.uvScale || 1);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      if (opts.name) m.name = opts.name;
      (opts.parent || S).add(m);
      return m;
    }
    function holePath(h, f) {
      const p = new THREE.Path();
      if (h.r !== undefined) { p.absarc(h.a * f, h.y, h.r, 0, Math.PI * 2, false); return p; }
      const u0 = Math.min(h.a0 * f, h.a1 * f), u1 = Math.max(h.a0 * f, h.a1 * f);
      p.moveTo(u0, h.y0); p.lineTo(u1, h.y0); p.lineTo(u1, h.y1); p.lineTo(u0, h.y1); p.closePath();
      return p;
    }
    function wallExtrude(W, d0, d1, outline, holes, mat, opts) {
      const p0 = wp(W, d0), p1 = wp(W, d1);
      return extrudeWall(W.axis, Math.min(p0, p1), Math.max(p0, p1), outline, holes, mat, opts);
    }
    // ring (annulus) on a wall, e.g. round window frames / casings
    function wallRing(W, a, y, r0, r1, d0, d1, mat, opts = {}) {
      const f = W.axis === 'z' ? -1 : 1;
      const shape = new THREE.Shape(); shape.absarc(a * f, y, r1, 0, Math.PI * 2, false);
      const hole = new THREE.Path(); hole.absarc(a * f, y, r0, 0, Math.PI * 2, true); shape.holes.push(hole);
      const p0 = wp(W, d0), p1 = wp(W, d1), pa = Math.min(p0, p1), pb = Math.max(p0, p1);
      const g = new THREE.ExtrudeGeometry(shape, { depth: pb - pa, bevelEnabled: false, curveSegments: 40 });
      if (W.axis === 'x') _mx.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, pa, 0, 0, 0, 1), g.applyMatrix4(_mx);
      else _mz.set(0, 0, 1, pa, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1), g.applyMatrix4(_mz);
      U.worldUV(g);
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!opts.cast;
      (opts.parent || S).add(m);
      return m;
    }

    // Roof slope frame: local X = u (along ridge), Y = s (down-slope from the ridge underside), Z = t (outward normal)
    const slopeM = side => {
      const m = new THREE.Matrix4();
      m.makeBasis(new THREE.Vector3(side > 0 ? -1 : 1, 0, 0), new THREE.Vector3(0, -SA, side * CA), new THREE.Vector3(0, CA, side * SA));
      m.setPosition(0, 7.5, 0);
      return m;
    };
    const SLOPE = { 1: slopeM(1), [-1]: slopeM(-1) };
    const uOf = (side, x) => (side > 0 ? -x : x);
    const slopePoint = (side, x, s, t) => new THREE.Vector3(uOf(side, x), s, t).applyMatrix4(SLOPE[side]);
    function slopeSlab(side, outline, holes, t0, t1, mat, opts = {}) {
      const shape = new THREE.Shape(outline.map(([u, s]) => new THREE.Vector2(u, s)));
      for (const h of holes || []) {
        const p = new THREE.Path();
        p.moveTo(h.u0, h.s0); p.lineTo(h.u1, h.s0); p.lineTo(h.u1, h.s1); p.lineTo(h.u0, h.s1); p.closePath();
        shape.holes.push(p);
      }
      const g = new THREE.ExtrudeGeometry(shape, { depth: t1 - t0, bevelEnabled: false });
      g.translate(0, 0, t0);
      g.applyMatrix4(SLOPE[side]);
      if (opts.worldUV) U.worldUV(g);
      const m = new THREE.Mesh(g, mat); m.castShadow = !!opts.cast; m.receiveShadow = true;
      if (opts.name) m.name = opts.name;
      (opts.parent || S).add(m);
      return m;
    }
    // box in the slope frame given world-x range
    function slopeBox(side, x0, x1, s0, s1, t0, t1, mat, opts = {}) {
      const u0 = Math.min(uOf(side, x0), uOf(side, x1)), u1 = Math.max(uOf(side, x0), uOf(side, x1));
      const g = new THREE.BoxGeometry(u1 - u0, s1 - s0, t1 - t0);
      g.translate((u0 + u1) / 2, (s0 + s1) / 2, (t0 + t1) / 2);
      g.applyMatrix4(SLOPE[side]);
      U.worldUV(g);
      const m = new THREE.Mesh(g, mat); m.castShadow = !!opts.cast; m.receiveShadow = true;
      (opts.parent || S).add(m);
      return m;
    }

    const colliders = [];
    const wall = (x0, y0, z0, x1, y1, z1, name, tag = 'wall', extra = {}) => {
      const h = P.addBox([x0, y0, z0], [x1, y1, z1], Object.assign({ tag, name: 'house.' + name }, extra));
      colliders.push(h);
      return h;
    };

    // -----------------------------------------------------------------------------------------------------------------
    // Physics floors
    // -----------------------------------------------------------------------------------------------------------------
    P.addFloor(-7, -5, 7, 5, 0, { surface: 'wood', name: 'house.ground' });
    P.addSurfaceTag(-6.75, -4.75, 1.925, -2.6, -0.3, 0.6, 'tile');
    P.addFloor(-6.75, -4.75, 5.52, 4.75, 3.0, { surface: 'wood', name: 'house.UA' });
    P.addFloor(5.52, -4.75, 6.75, -0.45, 3.0, { surface: 'wood', name: 'house.UB' });
    P.addFloor(5.52, 2.4, 6.75, 4.75, 3.0, { surface: 'wood', name: 'house.UC' });
    P.addRamp(ST.x0, ST.zTop, ST.x1, ST.zBot, 'z', 3.0, 0.0, { surface: 'stairs', name: 'house.stairs' });
    P.addFloor(1.2, 5.0, 6.8, 7.2, 0, { surface: 'porch', name: 'house.porch' });
    P.addRamp(3.0, 7.2, 4.5, 7.8, 'z', 0.0, -0.45, { surface: 'porch', name: 'house.porchSteps' });

    // -----------------------------------------------------------------------------------------------------------------
    // Ground floor: floors, plinth
    // -----------------------------------------------------------------------------------------------------------------
    box(-6.8, -0.3, -2.6, 1.925, 0, 4.8, M.floor, { name: 'house.floorLiving', cast: false });
    box(1.925, -0.3, -4.8, 6.8, 0, 4.8, M.floor, { name: 'house.floorEast' });
    box(-6.8, -0.3, -4.8, 1.925, 0, -2.6, M.tile, { name: 'house.floorKitchen' });
    box(-6.75, 0, -2.618, 1.925, 0.004, -2.582, M.oak);                   // transition strip
    // thresholds
    box(1.93, 0, -3.1, 2.07, 0.006, -2.2, M.oak);
    box(2.6, 0, -0.77, 3.5, 0.006, -0.63, M.oak);
    box(1.93, 0, 1.4, 2.07, 0.004, 2.6, M.oak);

    // stone plinth (outside) + cap
    const PL = 0.06;
    box(-7 - PL, -0.5, -5 - PL, 7 + PL, 0.35, -4.9, M.stone, { name: 'house.plinthN' });
    box(-7 - PL, -0.5, 4.9, 1.2, 0.35, 5 + PL, M.stone);
    box(1.2, -0.5, 4.9, 6.8, -0.07, 5 + PL, M.stone);
    box(6.8, -0.5, 4.9, 7 + PL, 0.35, 5 + PL, M.stone);
    box(-7 - PL, -0.5, -5 - PL, -6.9, 0.35, 5 + PL, M.stone);
    box(6.9, -0.5, -5 - PL, 7 + PL, 0.35, 5 + PL, M.stone);
    const CAP = 0.09, cy0 = 0.33, cy1 = 0.38;
    box(-7 - CAP, cy0, -5 - CAP, 7 + CAP, cy1, -4.95, M.concrete);
    box(-7 - CAP, cy0, 4.95, 1.2, cy1, 5 + CAP, M.concrete);
    box(6.8, cy0, 4.95, 7 + CAP, cy1, 5 + CAP, M.concrete);
    box(-7 - CAP, cy0, -5 - CAP + 0.001, -6.95, cy1 - 0.001, 5 + CAP - 0.001, M.concrete);
    box(6.95, cy0, -5 - CAP + 0.001, 7 + CAP, cy1 - 0.001, 5 + CAP - 0.001, M.concrete);

    // -----------------------------------------------------------------------------------------------------------------
    // Exterior walls
    // -----------------------------------------------------------------------------------------------------------------
    const holesFor = (key) => {
      const hs = [];
      for (const w of WINDOWS) {
        if (w.wall !== key) continue;
        if (w.round) hs.push({ a: w.a, y: w.y, r: w.r });
        else hs.push({ a0: w.a0, a1: w.a1, y0: w.y0 - 0.045, y1: w.y1 });
      }
      if (key === 'S') hs.push({ a0: 3.25, a1: 4.25, y0: 0, y1: 2.15 });
      return hs;
    };
    const LONG_TOP = 4.2;
    const GX = 6.975;   // body extent along x for long walls
    for (const key of ['S', 'N']) {
      const W = WALLS[key], holes = holesFor(key);
      wallExtrude(W, SID - 0.005, WT, [[-GX, -0.45], [GX, -0.45], [GX, LONG_TOP], [-GX, LONG_TOP]], holes, M.plaster, { cast: true, name: 'house.wall' + key });
      wallExtrude(W, 0, SID, [[-6.97, -0.05], [6.97, -0.05], [6.97, LONG_TOP], [-6.97, LONG_TOP]], holes, M.siding, { name: 'house.siding' + key });
    }
    const gableOutline = (zr, bottom, extra) => {
      const pts = [[-zr, bottom], [zr, bottom], [zr, yu(zr) + extra]];
      pts.push([0, 7.5 + extra]);
      pts.push([-zr, yu(zr) + extra]);
      return pts;
    };
    for (const key of ['E', 'W']) {
      const W = WALLS[key], holes = holesFor(key);
      wallExtrude(W, SID - 0.005, WT, gableOutline(4.99, -0.45, 0.15), holes, M.plaster, { cast: true, name: 'house.wall' + key });
      wallExtrude(W, 0, SID, gableOutline(5.0, -0.05, 0.12), holes, M.siding, { name: 'house.siding' + key });
    }
    // wall colliders (y −0.45 → 4.1; gables higher)
    wall(-7, -0.45, 4.75, 3.25, 4.1, 5.0, 'wallS_w');
    wall(4.25, -0.45, 4.75, 7, 4.1, 5.0, 'wallS_e');
    wall(3.25, 2.15, 4.75, 4.25, 4.1, 5.0, 'wallS_lintel');
    wall(-7, -0.45, -5.0, 7, 4.1, -4.75, 'wallN');
    wall(-7, -0.45, -5, -6.75, 7.6, 5, 'wallW');
    wall(6.75, -0.45, -5, 7, 7.6, 5, 'wallE');

    // corner boards + frieze
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(sx * 6.86, -0.05, sz * 5.0, sx * 7.025, 4.05, sz * 5.03, M.trim);
      box(sx * 7.0, -0.05, sz * 4.86, sx * 7.03, 4.05, sz * 5.03, M.trim);
    }
    for (const sz of [-1, 1]) box(-6.97, 3.84, sz * 4.99, 6.97, 4.02, sz * 5.025, M.trim);   // frieze under the eaves
    for (const sx of [-1, 1]) box(sx * 6.99, 3.92, -5.0, sx * 7.035, 4.08, 5.0, M.trim);    // gable band
    // water table above the plinth (not under the porch deck)
    box(-6.97, 0.38, 5.0, 1.2, 0.46, 5.028, M.trim);
    box(6.8, 0.38, 5.0, 6.97, 0.46, 5.028, M.trim);
    box(-6.97, 0.38, -5.028, 6.97, 0.46, -5.0, M.trim);
    for (const sx of [-1, 1]) box(sx * 7.0, 0.38, -4.97, sx * 7.028, 0.46, 4.97, M.trim);

    // -----------------------------------------------------------------------------------------------------------------
    // Partitions P1 / P2
    // -----------------------------------------------------------------------------------------------------------------
    extrudeWall('z', 1.925, 2.075, [[-4.78, -0.05], [4.78, -0.05], [4.78, 2.82], [-4.78, 2.82]],
      [{ a0: -3.1, a1: -2.2, y0: 0, y1: 2.05 }, { a0: 1.4, a1: 2.6, y0: 0, y1: 2.25 }], M.plaster, { cast: true, name: 'house.P1' });
    extrudeWall('x', -0.775, -0.625, [[2.06, -0.05], [6.78, -0.05], [6.78, 2.82], [2.06, 2.82]],
      [{ a0: 2.6, a1: 3.5, y0: 0, y1: 2.05 }], M.plaster, { cast: true, name: 'house.P2' });
    wall(1.925, 0, -4.75, 2.075, 2.8, -3.1, 'P1a');
    wall(1.925, 0, -2.2, 2.075, 2.8, 1.4, 'P1b');
    wall(1.925, 0, 2.6, 2.075, 2.8, 4.75, 'P1c');
    wall(1.925, 2.05, -3.1, 2.075, 2.8, -2.2, 'P1_D2lintel');
    wall(1.925, 2.25, 1.4, 2.075, 2.8, 2.6, 'P1_D1lintel');
    wall(2.075, 0, -0.775, 2.6, 2.8, -0.625, 'P2a');
    wall(3.5, 0, -0.775, 6.75, 2.8, -0.625, 'P2b');
    wall(2.6, 2.05, -0.775, 3.5, 2.8, -0.625, 'P2_D3lintel');

    // -----------------------------------------------------------------------------------------------------------------
    // Interior finishes: wallpaper feature walls, hall wainscoting, skirting
    // -----------------------------------------------------------------------------------------------------------------
    const winHolesOn = (key, yMin, yMax) => WINDOWS.filter(w => w.wall === key && !w.round && w.y0 < yMax && w.y1 > yMin)
      .map(w => ({ a0: w.a0, a1: w.a1, y0: w.y0 - 0.045, y1: w.y1 }));
    // living feature wall: west wall z 0.3 → 4.75 (behind the fireplace)
    wallExtrude(WALLS.W, WT - 0.004, WT + 0.004, [[0.3, 0], [4.75, 0], [4.75, 2.8], [0.3, 2.8]],
      winHolesOn('W', 0, 2.8).filter(h => h.a0 > 0.3), M.wallpaper, { name: 'house.wallpaperLiving' });
    box(-6.75, 0, 0.285, -6.735, 2.8, 0.315, M.trim);                        // bead where the paper stops
    // loft feature wall: west gable (behind the bed) in dusty-blue stripes
    {
      const zr = 4.75;
      wallExtrude(WALLS.W, WT - 0.004, WT + 0.004, [[-zr, 3.0], [zr, 3.0], [zr, yu(zr) + 0.02], [0, 7.52], [-zr, yu(zr) + 0.02]],
        [{ a: 0, y: 5.1, r: 0.55 }], M.wallpaperBlue, { name: 'house.wallpaperLoft' });
    }
    // hall wainscoting (beadboard to 0.85 + chair rail)
    const WAIN = 0.85;
    const wains = (x0, z0, x1, z1) => {    // thin skin in front of a wall face
      box(x0, 0, z0, x1, WAIN, z1, M.bead);
    };
    const chair = (x0, z0, x1, z1) => box(x0, WAIN - 0.01, z0, x1, WAIN + 0.045, z1, M.trim);
    // P1 east face (x = 2.075)
    for (const [a, b] of [[-0.625, 1.4], [2.6, 4.75]]) { wains(2.071, a, 2.081, b); chair(2.071, a, 2.105, b); }
    // south wall inner face (z = 4.75)
    for (const [a, b] of [[2.075, 3.25], [4.25, 6.75]]) { wains(a, 4.739, b, 4.754); chair(a, 4.72, b, 4.754); }
    // P2 south face (z = −0.625)
    for (const [a, b] of [[2.075, 2.6], [3.5, 5.5]]) { wains(a, -0.629, b, -0.619); chair(a, -0.629, b, -0.595); }
    // east wall at the stair approach
    wains(6.736, 3.6, 6.754, 4.75); chair(6.72, 3.6, 6.754, 4.75);

    // skirting boards
    const SK = 0.14, SKT = 0.02;
    const skirtX = (x0, x1, zFace, dir, y = 0, t = SKT) => box(x0, y, zFace, x1, y + SK, zFace + dir * t, M.trim);
    const skirtZ = (z0, z1, xFace, dir, y = 0, t = SKT) => box(xFace, y, z0, xFace + dir * t, y + SK, z1, M.trim);
    // living/kitchen
    skirtX(-6.75, 1.925, 4.75, -1); skirtX(-6.75, 1.925, -4.75, 1);
    skirtZ(-4.75, 0.3, -6.75, 1); skirtZ(0.3, 4.75, -6.746, 1);
    for (const [a, b] of [[-4.75, -3.1], [-2.2, 1.4], [2.6, 4.75]]) skirtZ(a, b, 1.925, -1);
    // study
    for (const [a, b] of [[-4.75, -3.1], [-2.2, -0.775]]) skirtZ(a, b, 2.075, 1);
    skirtX(2.075, 6.75, -4.75, 1);
    skirtZ(-4.75, -0.775, 6.75, -1);
    for (const [a, b] of [[2.075, 2.6], [3.5, 6.75]]) skirtX(a, b, -0.775, -1);
    // hall (over the wainscot)
    for (const [a, b] of [[-0.625, 1.4], [2.6, 4.75]]) skirtZ(a, b, 2.078, 1, 0, 0.026);
    for (const [a, b] of [[2.075, 3.25], [4.25, 6.75]]) skirtX(a, b, 4.742, -1, 0, 0.026);
    for (const [a, b] of [[2.075, 2.6], [3.5, 5.5]]) skirtX(a, b, -0.622, 1, 0, 0.026);
    skirtZ(3.6, 4.75, 6.742, -1, 0, 0.026);
    // loft
    skirtX(-6.75, 6.75, 4.75, -1, 3.0); skirtX(-6.75, 6.75, -4.75, 1, 3.0);
    skirtZ(-4.75, 4.75, -6.746, 1, 3.0);
    skirtZ(-4.75, -0.45, 6.75, -1, 3.0); skirtZ(2.4, 4.75, 6.75, -1, 3.0);

    // -----------------------------------------------------------------------------------------------------------------
    // Ground-floor ceiling (underside of the upper slab) + exposed beams; upper floor
    // -----------------------------------------------------------------------------------------------------------------
    const slab = (x0, z0, x1, z1) => {
      box(x0, 2.8, z0, x1, 2.9, z1, M.ceil, { cast: true });
      box(x0, 2.9, z0, x1, 3.0, z1, M.floor);
    };
    slab(-6.8, -4.8, 5.52, 4.8);           // UA
    slab(5.52, -4.8, 6.8, -0.45);          // UB
    slab(5.52, 2.4, 6.8, 4.8);             // UC
    const beams = [];
    for (const x of BEAMS_MAIN) { box(x - 0.075, 2.62, -4.78, x + 0.075, 2.805, 4.78, M.dark, { cast: true }); beams.push({ axis: 'z', x, y0: 2.62, z0: -4.75, z1: 4.75, w: 0.15 }); }
    box(-6.78, 2.56, 0.19, 1.93, 2.805, 0.41, M.dark, { cast: true }); beams.push({ axis: 'x', z: 0.3, y0: 2.56, x0: -6.75, x1: 1.925, w: 0.22 });
    for (const x of BEAMS_EAST) {
      box(x - 0.07, 2.64, -0.63, x + 0.07, 2.805, 4.78, M.dark); beams.push({ axis: 'z', x, y0: 2.64, z0: -0.625, z1: 4.75, w: 0.14 });
      box(x - 0.07, 2.64, -4.78, x + 0.07, 2.805, -0.77, M.dark); beams.push({ axis: 'z', x, y0: 2.64, z0: -4.75, z1: -0.775, w: 0.14 });
    }
    // stairwell trims (slab edges)
    box(5.5, 2.78, -0.45, 5.53, 3.01, 2.4, M.dark);
    box(5.52, 2.78, 2.39, 6.75, 3.01, 2.42, M.dark);
    box(5.52, 2.78, -0.47, 6.75, 2.8, -0.44, M.dark);

    // -----------------------------------------------------------------------------------------------------------------
    // Stairs
    // -----------------------------------------------------------------------------------------------------------------
    for (let i = 1; i <= ST.n; i++) {
      const zf = ST.zBot - ST.run * (i - 1), zb = ST.zBot - ST.run * i, yt = ST.rise * i;
      box(ST.x0 + 0.01, yt - 0.035, zb, ST.x1 + 0.01, yt, zf + 0.025, M.oak, { cast: true });     // tread with nosing
      box(ST.x0 + 0.01, yt - 0.2 - 0.035 + (i === 1 ? 0.035 : 0), zf - 0.02, ST.x1 + 0.01, yt - 0.035, zf, M.trim);  // riser
    }
    // outer stringer (x 5.48 → 5.54) and closed under-stair panelling
    const stringerTop = z => noseY(z) + 0.06;
    {
      const zA = 3.66, top0 = stringerTop(zA);
      const zC = zA - (3.0 - top0) / 0.7407;
      const bot = z => stringerTop(z) - 0.32;
      const zF = zA - (2.8 - bot(zA)) / 0.7407;
      const zG = zA - (0 - bot(zA)) / 0.7407;
      extrudeWall('z', 5.475, 5.54, [[zA, 0], [zA, top0], [zC, 3.0], [-0.45, 3.0], [-0.45, 2.8], [zF, 2.8], [Math.min(zG, zA - 0.01), 0]], [], M.trim, { name: 'house.stringer' });
      // wall stringer along the east wall
      extrudeWall('z', 6.725, 6.76, [[zA, 0], [zA, top0], [zC, 3.0], [-0.45, 3.0], [-0.45, 2.85], [zF, 2.85], [Math.min(zG, zA - 0.01), 0]].map(([z, y]) => [z, y]), [], M.trim);
      // panelling (beadboard) under the stairs — with a small cupboard opening
      const cup = { a0: 0.35, a1: 0.95, y0: 0.08, y1: 1.3 };
      extrudeWall('z', 5.5, 5.53, [[Math.min(zG, zA - 0.01), 0], [-0.64, 0], [-0.64, 2.8], [zF, 2.8]], [cup], M.bead, { name: 'house.understair', cast: true });
      box(5.505, 0.08, cup.a0, 5.535, cup.y1, cup.a1, M.void);                               // dark cupboard interior (closed)
      // cupboard door (decorative) + frame
      box(5.49, cup.y0 + 0.01, cup.a0 + 0.01, 5.505, cup.y1 - 0.01, cup.a1 - 0.01, M.doorCream);
      box(5.485, cup.y0 + 0.1, cup.a0 + 0.06, 5.49, cup.y0 + 0.16, cup.a1 - 0.06, M.trim);     // ledges
      box(5.485, cup.y1 - 0.16, cup.a0 + 0.06, 5.49, cup.y1 - 0.1, cup.a1 - 0.06, M.trim);
      box(5.48, cup.y0 - 0.02, cup.a0 - 0.06, 5.505, cup.y1 + 0.06, cup.a0, M.trim);           // casing
      box(5.48, cup.y0 - 0.02, cup.a1, 5.505, cup.y1 + 0.06, cup.a1 + 0.06, M.trim);
      box(5.48, cup.y1, cup.a0 - 0.06, 5.505, cup.y1 + 0.06, cup.a1 + 0.06, M.trim);
      U.sphere(S, 0.022, M.brass, 5.47, 0.72, cup.a1 - 0.08, { w: 10, h: 8 });
      box(5.478, 0.7, cup.a1 - 0.085, 5.49, 0.745, cup.a1 - 0.075, M.brass);
      skirtZ(Math.min(zG, zA - 0.01), -0.625, 5.5, -1);
    }
    // banister: newels, balusters, handrail
    const railY = z => noseY(z) + 0.85;
    const BX = 5.505;
    box(BX - 0.05, 0, 3.47, BX + 0.05, 1.2, 3.57, M.dark);                                     // bottom newel
    box(BX - 0.065, 1.2, 3.455, BX + 0.065, 1.24, 3.585, M.dark);
    U.sphere(S, 0.05, M.dark, BX, 1.27, 3.52, { w: 12, h: 8 });
    box(BX - 0.05, 2.75, -0.5, BX + 0.05, 4.05, -0.4, M.dark);                                 // top newel
    box(BX - 0.065, 4.05, -0.515, BX + 0.065, 4.09, -0.385, M.dark);
    {
      const z0 = 3.47, z1 = -0.4, y0 = railY(z0), y1 = railY(z1);
      const len = Math.hypot(z0 - z1, y1 - y0), ang = Math.atan2(y1 - y0, z0 - z1);
      U.box(S, 0.07, 0.06, len, M.dark, BX, (y0 + y1) / 2, (z0 + z1) / 2, { rx: ang, round: 0.012 });
      for (let i = 1; i <= ST.n; i++) {
        const zf = ST.zBot - ST.run * (i - 1);
        for (const off of [0.07, 0.2]) {
          const z = zf - off; if (z > 3.4 || z < -0.35) continue;
          const yb = stringerTop(z), yt = railY(z) - 0.02;
          box(BX - 0.017, yb - 0.02, z - 0.017, BX + 0.017, yt, z + 0.017, M.trim);
        }
      }
    }
    wall(5.42, 0, -0.45, 5.52, 4.05, 3.6, 'banister', 'railing', { blocksInteract: false });
    wall(5.42, 0, -0.625, 5.54, 2.8, -0.45, 'understairEnd');
    // upstairs railings: along x = 5.47 (z −0.4 → 3.7) and south of the stairwell (z = 2.4)
    const railRun = (ax, fixed, a0, a1, yBase, yTop, name) => {   // ax 'z' → runs along z at x = fixed
      const len = a1 - a0;
      const n = Math.max(1, Math.round(len / 0.12));
      for (let k = 1; k < n; k++) {
        const a = a0 + len * k / n;
        if (ax === 'z') box(fixed - 0.016, yBase, a - 0.016, fixed + 0.016, yTop - 0.03, a + 0.016, M.trim);
        else box(a - 0.016, yBase, fixed - 0.016, a + 0.016, yTop - 0.03, fixed + 0.016, M.trim);
      }
      if (ax === 'z') {
        box(fixed - 0.04, yTop - 0.04, a0, fixed + 0.04, yTop + 0.02, a1, M.dark, { round: 0.01 });
        box(fixed - 0.03, yBase, a0, fixed + 0.03, yBase + 0.05, a1, M.trim);
      } else {
        box(a0, yTop - 0.04, fixed - 0.04, a1, yTop + 0.02, fixed + 0.04, M.dark, { round: 0.01 });
        box(a0, yBase, fixed - 0.03, a1, yBase + 0.05, fixed + 0.03, M.trim);
      }
    };
    railRun('z', BX, -0.4, 2.36, 3.0, 3.97, 'railW');
    railRun('z', BX, 2.46, 3.66, 3.0, 3.97, 'railW2');
    railRun('x', 2.42, 5.55, 6.75, 3.0, 3.97, 'railS');
    box(BX - 0.05, 2.9, 2.36, BX + 0.05, 4.05, 2.46, M.dark);                                  // corner newel
    box(BX - 0.05, 2.9, 3.66, BX + 0.05, 4.05, 3.76, M.dark);                                  // end newel
    wall(5.52, 3.0, 2.35, 6.75, 4.0, 2.45, 'railSouth', 'railing', { blocksInteract: false });

    // -----------------------------------------------------------------------------------------------------------------
    // Loft: eave colliders, knee-wall trim, sloped ceiling, rafters, ridge beam, collar ties
    // -----------------------------------------------------------------------------------------------------------------
    wall(-6.75, 3.0, 3.7, 6.75, 7.5, 4.75, 'eaveS', 'eave', { blocksInteract: false });
    wall(-6.75, 3.0, -4.75, 6.75, 7.5, -3.7, 'eaveN', 'eave', { blocksInteract: false });
    for (const sz of [-1, 1]) box(-6.75, 4.06, sz * 4.75, 6.75, 4.16, sz * (4.75 - 0.03), M.trim);
    const skyHoles = side => SKYLIGHTS.filter(k => k.side === side).map(k => {
      const u0 = Math.min(uOf(side, k.x0), uOf(side, k.x1)), u1 = Math.max(uOf(side, k.x0), uOf(side, k.x1));
      return { u0, u1, s0: sOf(Math.min(Math.abs(k.z0), Math.abs(k.z1))), s1: sOf(Math.max(Math.abs(k.z0), Math.abs(k.z1))) };
    });
    for (const side of [1, -1]) {
      const holes = skyHoles(side);
      const sKnee = sOf(4.8);
      // ceiling boards (inside)
      slopeSlab(side, [[-6.8, 0], [6.8, 0], [6.8, sKnee], [-6.8, sKnee]], holes, -0.025, 0, M.ceil, { name: 'house.loftCeiling' });
      // roof structure (soffit colour) and shingle layer
      const out = [[-7.4, S_RIDGE], [7.4, S_RIDGE], [7.4, S_EAVE], [-7.4, S_EAVE]];
      slopeSlab(side, out, holes, 0, ROOF_T - 0.05, M.trim, { name: 'house.roofDeck' });
      slopeSlab(side, out, holes, ROOF_T - 0.052, ROOF_T, M.shingles, { name: 'house.shingles' });
      // rafters
      for (const x of RAFTERS) slopeBox(side, x - 0.05, x + 0.05, 0, sOf(4.74), -0.16, -0.02, M.dark);
      // barge boards + fascia
      for (const sx of [-1, 1]) slopeBox(side, sx * 7.37, sx * 7.43, S_RIDGE - 0.02, S_EAVE + 0.03, -0.14, ROOF_T + 0.015, M.trim);
      slopeBox(side, -7.43, 7.43, S_EAVE, S_EAVE + 0.03, -0.14, ROOF_T + 0.015, M.trim);
    }
    // ridge beam + ridge cap
    box(-6.78, 7.12, -0.11, 6.78, 7.49, 0.11, M.dark, { name: 'house.ridgeBeam' });
    U.cyl(S, 0.085, 0.085, 14.86, M.ridge, 0, 7.73, 0, { rz: Math.PI / 2, radial: 14 });
    for (const x of COLLARS) box(x - 0.035, 6.2, -1.62, x + 0.035, 6.34, 1.62, M.dark);

    // -----------------------------------------------------------------------------------------------------------------
    // Gutters, downspouts, splash blocks
    // -----------------------------------------------------------------------------------------------------------------
    for (const sz of [-1, 1]) {
      const zb = sz * 5.555, zf = sz * 5.72;
      box(-7.42, 3.38, zb, 7.42, 3.52, zb + sz * 0.012, M.metal);               // back
      box(-7.42, 3.37, zb, 7.42, 3.385, zf, M.metal);                            // bottom
      box(-7.42, 3.37, zf - sz * 0.012, 7.42, 3.5, zf, M.metal);                 // front
      box(-7.42, 3.49, zf - sz * 0.02, 7.42, 3.51, zf + sz * 0.008, M.metal, { round: 0.004 });  // rolled lip
      for (const sx of [-1, 1]) box(sx * 7.42, 3.37, zb, sx * 7.41, 3.51, zf, M.metal);        // end caps
      for (const sx of [-1, 1]) {
        const x = sx * 7.1, zo = sz * 5.15, zg = sz * 5.64;
        U.cyl(S, 0.04, 0.04, 0.12, M.metal, x, 3.33, zg, { radial: 10 });
        const dz = zo - zg, dy = 3.0 - 3.27, len = Math.hypot(dz, dy);
        U.cyl(S, 0.04, 0.04, len + 0.04, M.metal, x, (3.27 + 3.0) / 2, (zg + zo) / 2, { radial: 10, rx: Math.atan2(dz, -dy) * 1 });
        U.cyl(S, 0.04, 0.04, 3.3, M.metal, x, 3.0 - 1.65, zo, { radial: 10 });
        U.cyl(S, 0.055, 0.042, 0.1, M.metal, x, -0.25, zo, { radial: 10 });
        for (const y of [0.6, 1.8, 2.8]) box(sx * 7.0, y - 0.02, zo - 0.012, x, y + 0.02, zo + 0.012, M.metalDark);
        box(x - 0.16, -0.46, zo - sz * 0.05, x + 0.16, -0.415, zo + sz * 0.55, M.concrete);   // splash block
      }
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Chimney stack (outside the west wall)
    // -----------------------------------------------------------------------------------------------------------------
    box(-7.9, -0.45, 1.8, -6.95, 8.2, 3.2, M.stone, { name: 'house.chimney' });
    box(-7.97, 7.85, 1.73, -6.93, 7.95, 3.27, M.stone);
    box(-7.99, 8.2, 1.71, -6.91, 8.3, 3.29, M.concrete);
    U.cyl(S, 0.11, 0.13, 0.32, C.mat('ceramicTerracotta'), -7.45, 8.46, 2.5, { radial: 14 });
    U.cyl(S, 0.125, 0.125, 0.04, C.mat('ceramicTerracotta'), -7.45, 8.6, 2.5, { radial: 14 });
    wall(-7.9, -0.45, 1.8, -6.95, 8.4, 3.2, 'chimney');
    // lead flashing where the stack passes the verge
    box(-7.42, yu(1.8) + 0.2, 1.75, -6.95, yu(1.8) + 0.32, 1.82, M.metalDark);

    // -----------------------------------------------------------------------------------------------------------------
    // Porch: deck, skirt, steps, posts, beam, roof, railings
    // -----------------------------------------------------------------------------------------------------------------
    box(1.2, -0.06, 5.0, 6.8, 0, 7.23, M.porch, { name: 'house.porchDeck' });
    box(1.18, -0.24, 7.2, 6.82, -0.04, 7.235, M.trim);                      // front fascia
    for (const x of [1.18, 6.79]) box(x, -0.24, 5.0, x + 0.03, -0.04, 7.235, M.trim);
    box(1.25, -0.45, 5.05, 6.75, -0.07, 7.15, M.void);                      // dark crawlspace
    box(1.22, -0.45, 7.19, 6.78, -0.24, 7.2, M.lattice, { name: 'house.lattice' });
    for (const x of [1.21, 6.78]) box(x, -0.45, 5.02, x + 0.01, -0.24, 7.19, M.lattice);
    wall(1.2, -0.45, 5.0, 6.8, -0.05, 7.2, 'porchSkirt', 'porch', { blocksInteract: false });
    // steps
    box(3.0, -0.19, 7.2, 4.5, -0.15, 7.52, M.porch);
    box(3.02, -0.45, 7.22, 4.48, -0.19, 7.5, M.trim);
    box(3.0, -0.34, 7.5, 4.5, -0.30, 7.82, M.porch);
    box(3.02, -0.45, 7.5, 4.48, -0.34, 7.8, M.trim);
    for (const x of [2.96, 4.5]) extrudeWall('z', x, x + 0.04, [[7.2, -0.45], [7.84, -0.45], [7.84, -0.33], [7.52, -0.18], [7.2, -0.02]], [], M.trim);
    // posts + beam
    const POSTS = [1.3, 2.85, 4.65, 6.7];
    for (const x of POSTS) {
      box(x - 0.07, 0, 7.03, x + 0.07, 2.44, 7.17, M.trim, { name: 'house.porchPost' });
      box(x - 0.09, 0, 7.01, x + 0.09, 0.14, 7.19, M.trim);
      box(x - 0.09, 2.3, 7.01, x + 0.09, 2.36, 7.19, M.trim);
      wall(x - 0.07, 0, 7.03, x + 0.07, 2.5, 7.17, 'porchPost', 'post', { blocksInteract: false });
    }
    box(1.0, 2.44, 7.02, 7.0, 2.66, 7.18, M.trim, { name: 'house.porchBeam' });
    // knee braces
    for (const x of POSTS) for (const dir of [-1, 1]) {
      if ((x === 1.3 && dir < 0) || (x === 6.7 && dir > 0)) continue;
      U.box(S, 0.34, 0.06, 0.06, M.trim, x + dir * 0.14, 2.3, 7.1, { rz: dir * Math.PI / 4 });
    }
    // shed roof (underside 3.2 at z=5 → 2.6 at z=7.4), haint-blue beadboard ceiling, shingles
    {
      const under = z => 3.2 - 0.25 * (z - 5.0);
      extrudeWall('z', 1.0, 7.0, [[4.99, under(4.99) + 0.004], [7.4, under(7.4) + 0.004], [7.4, under(7.4) + 0.05], [4.99, under(4.99) + 0.05]], [], M.trim, { name: 'house.porchRoofDeck' });
      extrudeWall('z', 1.02, 6.98, [[4.99, under(4.99) - 0.008], [7.36, under(7.36) - 0.008], [7.36, under(7.36) + 0.006], [4.99, under(4.99) + 0.006]], [], M.haint, { name: 'house.porchCeiling' });
      extrudeWall('z', 0.98, 7.02, [[4.99, under(4.99) + 0.048], [7.44, under(7.44) + 0.048], [7.44, under(7.44) + 0.072], [4.99, under(4.99) + 0.072]], [], M.shingles, { name: 'house.porchShingles', uv: true });
      box(0.98, under(7.4) - 0.07, 7.4, 7.02, under(7.4) + 0.075, 7.43, M.trim);      // front fascia
      for (const x of [0.97, 7.0]) extrudeWall('z', x, x + 0.03, [[4.99, under(4.99) - 0.07], [7.43, under(7.43) - 0.07], [7.43, under(7.43) + 0.075], [4.99, under(4.99) + 0.075]], [], M.trim);
      box(0.98, 3.265, 4.98, 7.02, 3.3, 5.07, M.metalDark);                           // flashing at the wall
    }
    // railings
    const porchRail = (ax, fixed, a0, a1) => {
      const len = a1 - a0, n = Math.max(1, Math.round(len / 0.13));
      for (let k = 1; k < n; k++) {
        const a = a0 + len * k / n;
        if (ax === 'x') box(a - 0.018, 0.1, fixed - 0.018, a + 0.018, 0.84, fixed + 0.018, M.trim);
        else box(fixed - 0.018, 0.1, a - 0.018, fixed + 0.018, 0.84, a + 0.018, M.trim);
      }
      if (ax === 'x') { box(a0, 0.84, fixed - 0.05, a1, 0.9, fixed + 0.05, M.trim); box(a0, 0.07, fixed - 0.03, a1, 0.12, fixed + 0.03, M.trim); }
      else { box(fixed - 0.05, 0.84, a0, fixed + 0.05, 0.9, a1, M.trim); box(fixed - 0.03, 0.07, a0, fixed + 0.03, 0.12, a1, M.trim); }
    };
    porchRail('x', 7.1, 1.37, 2.78); porchRail('x', 7.1, 4.72, 6.63);
    porchRail('z', 1.25, 5.0, 7.03); porchRail('z', 6.75, 5.0, 7.03);
    wall(1.3, 0, 7.05, 2.85, 1.0, 7.15, 'porchRailS1', 'railing', { blocksInteract: false });
    wall(4.65, 0, 7.05, 6.7, 1.0, 7.15, 'porchRailS2', 'railing', { blocksInteract: false });
    wall(1.2, 0, 5.0, 1.3, 1.0, 7.15, 'porchRailW', 'railing', { blocksInteract: false });
    wall(6.7, 0, 5.0, 6.8, 1.0, 7.15, 'porchRailE', 'railing', { blocksInteract: false });

    // -----------------------------------------------------------------------------------------------------------------
    // Windows
    // -----------------------------------------------------------------------------------------------------------------
    const glassPanes = [];
    const windows = [];
    const rotY = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };
    function addPane(parent, geo, pos, quatOrRotY, ud) {
      const m = new THREE.Mesh(geo, M.glass);
      m.position.set(pos[0], pos[1], pos[2]);
      if (typeof quatOrRotY === 'number') m.rotation.y = quatOrRotY; else m.quaternion.copy(quatOrRotY);
      m.name = 'house.glass.' + ud.windowId;
      m.userData = ud;
      m.renderOrder = 2;
      parent.add(m);
      glassPanes.push(m);
      return m;
    }
    function rectWindow(win) {
      const W = WALLS[win.wall], { a0, a1, y0, y1 } = win, w = a1 - a0, h = y1 - y0;
      const fw = 0.06, yb = y0 - 0.045;
      // frame (at the glass plane)
      wallBox(W, a0, a0 + fw, yb, y1, 0.035, 0.115, M.trim);
      wallBox(W, a1 - fw, a1, yb, y1, 0.035, 0.115, M.trim);
      wallBox(W, a0, a1, y1 - fw, y1, 0.035, 0.115, M.trim);
      wallBox(W, a0, a1, yb, y0 + 0.05, 0.035, 0.115, M.trim);
      const ia0 = a0 + fw, ia1 = a1 - fw, iy0 = y0 + 0.05, iy1 = y1 - fw;
      const nS = w > 1.9 ? 3 : w > 0.95 ? 2 : 1, mw = 0.05, sf = 0.035;
      const sw = (ia1 - ia0 - (nS - 1) * mw) / nS;
      for (let s = 0; s < nS; s++) {
        const sa0 = ia0 + s * (sw + mw), sa1 = sa0 + sw;
        if (s > 0) wallBox(W, sa0 - mw, sa0, iy0, iy1, 0.045, 0.105, M.trim);
        // sash frame
        wallBox(W, sa0, sa0 + sf, iy0, iy1, 0.05, 0.1, M.trim);
        wallBox(W, sa1 - sf, sa1, iy0, iy1, 0.05, 0.1, M.trim);
        wallBox(W, sa0, sa1, iy1 - sf, iy1, 0.05, 0.1, M.trim);
        wallBox(W, sa0, sa1, iy0, iy0 + sf + 0.01, 0.05, 0.1, M.trim);
        const la0 = sa0 + sf, la1 = sa1 - sf, ly0 = iy0 + sf + 0.01, ly1 = iy1 - sf;
        const cols = (la1 - la0) > 0.42 ? 2 : 1, rows = Math.max(2, Math.round((ly1 - ly0) / 0.36));
        const mu = 0.022;
        for (let c = 1; c < cols; c++) { const a = la0 + (la1 - la0) * c / cols; wallBox(W, a - mu / 2, a + mu / 2, ly0, ly1, 0.06, 0.09, M.trim); }
        for (let r = 1; r < rows; r++) { const y = ly0 + (ly1 - ly0) * r / rows; wallBox(W, la0, la1, y - mu / 2, y + mu / 2, 0.06, 0.09, M.trim); }
      }
      // glass
      const pw = ia1 - ia0, ph = iy1 - iy0;
      const pc = wallPoint(W, (ia0 + ia1) / 2, (iy0 + iy1) / 2, G_D);
      const pane = addPane(GLASS, new THREE.PlaneGeometry(pw, ph), pc, rotY[W.key], { windowId: win.id, normal: W.normal.slice(), w: pw, h: ph, skylight: false });
      // interior sill (deep, wooden), apron, casing
      const sill = wallAABB(W, a0 - 0.07, a1 + 0.07, y0 - 0.045, y0, 0.115, WT + 0.05);
      wallBox(W, a0 - 0.07, a1 + 0.07, y0 - 0.045, y0, 0.115, WT + 0.05, M.oak, { round: 0.006 });
      wallBox(W, a0 - 0.05, a1 + 0.05, y0 - 0.14, y0 - 0.045, WT - 0.004, WT + 0.018, M.trim);
      const cw = 0.085;
      wallBox(W, a0 - cw, a0, y0, y1 + cw, WT - 0.004, WT + 0.02, M.trim);
      wallBox(W, a1, a1 + cw, y0, y1 + cw, WT - 0.004, WT + 0.02, M.trim);
      wallBox(W, a0 - cw - 0.015, a1 + cw + 0.015, y1, y1 + cw + 0.01, WT - 0.004, WT + 0.024, M.trim);
      // exterior: casing, head with drip cap, sloped sill
      const ec = 0.1;
      wallBox(W, a0 - ec, a0, y0 - 0.03, y1, -0.026, 0.01, M.trim);
      wallBox(W, a1, a1 + ec, y0 - 0.03, y1, -0.026, 0.01, M.trim);
      wallBox(W, a0 - ec, a1 + ec, y1, y1 + 0.13, -0.026, 0.01, M.trim);
      wallBox(W, a0 - ec - 0.03, a1 + ec + 0.03, y1 + 0.13, y1 + 0.16, -0.055, 0.01, M.trim);
      wallBox(W, a0 - ec - 0.03, a1 + ec + 0.03, y0 - 0.085, y0 - 0.03, -0.065, G_D, M.trim);
      if (win.shutters) shutters(W, win);
      if (win.box) windowBox(W, win);
      windows.push({
        id: win.id, wall: W.name, type: 'rect', normal: W.normal.slice(), axis: W.axis,
        span: [a0, a1], y0, y1, w, h, center: pc, glassPlane: wp(W, G_D), pane,
        sill: { top: y0, min: sill.min, max: sill.max, depth: WT + 0.05 - 0.115 },
      });
    }
    function roundWindow(win) {
      const W = WALLS[win.wall], { a, y, r } = win;
      wallRing(W, a, y, r - 0.07, r, 0.035, 0.115, M.trim);
      wallBox(W, a - 0.012, a + 0.012, y - r + 0.05, y + r - 0.05, 0.06, 0.09, M.trim);
      wallBox(W, a - r + 0.05, a + r - 0.05, y - 0.012, y + 0.012, 0.06, 0.09, M.trim);
      wallRing(W, a, y, r, r + 0.11, -0.026, 0.01, M.trim);                        // exterior casing
      for (let k = 0; k < 4; k++) {                                                   // keystones
        const an = k * Math.PI / 2, ca = Math.cos(an), sa = Math.sin(an);
        wallBox(W, a + ca * (r + 0.06) - 0.045, a + ca * (r + 0.06) + 0.045, y + sa * (r + 0.06) - 0.045, y + sa * (r + 0.06) + 0.045, -0.034, 0.0, M.trim);
      }
      wallRing(W, a, y, r, r + 0.08, WT - 0.004, WT + 0.02, M.trim);                  // interior casing
      const pc = wallPoint(W, a, y, G_D);
      const pane = addPane(GLASS, new THREE.CircleGeometry(r - 0.04, 40), pc, rotY[W.key], { windowId: win.id, normal: W.normal.slice(), w: 2 * (r - 0.04), h: 2 * (r - 0.04), skylight: false });
      windows.push({ id: win.id, wall: W.name, type: 'round', normal: W.normal.slice(), axis: W.axis, center: pc, r, w: 2 * r, h: 2 * r, y0: y - r, y1: y + r, span: [a - r, a + r], glassPlane: wp(W, G_D), pane });
    }
    function shutters(W, win) {
      const { a0, a1, y0, y1 } = win;
      const sw = Math.min((a1 - a0) / 2, 0.55), ec = 0.1;
      for (const side of [-1, 1]) {
        const s0 = side < 0 ? a0 - ec - 0.02 - sw : a1 + ec + 0.02, s1 = s0 + sw;
        const sy0 = y0 - 0.02, sy1 = y1 + 0.02, dd0 = -0.06, dd1 = -0.03;
        wallBox(W, s0, s0 + 0.05, sy0, sy1, dd0, dd1, M.shutter);
        wallBox(W, s1 - 0.05, s1, sy0, sy1, dd0, dd1, M.shutter);
        wallBox(W, s0, s1, sy0, sy0 + 0.07, dd0, dd1, M.shutter);
        wallBox(W, s0, s1, sy1 - 0.07, sy1, dd0, dd1, M.shutter);
        const ym = (sy0 + sy1) / 2;
        wallBox(W, s0, s1, ym - 0.035, ym + 0.035, dd0, dd1, M.shutter);
        wallBox(W, s0 + 0.04, s1 - 0.04, sy0 + 0.05, sy1 - 0.05, dd0 + 0.022, dd1, M.shutter);   // back panel
        for (const [ya, yb] of [[sy0 + 0.07, ym - 0.035], [ym + 0.035, sy1 - 0.07]]) {
          const n = Math.max(2, Math.round((yb - ya) / 0.055));
          for (let k = 0; k < n; k++) {
            const yy = ya + (yb - ya) * (k + 0.5) / n;
            wallBoxTilt(W, (s0 + s1) / 2, yy, -0.045, sw - 0.1, 0.05, 0.008, 0.6, M.shutter);
          }
        }
        // holdback
        wallBox(W, side < 0 ? s0 - 0.03 : s1, side < 0 ? s0 : s1 + 0.03, ym - 0.01, ym + 0.01, -0.03, 0.0, M.iron);
      }
    }
    const FLOWER_MATS = () => [M.flowerRed, M.flowerPink, M.flowerWhite, M.flowerPurple];
    function windowBox(W, win) {
      const { a0, a1, y0 } = win;
      const rnd = U.rng(Math.round((a0 + 11) * 100) + win.wall.charCodeAt(0));
      const b0 = a0 - 0.06, b1 = a1 + 0.06, yb0 = y0 - 0.36, yb1 = y0 - 0.13, d0 = -0.3, d1 = -0.08;
      wallBox(W, b0, b1, yb0, yb1, d0, d1, M.shutter);
      wallBox(W, b0 - 0.015, b1 + 0.015, yb1 - 0.03, yb1, d0 - 0.015, d1, M.shutter);
      wallBox(W, b0 + 0.02, b1 - 0.02, yb1 - 0.05, yb1 - 0.02, d0 + 0.02, d1 - 0.02, M.soil);
      for (const a of [b0 + 0.15, b1 - 0.15]) wallBox(W, a - 0.02, a + 0.02, yb0 - 0.14, yb0, -0.26, 0, M.iron);
      const fm = FLOWER_MATS();
      const n = Math.round((b1 - b0) / 0.09);
      for (let k = 0; k < n; k++) {
        const a = b0 + 0.06 + (b1 - b0 - 0.12) * (k + rnd() * 0.6) / n;
        const d = d0 + 0.05 + rnd() * 0.12, yy = yb1 - 0.02;
        const p = wallPoint(W, a, yy + 0.05 + rnd() * 0.03, d);
        U.sphere(S, 0.055 + rnd() * 0.03, rnd() < 0.5 ? M.leaf : M.leafDark, p[0], p[1], p[2], { w: 7, h: 5, sy: 0.8 });
        if (rnd() < 0.75) {
          const mat = fm[Math.floor(rnd() * fm.length)];
          const q = wallPoint(W, a + (rnd() - 0.5) * 0.05, yy + 0.1 + rnd() * 0.07, d + (rnd() - 0.5) * 0.05);
          for (let j = 0; j < 3; j++) U.sphere(S, 0.022 + rnd() * 0.01, mat, q[0] + (rnd() - 0.5) * 0.05, q[1] + rnd() * 0.03, q[2] + (rnd() - 0.5) * 0.05, { w: 6, h: 4 });
        }
        if (rnd() < 0.35) {    // trailing ivy
          const len = 0.15 + rnd() * 0.25;
          const q = wallPoint(W, a, yb1 - len / 2 - 0.01, d0 - 0.012);
          if (W.axis === 'x') box(q[0] - 0.012, q[1] - len / 2, q[2] - 0.01, q[0] + 0.012, q[1] + len / 2, q[2] + 0.01, M.leafDark);
          else box(q[0] - 0.01, q[1] - len / 2, q[2] - 0.012, q[0] + 0.01, q[1] + len / 2, q[2] + 0.012, M.leafDark);
          for (let j = 0; j < 3; j++) U.sphere(S, 0.02, M.leaf, q[0], q[1] - len / 2 + j * len / 3, q[2], { w: 5, h: 4 });
        }
      }
    }
    for (const w of WINDOWS) (w.round ? roundWindow : rectWindow)(w);

    // skylights
    for (const k of SKYLIGHTS) {
      const side = k.side, s0 = sOf(Math.min(Math.abs(k.z0), Math.abs(k.z1))), s1 = sOf(Math.max(Math.abs(k.z0), Math.abs(k.z1)));
      const fr = 0.07, tb = ROOF_T - 0.01, tt = ROOF_T + 0.1;
      slopeBox(side, k.x0 - fr, k.x0, s0 - fr, s1 + fr, tb, tt, M.metalDark);
      slopeBox(side, k.x1, k.x1 + fr, s0 - fr, s1 + fr, tb, tt, M.metalDark);
      slopeBox(side, k.x0, k.x1, s0 - fr, s0, tb, tt, M.metalDark);
      slopeBox(side, k.x0, k.x1, s1, s1 + fr, tb, tt - 0.03, M.metalDark);
      slopeBox(side, (k.x0 + k.x1) / 2 - 0.012, (k.x0 + k.x1) / 2 + 0.012, s0, s1, tt - 0.04, tt - 0.015, M.metalDark);
      // interior lining + trim
      for (const [xa, xb, sa, sb] of [[k.x0 - 0.02, k.x0, s0, s1], [k.x1, k.x1 + 0.02, s0, s1], [k.x0 - 0.02, k.x1 + 0.02, s0 - 0.02, s0], [k.x0 - 0.02, k.x1 + 0.02, s1, s1 + 0.02]]) slopeBox(side, xa, xb, sa, sb, -0.03, tb, M.trim);
      for (const [xa, xb, sa, sb] of [[k.x0 - 0.08, k.x0, s0 - 0.08, s1 + 0.08], [k.x1, k.x1 + 0.08, s0 - 0.08, s1 + 0.08], [k.x0, k.x1, s0 - 0.08, s0], [k.x0, k.x1, s1, s1 + 0.08]]) slopeBox(side, xa, xb, sa, sb, -0.045, -0.02, M.trim);
      const cx = (k.x0 + k.x1) / 2, cs = (s0 + s1) / 2;
      const pc = slopePoint(side, cx, cs, tt - 0.03);
      const q = new THREE.Quaternion().setFromRotationMatrix(SLOPE[side]);
      const pw = k.x1 - k.x0, ph = s1 - s0;
      const normal = [0, CA, side * SA];
      const pane = addPane(GLASS, new THREE.PlaneGeometry(pw, ph), [pc.x, pc.y, pc.z], q, { windowId: k.id, normal, w: pw, h: ph, skylight: true });
      windows.push({ id: k.id, wall: side > 0 ? 'roofS' : 'roofN', type: 'skylight', normal, center: [pc.x, pc.y, pc.z], w: pw, h: ph, plan: { x0: k.x0, x1: k.x1, z0: k.z0, z1: k.z1 }, pane });
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Door frames / casings / archway
    // -----------------------------------------------------------------------------------------------------------------
    // front door frame
    {
      const W = WALLS.S;
      wallBox(W, 3.25, 3.3, 0, 2.15, 0.0, WT, M.trim);
      wallBox(W, 4.2, 4.25, 0, 2.15, 0.0, WT, M.trim);
      wallBox(W, 3.25, 4.25, 2.1, 2.15, 0.0, WT, M.trim);
      wallBox(W, 3.3, 3.32, 0.02, 2.1, 0.12, 0.155, M.trim);                                // stops
      wallBox(W, 4.18, 4.2, 0.02, 2.1, 0.12, 0.155, M.trim);
      wallBox(W, 3.3, 4.2, 2.08, 2.1, 0.12, 0.155, M.trim);
      wallBox(W, 3.25, 4.25, -0.02, 0.018, -0.05, WT + 0.01, M.oak);                         // threshold
      // exterior casing + cornice
      wallBox(W, 3.12, 3.25, 0, 2.15, -0.03, 0.01, M.trim);
      wallBox(W, 4.25, 4.38, 0, 2.15, -0.03, 0.01, M.trim);
      wallBox(W, 3.12, 4.38, 2.15, 2.33, -0.03, 0.01, M.trim);
      wallBox(W, 3.07, 4.43, 2.33, 2.37, -0.075, 0.01, M.trim);
      wallBox(W, 3.1, 4.4, 2.37, 2.4, -0.06, 0.01, M.trim);
      // interior casing
      wallBox(W, 3.16, 3.25, 0, 2.15, WT - 0.004, WT + 0.022, M.trim);
      wallBox(W, 4.25, 4.34, 0, 2.15, WT - 0.004, WT + 0.022, M.trim);
      wallBox(W, 3.14, 4.36, 2.15, 2.25, WT - 0.004, WT + 0.026, M.trim);
    }
    // partition door linings + casings. P1 (x 1.925..2.075) openings D1/D2, P2 (z −0.775..−0.625) opening D3
    const liningP1 = (z0, z1, hgt, withStop) => {
      box(1.92, 0, z0, 2.08, hgt, z0 + 0.03, M.trim);
      box(1.92, 0, z1 - 0.03, 2.08, hgt, z1, M.trim);
      box(1.92, hgt - 0.03, z0, 2.08, hgt, z1, M.trim);
      for (const [x0, x1] of [[1.9, 1.925], [2.075, 2.1]]) {
        box(x0, 0, z0 - 0.09, x1, hgt + 0.09, z0, M.trim);
        box(x0, 0, z1, x1, hgt + 0.09, z1 + 0.09, M.trim);
        box(x0, hgt, z0 - 0.1, x1 + (x0 < 2 ? -0.004 : 0.004), hgt + 0.1, z1 + 0.1, M.trim);
      }
      if (withStop) { box(1.99, 0.01, z0 + 0.03, 2.015, hgt - 0.03, z0 + 0.045, M.trim); box(1.99, 0.01, z1 - 0.045, 2.015, hgt - 0.03, z1 - 0.03, M.trim); box(1.99, hgt - 0.045, z0, 2.015, hgt - 0.03, z1, M.trim); }
    };
    liningP1(-3.1, -2.2, 2.05, true);
    liningP1(1.4, 2.6, 2.25, false);
    {
      const x0 = 2.6, x1 = 3.5, hgt = 2.05;
      box(x0, 0, -0.78, x0 + 0.03, hgt, -0.62, M.trim);
      box(x1 - 0.03, 0, -0.78, x1, hgt, -0.62, M.trim);
      box(x0, hgt - 0.03, -0.78, x1, hgt, -0.62, M.trim);
      for (const [z0, z1] of [[-0.8, -0.775], [-0.625, -0.6]]) {
        box(x0 - 0.09, 0, z0, x0, hgt + 0.09, z1, M.trim);
        box(x1, 0, z0, x1 + 0.09, hgt + 0.09, z1, M.trim);
        box(x0 - 0.1, hgt, z0 + (z0 < -0.7 ? -0.004 : 0), x1 + 0.1, hgt + 0.1, z1 + (z0 < -0.7 ? 0 : 0.004), M.trim);
      }
      box(x0 + 0.03, 0.01, -0.715, x0 + 0.045, hgt - 0.03, -0.69, M.trim);
      box(x1 - 0.045, 0.01, -0.715, x1 - 0.03, hgt - 0.03, -0.69, M.trim);
      box(x0, hgt - 0.045, -0.715, x1, hgt - 0.03, -0.69, M.trim);
    }

    // -----------------------------------------------------------------------------------------------------------------
    // Doors (dynamic; interactables)
    // -----------------------------------------------------------------------------------------------------------------
    const doors = {};
    function makeDoor({ id, label, pivot, leaf, openAngle, closedBox, openBox, center, build }) {
      const g = new THREE.Group(); g.name = 'house.door.' + id; g.userData.dynamic = true;
      g.position.set(pivot[0], pivot[1], pivot[2]);
      DYN.add(g);
      build(g);
      U.bakeStatic(g);
      const col = P.addBox(closedBox[0], closedBox[1], { tag: 'door', name: 'house.' + id });
      colliders.push(col);
      const d = {
        id, object: g, collider: col, isOpen: false, angle: 0, target: 0, openAngle, center,
        get open() { return this.isOpen; },
        setOpen(v, instant) {
          v = !!v;
          if (v === this.isOpen && !instant) return;
          this.isOpen = v;
          this.target = v ? openAngle : 0;
          if (v) col.set(openBox[0], openBox[1]); else col.set(closedBox[0], closedBox[1]);
          if (instant) { this.angle = this.target; g.rotation.y = this.angle; }
          C.emit('door', { id, open: v, x: center[0], y: center[1], z: center[2] });
        },
        toggle() { this.setOpen(!this.isOpen); return this.isOpen; },
      };
      C.interact.add({ id, object: g, label: () => (d.isOpen ? 'Close ' : 'Open ') + label, onUse: () => d.toggle(), ignore: [col] });
      return d;
    }
    // front door: leaf x 3.3→4.2, z 4.79→4.84, hinge x 3.3, swings inward (−Z) 100°
    doors.front = makeDoor({
      id: 'door_front', label: 'the front door', pivot: [3.3, 0, 4.79], openAngle: THREE.MathUtils.degToRad(100),
      closedBox: [[3.25, -0.45, 4.75], [4.25, 2.15, 5.0]], openBox: [[3.13, 0, 3.88], [3.36, 2.15, 4.8]], center: [3.75, 1.05, 4.85],
      build(g) {
        const T = 0.05, Wd = 0.9, Hh = 2.1, yb = 0.015;
        const L = (x0, y0, z0, x1, y1, z1, mat, o) => U.boxAt(g, x0, y0, z0, x1, y1, z1, mat, o);
        const wx0 = 0.22, wx1 = 0.68, wy0 = 1.42, wy1 = 1.9;
        L(0, yb, 0, Wd, wy0, T, M.doorGreen);
        L(0, wy1, 0, Wd, Hh, T, M.doorGreen);
        L(0, wy0, 0, wx0, wy1, T, M.doorGreen);
        L(wx1, wy0, 0, Wd, wy1, T, M.doorGreen);
        // window frame + muntins (both faces)
        for (const [z0, z1] of [[-0.012, 0.0], [T, T + 0.012]]) {
          L(wx0 - 0.03, wy0 - 0.03, z0, wx1 + 0.03, wy0, z1, M.green);
          L(wx0 - 0.03, wy1, z0, wx1 + 0.03, wy1 + 0.03, z1, M.green);
          L(wx0 - 0.03, wy0, z0, wx0, wy1, z1, M.green);
          L(wx1, wy0, z0, wx1 + 0.03, wy1, z1, M.green);
        }
        L((wx0 + wx1) / 2 - 0.012, wy0, 0.005, (wx0 + wx1) / 2 + 0.012, wy1, T - 0.005, M.green);
        L(wx0, (wy0 + wy1) / 2 - 0.012, 0.005, wx1, (wy0 + wy1) / 2 + 0.012, T - 0.005, M.green);
        // exterior raised rails (planked look) + small shelf under the lites
        L(0.06, 0.12, T, Wd - 0.06, 0.24, T + 0.014, M.green);
        L(0.06, 0.95, T, Wd - 0.06, 1.07, T + 0.014, M.green);
        L(wx0 - 0.06, wy0 - 0.07, T, wx1 + 0.06, wy0 - 0.03, T + 0.03, M.green);
        // brass: knob (both sides), knocker, letter plate
        for (const [zz, dir] of [[T, 1], [0, -1]]) {
          U.cyl(g, 0.035, 0.035, 0.012, M.brass, 0.8, 1.0, zz + dir * 0.006, { rx: Math.PI / 2, radial: 16 });
          U.cyl(g, 0.008, 0.008, 0.05, M.brass, 0.8, 1.0, zz + dir * 0.03, { rx: Math.PI / 2, radial: 8 });
          U.sphere(g, 0.028, M.brass, 0.8, 1.0, zz + dir * 0.06, { w: 14, h: 10 });
        }
        L(0.39, 1.26, T, 0.51, 1.36, T + 0.012, M.brass);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 20), M.brass);
        ring.position.set(0.45, 1.25, T + 0.025); g.add(ring);
        L(0.36, 0.72, T, 0.54, 0.77, T + 0.008, M.brass);
        // strap hinges (black iron) on the exterior
        for (const y of [0.35, 1.75]) L(-0.005, y - 0.022, T, 0.42, y + 0.022, T + 0.006, M.iron);
        const pane = addPane(g, new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), [(wx0 + wx1) / 2, (wy0 + wy1) / 2, T / 2], 0,
          { windowId: 'door_front', normal: [0, 0, 1], w: wx1 - wx0, h: wy1 - wy0, skylight: false });
        pane.userData.door = true;
      },
    });
    const ledgedDoor = (g, along, width, thick, faceSign) => {
      // along 'z' → leaf spans local +z, thickness local −x..0; ledges on the face with normal +x*faceSign
      const Hh = 2.02, yb = 0.01;
      const L = (a0, y0, t0, a1, y1, t1, mat, o) => along === 'z' ? U.boxAt(g, t0, y0, a0, t1, y1, a1, mat, o) : U.boxAt(g, a0, y0, t0, a1, y1, t1, mat, o);
      const t0 = along === 'z' ? -thick : 0, t1 = along === 'z' ? 0 : thick;
      L(0, yb, t0, width, Hh, t1, M.doorCream);
      const face = faceSign > 0 ? t1 : t0, fd = faceSign * 0.022;
      const ledges = [0.22, 1.0, 1.78];
      for (const y of ledges) L(0.05, y - 0.07, Math.min(face, face + fd), width - 0.05, y + 0.07, Math.max(face, face + fd), M.trim);
      // braces between ledges (diagonal, rising from the hinge side)
      for (let i = 0; i < 2; i++) {
        const ya = ledges[i] + 0.07, yb2 = ledges[i + 1] - 0.07;
        const dx = width - 0.2, dy = yb2 - ya, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        const cA = width / 2, cY = (ya + yb2) / 2, cT = face + fd / 2;
        if (along === 'z') U.box(g, Math.abs(fd), 0.1, len, M.trim, cT, cY, cA, { rx: -ang });
        else U.box(g, len, 0.1, Math.abs(fd), M.trim, cA, cY, cT, { rz: ang });
      }
      // thumb latch + knob both sides
      for (const s of [1, -1]) {
        const tt = s > 0 ? t1 : t0;
        const p = along === 'z' ? [tt + s * 0.02, 1.0, width - 0.08] : [width - 0.08, 1.0, tt + s * 0.02];
        U.sphere(g, 0.026, M.iron, p[0], p[1], p[2], { w: 12, h: 8 });
        const pp = along === 'z' ? [tt + s * 0.004, 1.0, width - 0.08] : [width - 0.08, 1.0, tt + s * 0.004];
        U.cyl(g, 0.032, 0.032, 0.008, M.iron, pp[0], pp[1], pp[2], along === 'z' ? { rz: Math.PI / 2, radial: 14 } : { rx: Math.PI / 2, radial: 14 });
      }
      // hinges
      for (const y of [0.3, 1.72]) L(-0.004, y - 0.05, t0 - 0.002, 0.03, y + 0.05, t1 + 0.002, M.iron);
    };
    // D2 kitchen ↔ study: opening z −3.1→−2.2 in P1, hinge z −3.1 (+0.03 jamb), leaf on the study side, swings +X 95°
    doors.kitchenStudy = makeDoor({
      id: 'door_kitchen_study', label: 'the study door', pivot: [2.055, 0, -3.07], openAngle: THREE.MathUtils.degToRad(95),
      closedBox: [[1.925, 0, -3.1], [2.075, 2.05, -2.2]], openBox: [[2.03, 0, -3.18], [2.92, 2.05, -3.02]], center: [2.0, 1.0, -2.65],
      build(g) { ledgedDoor(g, 'z', 0.84, 0.035, 1); },
    });
    // D3 hall ↔ study: opening x 2.6→3.5 in P2, hinge x 2.6 (+0.03), leaf on the study side, swings −Z 95°
    doors.hallStudy = makeDoor({
      id: 'door_hall_study', label: 'the study door', pivot: [2.63, 0, -0.755], openAngle: THREE.MathUtils.degToRad(95),
      closedBox: [[2.6, 0, -0.775], [3.5, 2.05, -0.625]], openBox: [[2.53, 0, -1.62], [2.7, 2.05, -0.73]], center: [3.05, 1.0, -0.7],
      build(g) { ledgedDoor(g, 'x', 0.84, 0.035, -1); },
    });

    // -----------------------------------------------------------------------------------------------------------------
    // Bake + publish API
    // -----------------------------------------------------------------------------------------------------------------
    U.bakeStatic(S);
    const doorList = [doors.front, doors.kitchenStudy, doors.hallStudy];
    this._doors = doorList;

    C.house = {
      root, doors, windows, glassPanes, colliders, beams,
      levels: { ground: 0, ceiling: 2.8, upper: 3.0, eave: 4.0, ridgeUnder: 7.5, wallThickness: WT, interior: { x: 6.75, z: 4.75 } },
      wainscotY: WAIN, skirting: SK,
      stairs: { x0: ST.x0, x1: ST.x1, zBottom: ST.zBot, zTop: ST.zTop, risers: ST.n, rise: ST.rise, run: ST.run },
      roofUnderY: z => yu(z),
      roofY(x, z) {
        const ax = Math.abs(x), az = Math.abs(z);
        if (ax <= 7.4 && az <= 5.6) return 7.77 - 0.7 * az;
        if (x >= 1.0 && x <= 7.0 && z >= 5.0 && z <= 7.4) return 3.27 - 0.25 * (z - 5.0);
        if (x >= -7.9 && x <= -7.0 && z >= 1.8 && z <= 3.2) return 8.4;
        return null;
      },
      window: id => windows.find(w => w.id === id) || null,
    };
  },
  update(dt) {
    const ds = this._doors;
    if (!ds) return;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (d.angle === d.target) continue;
      const k = 1 - Math.exp(-7 * dt);
      d.angle += (d.target - d.angle) * k;
      if (Math.abs(d.target - d.angle) < 0.002) d.angle = d.target;
      d.object.rotation.y = d.angle;
    }
  },
});

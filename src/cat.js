// =====================================================================================================================
//  CAT — a small procedural ginger tabby, curled asleep. Module "cat", order 70.  (SPEC §9 cat, §8 'cat')
//
//  Built from signed-distance "clay" (smooth-unioned ellipsoids projected onto dense spheres) + tapered tubes, all
//  merged into ONE SkinnedMesh (fur, vertex-coloured coat) + ONE SkinnedMesh (glossy eyes & nose) that share a
//  hand-made 16-bone skeleton, plus a contact-shadow decal.  → 3 draw calls (+ shadow passes).
//
//  Animation (no per-frame allocations): breathing, ear twitches, tail-tip flicks, occasional sleepy look-around
//  (head lifts, eyes half open, slow blinks, looks at the player if near, lays back down), petting (purr, happy
//  squint, nuzzle, tail curl). Every few minutes the cat moves to another sleeping spot while nobody is looking.
//
//  Spots: C.living.catSpots, C.hallstudy.catBed, C.loft.catSpots (read at init; fallbacks from SPEC).
//  Spot convention: position = surface point under the cat's belly, rotationY = direction the cat's face/front points
//  (props convention: 0 → +Z, π/2 → +X, π → −Z, −π/2 → −X).
//  API: C.cat = { spot, spots, relocate(name), pet(), root, state }
// =====================================================================================================================
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const C = window.COZY;

// ------------------------------------------------------------------------------------------------ SDF helpers
function sdEll(px, py, pz, e) {
  const x = (px - e[0]) / e[3], y = (py - e[1]) / e[4], z = (pz - e[2]) / e[5];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt(x * x / (e[3] * e[3]) + y * y / (e[4] * e[4]) + z * z / (e[5] * e[5]));
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(e[3], e[4], e[5]);
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// Project a dense icosphere onto the zero set of sdf (searching inward from outside along rays from `c`).
function sdfMesh(sdf, c, rMax, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5);
  const pos = g.attributes.position, nor = new Float32Array(pos.count * 3);
  const step = 0.0025, eps = 0.0006;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i), dy = pos.getY(i), dz = pos.getZ(i);
    let t = rMax, found = false;
    let prev = rMax;
    while (t > 0) {
      const d = sdf(c[0] + dx * t, c[1] + dy * t, c[2] + dz * t);
      if (d < 0) { found = true; break; }
      prev = t; t -= Math.max(d * 0.6, step * 0.5);
    }
    let lo = Math.max(0, t), hi = found ? prev : 0.002;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (sdf(c[0] + dx * m, c[1] + dy * m, c[2] + dz * m) < 0) lo = m; else hi = m;
    }
    const x = c[0] + dx * lo, y = c[1] + dy * lo, z = c[2] + dz * lo;
    pos.setXYZ(i, x, y, z);
    let nx = sdf(x + eps, y, z) - sdf(x - eps, y, z), ny = sdf(x, y + eps, z) - sdf(x, y - eps, z), nz = sdf(x, y, z + eps) - sdf(x, y, z - eps);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
// point on the sdf surface along direction d from centre c (+ outward offset along the surface normal)
function sdfSurf(sdf, c, d, off = 0) {
  const l = Math.hypot(d[0], d[1], d[2]); const dx = d[0] / l, dy = d[1] / l, dz = d[2] / l;
  let lo = 0, hi = 0.3;
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (sdf(c[0] + dx * m, c[1] + dy * m, c[2] + dz * m) < 0) lo = m; else hi = m; }
  const x = c[0] + dx * lo, y = c[1] + dy * lo, z = c[2] + dz * lo, e = 0.0006;
  const n = new THREE.Vector3(sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)).normalize();
  return { p: new THREE.Vector3(x, y, z).addScaledVector(n, off), n };
}
// tube with a radius profile r(t) (t 0..1 along the curve); ring vertices rescaled around the curve point
function taperTube(points, segs, radial, rFn, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, closed);
  const pos = g.attributes.position, P = new THREE.Vector3(), V = new THREE.Vector3();
  const ts = new Float32Array(pos.count);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P); const r = rFn(t);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      V.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, V.x, V.y, V.z); ts[k] = t;
    }
  }
  g.deleteAttribute('uv');
  g.userData.t = ts; g.userData.curve = curve;
  return g;
}

// ------------------------------------------------------------------------------------------------ mesh accumulator
class Acc {
  constructor(withUV) { this.p = []; this.n = []; this.c = []; this.uv = withUV ? [] : null; this.si = []; this.sw = []; this.idx = []; }
  // geo: BufferGeometry (positions/normals already in "part space"); mat: Matrix4 part→mesh; fn(i, pLocal, pMesh, nMesh) → {col:[r,g,b] linear, bones:[[i,w],..], uv?}
  add(geo, mat, fn, ao = null) {
    const base = this.p.length / 3, pos = geo.attributes.position, nor = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(mat);
    const PL = new THREE.Vector3(), PM = new THREE.Vector3(), NM = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      PL.fromBufferAttribute(pos, i); PM.copy(PL).applyMatrix4(mat);
      NM.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const r = fn(i, PL, PM, NM);
      this.p.push(PM.x, PM.y, PM.z); this.n.push(NM.x, NM.y, NM.z);
      const a = ao ? ao(PM, NM) : 1;
      this.c.push(r.col[0] * a, r.col[1] * a, r.col[2] * a);
      if (this.uv) this.uv.push(r.uv ? r.uv[0] : 0.02, r.uv ? r.uv[1] : 0.98);
      const b = r.bones; let ws = 0;
      for (let k = 0; k < 4; k++) ws += b[k] ? b[k][1] : 0;
      for (let k = 0; k < 4; k++) { this.si.push(b[k] ? b[k][0] : 0); this.sw.push(b[k] ? b[k][1] / (ws || 1) : 0); }
    }
    const flip = mat.determinant() < 0;
    if (geo.index) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) flip ? this.idx.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]) : this.idx.push(base + ix[i], base + ix[i + 1], base + ix[i + 2]);
    } else for (let i = 0; i < pos.count; i += 3) flip ? this.idx.push(base + i, base + i + 2, base + i + 1) : this.idx.push(base + i, base + i + 1, base + i + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------------------------------------ constants
const PHRASES = ['The cat purrs contentedly.', 'The cat leans into your hand and purrs.', 'A deep, rumbly purr starts up.',
  'The cat squints at you happily.', 'Soft, warm fur. The purring gets louder.', 'The cat stretches a paw, purring.',
  'Mrrrp. The cat nuzzles your fingers.', 'The cat rolls its head into the scratch. Purrrr.'];
const PET_DUR = 6.4, PURR_DUR = 6.0;

C.register({
  name: 'cat',
  order: 70,
  init(C) {
    const U = C.util;
    const rnd = U.rng(+(C.params.get('seed') || 1234) * 7 + 70);
    const root = new THREE.Group(); root.name = 'cat'; C.scene.add(root);
    const catG = new THREE.Group(); catG.name = 'cat.body'; root.add(catG);

    // ------------------------------------------------------------------ palette (sRGB → linear)
    const col = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
    const K = {
      base: col(0xd6924f), light: col(0xebbe8a), stripe: col(0xb0642e), dark: col(0x8e4a22),
      cream: col(0xf6ead8), creamW: col(0xfbf1e2), pink: col(0xeea39e), pinkD: col(0xd9837f), line: col(0x3a2318),
      whisker: col(0xfbf6ee), earIn: col(0xf3c9b7),
    };
    const lerp3 = (o, a, b, t) => { o[0] = mix(a[0], b[0], t); o[1] = mix(a[1], b[1], t); o[2] = mix(a[2], b[2], t); return o; };
    const N3 = U.noise3D;

    // ------------------------------------------------------------------ skeleton (rest pose, cat-local; front = +Z)
    const B = {}; const bones = [];
    const mkBone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = 'cat.' + name; b.position.set(x, y, z); if (parent) parent.add(b); B[name] = bones.length; bones.push(b); return b; };
    const bRoot = mkBone('root', null, 0, 0, 0);
    const bBody = mkBone('body', bRoot, 0, 0, -0.02);

    // head placement: head-local frame (origin = head centre, +Z face, +Y up)
    const HEAD_C = new THREE.Vector3(0.098, 0.09, 0.105);
    const HEAD_REST_E = new THREE.Euler(0.24, 0.2, 0.2, 'YXZ');
    const HEAD_ALERT_E = new THREE.Euler(-0.08, 0.16, 0.0, 'YXZ');
    const HEAD_ALERT_C = new THREE.Vector3(0.1, 0.15, 0.09);
    const PIVOT = new THREE.Vector3(0, -0.028, -0.035); // neck pivot in head-local
    const qRest = new THREE.Quaternion().setFromEuler(HEAD_REST_E), qAlert = new THREE.Quaternion().setFromEuler(HEAD_ALERT_E);
    const pRest = PIVOT.clone().applyQuaternion(qRest).add(HEAD_C), pAlert = PIVOT.clone().applyQuaternion(qAlert).add(HEAD_ALERT_C);
    const bHead = mkBone('head', bRoot, pRest.x, pRest.y, pRest.z); bHead.quaternion.copy(qRest);
    const headMat = new THREE.Matrix4().compose(HEAD_C, qRest, new THREE.Vector3(1, 1, 1)); // head-local → cat-local
    const hl = (x, y, z) => [x - PIVOT.x, y - PIVOT.y, z - PIVOT.z]; // head-local point → head-bone local

    // ------------------------------------------------------------------ HEAD sdf (head-local)
    const HE = {
      skull: [0, 0.006, -0.006, 0.056, 0.049, 0.051],
      cheekL: [0.033, -0.015, 0.010, 0.034, 0.030, 0.032], cheekR: [-0.033, -0.015, 0.010, 0.034, 0.030, 0.032],
      padL: [0.0125, -0.0215, 0.041, 0.0155, 0.0125, 0.0135], padR: [-0.0125, -0.0215, 0.041, 0.0155, 0.0125, 0.0135],
      chin: [0, -0.033, 0.030, 0.014, 0.011, 0.013], bridge: [0, -0.003, 0.036, 0.013, 0.012, 0.018],
    };
    const headSdf = (x, y, z) => {
      let d = sdEll(x, y, z, HE.skull);
      d = smin(d, sdEll(x, y, z, HE.cheekL), 0.02); d = smin(d, sdEll(x, y, z, HE.cheekR), 0.02);
      d = smin(d, sdEll(x, y, z, HE.bridge), 0.018);
      d = smin(d, sdEll(x, y, z, HE.padL), 0.008); d = smin(d, sdEll(x, y, z, HE.padR), 0.008);
      d = smin(d, sdEll(x, y, z, HE.chin), 0.012);
      return d;
    };
    // ------------------------------------------------------------------ BODY sdf (cat-local)
    const BE = {
      main: [-0.012, 0.074, -0.02, 0.185, 0.082, 0.132],
      haunch: [-0.098, 0.088, 0.02, 0.092, 0.078, 0.092],
      shoulder: [0.085, 0.07, 0.03, 0.08, 0.066, 0.085],
      belly: [0.0, 0.045, 0.065, 0.14, 0.045, 0.075],
    };
    // front paws: separate little clay blobs resting on the tail, under the chin
    const PAWS = [[0.045, 0.05, 0.158, 0.024, 0.017, 0.034, 0.35], [0.1, 0.047, 0.152, 0.022, 0.016, 0.03, 0.75]];
    const bendZ = (x) => 0.85 * x * x; // spine curls: ends come forward
    const bodySdf = (x, y, z) => {
      const zb = z - bendZ(x);
      let d = sdEll(x, y, zb, BE.main);
      d = smin(d, sdEll(x, y, zb, BE.haunch), 0.05);
      d = smin(d, sdEll(x, y, zb, BE.shoulder), 0.05);
      d = smin(d, sdEll(x, y, z, BE.belly), 0.04);
      d = smax(d, -0.004 - y, 0.022); // flat underside, sunk 4 mm into the cushion
      return d;
    };
    const bodySdfT = (x, y, z) => bodySdf(x, y, z) * 0.8;

    // ------------------------------------------------------------------ TAIL curve (cat-local)
    const tailPts = [[-0.13, 0.055, -0.06], [-0.196, 0.04, 0.035], [-0.17, 0.032, 0.115], [-0.095, 0.03, 0.152], [0.0, 0.03, 0.162], [0.075, 0.033, 0.158], [0.132, 0.04, 0.128]].map(a => new THREE.Vector3(...a));
    const tailR = (t) => { const r = mix(0.031, 0.023, t); const e = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1; return r * Math.max(0.03, e); };
    const tailGeo = taperTube(tailPts, 72, 14, tailR);
    const tailCurve = tailGeo.userData.curve, tailLen = tailCurve.getLength();
    const TAIL_T = [0.12, 0.35, 0.55, 0.72, 0.86];
    const tailBones = []; { let parent = bRoot, prev = new THREE.Vector3(); TAIL_T.forEach((t, i) => { const p = tailCurve.getPointAt(t); const b = mkBone('tail' + i, parent, p.x - prev.x, p.y - prev.y, p.z - prev.z); tailBones.push(b); parent = b; prev = p; }); }
    const tailAxes = TAIL_T.map(t => { const tg = tailCurve.getTangentAt(t); return new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tg).normalize(); });

    // ears / eyes bones (children of head)
    const EAR = [
      { side: 1, pos: [0.031, 0.035, -0.014], rot: new THREE.Euler(-0.2, 0.32, -0.42, 'XYZ') },
      { side: -1, pos: [-0.031, 0.035, -0.014], rot: new THREE.Euler(-0.2, -0.32, 0.42, 'XYZ') },
    ];
    const earBones = EAR.map((e, i) => mkBone(i ? 'earR' : 'earL', bHead, ...hl(...e.pos)));
    const eyeDirs = [[0.43, 0.05, 0.9], [-0.43, 0.05, 0.9]];
    const hc = [0, 0, 0];
    const eyeSurf = eyeDirs.map(d => sdfSurf(headSdf, hc, d, 0));
    const eyeOpenB = [], sleepB = [], happyB = [];
    eyeSurf.forEach((s, i) => {
      const n = i ? 'R' : 'L';
      eyeOpenB.push(mkBone('eyeOpen' + n, bHead, ...hl(s.p.x, s.p.y, s.p.z)));
      sleepB.push(mkBone('eyeSleep' + n, bHead, ...hl(s.p.x, s.p.y, s.p.z)));
      happyB.push(mkBone('eyeHappy' + n, bHead, ...hl(s.p.x, s.p.y, s.p.z)));
    });

    // ------------------------------------------------------------------ coat colouring
    const tmpC = [0, 0, 0], tmpC2 = [0, 0, 0];
    const headInv = new THREE.Matrix4().copy(headMat).invert();
    const QL = new THREE.Vector3(), QN = new THREE.Vector3();
    function bodyCoat(p, n) {
      // stripes run across the back (angle around the curl centre), strongest on the upper/back side
      const th = Math.atan2(p.x, 0.62 - p.z);
      const wob = N3(p.x * 14, p.y * 14, p.z * 14) * 1.6 + N3(p.x * 40, p.y * 40, p.z * 40) * 0.35;
      const s = Math.sin(th * 92 + wob + p.y * 20);
      const dors = sstep(-0.45, 0.55, n.y * 0.75 - n.z * 0.65);
      const stripe = sstep(0.25, 0.85, s) * dors;
      const spine = sstep(0.72, 0.95, n.y * 0.55 - n.z * 0.84) * 0.8;
      const belly = sstep(0.15, 0.7, n.z * 0.85 - n.y * 0.45 + (0.06 - p.y) * 6);
      lerp3(tmpC, K.light, K.base, sstep(-0.2, 0.5, dors + N3(p.x * 8, p.y * 8, p.z * 8) * 0.25));
      lerp3(tmpC, tmpC, K.stripe, Math.max(stripe * 0.9, spine));
      lerp3(tmpC, tmpC, K.dark, stripe * spine * 0.5);
      lerp3(tmpC, tmpC, K.cream, belly);
      // paws: white socks
      const paw = Math.max(sstep(0.034, 0.02, Math.hypot((p.x - 0.04) * 0.9, p.y - 0.022, (p.z - 0.155) * 0.6)),
        sstep(0.032, 0.018, Math.hypot((p.x - 0.1) * 0.9, p.y - 0.02, (p.z - 0.148) * 0.6)),
        sstep(0.035, 0.02, Math.hypot((p.x + 0.06) * 0.8, p.y - 0.026, (p.z - 0.145) * 0.7)));
      lerp3(tmpC, tmpC, K.creamW, paw);
      return tmpC;
    }
    function headCoat(q, n) { // q, n head-local
      const wob = N3(q.x * 60, q.y * 60, q.z * 60) * 0.0025;
      lerp3(tmpC, K.base, K.light, sstep(-0.01, 0.03, q.z) * 0.5);
      // forehead "M": three stripes running back over the crown
      let m = 0;
      if (q.y > 0.004) {
        const fade = sstep(0.004, 0.02, q.y) * sstep(0.045, 0.012, q.z) * sstep(-0.06, -0.02, q.z);
        for (const x0 of [-0.013, 0, 0.013]) m = Math.max(m, sstep(0.0042, 0.0018, Math.abs(q.x - x0 - q.z * x0 * 6 + wob)) * fade);
        m = Math.max(m, sstep(0.006, 0.002, Math.abs(Math.abs(q.x) - 0.024 - (q.y - 0.02) * 0.2 + wob)) * sstep(0.015, 0.03, q.y) * sstep(0.03, -0.02, q.z) * 0.8);
      }
      // cheek swooshes from the outer eye corner backwards
      let ck = 0;
      if (Math.abs(q.x) > 0.03 && q.z < 0.03) {
        const ax = Math.abs(q.x);
        for (const y0 of [0.002, -0.012]) ck = Math.max(ck, sstep(0.0035, 0.0012, Math.abs(q.y - y0 + (0.03 - q.z) * 0.18 + wob)) * sstep(0.03, 0.045, ax) * sstep(-0.04, -0.005, q.z));
      }
      // back of the head: soft stripes continuing the back pattern
      const back = sstep(0.0, -0.04, q.z) * sstep(-0.01, 0.02, q.y) * sstep(0.2, 0.9, Math.sin(q.z * 190 + wob * 300));
      lerp3(tmpC, tmpC, K.stripe, Math.max(m, ck * 0.85, back * 0.7));
      // muzzle / chin / eye rims cream
      const muz = Math.max(sstep(0.024, 0.036, q.z) * sstep(-0.004, -0.016, q.y), sstep(-0.024, -0.034, q.y) * sstep(0.0, 0.02, q.z));
      const eyeRim = Math.max(...eyeSurf.map(s => sstep(0.017, 0.011, QL.set(q.x, q.y, q.z).distanceTo(s.p))));
      lerp3(tmpC, tmpC, K.cream, Math.max(muz, eyeRim * 0.55));
      lerp3(tmpC, tmpC, K.light, sstep(0.02, 0.0, Math.abs(q.x)) * sstep(0.02, 0.04, q.z) * sstep(-0.012, 0.005, q.y) * 0.6);
      return tmpC;
    }
    function tailCoat(t, p) {
      const w = N3(p.x * 30, p.y * 30, p.z * 30) * 0.8;
      const ring = sstep(0.2, 0.8, Math.sin(t * tailLen / 0.042 * Math.PI * 2 + w));
      lerp3(tmpC, K.base, K.stripe, ring * 0.9);
      lerp3(tmpC, tmpC, K.dark, sstep(0.86, 0.95, t));
      return tmpC;
    }

    // ------------------------------------------------------------------ combined sdf (cat space) → baked ambient occlusion
    const pawSdf = (x, y, z, P) => {
      const c = Math.cos(P[6]), s = Math.sin(P[6]);
      const dx = x - P[0], dz = z - P[2];
      const lx = dx * c - dz * s, lz = dx * s + dz * c, ly = y - P[1];
      let d = sdEll(lx, ly, lz, [0, 0, 0, P[3], P[4], P[5]]);
      for (const tx of [-0.0095, 0, 0.0095]) d = smin(d, sdEll(lx, ly, lz, [tx, -0.002, P[5] * 0.8, 0.0085, 0.0095, 0.009]), 0.006);
      return d;
    };
    const tailSamp = []; for (let i = 0; i <= 90; i++) { const t = i / 90, p = tailCurve.getPointAt(t); tailSamp.push(p.x, p.y, p.z, tailR(t)); }
    const tailSdf = (x, y, z) => {
      let d = 1;
      for (let i = 0; i < tailSamp.length; i += 4) { const dd = Math.hypot(x - tailSamp[i], y - tailSamp[i + 1], z - tailSamp[i + 2]) - tailSamp[i + 3]; if (dd < d) d = dd; }
      return d;
    };
    const _hv = new THREE.Vector3();
    const allSdf = (x, y, z) => {
      let d = Math.min(bodySdf(x, y, z), tailSdf(x, y, z), y + 0.004);
      for (const P of PAWS) d = Math.min(d, pawSdf(x, y, z, P));
      _hv.set(x, y, z).applyMatrix4(headInv);
      return Math.min(d, headSdf(_hv.x, _hv.y, _hv.z));
    };
    const aoFn = (p, n) => {
      let occ = 0;
      for (let i = 1; i <= 5; i++) {
        const h = 0.0075 * i;
        const d = allSdf(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h);
        occ += Math.max(0, h - d) / h * (1.25 - i * 0.12);
      }
      const a = Math.max(0, 1 - occ * 0.42);
      return 0.42 + 0.58 * a;
    };

    // ------------------------------------------------------------------ assemble FUR mesh
    const fur = new Acc(false);
    const I = new THREE.Matrix4();
    const headCw = HEAD_C.clone();
    // body
    const bodyGeo = sdfMesh(bodySdfT, [-0.01, 0.07, 0.0], 0.34, 36);
    fur.add(bodyGeo, I, (i, pl, p, n) => {
      const d = p.distanceTo(headCw);
      const wh = 0.85 * sstep(0.1, 0.045, d) * sstep(0.02, 0.07, p.y);
      return { col: bodyCoat(p, n), bones: [[B.body, 1 - wh], [B.head, wh]] };
    }, aoFn);
    // front paws (white socks, toe bumps)
    PAWS.forEach(P => {
      const g = sdfMesh((x, y, z) => pawSdf(x, y, z, P) * 0.9, [P[0], P[1], P[2]], 0.07, 12);
      fur.add(g, I, (i, pl, p) => {
        const c = Math.cos(P[6]), s = Math.sin(P[6]);
        const lz = (p.x - P[0]) * s + (p.z - P[2]) * c;
        lerp3(tmpC, K.base, K.creamW, sstep(-0.028, -0.004, lz));
        return { col: tmpC, bones: [[B.body, 1]] };
      }, aoFn);
    });
    // head
    const headGeo = sdfMesh(headSdf, [0, 0, 0], 0.12, 28);
    fur.add(headGeo, headMat, (i, pl, p, n) => {
      QN.copy(n).transformDirection(headInv);
      return { col: headCoat(pl, QN), bones: [[B.head, 1]] };
    }, aoFn);
    // ears
    EAR.forEach((e, ei) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.pos), new THREE.Quaternion().setFromEuler(e.rot), new THREE.Vector3(1, 1, 1));
      const earM = headMat.clone().multiply(m);
      const outer = new THREE.ConeGeometry(0.022, 0.046, 22, 8, true);
      outer.translate(0, 0.023, 0);
      { const a = outer.attributes.position; for (let i = 0; i < a.count; i++) { let z = a.getZ(i), y = a.getY(i), x = a.getX(i); z = z > 0 ? -0.3 * z : 0.55 * z; const tip = sstep(0.03, 0.046, y); x *= 1 - tip * 0.25; a.setXYZ(i, x, y, z); } }
      outer.computeVertexNormals();
      const bi = ei ? B.earR : B.earL;
      fur.add(outer, earM, (i, pl) => {
        const tip = sstep(0.028, 0.044, pl.y);
        lerp3(tmpC, K.base, K.stripe, 0.35 + tip * 0.5);
        if (pl.z > -0.001 && Math.abs(pl.x) < 0.02 * (1 - pl.y / 0.046)) lerp3(tmpC, tmpC, K.earIn, 0.7);
        return { col: tmpC, bones: [[bi, 1]] };
      }, aoFn);
      const inner = new THREE.ConeGeometry(0.0155, 0.032, 18, 5, true);
      inner.translate(0, 0.016 + 0.005, 0);
      { const a = inner.attributes.position; for (let i = 0; i < a.count; i++) a.setZ(i, a.getZ(i) * 0.18 - 0.0045); }
      inner.computeVertexNormals();
      fur.add(inner, earM, (i, pl) => {
        const edge = sstep(0.0035, 0.009, 0.0155 * (1 - (pl.y - 0.005) / 0.032) - Math.abs(pl.x));
        lerp3(tmpC, K.earIn, K.pink, edge * 0.8);
        return { col: tmpC, bones: [[bi, 1]] };
      });
    });
    // tail
    fur.add(tailGeo, I, (i, pl, p) => {
      const t = tailGeo.userData.t[i];
      const bs = [];
      if (t <= TAIL_T[0]) bs.push([B.body, 1 - t / TAIL_T[0]], [B.tail0, t / TAIL_T[0]]);
      else {
        let k = 0; while (k < TAIL_T.length - 1 && t > TAIL_T[k + 1]) k++;
        if (k >= TAIL_T.length - 1) bs.push([B['tail' + k], 1]);
        else { const f = sstep(TAIL_T[k], TAIL_T[k + 1], t); bs.push([B['tail' + k], 1 - f], [B['tail' + (k + 1)], f]); }
      }
      return { col: tailCoat(t, p), bones: bs };
    }, aoFn);
    // face lines: closed (sleep ◡), happy (^), mouth ω — thin dark tubes laid on the head surface
    const lineOnHead = (pts, r, boneIdx, color = K.line) => {
      const g = taperTube(pts, Math.max(8, pts.length * 4), 5, t => r * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)))));
      fur.add(g, headMat, () => ({ col: color, bones: [[boneIdx, 1]] }));
    };
    const surfPt = (dx, dy, dz, off) => sdfSurf(headSdf, hc, [dx, dy, dz], off).p;
    eyeDirs.forEach((d, i) => {
      const sgn = i ? -1 : 1;
      const sl = [], hp = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8 * 2 - 1; // -1 inner .. +1 outer
        const ax = d[0] + u * 0.2 * sgn, ay = d[1] + u * 0.05;
        sl.push(surfPt(ax, ay - 0.075 * (1 - u * u) + 0.02, d[2], 0.0008));
        hp.push(surfPt(ax * 0.98, ay + 0.085 * (1 - u * u) - 0.035, d[2], 0.0008));
      }
      lineOnHead(sl, 0.0021, i ? B.eyeSleepR : B.eyeSleepL);
      lineOnHead(hp, 0.0022, i ? B.eyeHappyR : B.eyeHappyL);
    });
    { // mouth: philtrum + two curls (ω)
      const nb = sdfSurf(headSdf, hc, [0, -0.36, 0.93], 0.0006).p;
      const m0 = surfPt(0, -0.62, 0.78, 0.0006);
      lineOnHead([nb, m0], 0.0011, B.head, K.pinkD);
      for (const s of [1, -1]) lineOnHead([m0, surfPt(s * 0.1, -0.7, 0.72, 0.0006), surfPt(s * 0.22, -0.64, 0.74, 0.0006)], 0.0011, B.head, K.pinkD);
    }
    // whiskers: 3 per side, tapered, fanning out of the whisker pads
    for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
      const o = surfPt(s * 0.34, -0.42 - k * 0.07, 0.86, -0.002);
      const dir = new THREE.Vector3(s * 1, 0.12 - k * 0.2, 0.25 - k * 0.12).normalize();
      const len = 0.07 - k * 0.006;
      const p1 = o.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, 0.004, 0));
      const p2 = o.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, -0.006 - k * 0.003, -0.01));
      const g = taperTube([o, p1, p2], 12, 4, t => mix(0.0009, 0.00025, t));
      fur.add(g, headMat, () => ({ col: K.whisker, bones: [[B.head, 1]] }));
    }
    const furGeo = fur.build();

    // ------------------------------------------------------------------ EYES + NOSE mesh (glossy)
    const eyeTex = U.canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.beginPath(); ctx.ellipse(64, 64, 63, 63, 0, 0, Math.PI * 2); ctx.clip();
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, '#f2cf5a'); g.addColorStop(0.55, '#d9a83a'); g.addColorStop(0.85, '#8f8a2e'); g.addColorStop(1, '#3e3a18');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { const a = i / 70 * Math.PI * 2; ctx.strokeStyle = `rgba(${i % 2 ? '120,80,20' : '255,230,140'},0.18)`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14); ctx.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); ctx.stroke(); }
      ctx.fillStyle = '#120c08'; ctx.beginPath(); ctx.ellipse(64, 64, 13, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.ellipse(44, 40, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(80, 84, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    const eyesAcc = new Acc(true);
    eyeSurf.forEach((s, i) => {
      const sgn = i ? -1 : 1;
      const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); // dome, pole +Y
      g.rotateX(Math.PI / 2); // pole → +Z
      const EW = 0.0118, EH = 0.0105, ED = 0.0036;
      g.scale(EW, EH, ED);
      const nz = s.n.clone(); const up = new THREE.Vector3(0, 1, 0);
      const xAx = new THREE.Vector3().crossVectors(up, nz).normalize(), yAx = new THREE.Vector3().crossVectors(nz, xAx);
      const rot = new THREE.Matrix4().makeBasis(xAx, yAx, nz).multiply(new THREE.Matrix4().makeRotationZ(sgn * 0.22));
      const m = new THREE.Matrix4().makeTranslation(s.p.x, s.p.y, s.p.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.0012));
      eyesAcc.add(g, headMat.clone().multiply(m), (k, pl) => ({ col: [1, 1, 1], uv: [pl.x / EW * 0.5 + 0.5, pl.y / EH * 0.5 + 0.5], bones: [[i ? B.eyeOpenR : B.eyeOpenL, 1]] }));
    });
    { // nose: soft rounded triangle
      const ns = sdfSurf(headSdf, hc, [0, -0.2, 0.98], 0);
      const g = new THREE.SphereGeometry(1, 20, 12);
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i), z = a.getZ(i); a.setXYZ(i, x * 0.0078 * (0.62 + 0.38 * (y + 1) / 2 * 1.3), y * 0.0052, z * 0.0048); }
      g.computeVertexNormals();
      const nzv = ns.n.clone(); const xAx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), nzv).normalize(), yAx = new THREE.Vector3().crossVectors(nzv, xAx);
      const m = new THREE.Matrix4().makeTranslation(ns.p.x, ns.p.y, ns.p.z).multiply(new THREE.Matrix4().makeBasis(xAx, yAx, nzv)).multiply(new THREE.Matrix4().makeTranslation(0, 0.0008, 0.0006));
      eyesAcc.add(g, headMat.clone().multiply(m), () => ({ col: K.pink, bones: [[B.head, 1]] }));
    }
    const eyesGeo = eyesAcc.build();

    // ------------------------------------------------------------------ materials + skinned meshes
    const furMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, sheen: 1.0, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffd6a8) });
    furMat.name = 'cat.fur';
    const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: eyeTex, roughness: 0.18, metalness: 0 });
    eyeMat.name = 'cat.eyes';
    const furMesh = new THREE.SkinnedMesh(furGeo, furMat); furMesh.name = 'cat.fur';
    const eyeMesh = new THREE.SkinnedMesh(eyesGeo, eyeMat); eyeMesh.name = 'cat.eyes';
    furMesh.castShadow = true; furMesh.receiveShadow = true; eyeMesh.receiveShadow = false;
    furMesh.userData.dynamic = true; eyeMesh.userData.dynamic = true;
    catG.add(furMesh, eyeMesh);
    furMesh.add(bRoot);
    catG.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    furMesh.bind(skeleton); eyeMesh.bind(skeleton);
    // generous fixed bounds (head lifts / tail flicks) so frustum culling never pops
    furMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.1, 0.04), 0.36);
    eyeMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.1, 0.12, 0.12), 0.16);

    // contact shadow + invisible pick proxy
    const blob = U.blobShadow(catG, 0.0, 0, 0.03, 0.56, 0.46, 0.42);
    blob.userData.dynamic = true;
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), proxyMat);
    proxy.scale.set(0.23, 0.13, 0.19); proxy.position.set(0.0, 0.08, 0.04); proxy.name = 'cat.pick';
    proxy.userData.dynamic = true;
    catG.add(proxy);

    // ------------------------------------------------------------------ sleeping spots
    const spots = [];
    const addSpot = (name, s, weight, floor, src) => {
      if (!s || !s.position) return;
      const p = s.position.isVector3 ? [s.position.x, s.position.y, s.position.z] : s.position;
      if (!p.every(v => isFinite(v))) return;
      if (spots.some(o => o.name === name)) return;
      spots.push({ name, x: p[0], y: p[1], z: p[2], ry: +s.rotationY || 0, weight, floor, src });
    };
    const liv = C.living && Array.isArray(C.living.catSpots) ? C.living.catSpots : [];
    const findSpot = (arr, re) => arr.find(s => s && re.test(String(s.name || '')));
    addSpot('window', findSpot(liv, /window|seat/i) || { position: [-3.0, 0.48, 4.45], rotationY: Math.PI }, 0.4, 0, findSpot(liv, /window|seat/i) ? 'living' : 'spec');
    addSpot('fire', findSpot(liv, /fire|rug|hearth/i) || { position: [-5.2, 0.01, 2.5], rotationY: Math.PI / 2 }, 0.3, 0, findSpot(liv, /fire|rug|hearth/i) ? 'living' : 'spec');
    liv.forEach((s, i) => { if (s && !/window|seat|fire|rug|hearth/i.test(String(s.name || ''))) addSpot(String(s.name || ('living' + i)), s, 0.15, 0, 'living'); });
    const hs = C.hallstudy && C.hallstudy.catBed;
    if (hs) addSpot('study', hs, 0.18, 0, 'hallstudy');
    const lf = C.loft && (Array.isArray(C.loft.catSpots) ? C.loft.catSpots : C.loft.catSpot ? [C.loft.catSpot] : []);
    if (lf && lf.length) { addSpot('loft', lf[0], 0.12, 1, 'loft'); lf.slice(1).forEach((s, i) => addSpot(String(s.name || ('loft' + (i + 2))), s, 0.05, 1, 'loft')); }

    // settle each spot onto the actual surface below it (soft cushions / quilts): pick upward-facing hits near y
    const ray = new THREE.Raycaster(); ray.camera = C.camera;
    const _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0), _n = new THREE.Vector3();
    for (const sp of spots) {
      const grp = C.scene.getObjectByName(sp.src === 'spec' ? 'living' : sp.src);
      if (!grp) continue;
      const ys = [];
      const cs = Math.cos(sp.ry), sn = Math.sin(sp.ry);
      for (const [lx, lz] of [[0, 0.02], [0.1, 0.02], [-0.1, 0.02], [0, 0.1], [0, -0.07]]) {
        const wx = sp.x + lx * cs + lz * sn, wz = sp.z - lx * sn + lz * cs;
        _o.set(wx, sp.y + 0.3, wz);
        ray.set(_o, _d); ray.far = 0.6;
        let best = null;
        for (const h of ray.intersectObject(grp, true)) {
          if (!h.object.isMesh || h.object.isSprite || !h.face) continue;
          const m = h.object.material; if (!m || Array.isArray(m) || m.transparent || m.visible === false) continue;
          _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
          if (_n.y < 0.5) continue;
          if (Math.abs(h.point.y - sp.y) > 0.1) continue;
          if (!best || Math.abs(h.point.y - sp.y) < Math.abs(best - sp.y)) best = h.point.y;
        }
        if (best !== null) ys.push(best);
      }
      if (ys.length >= 2) { ys.sort((a, b) => a - b); sp.ySurf = ys[Math.floor(ys.length / 2)]; sp.yOrig = sp.y; sp.y = sp.ySurf; }
    }

    // ------------------------------------------------------------------ state
    const S = {
      spot: null, mode: 'sleep', modeT: 0, lookDur: 8,
      lift: 0, liftT: 0, eye: 0, eyeT: 0, happy: 0, happyT: 0, curl: 0, curlT: 0,
      yaw: 0, yawT: 0, pitch: 0, pitchT: 0, roll: 0, nextLookTarget: 0,
      blinkAt: 0, blink: 0, nextLook: 0, nextTwitch: [0, 0], twitch: [9, 9], twitchDir: [1, 1],
      nextFlick: 0, flick: 9, flickAmp: 1, nextRelocate: 0, purring: false, purrUntil: 0,
      lastPhrase: -1, pets: 0, nearSince: -1, lastNearLook: -999, lastMeow: -999,
    };
    const placeAt = (sp) => {
      S.spot = sp;
      catG.position.set(sp.x, sp.y, sp.z);
      catG.rotation.set(0, sp.ry, 0);
      catG.updateMatrixWorld(true);
    };
    const start = spots.find(s => s.name === 'window') || spots[0];
    if (start) placeAt(start);
    const t0 = C.time || 0;
    S.nextLook = t0 + 25 + rnd() * 30; S.nextTwitch = [t0 + 3 + rnd() * 6, t0 + 5 + rnd() * 8]; S.nextFlick = t0 + 4 + rnd() * 6;
    S.nextRelocate = t0 + 150 + rnd() * 120;

    // visibility test for relocation (no allocations)
    const _cam = new THREE.Vector3(), _dir = new THREE.Vector3(), _sph = new THREE.Sphere(), _frus = new THREE.Frustum(), _pm = new THREE.Matrix4();
    const wallFilter = c => c.tag === 'wall' || c.tag === 'door';
    function spotSeen(sp) {
      if (!sp) return false;
      C.camera.getWorldPosition(_cam);
      _dir.set(sp.x - _cam.x, sp.y + 0.12 - _cam.y, sp.z - _cam.z);
      const dist = _dir.length();
      if (dist < 3.0) return true;              // right next to it: you'd notice
      if (dist > 16) return false;
      const camUp = _cam.y > 2.95, spUp = sp.floor === 1;
      if (camUp !== spUp) {
        // only the stairwell connects the floors visually
        if (!(C.player.position.x > 5.0 && C.player.position.z > -0.8 && C.player.position.z < 4.75)) return false;
      }
      C.camera.updateMatrixWorld();
      _pm.multiplyMatrices(C.camera.projectionMatrix, C.camera.matrixWorldInverse);
      _frus.setFromProjectionMatrix(_pm);
      _sph.center.set(sp.x, sp.y + 0.12, sp.z); _sph.radius = 0.9; // generous margin: player may be turning
      if (!_frus.intersectsSphere(_sph)) return false;
      _dir.multiplyScalar(1 / dist);
      const hit = C.physics.raycast(_cam, _dir, dist, wallFilter);
      if (hit && hit.dist < dist - 0.4) return false;
      return true;
    }
    function pickSpot() {
      let tot = 0;
      for (const s of spots) if (s !== S.spot) tot += s.weight * (s.name === 'fire' ? (C.env.fireLevel > 0.1 ? 1.3 : 0.4) : 1);
      let r = rnd() * tot;
      for (const s of spots) {
        if (s === S.spot) continue;
        r -= s.weight * (s.name === 'fire' ? (C.env.fireLevel > 0.1 ? 1.3 : 0.4) : 1);
        if (r <= 0) return s;
      }
      return spots.find(s => s !== S.spot) || null;
    }
    function resetPose() {
      S.mode = 'sleep'; S.lift = S.liftT = 0; S.eye = S.eyeT = 0; S.happy = S.happyT = 0; S.curl = S.curlT = 0;
      S.yaw = S.yawT = S.pitch = S.pitchT = S.roll = 0; S.flick = 9; S.twitch[0] = S.twitch[1] = 9;
    }
    function relocate(name) {
      const sp = typeof name === 'string' ? spots.find(s => s.name === name) : name;
      if (!sp) return false;
      if (S.purring) { C.audio.purr.stop(); S.purring = false; }
      resetPose();
      placeAt(sp);
      S.nextRelocate = C.time + 150 + rnd() * 150;
      C.log('cat', 'relocated to', sp.name);
      return true;
    }
    const catWorld = (out) => out.set(0.08, 0.12, 0.08).applyMatrix4(catG.matrixWorld);
    const _cp = new THREE.Vector3();
    function pet() {
      catWorld(_cp);
      const first = S.mode !== 'pet';
      S.mode = 'pet'; S.modeT = first ? 0 : Math.min(S.modeT, 1.2);
      S.happyT = 1; S.eyeT = 0; S.curlT = 1;
      if (!S.purring) { C.audio.purr.start(_cp.x, _cp.y, _cp.z); S.purring = true; }
      S.purrUntil = C.time + PURR_DUR;
      let i = 0;
      if (S.pets > 0) { do { i = Math.floor(rnd() * PHRASES.length); } while (i === S.lastPhrase && PHRASES.length > 1); }
      S.lastPhrase = i; S.pets++;
      C.hud.toast(PHRASES[i], 3);
      if (first && rnd() < 0.14 && C.time - S.lastMeow > 60) { S.lastMeow = C.time; C.audio.play('meow', { x: _cp.x, y: _cp.y, z: _cp.z, volume: 0.6, rate: 1.12 }); }
    }
    C.interact.add({ id: 'cat', object: proxy, label: 'Pet the cat', onUse: pet, range: 2.0 });

    // ------------------------------------------------------------------ animation temps
    const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), eA = new THREE.Euler(0, 0, 0, 'YXZ'), vA = new THREE.Vector3(), vB = new THREE.Vector3();
    const Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1), X_AXIS = new THREE.Vector3(1, 0, 0);
    const earRest = earBones.map(b => b.quaternion.clone());
    const breathPh = rnd() * 10;

    function startLook(t) {
      S.mode = 'look'; S.modeT = 0; S.lookDur = 6.5 + rnd() * 4; S.nextLookTarget = 1.8;
      S.blinkAt = t + 2.2 + rnd();
      catWorld(_cp);
      if (C.time - S.lastMeow > 240 && rnd() < 0.22 && _cp.distanceTo(C.camera.position) < 7) { S.lastMeow = C.time; C.audio.play('meow', { x: _cp.x, y: _cp.y, z: _cp.z, volume: 0.45, rate: 0.95 + rnd() * 0.15 }); }
    }
    function aimAtPlayer(amount) {
      // camera position in cat space → yaw/pitch offsets for the head (relative to the alert pose facing)
      vA.copy(C.camera.position); catG.worldToLocal(vA);
      vA.sub(HEAD_ALERT_C);
      const yaw = Math.atan2(vA.x, vA.z) - HEAD_ALERT_E.y;
      const pitch = -Math.atan2(vA.y, Math.hypot(vA.x, vA.z));
      S.yawT = U.clamp(yaw, -0.9, 0.9) * amount; S.pitchT = U.clamp(pitch, -0.5, 0.35) * amount;
    }

    C.cat = {
      get spot() { return S.spot ? S.spot.name : null; },
      spots: spots.map(s => ({ name: s.name, position: [s.x, s.y, s.z], rotationY: s.ry, source: s.src, surfaceY: s.ySurf ?? null, declaredY: s.yOrig ?? s.y })),
      relocate, pet, root, state: S,
      lookAround() { startLook(C.time); },
      _seen: spotSeen,
    };

    this._S = S; this._upd = { bBody, bHead, tailBones, tailAxes, earBones, earRest, eyeOpenB, sleepB, happyB, qRest, qAlert, pRest, pAlert, qA, qB, eA, vA, vB, Y_AXIS, Z_AXIS, X_AXIS, breathPh, startLook, aimAtPlayer, spotSeen, pickSpot, relocate, rnd, catWorld, _cp };
    C.log('cat', 'spots', spots.map(s => s.name + '@' + s.y.toFixed(3)).join(', '));
  },

  update(dt, t, C) {
    const S = this._S; if (!S || !S.spot) return;
    const u = this._upd, U = C.util, rnd = u.rnd;
    S.modeT += dt;

    // ---------------- behaviour
    if (S.mode === 'sleep') {
      S.liftT = 0; S.eyeT = 0; S.happyT = 0; S.curlT = 0; S.yawT = 0; S.pitchT = 0;
      if (t > S.nextLook) { u.startLook(t); S.nextLook = t + 40 + rnd() * 70; }
      // player comes close → sometimes peeks at them
      u.catWorld(u._cp);
      const near = u._cp.distanceTo(C.camera.position) < 1.8 && C.state.started;
      if (near && S.nearSince < 0) S.nearSince = t; else if (!near) S.nearSince = -1;
      if (near && S.nearSince > 0 && t - S.nearSince > 1.5 && t - S.lastNearLook > 45) { S.lastNearLook = t; if (rnd() < 0.6) { u.startLook(t); S.aimPlayer = true; } }
    } else if (S.mode === 'look') {
      const T = S.modeT, D = S.lookDur;
      S.liftT = T < D - 1.9 ? 1 : 0;
      S.eyeT = T > 0.9 && T < D - 2.2 ? 0.55 : 0;
      if (T > S.nextLookTarget && T < D - 2.2) {
        S.nextLookTarget = T + 1.6 + rnd() * 1.6;
        if (S.aimPlayer || rnd() < 0.35) u.aimAtPlayer(1); else { S.yawT = (rnd() * 2 - 1) * 0.7; S.pitchT = (rnd() * 2 - 1) * 0.15; }
      }
      if (T > D - 2.2) { S.yawT = 0; S.pitchT = 0; }
      if (T > D) { S.mode = 'sleep'; S.aimPlayer = false; }
    } else if (S.mode === 'pet') {
      const T = S.modeT;
      S.liftT = T < PET_DUR - 1.2 ? 0.62 : 0; S.happyT = T < PET_DUR - 0.8 ? 1 : 0; S.eyeT = 0; S.curlT = T < PET_DUR - 0.5 ? 1 : 0;
      S.yawT = Math.sin(T * 2.1) * 0.16 + 0.05; S.pitchT = -0.12 + Math.sin(T * 1.3) * 0.06;
      if (T > PET_DUR) S.mode = 'sleep';
    }
    if (S.purring && t > S.purrUntil) { C.audio.purr.stop(); S.purring = false; }

    // blinks while awake
    if (S.eyeT > 0.1 && t > S.blinkAt) { S.blink = 1; S.blinkAt = t + 1.4 + rnd() * 2.6; }
    S.blink = Math.max(0, S.blink - dt * 7);

    // ---------------- smoothing
    S.lift = U.damp(S.lift, S.liftT, S.liftT > S.lift ? 2.6 : 1.8, dt);
    S.eye = U.damp(S.eye, S.eyeT, 3.0, dt);
    S.happy = U.damp(S.happy, S.happyT, 6, dt);
    S.curl = U.damp(S.curl, S.curlT, 1.6, dt);
    S.yaw = U.damp(S.yaw, S.yawT, 2.2, dt); S.pitch = U.damp(S.pitch, S.pitchT, 2.2, dt);

    // ---------------- body: breathing (sleep ~22/min, a bit faster when awake), tiny purr rumble
    const bp = t * (S.mode === 'sleep' ? 2.35 : 2.9) + u.breathPh;
    const br = Math.sin(bp) * 0.5 + 0.5, brS = br * br * (3 - 2 * br);
    const rum = S.purring ? Math.sin(t * 150) * 0.0012 : 0;
    u.bBody.scale.set(1 + brS * 0.012, 1 + brS * 0.03 + rum, 1 + brS * 0.02);

    // ---------------- head
    const L = S.lift * S.lift * (3 - 2 * S.lift);
    u.qA.copy(u.qRest).slerp(u.qAlert, L);
    const nuz = S.mode === 'pet' ? Math.sin(S.modeT * 2.6) * 0.14 * S.happy : 0;
    u.eA.set(S.pitch, S.yaw, nuz, 'YXZ'); u.qB.setFromEuler(u.eA);
    u.bHead.quaternion.copy(u.qA).multiply(u.qB);
    u.bHead.position.lerpVectors(u.pRest, u.pAlert, L);
    u.bHead.position.y += brS * 0.0022 * (1 - L);

    // ---------------- ears: random twitches (quick flick back + return), relaxed back while petted
    for (let i = 0; i < 2; i++) {
      if (t > S.nextTwitch[i]) {
        S.twitch[i] = 0; S.twitchDir[i] = rnd() < 0.5 ? 1 : -1;
        S.nextTwitch[i] = t + (rnd() < 0.25 ? 0.35 : 3 + rnd() * 9);
      }
      S.twitch[i] += dt;
      const tw = S.twitch[i] < 0.32 ? Math.sin(S.twitch[i] / 0.32 * Math.PI) : 0;
      const side = i ? -1 : 1;
      u.eA.set(-0.35 * tw * (S.twitchDir[i] > 0 ? 1 : 0.5) - 0.25 * S.happy, side * 0.35 * tw * S.twitchDir[i], side * (0.3 * tw + 0.22 * S.happy), 'XYZ');
      u.qB.setFromEuler(u.eA);
      u.earBones[i].quaternion.copy(u.earRest[i]).multiply(u.qB);
    }

    // ---------------- tail: gentle idle sway + tip flicks + curl when petted
    if (t > S.nextFlick) { S.flick = 0; S.flickAmp = 0.6 + rnd() * 0.6; S.nextFlick = t + (S.mode === 'sleep' ? 5 + rnd() * 10 : 1.5 + rnd() * 3); }
    S.flick += dt;
    const fl = S.flick < 1.1 ? Math.sin(S.flick / 1.1 * Math.PI * 2) * Math.sin(S.flick / 1.1 * Math.PI) * S.flickAmp : 0;
    const flUp = S.flick < 1.1 ? Math.sin(S.flick / 1.1 * Math.PI) * S.flickAmp : 0;
    const sway = Math.sin(t * 0.7 + 1.3) * 0.03;
    for (let k = 0; k < u.tailBones.length; k++) {
      const w = k / (u.tailBones.length - 1); // 0 base .. 1 tip
      const yaw = (fl * 0.28 * w * w + sway * w) * 1 - S.curl * 0.16 * w;
      const lift = -flUp * 0.22 * w * w * w - S.curl * 0.05 * w;
      u.qA.setFromAxisAngle(u.Y_AXIS, yaw);
      u.qB.setFromAxisAngle(u.tailAxes[k], lift);
      u.tailBones[k].quaternion.copy(u.qA).multiply(u.qB);
    }

    // ---------------- eyes: sleep line ◡ / open (half-lidded, slit pupils) / happy ^
    const open = S.eye * (1 - S.blink);
    const showOpen = open > 0.1 && S.happy < 0.5;
    for (let i = 0; i < 2; i++) {
      const o = u.eyeOpenB[i], sl = u.sleepB[i], hp = u.happyB[i];
      if (showOpen) o.scale.set(1, Math.max(0.08, open), 1); else o.scale.setScalar(1e-4);
      const happy = S.happy >= 0.5;
      sl.scale.setScalar(!showOpen && !happy ? 1 : 1e-4);
      hp.scale.setScalar(happy ? 1 : 1e-4);
    }

    // ---------------- relocation (only when both the current and the new spot are unseen)
    if (t > S.nextRelocate && S.mode === 'sleep' && !S.purring) {
      S.nextRelocate = t + 4 + rnd() * 3;
      if (!u.spotSeen(S.spot)) {
        const cand = u.pickSpot();
        const pp = C.player.position;
        if (cand && !u.spotSeen(cand) && Math.hypot(pp.x - cand.x, pp.z - cand.z) > 1.0) u.relocate(cand);
      }
    }
  },
});

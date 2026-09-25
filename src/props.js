// =====================================================================================================================
//  PROPS — reusable procedural prop factories (C.props) + their animation (lamp fades, candle flames, steam, clocks).
//  Module "props", order 6.  (SPEC §11)
// =====================================================================================================================
//
//  API REFERENCE  (all factories: opts object; `position` = [x,y,z] (or Vector3) in the PARENT's space,
//  `parent` defaults to C.scene, `rotationY` rotates about +Y. Front faces local +Z.
//  Unless stated otherwise every factory returns the prop's THREE.Group (already added to parent).
//  Static props are plain meshes with shared materials → call C.util.bakeStatic(yourRoot) and they merge.
//  Animated / interactable parts are flagged userData.dynamic = true and survive baking.)
//
//  lamp({ id, type, position, rotationY, on = true, color = 0xffb46b, intensity, distance = 0, decay = 2,
//         shadeColor, metal: 'brass'|'iron'|'copper', height, label, castShadow = false, parent, room,
//         // extras:
//         scale = 1,            uniform scale of the whole lamp mesh (not the light)
//         bodyColor,            table lamp ceramic body colour (default sage glaze 0x7f9a86)
//         style,                pendant: 'dome' (enamel, default) | 'drum' (fabric) | 'glass' (amber glass bell)
//                               lantern: mount 'wall' (default) | 'stand' (table/floor lantern) | 'hang' (hangs below point)
//         mount,                alias of lantern style ('wall'|'stand'|'hang')
//         interactive = true,   false → no interactable registered
//         range,                interaction range (default 2.3)
//         glow = 1,             multiplier for halo sprite size/opacity
//         angle, penumbra,      desk lamp SpotLight cone (defaults 1.0 rad, 0.65)
//       })
//     types & anchor (`position`):
//       'floor'   base bottom centre on the floor. height = top of shade (default 1.6). Drum/empire fabric shade.
//       'table'   base bottom centre on the table. height default 0.6. Ceramic ginger-jar body + empire shade.
//       'desk'    base bottom centre. Banker's lamp (green glass shade along X), SpotLight aimed down/forward (+Z).
//       'pendant' ceiling attachment point; height = drop to shade bottom (default 0.75).
//       'ceiling' ceiling attachment point; flush-mount milk-glass dome (~0.14 m deep).
//       'wall'    wall mount point (sconce sticks out along +Z ~0.17 m, shade top ≈ +0.21 above mount).
//       'lantern' wall mount point (coach lantern, glass panes glow). mount:'stand' → bottom centre; 'hang' → hook point.
//     default intensities (cd): floor 18, table 11, desk 28 (spot), pendant 24, ceiling 14, wall 9, lantern 10.
//     default label nouns: 'floor lamp','table lamp','desk lamp','pendant lamp','ceiling light','wall lamp','lantern'
//       → interactable label is `Turn off the <label>` / `Turn on the <label>`. Pass label as the noun
//         (e.g. label:'reading lamp'); a function label is used verbatim.
//     → returns { id, type, group, light, get on(), setOn(bool, instant=false), toggle(), level (0..1 current fade),
//                 interactable }. Also stored in C.props.lamps[id].
//     Toggle: smooth 0.15 s fade of light intensity + shade/bulb emissive + halo; emits C.emit('lamp',{id,on,x,y,z}).
//     Lights are created once (PointLight, SpotLight for desk) and registered via C.registerLight(light,{id,room,kind}).
//     They are never added/removed at runtime (intensity only).
//
//  candle({ position, height = 0.14, radius = 0.025, color, lit = true, id?, parent,
//           holder: 'none'|'brass'|'saucer' (extra; default 'none'), label (extra) })
//     position = bottom of the candle (or of the holder). Animated flame + halo sprite, no light.
//     → returns the Group; group.userData.candle = { lit, setLit(bool), toggle() }. With `id` → interactable
//       ('Blow out the candle' / 'Light the candle').
//
//  books({ length = 0.8, depth = 0.2, minH = 0.17, maxH = 0.27, position, rotationY, parent, seed = 1, lean = true,
//          palette, // extras: stacks = true (allow small flat stacks in the row), gaps = true, fill = 1 (0..1 share of
//          // the length to fill before stopping) })
//     position = centre of the row ON the shelf surface (books span local X, spines at local z = +depth/2).
//     One merged mesh, one shared atlas material (spine designs). `palette` = array of hex colours → tints spines.
//     → Group (group.userData.usedLength = metres actually used).
//
//  bookStack({ count = 3, position, rotationY, parent, seed = 1, // extras: minH = 0.18, maxH = 0.28, jitter = 1 })
//     books lying flat, position = bottom centre of the stack. group.userData.height = stack height.
//
//  painting({ width = 0.5, height = 0.4, style: 'landscape'|'seascape'|'botanical'|'portrait'|'abstract'|'cottage'|'map',
//             frame: 'gold'|'wood'|'black'|'white', position, rotationY, parent, seed = 1 })
//     position = centre of the BACK of the frame on the wall surface; faces +Z; frame depth ≈ 0.035.
//     width/height = outer frame size. Canvas-generated art (unique texture per painting, ≤ 512 px).
//
//  plant({ type: 'fern'|'monstera'|'snake'|'succulent'|'ivy'|'herb'|'fiddle'|'pothos', scale = 1, potColor,
//          position, parent, seed = 1, // extras: rotationY, pot: 'terracotta'|'ceramic'|'basket' (override),
//          saucer = true (terracotta saucer) })
//     position = pot bottom centre. Approx sizes (scale 1): fern ⌀0.26×0.55h, monstera ⌀0.34 pot ×0.95h,
//     snake 0.7h, succulent ⌀0.12×0.14h, ivy (trails 0.3–0.5 below rim), herb 0.28h, fiddle 1.35h, pothos (trailing).
//     3 draw calls (pot, soil, leaves) — bakeable.
//
//  pillow({ w = 0.45, h = 0.45, t = 0.14, material|color, position, rotation:[x,y,z], parent,
//           // extras: rotationY, shape: 'square'|'round'|'bolster', button = false })
//     position = pillow CENTRE; w along X, h along Y (standing up), t = thickness along Z (front face +Z).
//     For a pillow lying flat use rotation:[-Math.PI/2,0,0]. `material` = Material or C.mats name; `color` = hex
//     (tinted linen weave). Shared geometry per size.
//
//  blanket({ w = 0.5, d = 0.35, t = 0.03, material = 'knit', position, rotationY, folds = 3, parent })
//     folded stack; position = bottom centre. group.userData.height.
//  throwBlanket({ w = 1.2, d = 0.9, material = 'knit', position, rotationY, parent, drapeOver,
//                 // extras: seed, wave = 1 })
//     softly wavy throw lying on a surface at position.y (local XZ, w along X, d along Z).
//     drapeOver: number (m hanging down over the +Z edge) or { drop, radius = 0.035 } → the last `drop` metres of d
//     wrap over the edge at local z = d/2 - drop and hang straight down in front (−Y).
//
//  rug({ w = 2, d = 1.4, style: 'persian'|'braided'|'runner'|'sheepskin'|'kilim', round = false, position, rotationY,
//        parent, tag = true, // extras: fringe = true (persian/runner/kilim) })
//     rug top at position.y + 0.006 (bottom at +0.0005). Registers C.physics.addSurfaceTag(..., 'rug') over its AABB.
//
//  mug({ position, color, steam = false, parent, // extras: rotationY, fill = 'tea'|'coffee'|'cocoa'|'none' })
//     bottom centre; 0.095 tall, handle on +X. group.userData.steam = steam handle (if steam).
//  teapot({ position, color, steam = false, parent, rotationY })  ~0.16 tall, spout +X.
//  vase({ position, flowers = true|'tulip'|'daisy'|'lavender'|'wild', color, parent, seed,
//         // extras: height = 0.2, shape: 'jug'|'bottle'|'round', flowerColor })
//  frame({ w = 0.13, h = 0.18, position, rotationY, parent, seed, // extras: style: 'wood'|'brass'|'silver'|'black' })
//     standing photo frame, bottom centre, leans back slightly on an easel leg.
//  clock({ position, rotationY, parent, // extras: scale = 1, id, color }) mantel clock (0.32 w × 0.2 h × 0.1 d),
//     hands show the real local time. With `id` → interactable 'Check the time' (toast).
//  jar({ position, parent, // extras: radius = 0.05, height = 0.14, contents: 'flour'|'sugar'|'beans'|'pasta'|'tea'|
//        'cookies'|'jam'|'honey'|'rice'|'empty', fill = 0.7, lid: 'cork'|'wood'|'metal', label = true })
//  bottle({ position, parent, // extras: kind: 'wine'|'oil'|'milk'|'beer'|'green', color, height, label = true })
//  basket({ position, rotationY, parent, // extras: radius = 0.18, height = 0.2, oval = 1 (z scale), handle = false,
//           contents: 'none'|'yarn'|'logs'|'blanket'|'apples'|'bread' })
//  steam(parent, position, opts?) → { points, setStrength(0..1), strength, remove() }
//     soft rising wisps (one Points draw call, shader-animated, no per-frame JS work).
//     opts { count = 18, height = 0.28, size = 0.05, spread = 0.02, speed = 1, opacity = 0.35, strength = 1,
//            color = 0xffffff }
//  glow(parent, position, color = 0xffc080, size = 0.4, opacity = 0.8) → additive halo Sprite (raycast disabled).
//
//  helpers (C.props.util): { Parts, metal(kind), fabric(colorHex), leafMaterial() }
//     Parts: const p = new Parts(); p.add(geometry, material) ...; p.build(parent, name, {cast, dynamic}) merges
//     geometries per material into one mesh each.
// =====================================================================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const C = window.COZY;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------ runtime state
const S = {
  lamps: [], candles: [], clocks: [], lampSeq: 0,
  steamTime: { value: 0 }, steamScale: { value: 360 },
  tzOffsetMs: 0,
};
const _v = new THREE.Vector3();

// ------------------------------------------------------------------------------------------------ small helpers
const P3 = (p, d) => (!p ? (d || [0, 0, 0]) : Array.isArray(p) ? p : [p.x, p.y, p.z]);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = t => t * t * (3 - 2 * t);
const hexCol = h => new THREE.Color(h);

function mkGroup(o, name) {
  const g = new THREE.Group();
  g.name = name;
  const p = P3(o.position);
  g.position.set(p[0], p[1], p[2]);
  if (o.rotation) g.rotation.set(o.rotation[0] || 0, o.rotation[1] || 0, o.rotation[2] || 0);
  if (o.rotationY) g.rotation.y += o.rotationY;
  (o.parent || C.scene).add(g);
  return g;
}
function M(name) { return C.mat(name); }

// geometry prep for merging: non-indexed, position/normal/uv (+color when needed)
function prep(g, keepColor) {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (keepColor && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(keepColor && k === 'color')) g.deleteAttribute(k);
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}
const geoCache = new Map();
class Parts {
  constructor() { this.buckets = new Map(); }
  add(g, mat) {
    let b = this.buckets.get(mat.uuid);
    if (!b) { b = { mat, geos: [] }; this.buckets.set(mat.uuid, b); }
    b.geos.push(g);
    return g;
  }
  merged() {
    const out = [];
    for (const b of this.buckets.values()) {
      const keep = !!b.mat.vertexColors;
      const gs = b.geos.map(g => prep(g, keep));
      const geo = gs.length === 1 ? gs[0] : mergeGeometries(gs, false);
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      out.push({ geo, mat: b.mat });
    }
    return out;
  }
  build(parent, name, o = {}) { return meshesFrom(this.merged(), parent, name, o); }
}
function meshesFrom(list, parent, name, o = {}) {
  const out = [];
  for (const { geo, mat } of list) {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = !!o.cast;
    m.receiveShadow = o.receive !== false;
    if (o.dynamic) m.userData.dynamic = true;
    if (o.renderOrder) m.renderOrder = o.renderOrder;
    parent.add(m);
    out.push(m);
  }
  return out;
}
// build (or reuse) merged geometry lists by key → shares geometry between identical instances
function cachedParts(key, fill) {
  let list = geoCache.get(key);
  if (!list) { const p = new Parts(); fill(p); list = p.merged(); geoCache.set(key, list); }
  return list;
}

function place(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  if (x || y || z) g.translate(x, y, z);
  return g;
}
const gBox = (w, h, d, x, y, z, rx, ry, rz) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const gRBox = (w, h, d, r, x, y, z, rx, ry, rz, seg = 2) => place(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), x, y, z, rx, ry, rz);
const gCyl = (rt, rb, h, seg, x, y, z, rx, ry, rz, open) => place(new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open), x, y, z, rx, ry, rz);
const gSph = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 16, hs = 12) => { const g = new THREE.SphereGeometry(r, ws, hs); if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz); return place(g, x, y, z); };
const gLathe = (pts, seg = 24, x, y, z) => place(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0, p[0]), p[1])), seg), x, y, z);
const gTorus = (R, r, rs, ts, arc, x, y, z, rx, ry, rz) => place(new THREE.TorusGeometry(R, r, rs || 6, ts || 24, arc || TAU), x, y, z, rx, ry, rz);
const gTube = (pts, r, segs = 12, radial = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))), segs, r, radial, false);
const wuv = (g, s = 1) => { C.util.worldUV(g, s); return g; };
// scale lathe uvs so textures authored for 1 uv = 1 m look right (u around circumference, v along profile)
function latheUV(g, circ, len) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * len); return g; }

// ------------------------------------------------------------------------------------------------ materials
const matCache = new Map();
function cachedMat(key, make) { let m = matCache.get(key); if (!m) { m = make(); m.name = 'props.' + key; matCache.set(key, m); } return m; }
function metal(kind = 'brass') {
  kind = kind === 'iron' ? 'ironBlack' : kind;
  return cachedMat('metal.' + kind, () => {
    const m = M(kind).clone();
    // softened metals: read well both with and without an environment map
    if (kind === 'ironBlack') { m.metalness = 0.45; m.color.set(0x2c2926); }
    else if (kind === 'chrome') { m.metalness = 0.7; }
    else { m.metalness = 0.62; }
    return m;
  });
}
function fabric(color) {
  return cachedMat('fabric.' + color, () => {
    const m = M('fabricCream').clone();
    m.color.set(color).multiplyScalar(1.07);
    if (m.sheenColor) m.sheenColor.set(color).lerp(new THREE.Color(0xffffff), 0.5);
    return m;
  });
}
function resolveMat(m, fallbackName, color) {
  if (m && m.isMaterial) return m;
  if (typeof m === 'string') return M(m);
  if (color !== undefined && color !== null) return typeof color === 'string' ? M(color) : fabric(color);
  return M(fallbackName);
}
const glaze = (color, rough = 0.28) => C.util.stdMat(color, rough, 0);
let _leafMat = null;
function leafMaterial() {
  if (!_leafMat) { _leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.52, metalness: 0 }); _leafMat.name = 'props.leaf'; }
  return _leafMat;
}
let _gradTex = null;
function shadeGradient() {
  if (_gradTex) return _gradTex;
  _gradTex = C.util.canvasTexture(4, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0); // bottom (v=0) -> top (v=1)
    g.addColorStop(0, '#c8c8c8'); g.addColorStop(0.35, '#ffffff'); g.addColorStop(0.7, '#e6e6e6'); g.addColorStop(1, '#8a8a8a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
  return _gradTex;
}

// ================================================================================================================
//  LAMPS
// ================================================================================================================
const LAMP_DEF = {
  floor: { intensity: 18, noun: 'floor lamp' }, table: { intensity: 11, noun: 'table lamp' }, desk: { intensity: 28, noun: 'desk lamp' },
  pendant: { intensity: 24, noun: 'pendant lamp' }, ceiling: { intensity: 14, noun: 'ceiling light' }, wall: { intensity: 9, noun: 'wall lamp' },
  lantern: { intensity: 10, noun: 'lantern' },
};
// Glow tuning (playtest: lamps read white-hot). Emissive glows scale by `emissive`, halo sprites by `halo` (opacity)
// and `haloSize`. Shade interiors use unlit colours (innerGlow): the lamp's own light a few cm away blows them out.
const GLOW = { emissive: 0.4, halo: 0.35, haloSize: 0.7 };

function makeShadeMat(o, lampColor, maxEmissive = 1.1) {
  const m = M('lampshade').clone();
  m.side = THREE.FrontSide;                     // outer face; the inside is drawn by shadeInner()
  if (o.shadeColor !== undefined) m.color.set(o.shadeColor).multiplyScalar(1.05);
  m.emissive = lampColor.clone();
  if (o.shadeColor !== undefined) m.emissive.lerp(new THREE.Color(o.shadeColor), 0.35);
  m.emissiveMap = shadeGradient();
  m.emissiveIntensity = 0;
  m.name = 'props.lampshade.' + (o.id || '');
  return { m, max: maxEmissive };
}
function makeBulbMat(max = 3.2) {
  const m = M('bulb').clone();
  m.emissiveIntensity = 0;
  return { m, max };
}
// unlit surface whose colour fades off → on with the lamp (applyLamp), so it never blows out
function innerGlow(on, off, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color: off.clone(), side: opts.side !== undefined ? opts.side : THREE.BackSide,
    transparent: !!opts.transparent, opacity: opts.opacity !== undefined ? opts.opacity : 1, depthWrite: !opts.transparent });
  m.name = 'props.innerGlow';
  return { m, on, off };
}
function shadeInner(parent, geo, o, id, lampColor, glows) {
  const on = lampColor.clone().lerp(new THREE.Color(o.shadeColor !== undefined ? o.shadeColor : 0xefe0c0), 0.3).multiplyScalar(0.6);
  const g = innerGlow(on, new THREE.Color(0x1d1a17));
  glows.push(g);
  meshesFrom([{ geo: prep(geo, false), mat: g.m }], parent, 'props.lamp.' + id + '.shadeIn', { dynamic: true });
}

function lamp(o = {}) {
  const type = LAMP_DEF[o.type] ? o.type : 'floor';
  const def = LAMP_DEF[type];
  const id = o.id || ('lamp_' + (++S.lampSeq));
  const g = mkGroup(o, 'props.lamp.' + id);
  g.userData.dynamic = true;
  const inner = new THREE.Group();
  inner.scale.setScalar(o.scale || 1);
  g.add(inner);
  const lampColor = new THREE.Color(o.color !== undefined ? o.color : 0xffb46b);
  const mk = metal(o.metal || (type === 'lantern' ? 'iron' : 'brass'));
  const parts = new Parts();
  const glows = [];           // materials that fade with the lamp: { m, max } emissive, or { m, on, off } unlit colour
  let lightPos = [0, 0, 0], spriteSize = 0.6, spriteOpacity = 0.55, spritePos = null;
  let spotTarget = null;
  let spotAngle = 1.0, spotPenumbra = 0.65;

  if (type === 'floor') {
    const H = o.height || 1.6;
    parts.add(gLathe([[0, 0], [0.145, 0], [0.15, 0.008], [0.147, 0.018], [0.125, 0.03], [0.07, 0.042], [0.03, 0.055], [0.02, 0.078], [0, 0.08]], 32), mk);
    const sb = H - 0.32;               // shade bottom
    const sockY = H - 0.25;
    parts.add(gCyl(0.011, 0.011, sockY - 0.07, 12, 0, (sockY + 0.07) / 2, 0), mk);
    parts.add(gLathe([[0, -0.022], [0.012, -0.022], [0.019, -0.012], [0.021, 0], [0.019, 0.012], [0.012, 0.022], [0, 0.022]], 16, 0, H * 0.46, 0), mk);
    parts.add(gLathe([[0, -0.015], [0.014, -0.015], [0.018, 0], [0.014, 0.015], [0, 0.015]], 16, 0, sb - 0.12, 0), mk);
    // socket + saddle + harp
    parts.add(gCyl(0.017, 0.015, 0.055, 16, 0, sockY + 0.027, 0), mk);
    parts.add(gBox(0.15, 0.006, 0.008, 0, sockY + 0.008, 0), mk);
    const hr = 0.072, harpH = H - (sockY + 0.008) - 0.004;
    const harp = gTorus(hr, 0.003, 4, 20, Math.PI);
    harp.scale(1, harpH / hr, 1); harp.translate(0, sockY + 0.008, 0);
    parts.add(harp, mk);
    parts.add(gSph(0.013, 0, H + 0.013, 0), mk);
    parts.add(gCyl(0.004, 0.006, 0.012, 8, 0, H + 0.002, 0), mk);
    // shade
    const sh = makeShadeMat(o, lampColor, 1.15);
    glows.push(sh);
    const shade = gLathe([[0.235, sb], [0.228, sb + 0.06], [0.212, sb + 0.14], [0.19, sb + 0.23], [0.158, H]], 40);
    const trimM = C.util.stdMat(new THREE.Color(o.shadeColor !== undefined ? o.shadeColor : 0xefe0c0).multiplyScalar(0.62).getHex(), 0.9);
    parts.add(gTorus(0.236, 0.0045, 5, 48, TAU, 0, sb, 0, Math.PI / 2), trimM);
    parts.add(gTorus(0.159, 0.004, 5, 40, TAU, 0, H, 0, Math.PI / 2), trimM);
    // top spider ring
    parts.add(gBox(0.31, 0.003, 0.003, 0, H - 0.004, 0), mk);
    parts.add(gBox(0.003, 0.003, 0.31, 0, H - 0.004, 0), mk);
    const bulb = makeBulbMat(); glows.push(bulb);
    const bY = sockY + 0.1;
    parts.add(gSph(0.03, 0, bY, 0, 1, 1.18, 1), bulb.m);
    parts.add(gCyl(0.013, 0.017, 0.03, 12, 0, bY - 0.035, 0), bulb.m);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    meshesFrom([{ geo: prep(shade, false), mat: sh.m }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
    shadeInner(inner, shade, o, id, lampColor, glows);
    lightPos = [0, bY, 0]; spriteSize = 0.95; spriteOpacity = 0.5;
  } else if (type === 'table') {
    const H = o.height || 0.6, k = H / 0.6;
    parts.add(gLathe([[0, 0], [0.078, 0], [0.081, 0.006], [0.077, 0.016], [0.06, 0.022], [0, 0.023]], 32), mk);
    const body = glaze(o.bodyColor !== undefined ? o.bodyColor : 0x7f9a86, 0.22);
    parts.add(gLathe([[0, 0.022], [0.05, 0.022], [0.066, 0.04], [0.086, 0.085], [0.095, 0.13], [0.09, 0.175], [0.068, 0.225], [0.045, 0.255], [0.03, 0.27], [0.028, 0.285], [0, 0.286]].map(p => [p[0] * Math.min(1.1, k), 0.022 + (p[1] - 0.022) * k]), 32), body);
    const nb = 0.022 + 0.264 * k;
    parts.add(gCyl(0.03, 0.03, 0.01, 20, 0, nb + 0.004, 0), mk);
    parts.add(gCyl(0.011, 0.011, 0.06, 12, 0, nb + 0.035, 0), mk);
    const sb = H - 0.22, sockY = Math.max(nb + 0.06, sb + 0.01);
    parts.add(gCyl(0.016, 0.014, 0.045, 14, 0, sockY + 0.02, 0), mk);
    parts.add(gBox(0.12, 0.005, 0.006, 0, sockY + 0.004, 0), mk);
    const hr = 0.058, harpH = H - sockY - 0.006;
    const harp = gTorus(hr, 0.0025, 4, 18, Math.PI); harp.scale(1, harpH / hr, 1); harp.translate(0, sockY + 0.004, 0);
    parts.add(harp, mk);
    parts.add(gSph(0.011, 0, H + 0.011, 0), mk);
    const sh = makeShadeMat(o, lampColor, 1.1); glows.push(sh);
    const shade = gLathe([[0.165, sb], [0.155, sb + 0.06], [0.132, sb + 0.14], [0.1, H]], 36);
    const trimM = C.util.stdMat(new THREE.Color(o.shadeColor !== undefined ? o.shadeColor : 0xefe0c0).multiplyScalar(0.62).getHex(), 0.9);
    parts.add(gTorus(0.166, 0.0035, 5, 40, TAU, 0, sb, 0, Math.PI / 2), trimM);
    parts.add(gTorus(0.101, 0.003, 5, 32, TAU, 0, H, 0, Math.PI / 2), trimM);
    const bulb = makeBulbMat(); glows.push(bulb);
    const bY = sockY + 0.075;
    parts.add(gSph(0.026, 0, bY, 0, 1, 1.18, 1), bulb.m);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    meshesFrom([{ geo: prep(shade, false), mat: sh.m }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
    shadeInner(inner, shade, o, id, lampColor, glows);
    lightPos = [0, bY, 0]; spriteSize = 0.6; spriteOpacity = 0.5;
  } else if (type === 'desk') {
    const H = o.height || 0.42;
    const dz = 0.045;
    parts.add(gLathe([[0, 0], [0.085, 0], [0.088, 0.006], [0.084, 0.016], [0.07, 0.024], [0.035, 0.03], [0.02, 0.045], [0, 0.046]], 32), mk);
    const armTop = H - 0.075;
    parts.add(gCyl(0.008, 0.009, armTop - 0.04, 10, 0, (armTop + 0.04) / 2, 0), mk);
    // bracket arm forward to shade
    parts.add(gTube([[0, armTop - 0.01, 0], [0, armTop + 0.022, 0.01], [0, armTop + 0.036, dz]], 0.006, 10, 6), mk);
    const glassCol = o.shadeColor !== undefined ? o.shadeColor : 0x1d4a2c;
    const gm = C.util.stdMat(glassCol, 0.08, 0.1).clone();
    gm.emissive = new THREE.Color(glassCol).lerp(lampColor, 0.2); gm.emissiveIntensity = 0;
    gm.name = 'props.bankerglass.' + id;
    glows.push({ m: gm, max: 0.25 });
    const opalGlow = innerGlow(lampColor.clone().lerp(new THREE.Color(0xffffff), 0.3).multiplyScalar(0.55), new THREE.Color(0x2c2a26));
    const opal = opalGlow.m; opal.name = 'props.bankeropal.' + id;
    glows.push(opalGlow);
    const sy = H - 0.03, len = 0.27, R = 0.07;
    const shadeG = new THREE.CylinderGeometry(R, R, len, 24, 1, true, 0, Math.PI);
    // axis along X, opening facing down
    shadeG.rotateZ(Math.PI / 2); shadeG.translate(0, sy, dz);
    // ends
    parts.add(place(new THREE.CircleGeometry(R + 0.002, 20, 0, Math.PI), len / 2 + 0.001, sy, dz, 0, Math.PI / 2, 0), mk);
    parts.add(place(new THREE.CircleGeometry(R + 0.002, 20, 0, Math.PI), -len / 2 - 0.001, sy, dz, 0, -Math.PI / 2, 0), mk);
    parts.add(gTorus(R + 0.001, 0.003, 4, 16, Math.PI, len / 2, sy, dz, 0, Math.PI / 2), mk);
    parts.add(gTorus(R + 0.001, 0.003, 4, 16, Math.PI, -len / 2, sy, dz, 0, Math.PI / 2), mk);
    parts.add(gCyl(0.003, 0.003, len, 6, 0, sy, dz + R - 0.001, 0, 0, Math.PI / 2), mk);
    parts.add(gCyl(0.003, 0.003, len, 6, 0, sy, dz - R + 0.001, 0, 0, Math.PI / 2), mk);
    // pull chain + bead
    parts.add(gCyl(0.0012, 0.0012, 0.07, 4, 0.05, sy - 0.035, dz + R - 0.012), mk);
    parts.add(gSph(0.006, 0.05, sy - 0.074, dz + R - 0.012), mk);
    const bulb = makeBulbMat(2.6); glows.push(bulb);
    parts.add(gCyl(0.011, 0.011, 0.17, 12, 0, sy + 0.01, dz, 0, 0, Math.PI / 2), bulb.m);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    const opalG = shadeG.clone(); opalG.translate(0, -sy, -dz); opalG.scale(0.985, 0.955, 0.955); opalG.translate(0, sy, dz);
    meshesFrom([{ geo: prep(shadeG, false), mat: gm }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
    meshesFrom([{ geo: prep(opalG, false), mat: opal }], inner, 'props.lamp.' + id + '.opal', { dynamic: true });
    lightPos = [0, sy - 0.01, dz + 0.01]; spriteSize = 0.35; spriteOpacity = 0.4; spritePos = [0, sy - 0.03, dz + 0.02];
    spotTarget = [0, -H, dz + 0.3];
  } else if (type === 'pendant') {
    const drop = o.height || 0.75;
    const style = o.style || 'dome';
    parts.add(gLathe([[0, -0.028], [0.065, -0.028], [0.066, -0.022], [0.06, -0.012], [0.035, -0.004], [0.0, 0]], 24), mk);
    const cordM = C.util.stdMat(0x2a2522, 0.8);
    const shTop = -(drop - (style === 'drum' ? 0.24 : 0.19));
    parts.add(gCyl(0.0035, 0.0035, -0.03 - shTop, 6, 0, (shTop - 0.03) / 2, 0), cordM);
    parts.add(gCyl(0.02, 0.02, 0.05, 16, 0, shTop + 0.005, 0), mk);
    const bulb = makeBulbMat(); glows.push(bulb);
    if (style === 'drum') {
      const sb = -drop;
      const sh = makeShadeMat(o, lampColor, 1.1); glows.push(sh);
      const shade = gLathe([[0.23, sb], [0.23, sb + 0.24]], 40);
      const trimM = C.util.stdMat(new THREE.Color(o.shadeColor !== undefined ? o.shadeColor : 0xefe0c0).multiplyScalar(0.62).getHex(), 0.9);
      parts.add(gTorus(0.231, 0.004, 5, 48, TAU, 0, sb, 0, Math.PI / 2), trimM);
      parts.add(gTorus(0.231, 0.004, 5, 48, TAU, 0, sb + 0.24, 0, Math.PI / 2), trimM);
      parts.add(gBox(0.46, 0.003, 0.003, 0, sb + 0.235, 0), mk); parts.add(gBox(0.003, 0.003, 0.46, 0, sb + 0.235, 0), mk);
      parts.add(gSph(0.032, 0, sb + 0.11, 0, 1, 1.15, 1), bulb.m);
      meshesFrom([{ geo: prep(shade, false), mat: sh.m }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
      shadeInner(inner, shade, o, id, lampColor, glows);
      lightPos = [0, sb + 0.1, 0]; spriteSize = 1.0; spriteOpacity = 0.45;
    } else if (style === 'glass') {
      const gc = o.shadeColor !== undefined ? o.shadeColor : 0xd9a55a;
      const gcol = new THREE.Color(gc);
      const glass = innerGlow(gcol.clone().lerp(lampColor, 0.5).multiplyScalar(0.75), gcol.clone().multiplyScalar(0.3), { side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const gm = glass.m; gm.name = 'props.pendantglass.' + id;
      glows.push(glass);
      const sb = -drop;
      const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([0.03 + 0.13 * Math.pow(Math.sin(t * Math.PI * 0.5), 0.8) * (1 - 0.1 * t), sb + 0.19 * (1 - t)]); }
      prof.reverse();
      const shade = gLathe(prof, 32);
      meshesFrom([{ geo: prep(shade, false), mat: gm }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
      parts.add(gSph(0.03, 0, sb + 0.07, 0, 1, 1.15, 1), bulb.m);
      lightPos = [0, sb + 0.07, 0]; spriteSize = 0.9; spriteOpacity = 0.5;
    } else {
      // enamel dome: outer colour, inner white lit
      const sb = -drop;
      const prof = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;               // 0 = rim, 1 = top
        const r = 0.035 + 0.165 * Math.pow(Math.cos(t * Math.PI * 0.5), 0.9);
        prof.push([r, sb + 0.012 + 0.178 * Math.sin(t * Math.PI * 0.5)]);
      }
      const outerCol = o.shadeColor !== undefined ? o.shadeColor : 0x3d5a47;
      const outerM = C.util.stdMat(outerCol, 0.3, 0.05);
      const enamel = innerGlow(lampColor.clone().lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.6), new THREE.Color(0x3b3833));
      const inM = enamel.m; inM.name = 'props.enamelIn.' + id;
      glows.push(enamel);
      parts.add(gLathe(prof, 36), outerM);
      // rolled rim
      parts.add(gTorus(0.2, 0.006, 6, 48, TAU, 0, sb + 0.012, 0, Math.PI / 2), outerM);
      const innerG = gLathe(prof.map(p => [p[0] - 0.004, p[1] + 0.001]), 36);
      meshesFrom([{ geo: prep(innerG, false), mat: inM }], inner, 'props.lamp.' + id + '.shadeIn', { dynamic: true });
      parts.add(gSph(0.034, 0, sb + 0.085, 0, 1, 1.12, 1), bulb.m);
      lightPos = [0, sb + 0.08, 0]; spriteSize = 0.8; spriteOpacity = 0.55; spritePos = [0, sb + 0.04, 0];
      // opaque metal dome: light only leaves downwards (a point light would light the ceiling through it)
      spotTarget = [0, sb - 1.5, 0]; spotAngle = 1.2; spotPenumbra = 0.75;
    }
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
  } else if (type === 'ceiling') {
    parts.add(gLathe([[0, -0.03], [0.14, -0.03], [0.145, -0.022], [0.13, -0.008], [0.1, 0], [0, 0]], 36), mk);
    parts.add(gTorus(0.142, 0.006, 6, 40, TAU, 0, -0.03, 0, Math.PI / 2), mk);
    const gm = new THREE.MeshStandardMaterial({ color: 0xf6efe2, roughness: 0.35, metalness: 0, emissive: lampColor.clone().lerp(new THREE.Color(0xffffff), 0.3), emissiveIntensity: 0 });
    gm.name = 'props.milkglass.' + id;
    glows.push({ m: gm, max: 1.6 });
    const hemi = new THREE.SphereGeometry(0.135, 32, 10, 0, TAU, Math.PI / 2, Math.PI / 2); hemi.scale(1, 0.75, 1); hemi.translate(0, -0.03, 0);
    parts.add(gSph(0.012, 0, -0.135, 0), mk);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    meshesFrom([{ geo: prep(hemi, false), mat: gm }], inner, 'props.lamp.' + id + '.glass', { dynamic: true });
    lightPos = [0, -0.1, 0]; spriteSize = 0.9; spriteOpacity = 0.4; spritePos = [0, -0.1, 0];
  } else if (type === 'wall') {
    parts.add(gLathe([[0, 0], [0.05, 0], [0.052, 0.006], [0.046, 0.014], [0.02, 0.018], [0, 0.019]], 28, 0, 0, 0).rotateX(Math.PI / 2), mk);
    parts.add(gTube([[0, 0, 0.015], [0, -0.03, 0.07], [0, -0.005, 0.14], [0, 0.05, 0.165]], 0.0065, 16, 6), mk);
    const cy = 0.055, cz = 0.165;
    parts.add(gLathe([[0, -0.012], [0.012, -0.012], [0.035, 0.0], [0.038, 0.004], [0.02, 0.006], [0, 0.006]], 20, 0, cy, cz), mk);
    const sleeve = C.util.stdMat(0xf1e8d6, 0.5);
    parts.add(gCyl(0.012, 0.012, 0.05, 14, 0, cy + 0.03, cz), sleeve);
    const bulb = makeBulbMat(); glows.push(bulb);
    const bY = cy + 0.075;
    parts.add(gSph(0.018, 0, bY, cz, 1, 1.5, 1), bulb.m);
    // clip shade
    const sb = cy + 0.035, st = cy + 0.15;
    const sh = makeShadeMat(o, lampColor, 1.1); glows.push(sh);
    const shade = gLathe([[0.085, sb], [0.078, sb + 0.04], [0.065, sb + 0.08], [0.052, st]], 28, 0, 0, cz);
    const trimM = C.util.stdMat(new THREE.Color(o.shadeColor !== undefined ? o.shadeColor : 0xefe0c0).multiplyScalar(0.62).getHex(), 0.9);
    parts.add(gTorus(0.0855, 0.003, 4, 32, TAU, 0, sb, cz, Math.PI / 2), trimM);
    parts.add(gTorus(0.0525, 0.0025, 4, 28, TAU, 0, st, cz, Math.PI / 2), trimM);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    meshesFrom([{ geo: prep(shade, false), mat: sh.m }], inner, 'props.lamp.' + id + '.shade', { dynamic: true });
    shadeInner(inner, shade, o, id, lampColor, glows);
    lightPos = [0, bY, cz + 0.02]; spriteSize = 0.55; spriteOpacity = 0.5;
  } else if (type === 'lantern') {
    const mount = o.mount || o.style || 'wall';
    let cx = 0, by = 0, cz = 0;               // lantern body bottom centre
    if (mount === 'wall') {
      parts.add(gRBox(0.09, 0.26, 0.016, 0.006, 0, -0.02, 0.008), mk);
      parts.add(gBox(0.02, 0.02, 0.15, 0, -0.1, 0.085), mk);
      parts.add(gTube([[0, -0.13, 0.016], [0, -0.15, 0.06], [0, -0.13, 0.11], [0, -0.1, 0.13]], 0.005, 12, 5), mk);
      cz = 0.16; by = -0.09;
    } else if (mount === 'hang') {
      cz = 0; by = -0.34;
      parts.add(gTorus(0.02, 0.004, 5, 14, TAU, 0, -0.022, 0), mk);
      parts.add(gCyl(0.003, 0.003, 0.05, 5, 0, -0.06, 0), mk);
    }
    const W = 0.15, Hh = 0.22;
    parts.add(gBox(W + 0.02, 0.018, W + 0.02, cx, by + 0.009, cz), mk);
    parts.add(gBox(W - 0.03, 0.012, W - 0.03, cx, by - 0.004, cz), mk);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.add(gBox(0.012, Hh, 0.012, cx + sx * W / 2, by + 0.018 + Hh / 2, cz + sz * W / 2), mk);
    const topY = by + 0.018 + Hh;
    parts.add(gBox(W + 0.024, 0.012, W + 0.024, cx, topY + 0.006, cz), mk);
    parts.add(place(new THREE.ConeGeometry(0.13, 0.1, 4, 1), cx, topY + 0.062, cz, 0, Math.PI / 4, 0), mk);
    parts.add(gCyl(0.02, 0.028, 0.03, 12, cx, topY + 0.12, cz), mk);
    parts.add(gSph(0.012, cx, topY + 0.145, cz), mk);
    if (mount === 'stand' || mount === 'hang') parts.add(gTorus(0.035, 0.005, 5, 18, Math.PI, cx, topY + 0.15, cz), mk);
    const lglass = innerGlow(lampColor.clone().lerp(new THREE.Color(0xf4e2c0), 0.4).multiplyScalar(0.7), new THREE.Color(0xf4e2c0).multiplyScalar(0.12), { side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const gm = lglass.m; gm.name = 'props.lanternglass.' + id;
    glows.push(lglass);
    const pan = new Parts();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      pan.add(place(new THREE.PlaneGeometry(W - 0.012, Hh), cx + Math.sin(a) * (W / 2 - 0.002), by + 0.018 + Hh / 2, cz + Math.cos(a) * (W / 2 - 0.002), 0, a, 0), gm);
    }
    pan.build(inner, 'props.lamp.' + id + '.glass', { dynamic: true });
    const bulb = makeBulbMat(3.5); glows.push(bulb);
    parts.add(gCyl(0.012, 0.012, 0.05, 10, cx, by + 0.045, cz), C.util.stdMat(0xf1e8d6, 0.5));
    parts.add(gSph(0.016, cx, by + 0.095, cz, 1, 1.6, 1), bulb.m);
    parts.build(inner, 'props.lamp.' + id + '.body', { dynamic: true });
    lightPos = [cx, by + 0.11, cz]; spriteSize = 0.7; spriteOpacity = 0.55;
  }

  // light
  const intensity = o.intensity !== undefined ? o.intensity : def.intensity;
  let light;
  if (spotTarget) {
    light = new THREE.SpotLight(lampColor, 0, o.distance || 0, o.angle || spotAngle, o.penumbra !== undefined ? o.penumbra : spotPenumbra, o.decay !== undefined ? o.decay : 2);
    const tgt = new THREE.Object3D(); tgt.name = 'props.lamp.' + id + '.target';
    tgt.position.set(spotTarget[0], spotTarget[1], spotTarget[2]);
    inner.add(tgt);
    light.target = tgt;
  } else {
    light = new THREE.PointLight(lampColor, 0, o.distance || 0, o.decay !== undefined ? o.decay : 2);
  }
  light.name = 'light.' + id;
  light.position.set(lightPos[0], lightPos[1], lightPos[2]);
  if (o.castShadow) {
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.002;
    light.shadow.normalBias = 0.02;
    light.shadow.radius = 3;
  }
  inner.add(light);
  C.registerLight(light, { id, room: o.room || null, kind: 'lamp:' + type });

  // halo
  const gm = o.glow !== undefined ? o.glow : 1;
  const sprite = C.util.glowSprite(lampColor.getHex(), spriteSize * gm * GLOW.haloSize, 0);
  const sp = spritePos || lightPos;
  sprite.position.set(sp[0], sp[1], sp[2]);
  sprite.raycast = () => {};
  sprite.name = 'props.lamp.' + id + '.glow';
  inner.add(sprite);

  const L = {
    id, type, group: g, light, intensity, glows, sprite, spriteOpacity: spriteOpacity * Math.min(1, gm) * GLOW.halo,
    level: 0, target: 0, interactable: null,
    get on() { return this.target > 0.5; },
    setOn(v, instant) {
      const t = v ? 1 : 0;
      if (t === this.target && !instant) return;
      const changed = t !== this.target;
      this.target = t;
      if (instant) { this.level = t; applyLamp(this); }
      if (changed) {
        light.getWorldPosition(_v);
        C.emit('lamp', { id, on: !!v, x: _v.x, y: _v.y, z: _v.z });
      }
    },
    toggle() { this.setOn(!this.on); return this.on; },
  };
  L.target = o.on === false ? 0 : 1;
  L.level = L.target;
  applyLamp(L);
  if (o.interactive !== false) {
    const noun = typeof o.label === 'string' && o.label ? o.label : def.noun;
    const label = typeof o.label === 'function' ? o.label : () => `Turn ${L.on ? 'off' : 'on'} the ${noun}`;
    try { L.interactable = C.interact.add({ id, object: g, label, onUse: () => L.toggle(), range: o.range }); } catch (e) { C.log('props', 'interact add failed', e); }
  }
  S.lamps.push(L);
  api.lamps[id] = L;
  g.userData.lamp = L;
  return L;
}
function applyLamp(L) {
  const k = smooth(clamp(L.level, 0, 1));
  L.light.intensity = L.intensity * k;
  for (let i = 0; i < L.glows.length; i++) {
    const gl = L.glows[i];
    if (gl.on) gl.m.color.copy(gl.off).lerp(gl.on, k);
    else gl.m.emissiveIntensity = gl.max * k * GLOW.emissive;
  }
  L.sprite.material.opacity = L.spriteOpacity * k;
  L.sprite.visible = k > 0.002;
}

// ================================================================================================================
//  CANDLES + FLAMES
// ================================================================================================================
let _flameGeo = null, _flameMat = null;
function flameGeo() {
  if (_flameGeo) return _flameGeo;
  const outer = gLathe([[0, 0], [0.3, 0.08], [0.42, 0.25], [0.36, 0.5], [0.2, 0.78], [0, 1]], 12);
  const core = gLathe([[0, 0], [0.18, 0.06], [0.24, 0.2], [0.18, 0.4], [0, 0.6]], 10);
  core.translate(0, 0.02, 0);
  _flameGeo = mergeGeometries([prep(outer), prep(core)], false);
  _flameGeo.scale(0.019, 0.04, 0.019);
  _flameGeo.computeBoundingSphere();
  return _flameGeo;
}
function flameMat() {
  if (_flameMat) return _flameMat;
  _flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.22).multiplyScalar(1.4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  _flameMat.name = 'props.flame';
  return _flameMat;
}
function addFlame(parent, x, y, z, size = 1, lit = true) {
  const f = new THREE.Mesh(flameGeo(), flameMat());
  f.position.set(x, y, z);
  f.scale.setScalar(size);
  f.userData.dynamic = true;
  f.name = 'props.flame';
  f.raycast = () => {};
  const halo = C.util.glowSprite(0xffa048, 0.14 * size, 0.22);
  halo.position.set(x, y + 0.02 * size, z);
  halo.raycast = () => {};
  parent.add(f); parent.add(halo);
  const c = { flame: f, halo, base: size, ph: Math.random() * 100, lit, haloOp: 0.22 };
  f.visible = halo.visible = lit;
  S.candles.push(c);
  return c;
}
function candle(o = {}) {
  const h = o.height !== undefined ? o.height : 0.14, r = o.radius !== undefined ? o.radius : 0.025;
  const g = mkGroup(o, 'props.candle' + (o.id ? '.' + o.id : ''));
  const holder = o.holder || 'none';
  const wax = o.color !== undefined ? C.util.stdMat(o.color, 0.55, 0, { emissive: 0x2a1a08, emissiveIntensity: 0.2 }) : M('candleWax');
  const key = `candle|${h}|${r}|${holder}|${wax.uuid}|${o.metal || 'brass'}`;
  let base = 0;
  if (holder === 'brass') base = r < 0.016 ? 0.1 : 0.03;
  else if (holder === 'saucer') base = 0.014;
  const list = cachedParts(key, p => {
    const taper = r < 0.016;
    if (taper) p.add(gLathe([[0, 0], [r, 0], [r, h * 0.85], [r * 0.9, h * 0.97], [r * 0.55, h], [0, h]], 14, 0, base, 0), wax);
    else p.add(gLathe([[0, 0], [r, 0], [r, h - 0.004], [r * 0.97, h], [r * 0.82, h - 0.002], [r * 0.5, h - 0.007], [0, h - 0.008]], 24, 0, base, 0), wax);
    // wax drips
    const rr = C.util.rng(Math.round(h * 1000 + r * 10000));
    const nd = taper ? 1 : 3;
    for (let i = 0; i < nd; i++) {
      const a = rr() * TAU, len = 0.012 + rr() * 0.03;
      p.add(gSph(r * 0.16 + 0.002, Math.cos(a) * r * 0.98, base + h - len / 2 - 0.002, Math.sin(a) * r * 0.98, 0.6, len / (r * 0.3 + 0.004), 0.6, 8, 6), wax);
    }
    const wickTop = base + h - (taper ? 0 : 0.008);
    p.add(gCyl(0.0012, 0.0014, 0.014, 5, 0, wickTop + 0.006, 0, 0.12), C.util.stdMat(0x17110d, 0.9));
    if (holder === 'brass') {
      const mm = metal(o.metal || 'brass');
      if (taper) p.add(gLathe([[0, 0], [0.05, 0], [0.052, 0.006], [0.04, 0.014], [0.014, 0.024], [0.011, 0.07], [0.016, 0.078], [0.035, 0.088], [0.036, 0.092], [0.016, 0.094], [0.016, 0.1], [0, 0.1]], 24), mm);
      else p.add(gLathe([[0, 0], [r + 0.03, 0], [r + 0.034, 0.012], [r + 0.028, 0.016], [r + 0.004, 0.02], [r + 0.004, 0.03], [0, 0.03]], 28), mm);
      if (taper) p.add(gTorus(0.018, 0.004, 6, 14, Math.PI * 1.2, 0.045, 0.03, 0, 0, 0, -0.3), mm);
    } else if (holder === 'saucer') {
      p.add(gLathe([[0, 0], [r + 0.03, 0], [r + 0.04, 0.012], [r + 0.036, 0.014], [r + 0.024, 0.006], [0, 0.006]], 28), M('ceramic'));
    }
  });
  meshesFrom(list, g, 'props.candle.body', {});
  const taper = r < 0.016;
  const fy = base + h - (taper ? 0 : 0.008) + 0.01;
  const c = addFlame(g, 0, fy, 0, clamp(r / 0.025, 0.7, 1.2), o.lit !== false);
  const ctl = {
    get lit() { return c.lit; },
    setLit(v) { c.lit = !!v; c.flame.visible = c.halo.visible = c.lit; },
    toggle() { this.setLit(!c.lit); return c.lit; },
  };
  g.userData.candle = ctl;
  if (o.id) {
    const lab = o.label || 'candle';
    g.userData.dynamic = true;
    try {
      C.interact.add({ id: o.id, object: g, label: () => (c.lit ? `Blow out the ${lab}` : `Light the ${lab}`), range: o.range,
        onUse: () => { ctl.toggle(); C.audio.play && C.audio.play(c.lit ? 'match' : 'whoosh', { x: g.position.x, y: g.position.y, z: g.position.z, volume: 0.4 }); } });
    } catch (e) { C.log('props', e); }
  }
  return g;
}

// ================================================================================================================
//  BOOKS
// ================================================================================================================
const BOOK_PALETTE = ['#6e2b27', '#34503d', '#2d3a55', '#b98b3a', '#e0d3b4', '#9c4a2c', '#3c6466', '#5a3a4f', '#6b6a3a', '#6a4a32',
  '#8a9a7a', '#b98580', '#3a3836', '#b89a6e', '#7a2f35', '#445a6e', '#c7a15a', '#4e3b2c', '#a86a3c', '#56704f', '#8c7a9a', '#d9c7a0', '#27313f', '#94452e'];
const ATLAS_COLS = 32, ATLAS_N = 62; // 2 rows of 32 cells; cell 62 = page block, 63 = spare
const atlasCache = new Map();
function bookAtlas(palette) {
  const key = palette ? palette.join(',') : 'default';
  if (atlasCache.has(key)) return atlasCache.get(key);
  const pal = palette || BOOK_PALETTE;
  const rnd = C.util.rng(4242 + key.length);
  const tex = C.util.canvasTexture(1024, 1024, (ctx) => {
    const cw = 32, ch = 512;
    for (let k = 0; k < 64; k++) {
      const x0 = (k % ATLAS_COLS) * cw, y0 = k < ATLAS_COLS ? 512 : 0;   // row 0 = bottom half (v 0..0.5)
      if (k >= ATLAS_N) {
        // pages
        ctx.fillStyle = '#ece2c8'; ctx.fillRect(x0, y0, cw, ch);
        for (let y = 0; y < ch; y += 2) { ctx.fillStyle = `rgba(120,100,70,${0.05 + rnd() * 0.08})`; ctx.fillRect(x0, y0 + y, cw, 1); }
        continue;
      }
      const base = pal[k % pal.length];
      const j = 0.85 + rnd() * 0.3;
      const ch8 = o => Math.min(255, Math.round(parseInt(base.slice(o, o + 2), 16) * j));
      const col = `rgb(${ch8(1)},${ch8(3)},${ch8(5)})`;
      ctx.fillStyle = col; ctx.fillRect(x0, y0, cw, ch);
      // cloth noise
      for (let i = 0; i < 260; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(x0 + rnd() * cw, y0 + rnd() * ch, 1 + rnd() * 2, 1 + rnd() * 3); }
      const light = (parseInt(base.slice(1, 3), 16) + parseInt(base.slice(3, 5), 16) + parseInt(base.slice(5, 7), 16)) / 3 > 150;
      const gold = light ? '#5a4128' : ['#d8b56a', '#e3c47e', '#caa45a'][k % 3];
      const style = k % 5;
      const title = (ya, yb, colr, wmax = 20) => {
        ctx.fillStyle = colr;
        let y = ya;
        while (y < yb) { const lw = 3 + Math.floor(rnd() * (wmax - 6)); ctx.fillRect(x0 + cw / 2 - lw / 2, y0 + y, lw, 3); y += 5 + (rnd() < 0.2 ? 6 : 0); }
      };
      if (style === 0) {         // gilt bands + title
        ctx.fillStyle = gold;
        for (const y of [22, 30, 470, 478]) ctx.fillRect(x0 + 2, y0 + y, cw - 4, 3);
        title(70, 200, gold);
        ctx.fillRect(x0 + 10, y0 + 430, 12, 3);
      } else if (style === 1) {  // leather label + raised bands
        for (const y of [40, 150, 300, 420]) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, y0 + y, cw, 5); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0, y0 + y - 2, cw, 2); }
        ctx.fillStyle = rnd() < 0.5 ? '#1f1a17' : '#6b1f1c'; ctx.fillRect(x0 + 3, y0 + 62, cw - 6, 70);
        ctx.strokeStyle = gold; ctx.lineWidth = 1; ctx.strokeRect(x0 + 5, y0 + 65, cw - 10, 64);
        title(76, 120, gold, 18);
      } else if (style === 2) {  // modern cloth: contrasting block
        ctx.fillStyle = light ? '#2c2a28' : '#efe6d2'; ctx.fillRect(x0, y0 + 50, cw, 150);
        title(64, 180, light ? '#efe6d2' : '#3b2e24', 20);
        ctx.fillStyle = light ? '#2c2a28' : '#efe6d2'; ctx.fillRect(x0 + 9, y0 + 440, 14, 14);
      } else if (style === 3) {  // thin lines
        ctx.fillStyle = gold;
        ctx.fillRect(x0, y0 + 14, cw, 2); ctx.fillRect(x0, y0 + 496, cw, 2);
        title(40, 240, gold, 16);
        title(420, 440, gold, 12);
      } else {                   // paper label
        ctx.fillStyle = '#e9dfc6'; ctx.fillRect(x0 + 4, y0 + 70, cw - 8, 110);
        ctx.strokeStyle = 'rgba(60,40,30,0.5)'; ctx.strokeRect(x0 + 5.5, y0 + 72.5, cw - 11, 105);
        title(84, 170, '#3a2c22', 16);
        ctx.fillStyle = gold; ctx.fillRect(x0 + 2, y0 + 470, cw - 4, 4);
      }
      // rounded-spine shading
      const gr = ctx.createLinearGradient(x0, 0, x0 + cw, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.38)'); gr.addColorStop(0.2, 'rgba(0,0,0,0.05)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.08)');
      gr.addColorStop(0.8, 'rgba(0,0,0,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = gr; ctx.fillRect(x0, y0, cw, ch);
      // worn top/bottom
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x0, y0, cw, 4); ctx.fillRect(x0, y0 + ch - 4, cw, 4);
    }
  }, { wrap: false });
  tex.generateMipmaps = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0 });
  mat.name = 'props.books';
  const entry = { mat, tex };
  atlasCache.set(key, entry);
  return entry;
}
function cellRect(k, u0f = 0, u1f = 1, v0f = 0, v1f = 1) {
  const col = k % ATLAS_COLS, row = k < ATLAS_COLS ? 0 : 1;
  const U0 = col / ATLAS_COLS, V0 = row * 0.5;
  const du = 1 / ATLAS_COLS, dv = 0.5;
  return [U0 + du * u0f, U0 + du * u1f, V0 + dv * v0f, V0 + dv * v1f];
}
function setBoxFaceUV(g, face, r) {
  const uv = g.attributes.uv;
  for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[1] - r[0]), r[2] + uv.getY(i) * (r[3] - r[2]));
}
function setAllUV(g, r) { for (let f = 0; f < 6; f++) setBoxFaceUV(g, f, r); }
// standing book: x = thickness w, y = height h, z = depth d; origin bottom centre; spine at +Z
function bookGeos(w, h, d, design) {
  const cov = 0.0022;
  const spine = gBox(w, h, cov, 0, h / 2, d / 2 - cov / 2);
  const coverR = cellRect(design, 0.35, 0.65, 0.62, 0.7);
  setAllUV(spine, coverR);
  setBoxFaceUV(spine, 4, cellRect(design, 0.02, 0.98, 0.005, 0.995));
  const left = gBox(cov, h, d - cov, -w / 2 + cov / 2, h / 2, -cov / 2); setAllUV(left, coverR);
  const right = gBox(cov, h, d - cov, w / 2 - cov / 2, h / 2, -cov / 2); setAllUV(right, coverR);
  const pd = d - cov - 0.003;
  const pages = gBox(w - 2 * cov, h - 0.006, pd, 0, h / 2, (0.003 - cov) / 2); setAllUV(pages, cellRect(62, 0.1, 0.9, 0.1, 0.9));
  return [spine, left, right, pages];
}
function addBook(parts, mat, w, h, d, design, m4) {
  for (const g of bookGeos(w, h, d, design)) { g.applyMatrix4(m4); parts.add(g, mat); }
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function mat4(x, y, z, rx = 0, ry = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); return _m4.compose(_p, _q, _s); }

function books(o = {}) {
  const L = o.length !== undefined ? o.length : 0.8, D = o.depth !== undefined ? o.depth : 0.2;
  const minH = o.minH !== undefined ? o.minH : 0.17, maxH = o.maxH !== undefined ? o.maxH : 0.27;
  const rnd = C.util.rng(((o.seed !== undefined ? o.seed : 1) * 7919 + 13) >>> 0);
  const g = mkGroup(o, 'props.books');
  const { mat } = bookAtlas(o.palette);
  const parts = new Parts();
  const end = L / 2;
  const doLean = o.lean !== false && rnd() < 0.75;
  const leanSpace = doLean ? 0.07 + rnd() * 0.06 : 0;
  const fillEnd = end - leanSpace - (L * (1 - (o.fill !== undefined ? o.fill : 1)));
  let x = -L / 2 + rnd() * 0.01;
  let lastH = 0, lastX = x;
  const Hr = () => minH + (maxH - minH) * Math.pow(rnd(), 1.1);
  const dRand = () => Math.min(D, D * (0.7 + rnd() * 0.3));
  let guard = 0;
  while (x < fillEnd && guard++ < 400) {
    const r = rnd();
    const remaining = fillEnd - x;
    if (o.stacks !== false && r < 0.07 && remaining > maxH + 0.02 && x > -L / 2 + 0.1) {
      // small flat stack in the row
      const n = 2 + Math.floor(rnd() * 3);
      let y = 0, fw = 0;
      const sizes = [];
      for (let i = 0; i < n; i++) sizes.push({ h: Math.min(D * 1.3, minH + rnd() * (maxH - minH)), w: 0.022 + rnd() * 0.03, d: Math.min(D, 0.13 + rnd() * 0.07), k: Math.floor(rnd() * ATLAS_N) });
      sizes.sort((a, b) => b.h - a.h);
      fw = sizes[0].h;
      const cx = x + fw / 2 + 0.004;
      for (const s of sizes) {
        const jx = (rnd() - 0.5) * 0.012;
        // lying: rotateZ(-PI/2) -> x extent h, y extent w
        const m = mat4(cx + jx - 0, y + s.w / 2, D / 2 - s.d / 2 - rnd() * 0.01, 0, (rnd() - 0.5) * 0.06, -Math.PI / 2);
        // origin of standing geo is bottom centre → after rotZ(-90°) spans x∈[0,h]; shift by -h/2
        _p.set(0, -s.h / 2, 0).applyQuaternion(_q); m.elements[12] += _p.x; m.elements[13] += _p.y; m.elements[14] += _p.z;
        addBook(parts, mat, s.w, s.h, s.d, s.k, m);
        y += s.w;
      }
      lastH = y; x += fw + 0.008; lastX = x;
      continue;
    }
    const series = rnd() < 0.18 ? 2 + Math.floor(rnd() * 4) : 1;
    const k = Math.floor(rnd() * ATLAS_N);
    const h = Hr(), d = dRand();
    const w0 = rnd() < 0.12 ? 0.045 + rnd() * 0.02 : 0.018 + rnd() * 0.028;
    let placed = 0;
    for (let i = 0; i < series; i++) {
      const w = series > 1 ? w0 : w0;
      if (x + w > fillEnd + (leanSpace ? 0 : 0.0)) break;
      const hh = series > 1 ? h : h;
      addBook(parts, mat, w, hh, d, series > 1 ? k : Math.floor(rnd() * ATLAS_N), mat4(x + w / 2, 0, D / 2 - d / 2 - rnd() * 0.006));
      x += w + (rnd() < 0.2 ? rnd() * 0.004 : 0.0006);
      lastH = hh; lastX = x; placed++;
    }
    if (!placed) break;
    if (o.gaps !== false && rnd() < 0.04 && fillEnd - x > 0.15) x += 0.02 + rnd() * 0.04;
  }
  // leaning book at the end
  if (doLean && lastH > 0) {
    const xn = lastX, hn = lastH;
    const avail = end - xn;
    for (let tries = 0; tries < 6; tries++) {
      const w = 0.02 + rnd() * 0.025, h = Math.max(hn * 0.9, Hr()), d = dRand();
      let ok = false;
      for (let th = 0.42; th >= 0.12; th -= 0.03) {
        if (hn / Math.cos(th) > h - 0.008) continue;
        const px = xn + hn * Math.tan(th);
        if (px + w * Math.cos(th) > end - 0.002) continue;
        const m = mat4(px + (w / 2) * Math.cos(th), (w / 2) * Math.sin(th), D / 2 - d / 2 - 0.004, 0, 0, th);
        addBook(parts, mat, w, h, d, Math.floor(rnd() * ATLAS_N), m);
        lastX = px + w * Math.cos(th);
        ok = true; break;
      }
      if (ok) break;
    }
    void avail;
  }
  parts.build(g, 'props.books.row', {});
  g.userData.usedLength = lastX + L / 2;
  return g;
}
function bookStack(o = {}) {
  const n = o.count || 3;
  const rnd = C.util.rng(((o.seed !== undefined ? o.seed : 1) * 3571 + 7) >>> 0);
  const g = mkGroup(o, 'props.bookStack');
  const { mat } = bookAtlas(o.palette);
  const parts = new Parts();
  const minH = o.minH || 0.18, maxH = o.maxH || 0.28, jit = o.jitter !== undefined ? o.jitter : 1;
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push({ h: minH + rnd() * (maxH - minH), w: 0.02 + rnd() * 0.03, d: 0.13 + rnd() * 0.07, k: Math.floor(rnd() * ATLAS_N) });
  sizes.sort((a, b) => b.h * b.d - a.h * a.d);
  let y = 0;
  for (const s of sizes) {
    const ry = (rnd() - 0.5) * 0.3 * jit;
    const m = mat4((rnd() - 0.5) * 0.02 * jit, y + s.w / 2, (rnd() - 0.5) * 0.02 * jit, 0, ry, -Math.PI / 2);
    // centre the lying book: standing geo origin at bottom centre, depth centred at z≈0 → after rotZ(-90°) x∈[0,h]
    _p.set(0, -s.h / 2, 0).applyQuaternion(_q); m.elements[12] += _p.x; m.elements[13] += _p.y; m.elements[14] += _p.z;
    addBook(parts, mat, s.w, s.h, s.d, s.k, m);
    y += s.w;
  }
  parts.build(g, 'props.bookStack', {});
  g.userData.height = y;
  return g;
}

// ================================================================================================================
//  PAINTINGS (canvas art)
// ================================================================================================================
function painterly(ctx, w, h, rnd, n = 2600, len = 9, width = 3, flow = 0) {
  const img = ctx.getImageData(0, 0, w, h).data;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h;
    const ix = (Math.floor(y) * w + Math.floor(x)) * 4;
    const j = 0.9 + rnd() * 0.2;
    ctx.strokeStyle = `rgba(${Math.min(255, img[ix] * j) | 0},${Math.min(255, img[ix + 1] * j) | 0},${Math.min(255, img[ix + 2] * j) | 0},${0.55 + rnd() * 0.35})`;
    ctx.lineWidth = width * (0.6 + rnd() * 0.8);
    const a = flow + (C.util.noise2D(x / 90, y / 90) * 0.9) + (rnd() - 0.5) * 0.4;
    const l = len * (0.5 + rnd());
    ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2); ctx.lineTo(x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2); ctx.stroke();
  }
}
function varnish(ctx, w, h, amt = 0.35) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(60,40,10,0)'); g.addColorStop(1, `rgba(40,25,5,${amt})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,220,150,0.06)'; ctx.fillRect(0, 0, w, h);
}
function canvasWeave(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.035)';
  for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}
function ridge(ctx, w, y0, amp, freq, seed, color, h) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, y0 - amp * (0.5 + 0.5 * C.util.fbm2D(x * freq, seed, 3)));
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
}
function tree(ctx, x, y, s, rnd, dark = '#34482f', light = '#56704a') {
  ctx.fillStyle = '#3b2c20'; ctx.fillRect(x - s * 0.06, y - s * 0.5, s * 0.12, s * 0.5);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i < 4 ? dark : light;
    ctx.beginPath(); ctx.ellipse(x + (rnd() - 0.5) * s * 0.5, y - s * 0.65 - rnd() * s * 0.45 + (i > 4 ? -s * 0.1 : 0), s * (0.22 + rnd() * 0.12), s * (0.2 + rnd() * 0.12), 0, 0, TAU); ctx.fill();
  }
}
const ART = {
  landscape(ctx, w, h, rnd) {
    const dusk = rnd() < 0.5;
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, dusk ? '#6f7f98' : '#8ea6b8'); sky.addColorStop(1, dusk ? '#f0c28e' : '#e9ddbf');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(255,248,235,${0.18 + rnd() * 0.2})`; ctx.beginPath(); ctx.ellipse(rnd() * w, h * (0.08 + rnd() * 0.25), w * (0.08 + rnd() * 0.12), h * (0.03 + rnd() * 0.03), 0, 0, TAU); ctx.fill(); }
    const hz = h * (0.5 + rnd() * 0.08), s = rnd() * 50;
    ridge(ctx, w, hz, h * 0.14, 0.006, s, '#8e9ba4', h);
    ridge(ctx, w, hz + h * 0.06, h * 0.12, 0.009, s + 3, '#7f906c', h);
    ridge(ctx, w, hz + h * 0.16, h * 0.1, 0.012, s + 7, '#667a47', h);
    ridge(ctx, w, hz + h * 0.3, h * 0.08, 0.01, s + 9, '#51663a', h);
    // river / path
    ctx.strokeStyle = rnd() < 0.5 ? '#a9bcc0' : '#cdb88c'; ctx.lineWidth = w * 0.05;
    ctx.beginPath(); ctx.moveTo(w * 0.55, h); ctx.bezierCurveTo(w * 0.3, h * 0.85, w * 0.7, h * 0.72, w * 0.5, hz + h * 0.12); ctx.stroke();
    ctx.lineWidth = w * 0.02; ctx.stroke();
    // cottage far away
    const cx = w * (0.2 + rnd() * 0.6), cy = hz + h * 0.14;
    ctx.fillStyle = '#e8dfcc'; ctx.fillRect(cx, cy - 12, 22, 12); ctx.fillStyle = '#7a3b2c'; ctx.beginPath(); ctx.moveTo(cx - 3, cy - 12); ctx.lineTo(cx + 11, cy - 22); ctx.lineTo(cx + 25, cy - 12); ctx.fill();
    for (let i = 0; i < 4; i++) tree(ctx, w * (rnd() < 0.5 ? 0.05 + rnd() * 0.25 : 0.7 + rnd() * 0.25), h * (0.78 + rnd() * 0.15), h * (0.25 + rnd() * 0.2), rnd);
    painterly(ctx, w, h, rnd, 3000, 10, 3.5);
    canvasWeave(ctx, w, h); varnish(ctx, w, h, 0.3);
  },
  seascape(ctx, w, h, rnd) {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, '#7d8ea0'); sky.addColorStop(1, '#e3dccb');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = `rgba(250,246,238,${0.2 + rnd() * 0.25})`; ctx.beginPath(); ctx.ellipse(rnd() * w, h * (0.05 + rnd() * 0.3), w * (0.1 + rnd() * 0.15), h * (0.03 + rnd() * 0.04), 0, 0, TAU); ctx.fill(); }
    const hz = h * 0.55;
    const sea = ctx.createLinearGradient(0, hz, 0, h);
    sea.addColorStop(0, '#6f8e96'); sea.addColorStop(1, '#2f4e58');
    ctx.fillStyle = sea; ctx.fillRect(0, hz, w, h - hz);
    for (let i = 0; i < 220; i++) { const y = hz + Math.pow(rnd(), 1.5) * (h - hz); ctx.fillStyle = `rgba(230,240,238,${0.15 + rnd() * 0.35})`; ctx.fillRect(rnd() * w, y, 6 + rnd() * 30 * (y - hz) / h * 3, 1.5 + (y - hz) / h * 4); }
    // cliff + lighthouse
    const left = rnd() < 0.5;
    ctx.fillStyle = '#5b5247';
    ctx.beginPath();
    const cx0 = left ? 0 : w, dir = left ? 1 : -1;
    ctx.moveTo(cx0, h); ctx.lineTo(cx0, hz - h * 0.12); ctx.lineTo(cx0 + dir * w * 0.18, hz - h * 0.1); ctx.lineTo(cx0 + dir * w * 0.26, hz + h * 0.05); ctx.lineTo(cx0 + dir * w * 0.33, h); ctx.fill();
    ctx.fillStyle = '#6a7a4a'; ctx.beginPath(); ctx.moveTo(cx0, hz - h * 0.12); ctx.lineTo(cx0 + dir * w * 0.18, hz - h * 0.1); ctx.lineTo(cx0 + dir * w * 0.2, hz - h * 0.07); ctx.lineTo(cx0, hz - h * 0.08); ctx.fill();
    const lx = cx0 + dir * w * 0.1, ly = hz - h * 0.11;
    ctx.fillStyle = '#efe9dc'; ctx.beginPath(); ctx.moveTo(lx - 7, ly); ctx.lineTo(lx - 5, ly - h * 0.16); ctx.lineTo(lx + 5, ly - h * 0.16); ctx.lineTo(lx + 7, ly); ctx.fill();
    ctx.fillStyle = '#a2392c'; ctx.fillRect(lx - 6.5, ly - h * 0.06, 13, h * 0.025); ctx.fillRect(lx - 6, ly - h * 0.12, 12, h * 0.025);
    ctx.fillStyle = '#2d2a28'; ctx.fillRect(lx - 7, ly - h * 0.18, 14, h * 0.02);
    ctx.fillStyle = '#ffe2a0'; ctx.fillRect(lx - 4, ly - h * 0.2, 8, h * 0.02);
    // sailboat
    const bx = left ? w * 0.65 : w * 0.3, by = hz + h * 0.06;
    ctx.fillStyle = '#4a3326'; ctx.beginPath(); ctx.moveTo(bx - 22, by); ctx.lineTo(bx + 22, by); ctx.lineTo(bx + 15, by + 7); ctx.lineTo(bx - 15, by + 7); ctx.fill();
    ctx.fillStyle = '#f1e8d6'; ctx.beginPath(); ctx.moveTo(bx - 2, by - 2); ctx.lineTo(bx - 2, by - 48); ctx.lineTo(bx - 20, by - 4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx + 1, by - 2); ctx.lineTo(bx + 1, by - 40); ctx.lineTo(bx + 18, by - 3); ctx.fill();
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const gx = w * (0.3 + rnd() * 0.5), gy = h * (0.12 + rnd() * 0.2); ctx.beginPath(); ctx.moveTo(gx - 6, gy - 3); ctx.quadraticCurveTo(gx - 3, gy - 5, gx, gy); ctx.quadraticCurveTo(gx + 3, gy - 5, gx + 6, gy - 3); ctx.stroke(); }
    painterly(ctx, w, h, rnd, 2600, 12, 3, 0);
    canvasWeave(ctx, w, h); varnish(ctx, w, h, 0.28);
  },
  cottage(ctx, w, h, rnd) {
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#9fb1bf'); sky.addColorStop(1, '#efe3c6');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ridge(ctx, w, h * 0.55, h * 0.1, 0.008, rnd() * 40, '#93a28a', h);
    ridge(ctx, w, h * 0.68, h * 0.06, 0.01, rnd() * 40, '#6f874e', h);
    const cx = w * 0.5, base = h * 0.78, cw = w * 0.36, chh = h * 0.2;
    tree(ctx, w * 0.12, h * 0.82, h * 0.42, rnd); tree(ctx, w * 0.88, h * 0.8, h * 0.36, rnd);
    ctx.fillStyle = '#ece3cf'; ctx.fillRect(cx - cw / 2, base - chh, cw, chh);
    ctx.fillStyle = '#6d4a36';
    ctx.beginPath(); ctx.moveTo(cx - cw / 2 - 10, base - chh + 2); ctx.lineTo(cx - cw * 0.3, base - chh - h * 0.14); ctx.lineTo(cx + cw * 0.3, base - chh - h * 0.14); ctx.lineTo(cx + cw / 2 + 10, base - chh + 2); ctx.fill();
    ctx.fillStyle = '#8a6a55'; ctx.fillRect(cx + cw * 0.18, base - chh - h * 0.19, w * 0.03, h * 0.08);
    ctx.fillStyle = 'rgba(230,230,230,0.5)'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(cx + cw * 0.2 + i * 6 + rnd() * 4, base - chh - h * 0.22 - i * 11, 7 + i * 2, 5 + i, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#2e4a3b'; ctx.fillRect(cx - w * 0.03, base - chh * 0.62, w * 0.06, chh * 0.62);
    ctx.fillStyle = '#f6cf78';
    for (const wx of [-0.3, 0.2]) { ctx.fillRect(cx + cw * wx, base - chh * 0.7, w * 0.05, chh * 0.32); }
    ctx.strokeStyle = '#5f7a63'; ctx.lineWidth = 3;
    for (const wx of [-0.3, 0.2]) { ctx.strokeRect(cx + cw * wx, base - chh * 0.7, w * 0.05, chh * 0.32); }
    ctx.fillStyle = '#c9b48a'; ctx.beginPath(); ctx.moveTo(cx - w * 0.03, base); ctx.lineTo(cx + w * 0.03, base); ctx.lineTo(cx + w * 0.1, h); ctx.lineTo(cx - w * 0.06, h); ctx.fill();
    const fl = ['#e7a3b0', '#f2ead8', '#d8b44a', '#9a7ab8', '#d0573e'];
    for (let i = 0; i < 260; i++) { ctx.fillStyle = rnd() < 0.4 ? '#4c6b36' : fl[Math.floor(rnd() * fl.length)]; const x = rnd() * w, y = base - 6 + rnd() * (h - base + 6); if (Math.abs(x - cx) < w * 0.07 && y > base) continue; ctx.beginPath(); ctx.arc(x, y, 2 + rnd() * 3, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#f1ece0';
    for (let x = 0; x < w; x += 12) { if (Math.abs(x - cx) < w * 0.06) continue; ctx.fillRect(x, base + h * 0.06, 5, h * 0.07); }
    ctx.fillRect(0, base + h * 0.08, cx - w * 0.06, 3); ctx.fillRect(cx + w * 0.06, base + h * 0.08, w, 3);
    painterly(ctx, w, h, rnd, 2400, 8, 3);
    canvasWeave(ctx, w, h); varnish(ctx, w, h, 0.25);
  },
  botanical(ctx, w, h, rnd) {
    ctx.fillStyle = '#eee5cd'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(160,120,60,${rnd() * 0.05})`; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 10 + rnd() * 40, 0, TAU); ctx.fill(); }
    const ink = '#4a3526';
    const kind = Math.floor(rnd() * 3);
    const fc = ['#b44a5a', '#8a5aa8', '#d89a3a', '#c85a3a', '#e0b8c0'][Math.floor(rnd() * 5)];
    const x0 = w * 0.5, y0 = h * 0.86, top = h * 0.2;
    ctx.strokeStyle = '#556b3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0 - w * 0.08, h * 0.6, x0 + w * 0.08, h * 0.4, x0, top); ctx.stroke();
    const leaf = (x, y, a, L, W) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(96,130,70,0.8)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.5, -W, L, 0); ctx.quadraticCurveTo(L * 0.5, W, 0, 0); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.95, 0); ctx.stroke();
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(L * k / 5, 0); ctx.lineTo(L * k / 5 + L * 0.08, -W * 0.5); ctx.moveTo(L * k / 5, 0); ctx.lineTo(L * k / 5 + L * 0.08, W * 0.5); ctx.stroke(); }
      ctx.restore();
    };
    for (let i = 0; i < 7; i++) { const t = 0.15 + i * 0.1; const y = lerp(y0, top, t); const side = i % 2 ? 1 : -1; leaf(x0 + Math.sin(t * 5) * 8, y, side > 0 ? -0.5 : Math.PI + 0.5, w * (0.22 - t * 0.12), h * 0.035); }
    if (kind === 0) {          // bloom
      for (let k = 0; k < 8; k++) { ctx.save(); ctx.translate(x0, top); ctx.rotate(k / 8 * TAU); ctx.fillStyle = fc; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.ellipse(w * 0.06, 0, w * 0.065, w * 0.028, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
      ctx.fillStyle = '#d8a93a'; ctx.beginPath(); ctx.arc(x0, top, w * 0.03, 0, TAU); ctx.fill(); ctx.stroke();
    } else if (kind === 1) {   // foxglove bells
      for (let k = 0; k < 9; k++) { const y = top + k * h * 0.035, x = x0 + (k % 2 ? 1 : -1) * w * 0.035; ctx.fillStyle = fc; ctx.beginPath(); ctx.ellipse(x, y, w * 0.028, h * 0.02, (k % 2 ? 0.6 : -0.6), 0, TAU); ctx.fill(); ctx.strokeStyle = ink; ctx.stroke(); }
    } else {                   // berries
      for (let k = 0; k < 14; k++) { const a = rnd() * TAU, rr = rnd() * w * 0.07; ctx.fillStyle = fc; ctx.beginPath(); ctx.arc(x0 + Math.cos(a) * rr, top + Math.sin(a) * rr, w * 0.018, 0, TAU); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x0 + Math.cos(a) * rr - 2, top + Math.sin(a) * rr - 3, 2, 2); }
    }
    const names = ['Digitalis purpurea', 'Rosa canina', 'Bellis perennis', 'Sambucus nigra', 'Lavandula angustifolia', 'Papaver rhoeas', 'Malus sylvestris'];
    ctx.fillStyle = ink; ctx.textAlign = 'center';
    ctx.font = `italic ${Math.round(w * 0.05)}px Georgia, serif`; ctx.fillText(names[Math.floor(rnd() * names.length)], w / 2, h * 0.94);
    ctx.font = `${Math.round(w * 0.035)}px Georgia, serif`; ctx.fillText('Pl. ' + ['IV', 'VII', 'XII', 'XIX', 'XXIII'][Math.floor(rnd() * 5)], w * 0.88, h * 0.06);
    ctx.strokeStyle = 'rgba(74,53,38,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(w * 0.05, h * 0.03, w * 0.9, h * 0.94);
  },
  portrait(ctx, w, h, rnd) {
    const bg = ctx.createRadialGradient(w * 0.45, h * 0.35, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#5d5238'); bg.addColorStop(1, '#1e1a14');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cat = rnd() < 0.6;
    const cx = w * 0.5;
    if (cat) {
      const fur = ['#8a7a6a', '#d09050', '#3a3430', '#b8b0a4'][Math.floor(rnd() * 4)];
      ctx.fillStyle = '#2d3a55'; ctx.beginPath(); ctx.ellipse(cx, h * 1.02, w * 0.42, h * 0.35, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(cx, h * 0.72, w * 0.2, h * 0.14, 0, 0, TAU); ctx.fill();
      // ruff
      ctx.fillStyle = '#efe8d8';
      for (let k = 0; k < 14; k++) { const a = Math.PI + k / 13 * Math.PI; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * w * 0.2, h * 0.66 - Math.sin(a) * h * -0.04, w * 0.06, h * 0.035, a, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(cx, h * 0.67, w * 0.23, h * 0.05, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(cx, h * 0.47, w * 0.2, h * 0.16, 0, 0, TAU); ctx.fill();
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + s * w * 0.18, h * 0.42); ctx.lineTo(cx + s * w * 0.15, h * 0.24); ctx.lineTo(cx + s * w * 0.05, h * 0.34); ctx.fill(); ctx.fillStyle = '#c89088'; ctx.beginPath(); ctx.moveTo(cx + s * w * 0.155, h * 0.38); ctx.lineTo(cx + s * w * 0.145, h * 0.28); ctx.lineTo(cx + s * w * 0.08, h * 0.35); ctx.fill(); ctx.fillStyle = fur; }
      ctx.fillStyle = '#c8b050'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * w * 0.075, h * 0.45, w * 0.035, h * 0.022, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#111'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * w * 0.075, h * 0.45, w * 0.008, h * 0.018, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#c47b74'; ctx.beginPath(); ctx.moveTo(cx - 6, h * 0.51); ctx.lineTo(cx + 6, h * 0.51); ctx.lineTo(cx, h * 0.525); ctx.fill();
      ctx.strokeStyle = 'rgba(240,240,230,0.6)'; ctx.lineWidth = 1;
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(cx + s * w * 0.04, h * 0.525); ctx.lineTo(cx + s * w * 0.2, h * (0.5 + k * 0.02)); ctx.stroke(); }
    } else {
      ctx.fillStyle = '#2a2320'; ctx.beginPath(); ctx.ellipse(cx, h * 1.0, w * 0.36, h * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#efe6d6'; ctx.beginPath(); ctx.moveTo(cx - w * 0.1, h * 0.7); ctx.lineTo(cx, h * 0.82); ctx.lineTo(cx + w * 0.1, h * 0.7); ctx.fill();
      ctx.fillStyle = '#d9b196'; ctx.fillRect(cx - w * 0.045, h * 0.56, w * 0.09, h * 0.14);
      ctx.beginPath(); ctx.ellipse(cx, h * 0.45, w * 0.13, h * 0.15, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3b2518'; ctx.beginPath(); ctx.ellipse(cx, h * 0.36, w * 0.15, h * 0.1, 0, Math.PI, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - w * 0.12, h * 0.46, w * 0.05, h * 0.12, 0.2, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx + w * 0.12, h * 0.46, w * 0.05, h * 0.12, -0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a2a20'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * w * 0.05, h * 0.45, w * 0.015, h * 0.008, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#b06a5a'; ctx.beginPath(); ctx.ellipse(cx, h * 0.53, w * 0.03, h * 0.008, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(200,110,90,0.25)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * w * 0.075, h * 0.5, w * 0.03, 0, TAU); ctx.fill(); }
    }
    painterly(ctx, w, h, rnd, 2600, 7, 2.5);
    canvasWeave(ctx, w, h); varnish(ctx, w, h, 0.45);
    ctx.strokeStyle = 'rgba(20,12,5,0.12)'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 90; i++) { let x = rnd() * w, y = rnd() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; ctx.lineTo(x, y); } ctx.stroke(); }
  },
  abstract(ctx, w, h, rnd) {
    ctx.fillStyle = '#ebdfc6'; ctx.fillRect(0, 0, w, h);
    const pal = ['#c8943e', '#a4492f', '#3f6a68', '#2f3d5a', '#8fa487', '#c98f8a', '#e6d6b6', '#4a3122'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = pal[Math.floor(rnd() * pal.length)]; ctx.globalAlpha = 0.85 + rnd() * 0.15;
      const t = rnd();
      if (t < 0.4) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, Math.min(w, h) * (0.08 + rnd() * 0.22), 0, rnd() < 0.5 ? Math.PI : TAU); ctx.fill(); }
      else if (t < 0.75) { ctx.fillRect(rnd() * w * 0.8, rnd() * h * 0.8, w * (0.1 + rnd() * 0.35), h * (0.05 + rnd() * 0.3)); }
      else { ctx.beginPath(); ctx.moveTo(rnd() * w, rnd() * h); ctx.lineTo(rnd() * w, rnd() * h); ctx.lineTo(rnd() * w, rnd() * h); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2b2622'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(rnd() * w, rnd() * h); ctx.quadraticCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h); ctx.stroke(); }
    for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},0.04)`; ctx.fillRect(rnd() * w, rnd() * h, 2, 2); }
  },
  map(ctx, w, h, rnd) {
    ctx.fillStyle = '#e4d1a4'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(140,100,50,${rnd() * 0.06})`; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 10 + rnd() * 50, 0, TAU); ctx.fill(); }
    const cx = w * (0.45 + rnd() * 0.1), cy = h * (0.5 + rnd() * 0.08), R = Math.min(w, h) * 0.3, sd = rnd() * 100;
    const pts = [];
    for (let i = 0; i < 120; i++) { const a = i / 120 * TAU; const r = R * (0.75 + 0.35 * C.util.fbm2D(Math.cos(a) * 1.5 + sd, Math.sin(a) * 1.5, 4)); pts.push([cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r]); }
    const outline = (off, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([x, y], i) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy); const X = x + dx / l * off, Y = y + dy / l * off; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.closePath(); ctx.stroke(); };
    for (let k = 5; k >= 1; k--) outline(k * 6, `rgba(70,90,100,${0.08 + 0.04 * (5 - k)})`, 1);
    ctx.fillStyle = '#d6c08c'; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    outline(0, '#4a3526', 2);
    ctx.strokeStyle = '#4a3526'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) { const x = cx + (rnd() - 0.5) * R * 1.4, y = cy + (rnd() - 0.6) * R * 0.8; ctx.beginPath(); ctx.moveTo(x - 7, y + 5); ctx.lineTo(x, y - 6); ctx.lineTo(x + 7, y + 5); ctx.stroke(); }
    ctx.fillStyle = 'rgba(80,110,60,0.6)'; for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.arc(cx + (rnd() - 0.5) * R * 1.2, cy + (rnd() - 0.2) * R * 0.8, 3.5, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#5d7a8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.bezierCurveTo(cx + R * 0.3, cy + R * 0.2, cx + R * 0.1, cy + R * 0.5, cx + R * 0.4, cy + R * 0.9); ctx.stroke();
    ctx.fillStyle = '#7a2f25'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx + (rnd() - 0.5) * R, cy + (rnd() - 0.5) * R * 0.7, 3, 0, TAU); ctx.fill(); }
    // compass
    const qx = w * 0.85, qy = h * 0.2, qr = Math.min(w, h) * 0.08;
    ctx.fillStyle = '#4a3526'; ctx.strokeStyle = '#4a3526'; ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) { ctx.save(); ctx.translate(qx, qy); ctx.rotate(k * Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -qr); ctx.lineTo(qr * 0.18, 0); ctx.lineTo(-qr * 0.18, 0); ctx.closePath(); if (k % 2) ctx.stroke(); else ctx.fill(); ctx.restore(); }
    ctx.beginPath(); ctx.arc(qx, qy, qr * 0.7, 0, TAU); ctx.stroke();
    ctx.font = `${Math.round(qr * 0.4)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText('N', qx, qy - qr - 3);
    ctx.font = `italic ${Math.round(w * 0.045)}px Georgia, serif`;
    ctx.fillText(['Isle of Rainmere', 'Mare Pluvium', 'The Mistward Isles', 'Brambleholm'][Math.floor(rnd() * 4)], w * 0.28, h * 0.1);
    ctx.strokeStyle = 'rgba(74,53,38,0.25)'; for (let x = 0; x < w; x += w / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); } for (let y = 0; y < h; y += h / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#4a3526'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, w - 12, h - 12); ctx.lineWidth = 1; ctx.strokeRect(12, 12, w - 24, h - 24);
    varnish(ctx, w, h, 0.35);
  },
};
function artTexture(style, aspect, seed, maxPx = 512, sepia = false) {
  const w = aspect >= 1 ? maxPx : Math.max(128, Math.round(maxPx * aspect));
  const h = aspect >= 1 ? Math.max(128, Math.round(maxPx / aspect)) : maxPx;
  const rnd = C.util.rng(((seed || 1) * 104729 + style.length * 31) >>> 0);
  const fn = ART[style] || ART.landscape;
  const tex = C.util.canvasTexture(w, h, (ctx) => {
    fn(ctx, w, h, rnd);
    if (sepia) {
      const img = ctx.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; d[i] = Math.min(255, l * 1.08 + 18); d[i + 1] = l * 0.95 + 8; d[i + 2] = l * 0.78; }
      ctx.putImageData(img, 0, 0);
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,40,20,0.5)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  }, { wrap: false });
  return tex;
}
function frameMat(kind) {
  if (kind === 'gold') return cachedMat('frame.gold', () => { const m = metal('brass').clone(); m.color.set(0xb8913f); m.metalness = 0.55; return m; });
  if (kind === 'black') return C.util.stdMat(0x201c19, 0.45, 0.1);
  if (kind === 'white') return M('woodPainted');
  if (kind === 'silver') return metal('chrome');
  if (kind === 'brass') return metal('brass');
  return M('woodDark');
}
function frameRing(parts, mat, W, H, fw, depth, z0 = 0, bevel = 0.004) {
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2 + bevel, -H / 2 + bevel); sh.lineTo(W / 2 - bevel, -H / 2 + bevel); sh.lineTo(W / 2 - bevel, H / 2 - bevel); sh.lineTo(-W / 2 + bevel, H / 2 - bevel); sh.closePath();
  const iw = W - 2 * fw, ih = H - 2 * fw;
  const hole = new THREE.Path();
  hole.moveTo(-iw / 2 - bevel, -ih / 2 - bevel); hole.lineTo(-iw / 2 - bevel, ih / 2 + bevel); hole.lineTo(iw / 2 + bevel, ih / 2 + bevel); hole.lineTo(iw / 2 + bevel, -ih / 2 - bevel); hole.closePath();
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, z0 + bevel);
  wuv(g, 1);
  parts.add(g, mat);
}
function painting(o = {}) {
  const W = o.width || 0.5, H = o.height || 0.4;
  const style = o.style || 'landscape', fk = o.frame || 'wood';
  const g = mkGroup(o, 'props.painting.' + style);
  const parts = new Parts();
  const fm = frameMat(fk);
  const fw = fk === 'gold' ? Math.min(0.075, Math.min(W, H) * 0.14) : fk === 'black' ? 0.028 : fk === 'white' ? 0.035 : 0.045;
  const depth = fk === 'gold' ? 0.04 : 0.03;
  frameRing(parts, fm, W, H, fw, depth, 0, fk === 'black' ? 0.003 : 0.006);
  let iw = W - 2 * fw, ih = H - 2 * fw;
  if (fk === 'gold') {
    // stepped inner moulding + linen slip
    frameRing(parts, fm, W - fw * 0.9, H - fw * 0.9, fw * 0.45, depth + 0.006, 0, 0.004);
    const slipW = Math.min(0.03, Math.min(iw, ih) * 0.08);
    frameRing(parts, M('fabricCream'), iw + 0.004, ih + 0.004, slipW + 0.002, depth - 0.012, 0, 0.002);
    iw -= 2 * slipW; ih -= 2 * slipW;
  } else if (fk === 'white' || fk === 'wood') {
    // thin inner lip in contrasting tone
    frameRing(parts, fk === 'white' ? M('woodDark') : metal('brass'), iw + 0.004, ih + 0.004, 0.006, depth - 0.008, 0, 0.001);
    iw -= 0.008; ih -= 0.008;
  }
  // backing (hidden) so nothing see-through at grazing angles
  parts.add(gBox(W - 0.01, H - 0.01, 0.004, 0, 0, 0.002), C.util.stdMat(0x3a2e24, 0.9));
  parts.build(g, 'props.painting.frame', {});
  const tex = artTexture(style, iw / ih, o.seed || 1);
  const cm = new THREE.MeshStandardMaterial({ map: tex, roughness: style === 'botanical' || style === 'map' ? 0.85 : 0.6, metalness: 0 });
  cm.name = 'props.painting.canvas';
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(iw + 0.006, ih + 0.006), cm);
  canvas.position.z = fk === 'gold' ? depth - 0.018 : depth - 0.012;
  canvas.name = 'props.painting.canvas';
  canvas.receiveShadow = true;
  g.add(canvas);
  return g;
}

// ================================================================================================================
//  PLANTS
// ================================================================================================================
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
// flat leaf strip in local frame: length along +Z (from origin), width along X, upper surface +Y; then bent.
function leafStrip(o) {
  const segs = o.segs || 6, across = o.across || [-1, -0.45, 0, 0.45, 1];
  const len = o.len, wid = o.wid, prof = o.profile || (t => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.75));
  const curl = o.curl || 0, fold = o.fold !== undefined ? o.fold : 0.25, twist = o.twist || 0;
  const cb = hexCol(o.base !== undefined ? o.base : 0x3d6b30), ct = hexCol(o.tip !== undefined ? o.tip : 0x5b8a3c);
  const ce = o.edge !== undefined ? hexCol(o.edge) : null;
  const vein = o.vein !== undefined ? o.vein : 1.12;
  const band = o.band || 0, bandSeed = o.bandSeed || 0;
  const nA = across.length;
  const pos = new Float32Array((segs + 1) * nA * 3), col = new Float32Array((segs + 1) * nA * 3);
  let cy = 0, cz = 0;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    if (i > 0) {
      const a = curl * Math.pow((i - 0.5) / segs, o.curlPow || 1.2);
      cz += Math.cos(a) * len / segs; cy -= Math.sin(a) * len / segs;
    }
    const a = curl * Math.pow(t, o.curlPow || 1.2);
    const ny = Math.cos(a), nz = Math.sin(a);
    const hw = wid / 2 * Math.max(0, prof(t));
    const tw = twist * t;
    const ctw = Math.cos(tw), stw = Math.sin(tw);
    for (let j = 0; j < nA; j++) {
      const s = across[j];
      const lx = s * hw, ly = -fold * Math.abs(s) * hw;
      // twist around tangent: mix X axis with normal
      const X = lx * ctw - ly * stw, Nn = lx * stw + ly * ctw;
      const k = (i * nA + j) * 3;
      pos[k] = X; pos[k + 1] = cy + ny * Nn; pos[k + 2] = cz + nz * Nn;
      _c1.copy(cb).lerp(ct, t);
      if (ce && Math.abs(s) > 0.99) _c1.lerp(ce, 0.85);
      let m = s === 0 ? vein : 1;
      if (band) m *= 1 - band * (0.5 + 0.5 * Math.sin(t * 38 + bandSeed + s * 1.3));
      col[k] = _c1.r * m; col[k + 1] = _c1.g * m; col[k + 2] = _c1.b * m;
    }
  }
  const idx = [];
  for (let i = 0; i < segs; i++) for (let j = 0; j < nA - 1; j++) {
    const a = i * nA + j, b = a + 1, c = a + nA, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// orient a leaf: elevation (up from horizontal), azimuth around Y, roll around own axis; then translate
function orient(g, x, y, z, elev, az, roll = 0) {
  if (roll) g.rotateZ(roll);
  g.rotateX(-elev); g.rotateY(az); g.translate(x, y, z);
  return g;
}
const PROFILES = {
  ovate: t => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.7) * (1 - 0.15 * t),
  heart: t => Math.sin(Math.PI * Math.pow(Math.min(1, t), 0.62)) * (t < 0.04 ? 0.6 + t * 10 : 1),
  sword: t => Math.min(1, 0.55 + t * 3) * Math.pow(Math.max(0, 1 - Math.pow(t, 3)), 0.6),
  fiddle: t => Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, t), 1.5)), 0.6) * (1 - 0.18 * Math.exp(-Math.pow((t - 0.42) / 0.12, 2))),
  lance: t => Math.pow(Math.sin(Math.PI * Math.min(1, t)), 0.9) * (1 - 0.3 * t),
  succ: t => Math.pow(Math.sin(Math.PI * (0.15 + 0.85 * Math.min(1, t))), 0.5),
};
function potGeo(parts, kind, r, h, color, rnd, saucer = true) {
  let mat, prof;
  if (kind === 'terracotta') {
    mat = color !== undefined ? glaze(color, 0.7) : M('ceramicTerracotta');
    prof = [[0, 0], [r * 0.72, 0], [r * 0.75, 0.006], [r * 0.9, h * 0.76], [r * 0.9, h * 0.765], [r * 1.0, h * 0.78], [r * 1.02, h * 0.8], [r * 1.02, h * 0.99], [r * 1.0, h], [r * 0.92, h], [r * 0.9, h * 0.9]];
  } else if (kind === 'basket') {
    mat = M('wickerBasket');
    prof = [[0, 0], [r * 0.85, 0], [r * 0.88, 0.01], [r * 0.98, h * 0.5], [r * 1.0, h * 0.95], [r * 1.02, h], [r * 0.95, h], [r * 0.93, h * 0.9]];
  } else {
    mat = glaze(color !== undefined ? color : 0xeee6d6, 0.3);
    prof = [[0, 0], [r * 0.6, 0], [r * 0.66, 0.006], [r * 0.9, h * 0.35], [r * 0.99, h * 0.75], [r * 1.0, h * 0.98], [r * 0.97, h], [r * 0.92, h * 0.97], [r * 0.9, h * 0.9]];
  }
  const g = gLathe(prof, 28);
  if (kind === 'basket') latheUV(g, TAU * r, h * 1.2);
  else latheUV(g, TAU * r * 1.5, h * 1.5);
  parts.add(g, mat);
  if (kind === 'basket') parts.add(gTorus(r * 1.01, 0.008, 5, 32, TAU, 0, h, 0, Math.PI / 2), mat);
  if (kind === 'terracotta' && saucer) {
    const s = gLathe([[0, 0], [r * 0.95, 0], [r * 1.05, 0.004], [r * 1.12, 0.022], [r * 1.09, 0.024], [r * 1.0, 0.008], [0, 0.008]], 28);
    latheUV(s, TAU * r * 1.5, 0.2);
    parts.add(s, mat);
  }
  const soil = new THREE.CircleGeometry(r * 0.9, 20);
  soil.rotateX(-Math.PI / 2); soil.translate(0, h * 0.9, 0);
  wuv(soil, 1);
  parts.add(soil, M('soil'));
  return h * 0.9;
}
function plant(o = {}) {
  const type = o.type || 'fern';
  const sc = o.scale || 1;
  const rnd = C.util.rng(((o.seed !== undefined ? o.seed : 1) * 2654435761 + type.length * 97) >>> 0);
  const g = mkGroup(o, 'props.plant.' + type);
  const inner = new THREE.Group(); inner.scale.setScalar(sc); g.add(inner);
  const parts = new Parts();
  const lm = leafMaterial();
  const stemM = C.util.stdMat(0x4d5a2e, 0.7);
  const J = (a, b) => a + (b - a) * rnd();
  let soilY;
  const defaults = { fern: 'terracotta', monstera: 'ceramic', snake: 'ceramic', succulent: 'ceramic', ivy: 'terracotta', herb: 'terracotta', fiddle: 'basket', pothos: 'ceramic' };
  const potKind = o.pot || defaults[type] || 'terracotta';
  const potC = o.potColor;
  if (type === 'fern') {
    const r = 0.12, h = 0.16;
    soilY = potGeo(parts, potKind, r, h, potC, rnd, o.saucer !== false);
    const n = 30;
    for (let f = 0; f < n; f++) {
      const L = J(0.28, 0.45), az = f / n * TAU + J(-0.2, 0.2) + f * 0.5, elev = J(0.55, 1.35);
      const curl = J(1.4, 2.4) * (1.4 - elev * 0.5);
      // frond = rachis + pinnae (built flat along +Z, then bent)
      const verts = [], cols = [];
      const np = 20;
      const base = hexCol(0x3e6b2c), tip = hexCol(0x7aa04a);
      const push = (x, y, z, t, m = 1) => { verts.push(x, y, z); _c1.copy(base).lerp(tip, t); cols.push(_c1.r * m, _c1.g * m, _c1.b * m); };
      for (let i = 0; i < np; i++) {
        const t = (i + 1) / (np + 1);
        const zc = t * L;
        const pl = 0.075 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9)), 0.8) * (L / 0.4);
        const pw = 0.011 * (1 - t * 0.5);
        for (const s of [-1, 1]) {
          const ang = 1.05 - t * 0.35;
          const dx = Math.sin(ang) * s, dz = Math.cos(ang);
          const tx = dx * pl, tz = zc + dz * pl;
          const mx = dx * pl * 0.45, mz = zc + dz * pl * 0.45;
          // diamond: base, left, tip, right (small upward cup)
          const px = -dz * s * pw, pz = dx * s * pw;
          push(0, 0, zc, t); push(mx + px, 0.004, mz + pz, t); push(tx, 0.01, tz, t, 1.1);
          push(0, 0, zc, t); push(tx, 0.01, tz, t, 1.1); push(mx - px, 0.004, mz - pz, t, 0.85);
        }
      }
      // rachis thin strip
      for (let i = 0; i < 6; i++) {
        const z0 = i / 6 * L, z1 = (i + 1) / 6 * L, w0 = 0.003 * (1 - i / 6), w1 = 0.003 * (1 - (i + 1) / 6);
        push(-w0, 0.002, z0, 0, 0.7); push(-w1, 0.002, z1, 0, 0.7); push(w0, 0.002, z0, 0, 0.7);
        push(w0, 0.002, z0, 0, 0.7); push(-w1, 0.002, z1, 0, 0.7); push(w1, 0.002, z1, 0, 0.7);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      fg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      bendZ(fg, L, curl);
      fg.computeVertexNormals();
      const rr = J(0.01, 0.07);
      orient(fg, Math.sin(az) * rr, soilY + 0.005, Math.cos(az) * rr, elev, az);
      parts.add(fg, lm);
    }
  } else if (type === 'monstera') {
    const r = 0.16, h = 0.22;
    soilY = potGeo(parts, potKind, r, h, potC !== undefined ? potC : 0xe9e2d2, rnd);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const az = i / n * TAU + J(-0.3, 0.3), el = J(0.9, 1.35), pl = J(0.35, 0.7);
      // petiole: gentle curve
      const bx = Math.sin(az) * 0.02, bz = Math.cos(az) * 0.02;
      const ex = bx + Math.sin(az) * Math.cos(el) * pl, ey = soilY + Math.sin(el) * pl, ez = bz + Math.cos(az) * Math.cos(el) * pl;
      parts.add(gTube([[bx, soilY - 0.01, bz], [bx + (ex - bx) * 0.4, soilY + (ey - soilY) * 0.55, bz + (ez - bz) * 0.4], [ex, ey, ez]], 0.006, 8, 5), stemM);
      const L = J(0.24, 0.34) * (0.7 + pl * 0.6), Wd = L * 0.92;
      const lg = monsteraLeaf(L, Wd, rnd);
      bendZ(lg, L, J(0.5, 0.9));
      lg.computeVertexNormals();
      orient(lg, ex, ey, ez, J(0.05, 0.45), az + J(-0.3, 0.3), J(-0.2, 0.2));
      parts.add(lg, lm);
    }
  } else if (type === 'snake') {
    const r = 0.11, h = 0.2;
    soilY = potGeo(parts, potKind, r, h, potC !== undefined ? potC : 0x3f5f6e, rnd);
    const n = 11;
    for (let i = 0; i < n; i++) {
      const az = J(0, TAU), rr = J(0, 0.06), L = J(0.35, 0.62), el = J(1.32, 1.52);
      const lg = leafStrip({ len: L, wid: J(0.045, 0.07), segs: 12, profile: PROFILES.sword, curl: J(-0.15, 0.25), fold: 0.18, twist: J(-0.6, 0.6),
        base: 0x2c4a2a, tip: 0x3a5e32, edge: 0xc8c070, band: 0.28, bandSeed: J(0, 10), vein: 1.0 });
      orient(lg, Math.sin(az) * rr, soilY - 0.01, Math.cos(az) * rr, el, az + Math.PI, J(-0.3, 0.3));
      parts.add(lg, lm);
    }
  } else if (type === 'succulent') {
    const r = 0.06, h = 0.07;
    soilY = potGeo(parts, potKind, r, h, potC !== undefined ? potC : 0xd8cbb4, rnd);
    const rings = [[11, 0.05, 0.25], [8, 0.042, 0.6], [6, 0.032, 0.95], [4, 0.022, 1.25]];
    rings.forEach(([n, L, el], ri) => {
      for (let i = 0; i < n; i++) {
        const az = i / n * TAU + ri * 0.4;
        const lg = leafStrip({ len: L, wid: L * 0.65, segs: 4, across: [-1, -0.5, 0, 0.5, 1], profile: PROFILES.succ, curl: -0.7, fold: -0.45, base: 0x6f9a86, tip: 0xc98a8a, vein: 1.0 });
        orient(lg, Math.sin(az) * 0.006, soilY + 0.004 + ri * 0.006, Math.cos(az) * 0.006, el, az);
        parts.add(lg, lm);
      }
    });
  } else if (type === 'ivy' || type === 'pothos') {
    const pothos = type === 'pothos';
    const r = pothos ? 0.09 : 0.075, h = pothos ? 0.11 : 0.09;
    soilY = potGeo(parts, potKind, r, h, potC !== undefined ? potC : (pothos ? 0xc98f7a : undefined), rnd, !pothos);
    const vines = pothos ? 6 : 9;
    for (let v = 0; v < vines; v++) {
      const az = v / vines * TAU + J(-0.2, 0.2);
      const dx = Math.sin(az), dz = Math.cos(az);
      const drop = J(0.18, pothos ? 0.45 : 0.5);
      const pts = [[dx * r * 0.4, soilY, dz * r * 0.4], [dx * r * 0.95, h + 0.03, dz * r * 0.95], [dx * (r + 0.035), h - 0.03, dz * (r + 0.035)], [dx * (r + 0.05) + J(-0.03, 0.03), h - drop * 0.55, dz * (r + 0.05)], [dx * (r + 0.06) + J(-0.04, 0.04), h - drop, dz * (r + 0.07)]];
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
      parts.add(new THREE.TubeGeometry(curve, 16, 0.0018, 3, false), stemM);
      const n = Math.floor((drop + 0.1) / (pothos ? 0.05 : 0.032));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const p = curve.getPointAt(t);
        const side = i % 2 ? 1 : -1;
        const L = (pothos ? J(0.05, 0.075) : J(0.028, 0.04)) * (1.05 - t * 0.4);
        const lg = leafStrip({ len: L, wid: L * (pothos ? 0.85 : 1.0), segs: 4, profile: PROFILES.heart, curl: 0.4, fold: 0.2, base: pothos ? 0x3f7a32 : 0x2f5028, tip: pothos ? 0x5f9a3e : 0x46683a, vein: pothos ? 1.25 : 1.3 });
        if (pothos) variegate(lg, rnd);
        orient(lg, p.x, p.y, p.z, J(-0.2, 0.5), az + side * J(0.5, 1.3), J(-0.4, 0.4));
        parts.add(lg, lm);
      }
    }
    // top mound
    const top = pothos ? 10 : 12;
    for (let i = 0; i < top; i++) {
      const az = J(0, TAU), rr = J(0, r * 0.6);
      const L = pothos ? J(0.06, 0.085) : J(0.03, 0.042);
      const lg = leafStrip({ len: L, wid: L * 0.9, segs: 4, profile: PROFILES.heart, curl: 0.5, fold: 0.2, base: pothos ? 0x3f7a32 : 0x2f5028, tip: pothos ? 0x5f9a3e : 0x46683a, vein: 1.25 });
      if (pothos) variegate(lg, rnd);
      orient(lg, Math.sin(az) * rr, soilY + J(0.02, 0.07), Math.cos(az) * rr, J(0.3, 0.9), az);
      parts.add(lg, lm);
    }
  } else if (type === 'herb') {
    const r = 0.07, h = 0.085;
    soilY = potGeo(parts, potKind, r, h, potC, rnd, o.saucer !== false);
    const stems = 7;
    for (let s = 0; s < stems; s++) {
      const az = s / stems * TAU + J(-0.3, 0.3), lean = J(0.05, 0.3), sh = J(0.1, 0.17);
      const bx = Math.sin(az) * J(0, 0.03), bz = Math.cos(az) * J(0, 0.03);
      const tx = bx + Math.sin(az) * sh * Math.sin(lean), tz = bz + Math.cos(az) * sh * Math.sin(lean), ty = soilY + sh * Math.cos(lean);
      parts.add(gTube([[bx, soilY - 0.005, bz], [(bx + tx) / 2, (soilY + ty) / 2, (bz + tz) / 2], [tx, ty, tz]], 0.0022, 5, 4), stemM);
      const pairs = 4;
      for (let p = 0; p < pairs; p++) {
        const t = 0.3 + p / pairs * 0.75;
        const px = lerp(bx, tx, t), py = lerp(soilY, ty, t), pz = lerp(bz, tz, t);
        const L = 0.045 * (1.15 - t * 0.6);
        for (const sd of [-1, 1]) {
          const lg = leafStrip({ len: L, wid: L * 0.62, segs: 4, profile: PROFILES.ovate, curl: 0.6, fold: -0.25, base: 0x4f8a32, tip: 0x6fae45, vein: 1.15 });
          orient(lg, px, py, pz, J(0.1, 0.6), az + sd * Math.PI / 2 + p * 0.8, 0);
          parts.add(lg, lm);
        }
      }
      for (let k = 0; k < 3; k++) {
        const lg = leafStrip({ len: 0.022, wid: 0.014, segs: 3, profile: PROFILES.ovate, curl: -0.4, fold: -0.3, base: 0x5f9a3a, tip: 0x86c060 });
        orient(lg, tx, ty, tz, J(0.9, 1.3), k / 3 * TAU + az, 0);
        parts.add(lg, lm);
      }
    }
  } else if (type === 'fiddle') {
    const r = 0.17, h = 0.28;
    soilY = potGeo(parts, potKind, r, h, potC, rnd);
    const bark = C.util.stdMat(0x6b5a44, 0.85);
    const topY = 1.3;
    const trunk = [[0, soilY - 0.02, 0], [0.02, 0.6, 0.01], [-0.01, 0.95, 0.02], [0.02, topY - 0.05, 0]];
    const curve = new THREE.CatmullRomCurve3(trunk.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    parts.add(new THREE.TubeGeometry(curve, 16, 0.013, 6, false), bark);
    const n = 17;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = curve.getPointAt(0.35 + t * 0.64);
      const az = i * 2.4;
      const L = J(0.2, 0.28) * (1 - t * 0.25), Wd = L * J(0.62, 0.72);
      const lg = leafStrip({ len: L, wid: Wd, segs: 7, profile: PROFILES.fiddle, curl: J(0.3, 0.7), fold: 0.22, twist: J(-0.2, 0.2), base: 0x2a4a22, tip: 0x3b6a2e, vein: 1.25 });
      const pet = 0.03;
      parts.add(gCyl(0.003, 0.004, pet, 4, p.x + Math.sin(az) * pet / 2, p.y + 0.01, p.z + Math.cos(az) * pet / 2, 0, 0, 0), stemM);
      orient(lg, p.x + Math.sin(az) * pet, p.y + 0.015, p.z + Math.cos(az) * pet, J(0.25, 0.75) + t * 0.3, az, J(-0.15, 0.15));
      parts.add(lg, lm);
    }
  }
  parts.build(inner, 'props.plant.' + type, {});
  return g;
}
function variegate(g, rnd) {
  const c = g.attributes.color, p = g.attributes.position;
  const s = rnd() * 10;
  for (let i = 0; i < c.count; i++) {
    const n = C.util.noise2D(p.getX(i) * 60 + s, p.getZ(i) * 60);
    if (n > 0.35) { const k = Math.min(1, (n - 0.35) * 2.5); c.setXYZ(i, lerp(c.getX(i), 0.75, k), lerp(c.getY(i), 0.72, k), lerp(c.getZ(i), 0.3, k)); }
  }
}
// bend geometry laid along +Z (length L) around the X axis with constant curvature: total angle `curl` (+ droops)
function bendZ(g, L, curl) {
  const p = g.attributes.position;
  if (Math.abs(curl) < 1e-4) return g;
  const k = curl / L;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = k * z;
    const cz = Math.sin(a) / k, cy = -(1 - Math.cos(a)) / k;
    p.setXYZ(i, x, cy + y * Math.cos(a), cz + y * Math.sin(a));
  }
  p.needsUpdate = true;
  return g;
}
function monsteraLeaf(L, W, rnd) {
  const sh = new THREE.Shape();
  const N = 40;
  const hw = s => W / 2 * Math.pow(Math.sin(Math.PI * s), 0.62) * (1 - 0.2 * s);
  const zf = s => L * (s * 1.08 - 0.08);
  const slitsL = [0.28, 0.42, 0.56, 0.7, 0.83], slitsR = [0.24, 0.38, 0.52, 0.66, 0.8];
  const side = (sgn, slits) => {
    const pts = [];
    for (let i = 1; i < N; i++) {
      const s = i / N;
      let sl = null;
      for (const q of slits) if (Math.abs(s - q) < 0.5 / N) sl = q;
      const x = sgn * hw(s), z = zf(s);
      if (sl !== null && s > 0.15) {
        pts.push([x, z - 0.004]);
        const depth = 0.55 + rnd() * 0.2;
        pts.push([x * (1 - depth), z - L * 0.07]);
        pts.push([x, z + 0.004]);
      } else pts.push([x, z]);
    }
    return pts;
  };
  const left = side(-1, slitsL), right = side(1, slitsR).reverse();
  sh.moveTo(0, 0);
  for (const [x, z] of left) sh.lineTo(x, z);
  sh.lineTo(0, L);
  for (const [x, z] of right) sh.lineTo(x, z);
  sh.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(sh, 1);
  // shape is in XY: map (x, y) -> (x, 0, y) with length along +Z
  g.rotateX(Math.PI / 2);
  // rotateX(+90) maps y -> z (positive) and z -> -y: fine (flat).
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const base = hexCol(0x24481f), tip = hexCol(0x3c6e30), vein = hexCol(0x5f8a45);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const t = clamp(z / L, 0, 1);
    _c1.copy(base).lerp(tip, t);
    if (Math.abs(x) < 0.006) _c1.lerp(vein, 0.6);
    // midrib fold: edges droop a touch
    p.setY(i, -Math.abs(x) * 0.18);
    cols[i * 3] = _c1.r; cols[i * 3 + 1] = _c1.g; cols[i * 3 + 2] = _c1.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.deleteAttribute('normal');
  return g;
}

// ================================================================================================================
//  TEXTILES: pillow, blanket, throw, rug
// ================================================================================================================
function pillowGeo(w, h, t, shape) {
  let g;
  if (shape === 'round') {
    g = new THREE.SphereGeometry(0.5, 32, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rr = Math.min(1, Math.hypot(x, y) / 0.5);
      p.setXYZ(i, x * w, y * h, Math.sign(z) * Math.pow(Math.abs(z) / 0.5, 0.8) * t / 2 * (0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - rr * rr))));
    }
  } else if (shape === 'bolster') {
    g = new THREE.CapsuleGeometry(h / 2, Math.max(0.01, w - h), 8, 20);
    g.rotateZ(Math.PI / 2);
  } else {
    g = new THREE.BoxGeometry(w, h, t, 16, 16, 3);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-5);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = x / (w / 2), ny = y / (h / 2), nz = z / (t / 2);
      const puff = 0.1 + 0.9 * Math.sqrt(Math.max(0, (1 - nx * nx * nx * nx) * (1 - ny * ny * ny * ny)) );
      const pinch = 0.07;
      const X = x * (1 - pinch * (1 - ny * ny)) * (1 - 0.04 * Math.abs(nz));
      const Y = y * (1 - pinch * (1 - nx * nx)) * (1 - 0.04 * Math.abs(nz));
      const wr = 0.004 * C.util.noise3D(x * 12, y * 12, z * 5);
      p.setXYZ(i, X, Y, nz * (t / 2) * puff + wr * Math.sign(nz || 1));
    }
  }
  g.computeVertexNormals();
  wuv(g, 1);
  g.computeBoundingSphere();
  return g;
}
function pillow(o = {}) {
  const w = o.w || 0.45, h = o.h || 0.45, t = o.t || 0.14, shape = o.shape || 'square';
  const g = mkGroup(o, 'props.pillow');
  const mat = resolveMat(o.material, 'fabricCream', o.color);
  const key = `pillow|${w}|${h}|${t}|${shape}`;
  let geo = geoCache.get(key);
  if (!geo) { geo = pillowGeo(w, h, t, shape); geoCache.set(key, geo); }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'props.pillow'; m.receiveShadow = true;
  g.add(m);
  if (o.button) {
    const bm = o.buttonColor !== undefined ? C.util.stdMat(o.buttonColor, 0.6) : mat;
    for (const s of [-1, 1]) { const b = new THREE.Mesh(sharedGeo('pillowButton', () => gSph(0.012, 0, 0, 0, 1, 1, 0.5, 10, 6)), bm); b.position.z = s * t * 0.42; g.add(b); }
  }
  return g;
}
function sharedGeo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }
function blanket(o = {}) {
  const w = o.w || 0.5, d = o.d || 0.35, t = o.t || 0.03, n = o.folds || 3;
  const g = mkGroup(o, 'props.blanket');
  const mat = resolveMat(o.material, 'knit', o.color);
  const parts = new Parts();
  const rnd = C.util.rng(((o.seed || 1) * 7 + 3) >>> 0);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const bg = gRBox(w - i * 0.006, t, d - i * 0.004, t * 0.48, (rnd() - 0.5) * 0.01, y + t / 2, (rnd() - 0.5) * 0.008, 0, (rnd() - 0.5) * 0.03, 0, 3);
    // soften: squash top a little, sag middle
    const p = bg.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k); p.setY(k, p.getY(k) + 0.004 * Math.cos(x / w * Math.PI) * Math.cos(z / d * Math.PI) * (i === n - 1 ? 1 : 0.3)); }
    bg.computeVertexNormals();
    wuv(bg, 1);
    parts.add(bg, mat);
    y += t * 0.94;
  }
  parts.build(g, 'props.blanket', {});
  g.userData.height = y;
  return g;
}
function throwBlanket(o = {}) {
  const w = o.w || 1.2, d = o.d || 0.9;
  const g = mkGroup(o, 'props.throw');
  const mat = resolveMat(o.material, 'knit', o.color);
  const dm = o.drapeOver;
  const drop = typeof dm === 'number' ? dm : dm && dm.drop ? dm.drop : 0;
  const rad = dm && dm.radius ? dm.radius : 0.035;
  const segX = Math.max(16, Math.round(w * 26)), segZ = Math.max(16, Math.round(d * 30));
  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);                 // now in XZ, normal +Y; z from -d/2 .. d/2
  const p = geo.attributes.position;
  const sd = (o.seed || 1) * 13.37, wave = o.wave !== undefined ? o.wave : 1;
  const zEdge = d / 2 - drop;               // start of the fold (flat before)
  const off = 0.006, rr = rad + off;
  const arcLen = drop > 0 ? rr * Math.PI / 2 : 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const nfl = C.util.fbm2D(x * 2.2 + sd, z * 2.2, 3);
    let X = x, Y = 0.004 + wave * (0.012 * Math.max(0, nfl) + 0.006 * (0.5 + 0.5 * Math.sin(x * 9 + nfl * 3))), Z = z;
    const edge = Math.min(1, Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)) / 0.06);
    Y *= 0.4 + 0.6 * edge;
    if (drop > 0 && z > zEdge) {
      const s = z - zEdge;                    // distance past the fold start
      if (s < arcLen) {
        const a = s / rr;                     // 0..PI/2 around the edge
        Y = (Y - off) * (1 - a / (Math.PI / 2)) - rad + rr * Math.cos(a); Z = zEdge + rr * Math.sin(a);
      } else {
        const hang = s - arcLen;
        const k = Math.min(1, hang / 0.12);
        const folds = wave * 0.022 * (0.5 + 0.5 * Math.sin(x * 11 + sd + nfl * 2)) * k;
        X = x; Y = -rad - hang; Z = zEdge + rr + folds + 0.006 * Math.max(0, nfl) * k;
      }
    }
    p.setXYZ(i, X, Y, Z);
  }
  geo.computeVertexNormals();
  wuv(geo, 1);
  const m = new THREE.Mesh(geo, mat.side === THREE.DoubleSide ? mat : doubleSided(mat));
  m.name = 'props.throw'; m.receiveShadow = true;
  g.add(m);
  return g;
}
function doubleSided(mat) { return cachedMat('ds.' + mat.uuid, () => { const m = mat.clone(); m.side = THREE.DoubleSide; return m; }); }
let _fringeMat = null;
function fringeMat() {
  if (_fringeMat) return _fringeMat;
  const tex = C.util.canvasTexture(128, 32, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let x = 1; x < w; x += 3) { ctx.strokeStyle = `rgba(236,226,204,1)`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.sin(x) * 2), h - (x * 7 % 6)); ctx.stroke(); }
  }, { wrap: true });
  _fringeMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  _fringeMat.name = 'props.fringe';
  return _fringeMat;
}
function rug(o = {}) {
  const style = o.style || 'persian';
  let w = o.w || 2, d = o.d || 1.4;
  const g = mkGroup(o, 'props.rug.' + style);
  const matName = { persian: 'rugPersian', braided: 'rugBraided', runner: 'rugRunner', kilim: 'rugRunner', sheepskin: 'sheepskin' }[style] || 'rugPersian';
  const mat = M(matName);
  const round = o.round || style === 'braided' && o.round !== false && Math.abs(w - d) < 1e-6;
  let geo;
  const TH = 0.0055;
  if (style === 'sheepskin') {
    geo = new THREE.RingGeometry(0, 1, 48, 6);
    const p = geo.attributes.position;
    const sd = (o.seed || 1) * 3.1;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y), a = Math.atan2(y, x);
      const lobe = 1 + 0.12 * Math.cos(a * 4) + 0.06 * C.util.noise2D(Math.cos(a) * 2 + sd, Math.sin(a) * 2) + 0.05 * Math.cos(a * 2);
      const R = r * lobe;
      p.setXYZ(i, Math.cos(a) * R * w / 2, Math.sin(a) * R * d / 2, 0.001 + 0.016 * Math.sqrt(Math.max(0, 1 - r * r)) + 0.003 * C.util.noise2D(x * 9 + sd, y * 9));
    }
    geo.rotateX(-Math.PI / 2);
    // rotateX(-90): (x, y, z) -> (x, z, -y) : height now in +Y
    geo.computeVertexNormals();
    wuv(geo, 1);
  } else if (round) {
    geo = new THREE.CylinderGeometry(0.5, 0.5, TH, 64, 1);
    geo.scale(w, 1, d);
    geo.translate(0, 0.0005 + TH / 2, 0);
  } else {
    const long = style === 'runner' || style === 'kilim' || style === 'persian';
    const swap = long && w > d;
    geo = new RoundedBoxGeometry(swap ? d : w, TH, swap ? w : d, 2, 0.0025);
    if (swap) geo.rotateY(Math.PI / 2);
    geo.translate(0, 0.0005 + TH / 2, 0);
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = 'props.rug'; m.receiveShadow = true;
  g.add(m);
  if (o.fringe !== false && !round && style !== 'sheepskin' && style !== 'braided') {
    const fm = fringeMat();
    const alongZ = !(w > d);
    const shortLen = alongZ ? w : d, longLen = alongZ ? d : w;
    for (const s of [-1, 1]) {
      const fg = new THREE.PlaneGeometry(shortLen * 0.96, 0.05);
      fg.rotateX(-Math.PI / 2);
      if (!alongZ) fg.rotateY(Math.PI / 2);
      const fo = longLen / 2 + 0.024;
      fg.translate(alongZ ? 0 : s * fo, 0.003, alongZ ? s * fo : 0);
      const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * shortLen * 8);
      const fmesh = new THREE.Mesh(fg, fm); fmesh.name = 'props.rug.fringe';
      g.add(fmesh);
    }
  }
  if (o.tag !== false) {
    g.updateWorldMatrix(true, true);
    const bb = new THREE.Box3().setFromObject(m);
    C.physics.addSurfaceTag(bb.min.x, bb.min.z, bb.max.x, bb.max.z, bb.min.y - 0.1, bb.max.y + 0.4, 'rug');
  }
  return g;
}

// ================================================================================================================
//  SMALL THINGS: mug, teapot, vase, frame, clock, jar, bottle, basket
// ================================================================================================================
const MUG_COLORS = [0xe9dcc6, 0x6f8a9a, 0xa4492f, 0x3d5a45, 0xd09a3a, 0xc98f8a, 0x2f3d5a];
let mugSeq = 0;
function mug(o = {}) {
  const g = mkGroup(o, 'props.mug');
  const color = o.color !== undefined ? o.color : MUG_COLORS[(mugSeq++) % MUG_COLORS.length];
  const fill = o.fill || 'tea';
  const cm = typeof color === 'string' ? M(color) : glaze(color, 0.22);
  const key = `mug|${cm.uuid}|${fill}`;
  const list = cachedParts(key, p => {
    p.add(gLathe([[0, 0], [0.034, 0], [0.038, 0.004], [0.04, 0.012], [0.041, 0.06], [0.042, 0.092], [0.0415, 0.0955], [0.0395, 0.0955], [0.038, 0.09], [0.037, 0.012], [0, 0.009]], 28), cm);
    const hnd = gTorus(0.024, 0.0055, 8, 16, Math.PI * 1.25, 0, 0, 0);
    hnd.rotateZ(-Math.PI * 0.62); hnd.scale(1, 1.15, 1); hnd.translate(0.043, 0.05, 0);
    p.add(hnd, cm);
    if (fill !== 'none') {
      const col = { tea: 0x6a3a1a, coffee: 0x2e1a0e, cocoa: 0x5a3422 }[fill] || 0x6a3a1a;
      const liq = new THREE.CircleGeometry(0.0375, 24); liq.rotateX(-Math.PI / 2); liq.translate(0, 0.078, 0);
      p.add(liq, C.util.stdMat(col, 0.12));
    }
  });
  meshesFrom(list, g, 'props.mug', {});
  if (o.steam) g.userData.steam = steam(g, [0, 0.085, 0], Object.assign({ count: 14, height: 0.22, size: 0.04 }, o.steamOpts || {}));
  return g;
}
function teapot(o = {}) {
  const g = mkGroup(o, 'props.teapot');
  const cm = o.color !== undefined ? (typeof o.color === 'string' ? M(o.color) : glaze(o.color, 0.2)) : glaze(0x5b7a9a, 0.2);
  const list = cachedParts('teapot|' + cm.uuid, p => {
    p.add(gLathe([[0, 0], [0.05, 0], [0.056, 0.006], [0.074, 0.03], [0.083, 0.06], [0.08, 0.09], [0.066, 0.112], [0.05, 0.122], [0.046, 0.126], [0.044, 0.12], [0, 0.118]], 32), cm);
    p.add(gLathe([[0, 0.118], [0.047, 0.12], [0.046, 0.128], [0.035, 0.138], [0.012, 0.142], [0.009, 0.148], [0, 0.149]], 24), cm);
    p.add(gSph(0.012, 0, 0.156, 0, 1, 0.8, 1), cm);
    const spout = new THREE.CylinderGeometry(0.007, 0.016, 0.1, 12, 4, true);
    const sp = spout.attributes.position;
    for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); sp.setX(i, sp.getX(i) + 0.9 * (y + 0.05) * (y + 0.05)); }
    spout.computeVertexNormals();
    spout.rotateZ(-0.75); spout.translate(0.1, 0.075, 0);
    p.add(spout, cm);
    const hnd = gTorus(0.036, 0.007, 8, 18, Math.PI * 1.1);
    hnd.rotateZ(Math.PI * 0.45); hnd.translate(-0.08, 0.07, 0);
    p.add(hnd, cm);
  });
  meshesFrom(list, g, 'props.teapot', {});
  if (o.steam) g.userData.steam = steam(g, [0.14, 0.12, 0], Object.assign({ count: 12, height: 0.2, size: 0.035 }, o.steamOpts || {}));
  return g;
}
const VASE_PROFILES = {
  jug: (h, r) => [[0, 0], [r * 0.7, 0], [r * 0.75, 0.006], [r, h * 0.3], [r * 0.95, h * 0.55], [r * 0.55, h * 0.8], [r * 0.5, h * 0.92], [r * 0.62, h], [r * 0.56, h], [r * 0.45, h * 0.9], [0, h * 0.85]],
  bottle: (h, r) => [[0, 0], [r * 0.8, 0], [r * 0.85, 0.006], [r, h * 0.25], [r * 0.95, h * 0.45], [r * 0.35, h * 0.62], [r * 0.28, h * 0.95], [r * 0.36, h], [r * 0.25, h], [r * 0.2, h * 0.9], [0, h * 0.85]],
  round: (h, r) => [[0, 0], [r * 0.5, 0], [r * 0.55, 0.006], [r * 1.05, h * 0.4], [r * 0.9, h * 0.75], [r * 0.55, h * 0.93], [r * 0.6, h], [r * 0.52, h], [r * 0.45, h * 0.92], [0, h * 0.88]],
};
function vase(o = {}) {
  const g = mkGroup(o, 'props.vase');
  const rnd = C.util.rng(((o.seed || 1) * 811 + 5) >>> 0);
  const h = o.height || 0.2, shape = o.shape || 'jug', r = h * 0.36;
  const cm = o.color !== undefined ? (typeof o.color === 'string' ? M(o.color) : glaze(o.color, 0.25)) : glaze(0x8fa487, 0.25);
  const parts = new Parts();
  const vg = gLathe((VASE_PROFILES[shape] || VASE_PROFILES.jug)(h, r), 28);
  parts.add(vg, cm);
  const fl = o.flowers === undefined ? true : o.flowers;
  if (fl) {
    const lm = leafMaterial();
    const kind = typeof fl === 'string' ? fl : ['tulip', 'daisy', 'lavender', 'wild'][Math.floor(rnd() * 4)];
    const neckR = r * 0.4;
    const n = kind === 'lavender' ? 14 : kind === 'wild' ? 11 : 7;
    const palette = o.flowerColor !== undefined ? [o.flowerColor] :
      kind === 'tulip' ? [0xd8504a, 0xe8a0b0, 0xf2d06a, 0xe07a3a] : kind === 'daisy' ? [0xf6f2e6] : kind === 'lavender' ? [0x8a70b8] : [0xf6f2e6, 0xd8a0c0, 0xe8c050, 0x8a70b8, 0xd05a4a];
    for (let i = 0; i < n; i++) {
      const az = rnd() * TAU, lean = 0.12 + rnd() * 0.4;
      const sl = h * (0.9 + rnd() * 0.8) * (kind === 'lavender' ? 1.1 : 1);
      const bx = Math.sin(az) * neckR * 0.5, bz = Math.cos(az) * neckR * 0.5, by = h * 0.8;
      const tx = bx + Math.sin(az) * Math.sin(lean) * sl, tz = bz + Math.cos(az) * Math.sin(lean) * sl, ty = by + Math.cos(lean) * sl * 0.75;
      const stem = leafStrip({ len: 1, wid: 0.004, segs: 3, across: [-1, 0, 1], profile: () => 1, base: 0x4a6a32, tip: 0x5a7a3a, fold: 0, vein: 1 });
      // turn stem strip (along +Z, unit length) into a vertical-ish ribbon from (bx,by,bz) to tip
      const dx = tx - bx, dy = ty - by, dz = tz - bz, dl = Math.hypot(dx, dy, dz);
      stem.scale(1, 1, dl);
      stem.rotateX(-Math.atan2(dy, Math.hypot(dx, dz)));
      stem.rotateY(Math.atan2(dx, dz));
      stem.translate(bx, by, bz);
      parts.add(stem, lm);
      const col = palette[Math.floor(rnd() * palette.length)];
      if (kind === 'lavender') {
        for (let k = 0; k < 7; k++) { const t = 1 - k * 0.035; parts.add(colored(gSph(0.0045, 0, 0, 0, 1, 1.4, 1, 6, 4), k % 2 ? col : 0x6f5a9a).translate(bx + dx * t + (rnd() - 0.5) * 0.003, by + dy * t, bz + dz * t), lm); }
      } else if (kind === 'tulip' || (kind === 'wild' && rnd() < 0.4)) {
        for (let k = 0; k < 5; k++) {
          const pet = leafStrip({ len: 0.035, wid: 0.024, segs: 3, profile: PROFILES.ovate, curl: -0.5, fold: -0.3, base: col, tip: col, vein: 1.0 });
          orient(pet, tx, ty - 0.004, tz, 1.25, k / 5 * TAU, 0);
          parts.add(pet, lm);
        }
      } else {
        const pc = kind === 'daisy' ? 12 : 8;
        for (let k = 0; k < pc; k++) {
          const pet = leafStrip({ len: 0.022, wid: 0.008, segs: 2, across: [-1, 0, 1], profile: PROFILES.ovate, curl: 0.2, fold: 0, base: col, tip: col, vein: 1.0 });
          orient(pet, tx, ty, tz, 0.35, k / pc * TAU, 0);
          parts.add(pet, lm);
        }
        parts.add(colored(gSph(0.006, tx, ty + 0.002, tz, 1, 0.6, 1, 8, 5), 0xd8a02a), lm);
      }
      if (rnd() < 0.5) {
        const lf = leafStrip({ len: 0.05, wid: 0.014, segs: 3, profile: PROFILES.lance, curl: 0.6, fold: 0.2, base: 0x3f6a2e, tip: 0x5a8a3a });
        orient(lf, bx + dx * 0.4, by + dy * 0.4, bz + dz * 0.4, 0.5, az + (rnd() - 0.5) * 2, 0);
        parts.add(lf, lm);
      }
    }
  }
  parts.build(g, 'props.vase', {});
  return g;
}
function colored(g, hex) {
  _c1.set(hex);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _c1.r; c[i * 3 + 1] = _c1.g; c[i * 3 + 2] = _c1.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function frame(o = {}) {
  const w = o.w || 0.13, h = o.h || 0.18;
  const g = mkGroup(o, 'props.photoframe');
  const lean = 0.2;
  const inner = new THREE.Group(); inner.rotation.x = -lean; g.add(inner);
  const parts = new Parts();
  const fm = frameMat(o.style || (['wood', 'brass', 'silver', 'black'][(o.seed || 1) % 4]));
  const fw = Math.min(w, h) * 0.13, dp = 0.012;
  const ring = new Parts();
  frameRing(ring, fm, w, h, fw, dp, 0, 0.002);
  for (const b of ring.buckets.values()) for (const gg of b.geos) { gg.translate(0, h / 2, -dp / 2); parts.add(gg, b.mat); }
  parts.add(gBox(w - 0.004, h - 0.004, 0.003, 0, h / 2, -dp / 2 + 0.0015), C.util.stdMat(0x3a2e24, 0.9));
  parts.build(inner, 'props.photoframe', {});
  // easel leg (in group space): from the frame back at 60% height down to the table behind
  const ay = h * 0.6 * Math.cos(lean), az = -h * 0.6 * Math.sin(lean) - dp / 2 - 0.002;
  const fz = az - h * 0.38;
  const ll = Math.hypot(ay, az - fz), la = Math.atan2(az - fz, ay);
  const leg = gBox(w * 0.22, ll, 0.004, 0, ll / 2, 0);
  leg.rotateX(la); leg.translate(0, 0, fz);
  const lp = new Parts(); lp.add(leg, C.util.stdMat(0x3a2e24, 0.9)); lp.build(g, 'props.photoframe.leg', {});
  const styles = ['portrait', 'landscape', 'cottage', 'seascape'];
  const tex = artTexture(styles[(o.seed || 1) % styles.length], (w - 2 * fw) / (h - 2 * fw), (o.seed || 1) + 77, 256, true);
  const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
  pm.name = 'props.photo';
  const ph = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * fw + 0.004, h - 2 * fw + 0.004), pm);
  ph.position.set(0, h / 2, -dp / 2 + 0.005);
  ph.name = 'props.photo';
  inner.add(ph);
  return g;
}
let _clockFace = null;
function clockFaceTex() {
  if (_clockFace) return _clockFace;
  _clockFace = C.util.canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f1e8d2'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 128); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,60,20,0.25)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a211a'; ctx.fillStyle = '#2a211a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(128, 128, 118, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(128, 128, 96, 0, TAU); ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; const r0 = i % 5 ? 112 : 106; ctx.lineWidth = i % 5 ? 1 : 3; ctx.beginPath(); ctx.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0); ctx.lineTo(128 + Math.sin(a) * 117, 128 - Math.cos(a) * 117); ctx.stroke(); }
    const nums = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    nums.forEach((s, i) => { const a = i / 12 * TAU; ctx.save(); ctx.translate(128 + Math.sin(a) * 82, 128 - Math.cos(a) * 82); ctx.rotate(a); ctx.fillText(s, 0, 0); ctx.restore(); });
    ctx.font = 'italic 11px Georgia, serif'; ctx.fillText('Hollingworth & Sons', 128, 170);
  }, { wrap: false });
  return _clockFace;
}
function clock(o = {}) {
  const sc = o.scale || 1;
  const g = mkGroup(o, 'props.clock');
  const inner = new THREE.Group(); inner.scale.setScalar(sc); g.add(inner);
  const wood = o.color !== undefined ? glaze(o.color, 0.4) : M('woodDark');
  const mk = metal('brass');
  const list = cachedParts('clock|' + wood.uuid, p => {
    p.add(wuv(gRBox(0.34, 0.022, 0.11, 0.006, 0, 0.011 + 0.012, 0)), wood);
    const sh = new THREE.Shape();
    sh.moveTo(-0.15, 0); sh.lineTo(0.15, 0); sh.lineTo(0.15, 0.07);
    sh.bezierCurveTo(0.15, 0.1, 0.1, 0.1, 0.075, 0.12);
    sh.bezierCurveTo(0.05, 0.19, -0.05, 0.19, -0.075, 0.12);
    sh.bezierCurveTo(-0.1, 0.1, -0.15, 0.1, -0.15, 0.07); sh.lineTo(-0.15, 0);
    const body = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 16 });
    body.translate(0, 0.034, -0.04);
    wuv(body, 1);
    p.add(body, wood);
    for (const sx of [-0.14, 0.14]) for (const sz of [-0.035, 0.035]) p.add(gSph(0.009, sx, 0.008, sz, 1, 0.9, 1, 10, 6), mk);
    p.add(gTorus(0.058, 0.0055, 8, 40, TAU, 0, 0.118, 0.046), mk);
    p.add(gSph(0.008, 0, 0.214, 0, 1, 1, 1, 10, 6), mk);
    const face = new THREE.CircleGeometry(0.056, 40); face.translate(0, 0.118, 0.0455);
    p.add(face, cachedMat('clockface', () => new THREE.MeshStandardMaterial({ map: clockFaceTex(), roughness: 0.4 })));
  });
  meshesFrom(list, inner, 'props.clock', {});
  const handM = C.util.stdMat(0x1c1612, 0.5, 0.3);
  const mkHand = (len, wd) => { const hg = sharedGeo('clockhand|' + len, () => { const b = new THREE.BoxGeometry(wd, len, 0.0015); b.translate(0, len * 0.4, 0); return b; }); const m = new THREE.Mesh(hg, handM); m.position.set(0, 0.118, 0.047); m.userData.dynamic = true; inner.add(m); return m; };
  const hh = mkHand(0.032, 0.004), mh = mkHand(0.046, 0.0028);
  mh.position.z += 0.0017;
  const ck = { hour: hh, min: mh, last: -1 };
  S.clocks.push(ck);
  updateClock(ck, true);
  if (o.id) {
    g.userData.dynamic = true;
    try {
      C.interact.add({ id: o.id, object: g, label: 'Check the time', range: o.range, onUse: () => {
        const d = new Date(); let hr = d.getHours() % 12; if (hr === 0) hr = 12;
        C.hud.toast(`It's ${hr}:${String(d.getMinutes()).padStart(2, '0')}. The rain shows no sign of stopping.`);
        C.audio.play && C.audio.play('chime', { x: g.position.x, y: g.position.y, z: g.position.z, volume: 0.3 });
      } });
    } catch (e) { C.log('props', e); }
  }
  return g;
}
function updateClock(ck, force) {
  const now = Date.now() - S.tzOffsetMs;
  const sec = Math.floor(now / 1000);
  if (!force && sec === ck.last) return;
  ck.last = sec;
  const mins = (now / 60000) % 60, hrs = (now / 3600000) % 12;
  ck.min.rotation.z = -mins / 60 * TAU;
  ck.hour.rotation.z = -hrs / 12 * TAU;
}
const JAR_FILL = { flour: 0xf0ead8, sugar: 0xf7f4ee, beans: 0x6e3a24, pasta: 0xe2bf6a, tea: 0x3a2a1c, cookies: 0xb98a52, jam: 0x8a1f2a, honey: 0xd08a1a, rice: 0xefe8da, coffee: 0x3a2416 };
function jar(o = {}) {
  const g = mkGroup(o, 'props.jar');
  const r = o.radius || 0.05, h = o.height || 0.14, contents = o.contents || 'flour', fill = o.fill !== undefined ? o.fill : 0.7;
  const lid = o.lid || 'cork';
  const key = `jar|${r}|${h}|${contents}|${fill}|${lid}|${o.label !== false}`;
  const glassList = cachedParts(key + '|g', p => {
    p.add(gLathe([[0, 0], [r - 0.004, 0], [r, 0.006], [r, h * 0.88], [r * 0.86, h * 0.95], [r * 0.86, h], [r * 0.83, h], [r * 0.83, h * 0.95], [r - 0.003, h * 0.88], [r - 0.003, 0.006], [0, 0.004]], 28), M('glassClear'));
  });
  const list = cachedParts(key, p => {
    if (contents !== 'empty' && fill > 0) {
      const fh = (h * 0.86) * fill;
      const fc = JAR_FILL[contents] || 0xe0d6c0;
      const fm = C.util.stdMat(fc, contents === 'jam' || contents === 'honey' ? 0.25 : 0.95);
      const top = contents === 'beans' || contents === 'cookies' || contents === 'pasta' ? 0.012 : 0.004;
      p.add(gLathe([[0, 0.005], [r - 0.005, 0.005], [r - 0.005, fh], [r * 0.5, fh + top], [0, fh + top * 1.2]], 24), fm);
    }
    const lm = lid === 'wood' ? M('woodMedium') : lid === 'metal' ? metal('brass') : C.util.stdMat(0xb08a5e, 0.95);
    if (lid === 'cork') p.add(gCyl(r * 0.84, r * 0.8, 0.03, 20, 0, h + 0.008, 0), lm);
    else p.add(wuv(gCyl(r * 0.92, r * 0.92, 0.018, 24, 0, h + 0.005, 0)), lm);
    if (lid === 'wood') p.add(gSph(0.012, 0, h + 0.018, 0, 1, 0.7, 1), lm);
    if (o.label !== false) {
      const lb = new THREE.CylinderGeometry(r + 0.0012, r + 0.0012, h * 0.28, 20, 1, true, -0.7, 1.4);
      lb.translate(0, h * 0.45, 0);
      p.add(lb, M('paper'));
    }
  });
  meshesFrom(list, g, 'props.jar', {});
  meshesFrom(glassList, g, 'props.jar.glass', {});
  return g;
}
const BOTTLE_KIND = { wine: [0x1f3a24, 0.9], green: [0x2c4a2e, 0.9], oil: [0x6a6a1a, 0.9], beer: [0x5a3210, 0.9], milk: [0xf2efe8, 0.9] };
function bottle(o = {}) {
  const g = mkGroup(o, 'props.bottle');
  const kind = o.kind || 'wine';
  const h = o.height || (kind === 'milk' ? 0.2 : kind === 'beer' ? 0.23 : 0.3);
  const col = o.color !== undefined ? o.color : (BOTTLE_KIND[kind] || BOTTLE_KIND.wine)[0];
  const r = kind === 'milk' ? 0.04 : kind === 'beer' ? 0.03 : 0.037;
  const gm = C.util.stdMat(col, kind === 'milk' ? 0.25 : 0.08, 0.1);
  const list = cachedParts(`bottle|${kind}|${h}|${col}|${o.label !== false}`, p => {
    const neck = kind === 'milk' ? 0.03 : 0.013;
    const shoulder = kind === 'milk' ? 0.6 : kind === 'oil' ? 0.55 : 0.62;
    p.add(gLathe([[0, 0], [r - 0.003, 0], [r, 0.005], [r, h * shoulder], [r * 0.8, h * (shoulder + 0.08)], [neck, h * (shoulder + 0.18)], [neck, h * 0.96], [neck + 0.002, h * 0.97], [neck + 0.002, h], [0, h]], 24), gm);
    if (kind === 'wine' || kind === 'oil' || kind === 'green') p.add(gCyl(neck + 0.001, neck + 0.001, 0.035, 14, 0, h - 0.016, 0), kind === 'wine' ? C.util.stdMat(0x6a1f24, 0.5, 0.3) : C.util.stdMat(0xb08a5e, 0.95));
    if (kind === 'beer') p.add(gCyl(neck + 0.004, neck + 0.004, 0.006, 14, 0, h + 0.002, 0), metal('brass'));
    if (kind === 'milk') p.add(gCyl(neck + 0.003, neck + 0.003, 0.008, 18, 0, h + 0.002, 0), C.util.stdMat(0x3a6a9a, 0.4, 0.5));
    if (o.label !== false && kind !== 'milk') {
      const lb = new THREE.CylinderGeometry(r + 0.001, r + 0.001, h * 0.26, 20, 1, true, -0.9, 1.8);
      lb.translate(0, h * 0.33, 0);
      p.add(lb, M('paper'));
    }
  });
  meshesFrom(list, g, 'props.bottle', {});
  return g;
}
function basket(o = {}) {
  const g = mkGroup(o, 'props.basket');
  const r = o.radius || 0.18, h = o.height || 0.2, oval = o.oval || 1, contents = o.contents || 'none';
  const rnd = C.util.rng(((o.seed || 1) * 131 + 9) >>> 0);
  const parts = new Parts();
  const wm = M('wickerBasket');
  const wmd = doubleSided(wm);
  const body = gLathe([[r * 0.8, 0], [r * 0.84, 0.01], [r * 0.95, h * 0.5], [r, h]], 32);
  latheUV(body, TAU * r, h * 1.1);
  body.scale(1, 1, oval);
  parts.add(body, wmd);
  const bottom = new THREE.CircleGeometry(r * 0.8, 28); bottom.rotateX(-Math.PI / 2); bottom.translate(0, 0.004, 0); bottom.scale(1, 1, oval); wuv(bottom, 1);
  parts.add(bottom, wm);
  const rim = gTorus(r, 0.011, 6, 40, TAU, 0, h, 0, Math.PI / 2); rim.scale(1, 1, oval);
  parts.add(rim, wm);
  if (o.handle) { const hd = gTorus(r * 0.95, 0.008, 6, 24, Math.PI, 0, h, 0); parts.add(hd, wm); }
  if (contents === 'yarn') {
    const cols = [0xa4492f, 0xd09a3a, 0x8fa487, 0xefe6d4, 0x2f3d5a, 0xc98f8a];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU + rnd(), rr = r * 0.45 * (i ? 1 : 0), yr = 0.055 + rnd() * 0.015;
      const ball = gSph(yr, Math.cos(a) * rr, h - 0.03 + (i ? 0 : 0.02), Math.sin(a) * rr * oval, 1, 0.95, 1, 16, 10);
      // wrap lines via uv-scale on knit texture
      parts.add(wuv(ball, 1.6), yarnMat(cols[i % cols.length]));
    }
    parts.add(gCyl(0.003, 0.003, 0.32, 6, r * 0.2, h + 0.08, 0, 0.3, 0, 0.5), C.util.stdMat(0xc9a86a, 0.5));
    parts.add(gCyl(0.003, 0.003, 0.32, 6, r * 0.25, h + 0.08, 0.02, 0.2, 0, 0.35), C.util.stdMat(0xc9a86a, 0.5));
  } else if (contents === 'logs') {
    for (let i = 0; i < 7; i++) {
      const lr = 0.035 + rnd() * 0.02, len = r * 1.7 + rnd() * 0.1;
      const x = (i % 3 - 1) * r * 0.55, y = h * 0.4 + Math.floor(i / 3) * 0.06 + lr, z = (rnd() - 0.5) * 0.03;
      const lg = gCyl(lr, lr * 1.05, len, 9, x, y, z, Math.PI / 2, (rnd() - 0.5) * 0.4, 0);
      wuv(lg, 1);
      parts.add(lg, M('bark'));
    }
  } else if (contents === 'blanket') {
    const bl = gSph(r * 0.9, 0, h * 0.9, 0, 1, 0.45, oval * 0.95, 20, 10);
    const p = bl.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.02 * C.util.noise3D(p.getX(i) * 12, p.getY(i) * 12, p.getZ(i) * 12));
    bl.computeVertexNormals(); wuv(bl, 1);
    parts.add(bl, M('knit'));
  } else if (contents === 'apples' || contents === 'bread') {
    const n = contents === 'apples' ? 9 : 3;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, rr = rnd() * r * 0.6;
      if (contents === 'apples') { parts.add(gSph(0.037, Math.cos(a) * rr, h - 0.02 + (i > 5 ? 0.04 : 0), Math.sin(a) * rr * oval, 1, 0.9, 1, 12, 8), glaze([0xa8322a, 0xb8442a, 0x8a2a22, 0xc0a040][i % 4], 0.4)); }
      else { const b = gSph(0.09, Math.cos(a) * rr * 0.5, h - 0.01, (i - 1) * 0.07, 1.3, 0.55, 0.65, 16, 10); parts.add(b, C.util.stdMat(0xc08a4a, 0.75)); }
    }
  }
  parts.build(g, 'props.basket', {});
  return g;
}
function yarnMat(color) { return cachedMat('yarn.' + color, () => { const m = M('knit').clone(); m.color.set(color).multiplyScalar(1.1); return m; }); }

// ================================================================================================================
//  STEAM + GLOW
// ================================================================================================================
const STEAM_VS = `
uniform float uTime; uniform float uHeight; uniform float uSize; uniform float uScale; uniform float uSpread; uniform float uSpeed;
attribute vec2 aSeed;
varying float vAlpha;
void main() {
  float life = fract(uTime * uSpeed * 0.3 + aSeed.x);
  float r = aSeed.y;
  vec3 p;
  p.y = life * uHeight;
  float sw = sin(uTime * 1.3 + r * 6.2831 + life * 5.0);
  p.x = (r - 0.5) * uSpread + sw * uSpread * 1.2 * life;
  p.z = cos(uTime * 1.1 + r * 12.0 + life * 4.0) * uSpread * 1.2 * life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (0.45 + 1.7 * life);
  gl_PointSize = max(1.0, size * uScale * projectionMatrix[1][1] / max(0.05, -mv.z));
  vAlpha = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.4, 1.0, life));
}`;
const STEAM_FS = `
uniform float uOpacity; uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = 1.0 - smoothstep(0.1, 1.0, r);
  a *= a;
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function steam(parent, position, opts = {}) {
  const n = opts.count || 18;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { seed[i * 2] = i / n + Math.random() * 0.03; seed[i * 2 + 1] = Math.random(); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const H = opts.height || 0.28;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), H);
  const strength = opts.strength !== undefined ? opts.strength : 1;
  const u = {
    uTime: S.steamTime, uScale: S.steamScale,
    uHeight: { value: H }, uSize: { value: opts.size || 0.05 }, uSpread: { value: opts.spread || 0.02 },
    uSpeed: { value: opts.speed || 1 }, uOpacity: { value: (opts.opacity !== undefined ? opts.opacity : 0.35) * strength },
    uColor: { value: new THREE.Color(opts.color !== undefined ? opts.color : 0xffffff) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: STEAM_VS, fragmentShader: STEAM_FS, transparent: true, depthWrite: false });
  mat.name = 'props.steam';
  const pts = new THREE.Points(geo, mat);
  const p = P3(position);
  pts.position.set(p[0], p[1], p[2]);
  pts.userData.dynamic = true;
  pts.name = 'props.steam';
  pts.raycast = () => {};
  pts.renderOrder = 3;
  pts.visible = strength > 0.001;
  (parent || C.scene).add(pts);
  const baseOp = opts.opacity !== undefined ? opts.opacity : 0.35;
  const h = {
    points: pts, strength,
    setStrength(v) { this.strength = v; u.uOpacity.value = baseOp * v; pts.visible = v > 0.001; },
    remove() { if (pts.parent) pts.parent.remove(pts); geo.dispose(); mat.dispose(); },
  };
  return h;
}
function glow(parent, position, color = 0xffc080, size = 0.4, opacity = 0.8) {
  const s = C.util.glowSprite(color, size, opacity);
  const p = P3(position);
  s.position.set(p[0], p[1], p[2]);
  s.raycast = () => {};
  (parent || C.scene).add(s);
  return s;
}

// ================================================================================================================
//  API + module
// ================================================================================================================
const api = {
  lamp, candle, books, bookStack, painting, plant, pillow, blanket, throwBlanket, rug,
  mug, teapot, vase, frame, clock, jar, bottle, basket, steam, glow,
  lamps: {},
  util: { Parts, metal, fabric, leafMaterial, prep },
};

C.register({
  name: 'props',
  order: 6,
  init(C) {
    S.tzOffsetMs = new Date().getTimezoneOffset() * 60000;
    C.props = api;
  },
  update(dt, t) {
    // lamp fades (0.15 s)
    const step = dt / 0.15;
    for (let i = 0; i < S.lamps.length; i++) {
      const L = S.lamps[i];
      if (L.level === L.target) continue;
      L.level = L.level < L.target ? Math.min(L.target, L.level + step) : Math.max(L.target, L.level - step);
      applyLamp(L);
    }
    // candle flames
    for (let i = 0; i < S.candles.length; i++) {
      const c = S.candles[i];
      if (!c.lit) continue;
      const ph = c.ph;
      const f = 1 + 0.07 * Math.sin(t * 13.1 + ph) + 0.05 * Math.sin(t * 23.7 + ph * 2.1) + 0.04 * Math.sin(t * 5.3 + ph * 0.7);
      const b = c.base;
      c.flame.scale.set(b * (1.04 - (f - 1) * 0.6), b * f, b * (1.04 - (f - 1) * 0.6));
      c.flame.rotation.z = 0.06 * Math.sin(t * 2.3 + ph) + 0.03 * Math.sin(t * 7.1 + ph * 1.3);
      c.flame.rotation.x = 0.04 * Math.sin(t * 1.9 + ph * 0.5);
      c.halo.material.opacity = c.haloOp * (0.8 + (f - 1) * 2.2);
    }
    // steam
    S.steamTime.value = t;
    const h = C.renderer.domElement.height;
    S.steamScale.value = h * 0.5;
    // clocks
    for (let i = 0; i < S.clocks.length; i++) updateClock(S.clocks[i], false);
  },
});

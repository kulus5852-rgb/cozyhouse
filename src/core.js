// =====================================================================================================================
//  COZY CORE — engine, loop, input, physics, interaction, HUD, utilities, debug API.  (see SPEC.md §3)
// =====================================================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const AUTOSTART = params.get('autostart') === '1';

const C = window.COZY = {
  THREE, version: '1.0.0', params, DEBUG,
  modules: [], ready: false, time: 0, frame: 0,
  state: { started: false, paused: false, uiOpen: false, muted: params.get('mute') === '1' },
  renderOverride: null,
  mats: {}, lights: [],
};

// ---------------------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------------------
const listeners = new Map();
C.on = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return fn; };
C.off = (name, fn) => { const s = listeners.get(name); if (s) s.delete(fn); };
C.emit = (name, payload) => {
  const s = listeners.get(name);
  if (!s) return;
  for (const fn of [...s]) { try { fn(payload); } catch (e) { reportError({ name: 'event:' + name }, 'event', e); } }
};
C.log = (tag, ...args) => { if (DEBUG) console.debug(`[${tag}]`, ...args); };

// ---------------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------------
const DEFAULT_SETTINGS = { masterVolume: 0.8, musicVolume: 0.7, ambienceVolume: 0.9, sfxVolume: 0.8, mouseSensitivity: 1.0,
  invertY: false, fov: 70, quality: 'high', headBob: false, showFps: false };
let savedSettings = {};
try { savedSettings = JSON.parse(localStorage.getItem('cozy-settings-v1') || '{}') || {}; } catch (e) { savedSettings = {}; }
C.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
if (['low', 'medium', 'high'].includes(params.get('quality'))) C.settings.quality = params.get('quality');
C.setSetting = (key, value) => {
  C.settings[key] = value;
  if (!DEBUG) { try { localStorage.setItem('cozy-settings-v1', JSON.stringify(C.settings)); } catch (e) { /* ignore */ } }
  applySettings();
  C.emit('settings', C.settings);
};

// ---------------------------------------------------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
renderer.domElement.id = 'cozy-canvas';
renderer.domElement.tabIndex = 0;
document.body.appendChild(renderer.domElement);
C.renderer = renderer;

function pixelRatioFor(q) {
  const d = window.devicePixelRatio || 1;
  return q === 'low' ? Math.min(d, 1) * 0.8 : q === 'medium' ? Math.min(d, 1.25) : Math.min(d, 2);
}
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(C.settings.fov, innerWidth / innerHeight, 0.05, 500);
camera.rotation.order = 'YXZ';
scene.add(camera);
C.scene = scene;
C.camera = camera;
C.clock = new THREE.Clock();

function resize() {
  renderer.setPixelRatio(pixelRatioFor(C.settings.quality));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
  C.emit('resize', { w: innerWidth, h: innerHeight });
}
addEventListener('resize', resize);
function applySettings() {
  if (Math.abs(camera.fov - C.settings.fov) > 0.01) { camera.fov = C.settings.fov; camera.updateProjectionMatrix(); }
  const pr = pixelRatioFor(C.settings.quality);
  if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) resize();
  const wantShadows = C.settings.quality === 'high';
  if (renderer.shadowMap.enabled !== wantShadows) {
    renderer.shadowMap.enabled = wantShadows;
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  }
}
renderer.setPixelRatio(pixelRatioFor(C.settings.quality));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = C.settings.quality === 'high';

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------
const seenErrors = new Set();
function reportError(mod, phase, e) {
  const message = (e && e.message) || String(e);
  const key = `${mod && mod.name}|${phase}|${message}`;
  const entry = { module: mod && mod.name, phase, message, stack: e && e.stack ? String(e.stack).slice(0, 1500) : '' };
  if (!seenErrors.has(key)) {
    seenErrors.add(key);
    C.debug.errors.push(entry);
    console.error(`[COZY] ${entry.module} ${phase} error: ${message}\n${entry.stack}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------------------------------
const input = C.input = {
  keys: new Set(), virtualKeys: new Set(),
  virtual: { moveX: 0, moveY: 0, lookX: 0, lookY: 0 },
  mouse: { dx: 0, dy: 0 },
  pointerLocked: false,
  isTouch: (window.matchMedia && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) || false,
};
input.isDown = code => input.keys.has(code) || input.virtualKeys.has(code);
const keyHandlers = new Map();
input.onKey = (code, fn) => { if (!keyHandlers.has(code)) keyHandlers.set(code, []); keyHandlers.get(code).push(fn); };
input.consumeMouse = () => { const r = { dx: input.mouse.dx, dy: input.mouse.dy }; input.mouse.dx = 0; input.mouse.dy = 0; return r; };

addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'F3') { e.preventDefault(); debugOverlayOn = !debugOverlayOn; hudDebug.style.display = debugOverlayOn ? 'block' : 'none'; return; }
  input.keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Escape' && C.state.started && !input.pointerLocked && !C.state.uiOpen) {
    if (C.state.paused) C.resume(); else C.pause();
    return;
  }
  if (C.state.uiOpen || !C.state.started) return;
  if (C.state.paused) return;
  if (e.code === 'KeyE') {
    if (C.interact.focused) C.interact.useFocused();
    else if (C.player.mode === 'sit') C.player.stand();
  }
  const hs = keyHandlers.get(e.code);
  if (hs) for (const h of hs) { try { h(e); } catch (err) { reportError({ name: 'key:' + e.code }, 'input', err); } }
});
addEventListener('keyup', e => { input.keys.delete(e.code); });
addEventListener('blur', () => input.keys.clear());
addEventListener('mousemove', e => {
  if (input.pointerLocked) { input.mouse.dx += e.movementX || 0; input.mouse.dy += e.movementY || 0; }
});
function requestLock() {
  if (input.isTouch || AUTOSTART) return;
  try {
    const p = renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* needs another click */ });
  } catch (e) { /* ignore */ }
}
C.requestPointerLock = requestLock;
document.addEventListener('pointerlockchange', () => {
  input.pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!input.pointerLocked && C.state.started && !C.state.paused && !C.state.uiOpen && !AUTOSTART) C.pause();
});
renderer.domElement.addEventListener('mousedown', e => {
  if (!C.state.started || C.state.uiOpen) return;
  if (C.state.paused) return;
  if (!input.pointerLocked && !input.isTouch && !AUTOSTART) { requestLock(); return; }
  if (e.button === 0 && C.interact.focused) C.interact.useFocused();
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------------------------------------------------------------
// Start / pause
// ---------------------------------------------------------------------------------------------------------------------
C.start = (opts = {}) => {
  const first = !C.state.started;
  C.state.started = true;
  C.state.paused = false;
  if (!opts.auto) requestLock();
  hud.classList.add('on');
  if (first) C.emit('start');
  else C.emit('resume');
};
C.pause = () => {
  if (!C.state.started || C.state.paused) return;
  C.state.paused = true;
  input.keys.clear();
  C.emit('pause');
};
C.resume = () => {
  if (!C.state.started) return C.start();
  C.state.paused = false;
  requestLock();
  C.emit('resume');
};

// ---------------------------------------------------------------------------------------------------------------------
// Player state (driven by the player module)
// ---------------------------------------------------------------------------------------------------------------------
C.world = {};
C.world.spawn = { x: 0.4, y: 0, z: 2.0, yaw: Math.PI / 2 };
C.player = {
  position: new THREE.Vector3(C.world.spawn.x, C.world.spawn.y, C.world.spawn.z),
  velocity: new THREE.Vector3(), yaw: C.world.spawn.yaw, pitch: -0.05,
  height: 1.75, crouchHeight: 1.2, eyeHeight: 1.62, radius: 0.28, stepUp: 0.35,
  crouch: 0, grounded: true, surface: 'wood', mode: 'walk', seat: null,
  bob: new THREE.Vector3(), cameraOwner: null,
  sitAt(seat) {
    this.seat = seat; this.mode = 'sit'; this.velocity.set(0, 0, 0);
    C.emit('sit', { id: seat && seat.id });
  },
  stand() {
    const s = this.seat;
    if (s && s.exit) this.position.set(s.exit[0], s.exit[1], s.exit[2]);
    this.seat = null; this.mode = 'walk'; this.velocity.set(0, 0, 0);
    if (s && typeof s.yawAfter === 'number') this.yaw = s.yawAfter;
    C.emit('stand', { id: s && s.id });
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------------------------------------------------
const V3 = (v) => (v && v.isVector3) ? v.clone() : Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v.x, v.y, v.z);
let colliderId = 0;
const boxes = [], cyls = [], floors = [], ramps = [], tags = [];
function removeFrom(arr, item) { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); physics._dirty = true; }
const physics = C.physics = {
  colliders: [], _dirty: true,
  addBox(min, max, opts = {}) {
    const a = V3(min), b = V3(max);
    const h = {
      id: ++colliderId, type: 'box', min: a.clone().min(b), max: a.clone().max(b), enabled: true,
      tag: opts.tag || 'solid', name: opts.name || '',
      blocksInteract: opts.blocksInteract !== undefined ? !!opts.blocksInteract : (opts.tag === 'wall' || opts.tag === 'door'),
      set(mn, mx) { const p = V3(mn), q = V3(mx); this.min.copy(p).min(q); this.max.copy(p).max(q); physics._dirty = true; return this; },
      remove() { removeFrom(boxes, h); removeFrom(physics.colliders, h); },
    };
    boxes.push(h); physics.colliders.push(h); physics._dirty = true;
    return h;
  },
  addBoxFromObject(obj, opts = {}) {
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    if (bb.isEmpty()) return null;
    const pad = opts.pad || 0;
    bb.min.x -= pad; bb.min.z -= pad; bb.max.x += pad; bb.max.z += pad;
    if (opts.minY !== undefined) bb.min.y = opts.minY;
    if (opts.maxY !== undefined) bb.max.y = opts.maxY;
    return physics.addBox(bb.min, bb.max, opts);
  },
  addCylinder(x, z, radius, yMin, yMax, opts = {}) {
    const h = {
      id: ++colliderId, type: 'cyl', x, z, r: radius, yMin, yMax, enabled: true, tag: opts.tag || 'solid', name: opts.name || '',
      blocksInteract: !!opts.blocksInteract,
      set(nx, nz, nr) { this.x = nx; this.z = nz; if (nr !== undefined) this.r = nr; physics._dirty = true; return this; },
      remove() { removeFrom(cyls, h); removeFrom(physics.colliders, h); },
    };
    cyls.push(h); physics.colliders.push(h); physics._dirty = true;
    return h;
  },
  addFloor(minX, minZ, maxX, maxZ, y, opts = {}) {
    const f = { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ), y,
      surface: opts.surface || 'wood', name: opts.name || '' };
    f.remove = () => removeFrom(floors, f);
    floors.push(f); physics._dirty = true;
    return f;
  },
  addRamp(minX, minZ, maxX, maxZ, axis, y0, y1, opts = {}) {
    const r = { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ),
      axis: axis === 'x' ? 'x' : 'z', y0, y1, surface: opts.surface || 'wood', name: opts.name || '' };
    r.remove = () => removeFrom(ramps, r);
    ramps.push(r); physics._dirty = true;
    return r;
  },
  addSurfaceTag(minX, minZ, maxX, maxZ, yMin, yMax, surface) {
    const t = { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ), yMin, yMax, surface };
    t.remove = () => removeFrom(tags, t);
    tags.push(t);
    return t;
  },
  groundAt(x, z, feetY, stepUp = 0.35) {
    const limit = feetY + stepUp + 1e-6;
    let bestY = -Infinity, bestS = null;
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      if (f.y <= limit && f.y > bestY) { bestY = f.y; bestS = f.surface; }
    }
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const t = r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX || 1) : (z - r.minZ) / (r.maxZ - r.minZ || 1);
      const y = r.y0 + (r.y1 - r.y0) * t;
      if (y <= limit && y > bestY) { bestY = y; bestS = r.surface; }
    }
    if (bestS === null) return null;
    return { y: bestY, surface: physics.surfaceAt(x, bestY, z, bestS) };
  },
  surfaceAt(x, y, z, fallback) {
    for (let i = tags.length - 1; i >= 0; i--) {
      const t = tags[i];
      if (x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ && y >= t.yMin && y <= t.yMax) return t.surface;
    }
    if (fallback) return fallback;
    const g = physics._groundRaw(x, z, y + 0.05);
    return g ? g.surface : 'none';
  },
  _groundRaw(x, z, limit) {
    let bestY = -Infinity, bestS = null;
    for (const f of floors) if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && f.y <= limit && f.y > bestY) { bestY = f.y; bestS = f.surface; }
    for (const r of ramps) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const t = r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX || 1) : (z - r.minZ) / (r.maxZ - r.minZ || 1);
      const y = r.y0 + (r.y1 - r.y0) * t;
      if (y <= limit && y > bestY) { bestY = y; bestS = r.surface; }
    }
    return bestS === null ? null : { y: bestY, surface: bestS };
  },
  // push a vertical circle (feet position pos, radius, height) out of all colliders; returns true if it touched anything
  resolve(pos, radius, height, stepUp = 0.35) {
    const yLo = pos.y + stepUp + 0.01, yHi = pos.y + height;
    let hit = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!b.enabled || b.max.y <= yLo || b.min.y >= yHi) continue;
        if (pos.x < b.min.x - radius || pos.x > b.max.x + radius || pos.z < b.min.z - radius || pos.z > b.max.z + radius) continue;
        const cx = pos.x < b.min.x ? b.min.x : pos.x > b.max.x ? b.max.x : pos.x;
        const cz = pos.z < b.min.z ? b.min.z : pos.z > b.max.z ? b.max.z : pos.z;
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2), push = radius - d + 1e-5;
          pos.x += dx / d * push; pos.z += dz / d * push;
        } else {
          const l = pos.x - b.min.x, r = b.max.x - pos.x, bk = pos.z - b.min.z, f = b.max.z - pos.z;
          const m = Math.min(l, r, bk, f);
          if (m === l) pos.x = b.min.x - radius; else if (m === r) pos.x = b.max.x + radius;
          else if (m === bk) pos.z = b.min.z - radius; else pos.z = b.max.z + radius;
        }
        moved = true; hit = true;
      }
      for (let i = 0; i < cyls.length; i++) {
        const c = cyls[i];
        if (!c.enabled || c.yMax <= yLo || c.yMin >= yHi) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z, rr = radius + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const push = rr - d + 1e-5;
        pos.x += (d2 > 1e-12 ? dx / d : 1) * push; pos.z += (d2 > 1e-12 ? dz / d : 0) * push;
        moved = true; hit = true;
      }
      if (!moved) break;
    }
    return hit;
  },
  move(pos, dx, dz, radius = 0.28, height = 1.75, stepUp = 0.35) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.1));
    const sx = dx / steps, sz = dz / steps;
    let hit = false;
    for (let s = 0; s < steps; s++) {
      pos.x += sx; pos.z += sz;
      if (physics.resolve(pos, radius, height, stepUp)) hit = true;
    }
    if (dist === 0 && physics.resolve(pos, radius, height, stepUp)) hit = true;
    return { hit };
  },
  raycast(origin, dir, maxDist = 100, filter) {
    let best = null, bestD = maxDist;
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.enabled || (filter && !filter(b))) continue;
      let tmin = 0, tmax = bestD;
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
        const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z, mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
        if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) ok = false; continue; }
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) ok = false;
      }
      if (ok && tmin < bestD) { bestD = tmin; best = b; }
    }
    for (let i = 0; i < cyls.length; i++) {
      const c = cyls[i];
      if (!c.enabled || (filter && !filter(c))) continue;
      const px = ox - c.x, pz = oz - c.z;
      const A = dx * dx + dz * dz, B = 2 * (px * dx + pz * dz), Cc = px * px + pz * pz - c.r * c.r;
      if (A < 1e-9) continue;
      const disc = B * B - 4 * A * Cc;
      if (disc < 0) continue;
      const t = Cc <= 0 ? 0 : (-B - Math.sqrt(disc)) / (2 * A);
      if (t < 0 || t >= bestD) continue;
      const y = oy + dy * t;
      if (y < c.yMin || y > c.yMax) continue;
      bestD = t; best = c;
    }
    return best ? { dist: bestD, collider: best } : null;
  },
  debugDraw(on) {
    if (physics._debugGroup) { scene.remove(physics._debugGroup); physics._debugGroup = null; }
    if (!on) return;
    const g = new THREE.Group(); g.name = 'core.physicsDebug';
    const pts = { box: [], floor: [], ramp: [], cyl: [] };
    const edge = (arr, a, b) => arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    for (const b of boxes) {
      if (!b.enabled) continue;
      const x0 = b.min.x, y0 = b.min.y, z0 = b.min.z, x1 = b.max.x, y1 = b.max.y, z1 = b.max.z;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([i, j]) => edge(pts.box, c[i], c[j]));
    }
    for (const c of cyls) for (let k = 0; k < 12; k++) {
      const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2;
      for (const y of [c.yMin, Math.min(c.yMax, c.yMin + 2)]) edge(pts.cyl, [c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r], [c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r]);
    }
    for (const f of floors) { const y = f.y + 0.01; const c = [[f.minX, y, f.minZ], [f.maxX, y, f.minZ], [f.maxX, y, f.maxZ], [f.minX, y, f.maxZ]]; [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([i, j]) => edge(pts.floor, c[i], c[j])); }
    for (const r of ramps) {
      const yAt = (x, z) => r.y0 + (r.y1 - r.y0) * (r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX) : (z - r.minZ) / (r.maxZ - r.minZ)) + 0.01;
      const c = [[r.minX, 0, r.minZ], [r.maxX, 0, r.minZ], [r.maxX, 0, r.maxZ], [r.minX, 0, r.maxZ]].map(p => [p[0], yAt(p[0], p[2]), p[2]]);
      [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]].forEach(([i, j]) => edge(pts.ramp, c[i], c[j]));
    }
    const colors = { box: 0x33ff66, floor: 0x3399ff, ramp: 0xffdd33, cyl: 0xff66cc };
    for (const k of Object.keys(pts)) {
      if (!pts[k].length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts[k], 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: colors[k], depthTest: false, transparent: true, opacity: 0.8 }));
      ls.renderOrder = 999; ls.frustumCulled = false;
      g.add(ls);
    }
    scene.add(g);
    physics._debugGroup = g;
  },
  _lists: { boxes, cyls, floors, ramps, tags },
};

// ---------------------------------------------------------------------------------------------------------------------
// World helpers (pure functions of the layout in SPEC §4)
// ---------------------------------------------------------------------------------------------------------------------
C.world.indoorAmount = (x, y, z) => {
  if (x >= -6.75 && x <= 6.75 && z >= -4.75 && z <= 4.75) return 1;
  if (x >= 1.2 && x <= 6.8 && z >= 4.75 && z <= 7.2) return 0.5;
  return 0;
};
C.world.isUnderRoof = (x, y, z) => {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= 7.4 && az <= 5.6 && y < 7.77 - 0.7 * az) return true;
  if (x >= -7.9 && x <= -7.0 && z >= 1.8 && z <= 3.2 && y < 8.4) return true;
  if (x >= 1.0 && x <= 7.0 && z >= 5.0 && z <= 7.4 && y < 3.27 - 0.25 * (z - 5.0)) return true;
  return false;
};
C.world.roomAt = (x, y, z) => {
  if (x >= -7 && x <= 7 && z >= -5 && z <= 5) {
    if (y >= 2.9) return 'loft';
    if (x >= 5.52 && z > -0.45 && z < 3.6 && y > 0.25) return 'stairs';
    if (x < 2.0) return z > 0.3 ? 'living' : 'kitchen';
    return z < -0.7 ? 'study' : 'hall';
  }
  if (x >= 1.2 && x <= 6.8 && z >= 5.0 && z <= 7.2 && y > -0.2) return 'porch';
  if (x >= -15 && x <= 15 && z >= -12 && z <= 19) return 'yard';
  if (x >= -16 && x <= 16 && z > 19 && z <= 23.5) return 'lane';
  return 'outside';
};

// ---------------------------------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------------------------------
C.env = { preset: 'dusk', daylight: 0.45, rain: 0.7, wind: { x: 0.35, z: 0.15 }, lightningFlash: 0, fireLevel: 1, indoor: 1, musicPlaying: false };

// ---------------------------------------------------------------------------------------------------------------------
// Audio stubs (the audio module fills these in, on the same objects)
// ---------------------------------------------------------------------------------------------------------------------
const noopLoop = () => ({ stop() {}, setVolume() {}, setPosition() {} });
C.audio = {
  ctx: null, started: false, master: null, buses: {},
  play() {}, loop: noopLoop, setListener() {},
  music: { playing: false, play() {}, stop() {}, toggle() {}, setPosition() {} },
  kettle: { start() {}, stop() {} },
  purr: { start() {}, stop() {} },
};

// ---------------------------------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------------------------------
const css = document.createElement('style');
css.textContent = `
#cozy-hud{position:fixed;inset:0;pointer-events:none;z-index:50;font-family:Georgia,'Iowan Old Style','Palatino Linotype',serif;color:#fbf1e1;opacity:0;transition:opacity .6s}
#cozy-hud.on{opacity:1}
#cozy-hud .xh{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,246,232,.82);box-shadow:0 0 4px rgba(0,0,0,.6);transition:all .15s ease}
#cozy-hud .xh.ring{width:18px;height:18px;margin:-9px 0 0 -9px;background:transparent;border:2px solid rgba(255,226,180,.9);box-shadow:0 0 8px rgba(255,180,90,.35),0 0 3px rgba(0,0,0,.6)}
#cozy-hud .xh.hidden{opacity:0}
#cozy-hud .prompt{position:absolute;left:50%;top:calc(50% + 26px);transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-size:17px;letter-spacing:.3px;text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 12px rgba(0,0,0,.5);opacity:0;transition:opacity .18s;white-space:nowrap}
#cozy-hud .prompt.on{opacity:1}
#cozy-hud .prompt .key{display:inline-block;min-width:22px;height:22px;line-height:21px;text-align:center;border:1.5px solid rgba(255,236,205,.85);border-radius:5px;font-size:13px;font-family:Verdana,sans-serif;background:rgba(40,28,20,.45)}
#cozy-hud .toasts{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
#cozy-hud .toast{padding:8px 18px;border-radius:18px;background:rgba(28,20,16,.55);box-shadow:0 2px 14px rgba(0,0,0,.35);font-size:16px;font-style:italic;color:#f9ead2;text-shadow:0 1px 2px rgba(0,0,0,.6);opacity:0;transform:translateY(8px);transition:opacity .45s,transform .45s}
#cozy-hud .toast.on{opacity:1;transform:none}
#cozy-hud .dbg{position:absolute;left:8px;top:8px;padding:6px 8px;background:rgba(0,0,0,.55);font:11px/1.35 Consolas,monospace;color:#bfe;white-space:pre;border-radius:4px;display:none}
`;
document.head.appendChild(css);
const hud = document.createElement('div');
hud.id = 'cozy-hud';
hud.innerHTML = '<div class="xh"></div><div class="prompt"><span class="key">E</span><span class="label"></span></div><div class="toasts"></div><div class="dbg"></div>';
document.body.appendChild(hud);
const hudXh = hud.querySelector('.xh'), hudPrompt = hud.querySelector('.prompt'), hudLabel = hud.querySelector('.prompt .label'),
  hudKey = hud.querySelector('.prompt .key'), hudToasts = hud.querySelector('.toasts'), hudDebug = hud.querySelector('.dbg');
let debugOverlayOn = DEBUG || C.settings.showFps;
hudDebug.style.display = debugOverlayOn ? 'block' : 'none';
let lastPrompt = null;
C.hud = {
  el: hud,
  prompt(text, key = 'E') {
    if (text === lastPrompt) return;
    lastPrompt = text;
    if (text) { hudLabel.textContent = text; hudKey.textContent = key; hudPrompt.classList.add('on'); }
    else hudPrompt.classList.remove('on');
  },
  toast(text, seconds = 3) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    hudToasts.appendChild(el);
    while (hudToasts.children.length > 3) hudToasts.removeChild(hudToasts.firstChild);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 600); }, seconds * 1000);
  },
  setCrosshair(mode) { hudXh.className = 'xh' + (mode === 'ring' ? ' ring' : mode === 'hidden' ? ' hidden' : ''); },
  show(on) { hud.classList.toggle('on', !!on); },
};
C.on('toast', p => p && p.text && C.hud.toast(p.text, p.seconds || 3));

// ---------------------------------------------------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------------------------------------------------
const interactables = [];
const raycaster = new THREE.Raycaster();
raycaster.camera = camera;
const _tmpV = new THREE.Vector3(), _tmpDir = new THREE.Vector3(), _tmpBox = new THREE.Box3(), _tmpSphere = new THREE.Sphere();
C.interact = {
  focused: null,
  add(opts) {
    if (!opts || !opts.object) throw new Error('interact.add needs an object');
    const it = { id: opts.id || ('it' + interactables.length), object: opts.object, label: opts.label || 'Use', onUse: opts.onUse || (() => {}),
      enabled: opts.enabled || null, range: opts.range || 2.3, ignore: opts.ignore || [], key: opts.key || 'E', radius: 0 };
    opts.object.updateMatrixWorld(true);
    _tmpBox.setFromObject(opts.object);
    _tmpBox.getBoundingSphere(_tmpSphere);
    it.radius = isFinite(_tmpSphere.radius) ? _tmpSphere.radius : 1;
    it.localCenter = opts.object.worldToLocal(_tmpSphere.center.clone());
    if (interactables.some(o => o.id === it.id)) console.warn(`[COZY] duplicate interactable id "${it.id}"`);
    interactables.push(it);
    it.remove = () => { const i = interactables.indexOf(it); if (i >= 0) interactables.splice(i, 1); if (C.interact.focused === it) C.interact.focused = null; };
    return it;
  },
  useFocused() {
    const it = C.interact.focused;
    if (!it) return false;
    try { it.onUse(); } catch (e) { reportError({ name: 'interact:' + it.id }, 'use', e); }
    C.emit('interact', { id: it.id });
    return true;
  },
  list() {
    return interactables.map(it => { it.object.updateMatrixWorld(true); const p = it.object.localToWorld(it.localCenter.clone()); return { id: it.id, label: labelOf(it), position: [p.x, p.y, p.z] }; });
  },
  get(id) { return interactables.find(it => it.id === id) || null; },
};
function labelOf(it) { try { return typeof it.label === 'function' ? it.label() : it.label; } catch (e) { return 'Use'; } }
const _hits = [];
function updateInteraction() {
  let best = null, bestD = Infinity;
  const p = C.player;
  const active = C.state.started && !C.state.paused && p.mode !== 'noclip';
  if (active) {
    camera.getWorldPosition(_tmpV);
    camera.getWorldDirection(_tmpDir);
    raycaster.set(_tmpV, _tmpDir);
    raycaster.near = 0;
    for (const it of interactables) {
      if (it.enabled && !it.enabled()) continue;
      const c = it.object.localToWorld(_tmpSphere.center.copy(it.localCenter));
      const dist = c.distanceTo(_tmpV);
      if (dist - it.radius > it.range) continue;
      raycaster.far = it.range;
      _hits.length = 0;
      it.object.raycast && raycaster.intersectObject(it.object, true, _hits);
      for (const h of _hits) { if (!h.object.visible) continue; if (h.distance < bestD) { bestD = h.distance; best = it; } break; }
    }
    if (best) {
      const block = physics.raycast(_tmpV, _tmpDir, bestD, c => c.blocksInteract && !best.ignore.includes(c));
      if (block && block.dist < bestD - 0.12) best = null;
    }
  }
  C.interact.focused = best;
  if (best) { C.hud.prompt(labelOf(best), best.key); C.hud.setCrosshair('ring'); }
  else if (active && p.mode === 'sit' && p.seat) { C.hud.prompt(p.seat.label || 'Stand up', 'E'); C.hud.setCrosshair('dot'); }
  else { C.hud.prompt(null); C.hud.setCrosshair(active ? 'dot' : 'hidden'); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------------------------------------------------
const util = C.util = {};
util.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
util.lerp = (a, b, t) => a + (b - a) * t;
util.smoothstep = (e0, e1, x) => { const t = util.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
util.damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
util.degToRad = d => d * Math.PI / 180;

util.rng = (seed = 1) => {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
util.random = util.rng(+(params.get('seed') || 1234));

// Simplex noise (Gustavson), seeded
const grad3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
{
  const r = util.rng(20240917), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }
}
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;
util.noise2D = (xin, yin) => {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { const g = permMod12[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { const g = permMod12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { const g = permMod12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2); }
  return 70 * (n0 + n1 + n2);
};
util.noise3D = (xin, yin, zin) => {
  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
  const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) { const g = permMod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0 + grad3[g + 2] * z0); }
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) { const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1 + grad3[g + 2] * z1); }
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) { const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2 + grad3[g + 2] * z2); }
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) { const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (grad3[g] * x3 + grad3[g + 1] * y3 + grad3[g + 2] * z3); }
  return 32 * (n0 + n1 + n2 + n3);
};
util.fbm2D = (x, y, octaves = 4) => {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * util.noise2D(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.02; }
  return sum / norm;
};

// World-scale UVs: box projection by vertex normal (1 UV unit = 1/scale metres)
util.worldUV = (g, scale = 1, offset) => {
  const pos = g.attributes.position, nor = g.attributes.normal;
  if (!nor) g.computeVertexNormals();
  const n = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const ox = offset ? offset[0] : 0, oy = offset ? offset[1] : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (ay >= az) { u = x; v = ny > 0 ? -z : z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u * scale + ox; uv[i * 2 + 1] = v * scale + oy;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
};

const matCache = new Map();
util.stdMat = (color = 0xffffff, roughness = 0.8, metalness = 0, opts = {}) => {
  const key = `${color}|${roughness}|${metalness}|${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness }, opts));
    m.name = 'std_' + (typeof color === 'number' ? color.toString(16) : color);
    matCache.set(key, m);
  }
  return m;
};

function finishMesh(mesh, parent, opts) {
  mesh.castShadow = !!opts.cast;
  mesh.receiveShadow = opts.receive !== false;
  if (opts.name) mesh.name = opts.name;
  if (opts.rx || opts.ry || opts.rz) mesh.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
  if (opts.dynamic) mesh.userData.dynamic = true;
  if (parent) parent.add(mesh);
  return mesh;
}
util.box = (parent, w, h, d, material, x = 0, y = 0, z = 0, opts = {}) => {
  const g = opts.round ? new RoundedBoxGeometry(w, h, d, opts.segments || 2, Math.min(opts.round, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
  if (opts.uv !== false) util.worldUV(g, opts.uvScale || 1, opts.uvOffset);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return finishMesh(m, parent, opts);
};
util.boxAt = (parent, minX, minY, minZ, maxX, maxY, maxZ, material, opts = {}) => {
  const w = Math.abs(maxX - minX), h = Math.abs(maxY - minY), d = Math.abs(maxZ - minZ);
  const g = opts.round ? new RoundedBoxGeometry(w, h, d, opts.segments || 2, Math.min(opts.round, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new THREE.BoxGeometry(w, h, d);
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  if (opts.uv !== false) util.worldUV(g, opts.uvScale || 1, opts.uvOffset);
  const m = new THREE.Mesh(g, material);
  return finishMesh(m, parent, opts);
};
util.cyl = (parent, rTop, rBottom, h, material, x = 0, y = 0, z = 0, opts = {}) => {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, opts.radial || 16, opts.heightSegments || 1, !!opts.open, opts.thetaStart || 0, opts.thetaLength || Math.PI * 2);
  if (opts.uv === 'world') util.worldUV(g, opts.uvScale || 1);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return finishMesh(m, parent, opts);
};
util.sphere = (parent, r, material, x = 0, y = 0, z = 0, opts = {}) => {
  const g = new THREE.SphereGeometry(r, opts.w || 16, opts.h || 12, opts.phiStart || 0, opts.phiLength || Math.PI * 2, opts.thetaStart || 0, opts.thetaLength || Math.PI);
  if (opts.sx || opts.sy || opts.sz) g.scale(opts.sx || 1, opts.sy || 1, opts.sz || 1);
  if (opts.uv === 'world') util.worldUV(g, opts.uvScale || 1);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return finishMesh(m, parent, opts);
};
util.lathe = (parent, points, material, x = 0, y = 0, z = 0, opts = {}) => {
  const g = new THREE.LatheGeometry(points.map(p => new THREE.Vector2(Math.max(0, p[0]), p[1])), opts.segments || 24);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return finishMesh(m, parent, opts);
};
util.extrude = (parent, shape, depth, material, opts = {}) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!opts.bevel, bevelSize: opts.bevelSize || 0.01, bevelThickness: opts.bevelThickness || 0.01, bevelSegments: opts.bevelSegments || 1, curveSegments: opts.curveSegments || 12 });
  if (opts.uv !== false) util.worldUV(g, opts.uvScale || 1);
  const m = new THREE.Mesh(g, material);
  if (opts.position) m.position.set(opts.position[0], opts.position[1], opts.position[2]);
  return finishMesh(m, parent, opts);
};

// Merge static meshes by material
util.bakeStatic = (group, opts = {}) => {
  if (!group) return null;
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  const m4 = new THREE.Matrix4();
  (function walk(o) {
    if (o !== group && (o.userData.dynamic || o.userData.noBake)) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.visible && o.children.length === 0 && o.geometry && o.geometry.attributes.position) {
      const mat = o.material;
      const okMat = mat && !Array.isArray(mat) && (!mat.transparent || o.userData.bakeTransparent) && !o.morphTargetInfluences;
      if (okMat) {
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const keepColor = !!mat.vertexColors;
        if (keepColor && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name) && !(keepColor && name === 'color')) g.deleteAttribute(name);
        g.morphAttributes = {};
        g.clearGroups();
        m4.multiplyMatrices(inv, o.matrixWorld);
        g.applyMatrix4(m4);
        if (m4.determinant() < 0) {
          const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array, c = g.attributes.color ? g.attributes.color.array : null;
          for (let t = 0; t < p.length / 9; t++) {
            for (const [arr, sz] of [[p, 3], [n, 3], [u, 2], [c, 3]]) {
              if (!arr) continue;
              const a = t * 3 * sz + sz, b = t * 3 * sz + 2 * sz;
              for (let k = 0; k < sz; k++) { const tmp = arr[a + k]; arr[a + k] = arr[b + k]; arr[b + k] = tmp; }
            }
          }
        }
        const key = mat.uuid + '|' + o.castShadow + '|' + o.receiveShadow + '|' + (o.renderOrder || 0);
        if (!buckets.has(key)) buckets.set(key, { mat, cast: o.castShadow, receive: o.receiveShadow, renderOrder: o.renderOrder || 0, geos: [], srcs: [] });
        const bk = buckets.get(key);
        bk.geos.push(g); bk.srcs.push(o);
      }
    }
    for (const c of o.children.slice()) walk(c);
  })(group);
  let count = 0;
  for (const bk of buckets.values()) {
    if (bk.geos.length < 2 && !opts.always) continue;
    let merged = null;
    try { merged = mergeGeometries(bk.geos, false); } catch (e) { merged = null; }
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bk.mat);
    mesh.castShadow = bk.cast; mesh.receiveShadow = bk.receive; mesh.renderOrder = bk.renderOrder;
    mesh.name = (group.name || 'group') + '.baked';
    group.add(mesh);
    for (const s of bk.srcs) { if (s.parent) s.parent.remove(s); }
    count += bk.srcs.length;
  }
  // remove now-empty groups
  (function prune(o) { for (const c of o.children.slice()) { prune(c); if (c.isGroup && c.children.length === 0 && !c.userData.dynamic && c !== group) o.remove(c); } })(group);
  return count;
};

// shared soft textures
let radialTex = null, blobTex = null;
function getRadialTex() {
  if (radialTex) return radialTex;
  radialTex = util.canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { srgb: false, wrap: false });
  return radialTex;
}
function getBlobTex() {
  if (blobTex) return blobTex;
  blobTex = util.canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { srgb: false, wrap: false });
  return blobTex;
}
util.radialTexture = getRadialTex;
util.canvasTexture = (w, h, draw, opts = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.readback });
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.wrap !== false) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.needsUpdate = true;
  return tex;
};
const blobMats = new Map();
util.blobShadow = (parent, x, y, z, w, d, opacity = 0.35) => {
  const key = opacity.toFixed(2);
  let mat = blobMats.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color: 0x000000, map: getBlobTex(), transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.name = 'blobShadow';
    blobMats.set(key, mat);
  }
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y + 0.003, z);
  m.userData.bakeTransparent = true;
  m.renderOrder = 1;
  m.name = 'blobShadow';
  if (parent) parent.add(m);
  return m;
};
util.glowSprite = (color = 0xffc080, size = 0.5, opacity = 1) => {
  const mat = new THREE.SpriteMaterial({ map: getRadialTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  s.userData.dynamic = true;
  s.name = 'glow';
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------
// Materials fallback (materials.js defines lazy getters on C.mats)
// ---------------------------------------------------------------------------------------------------------------------
const FALLBACK = {
  woodFloor: [0xa0673a, 0.55], woodDark: [0x4a3122, 0.6], woodMedium: [0x8a5a36, 0.6], woodLight: [0xc49a6c, 0.6], woodPainted: [0xf1e9d8, 0.55],
  woodPaintedSage: [0x8fa487, 0.55], woodPaintedGreen: [0x2e4a3b, 0.5], woodWeathered: [0x8d8a82, 0.8], woodPorch: [0x7b5b40, 0.7], bark: [0x4a3a2c, 0.95], logEnd: [0xb58a5a, 0.9],
  plaster: [0xefe4d0, 0.9], wallpaper: [0x9caf88, 0.85], wallpaperBlue: [0x8fa3b8, 0.85], ceilingBoards: [0xe9e2d4, 0.8], tileKitchen: [0xf2efe8, 0.3], tileFloor: [0xb5654a, 0.6],
  brick: [0x8e4a36, 0.9], stone: [0x7c776f, 0.85], siding: [0xe6e0d2, 0.7], shingles: [0x3c434b, 0.55], concrete: [0x8a8884, 0.9],
  fabricSofa: [0xa4492f, 0.95], fabricChair: [0xd09a3a, 0.95], fabricCream: [0xefe6d4, 0.95], fabricBlue: [0x2f3d5a, 0.95], fabricGreen: [0x6f8a64, 0.95], fabricRose: [0xc98f8a, 0.95],
  knit: [0xeee2cc, 1], quilt: [0xb56a4f, 0.95], rugPersian: [0x8c2f2a, 0.95], rugBraided: [0x9a7b5a, 0.95], rugRunner: [0x7a4a3a, 0.95], sheepskin: [0xf2ece0, 1], leather: [0x6b3f24, 0.5],
  brass: [0xc9a15a, 0.35, 1], copper: [0xb8734a, 0.35, 1], ironBlack: [0x222222, 0.55, 0.7], chrome: [0xdddddd, 0.15, 1], ceramic: [0xf4f1ea, 0.2], ceramicBlue: [0x4f6d9a, 0.25],
  ceramicTerracotta: [0xb86b45, 0.8], glassClear: [0xdde8ea, 0.05, 0, { transparent: true, opacity: 0.35 }], paper: [0xf3ecd8, 0.9], lampshade: [0xefe0c0, 0.9], bulb: [0xfff0d0, 0.3, 0, { emissive: 0xffc070, emissiveIntensity: 2 }],
  candleWax: [0xf3ead8, 0.6], soil: [0x3b2a1e, 1], wickerBasket: [0xa07a4a, 0.9],
  grass: [0x2f4a2c, 0.7], dirt: [0x5a4634, 0.9], mud: [0x3e3024, 0.35], gravel: [0x77726b, 0.8], flagstone: [0x6f6b66, 0.6], leaves: [0x3f5a32, 0.8], pineNeedles: [0x2c4430, 0.85],
  hedge: [0x2f4a2a, 0.9], moss: [0x4f6a36, 0.95], water: [0x2a3a44, 0.1], glass: [0xcfe0e6, 0.05, 0, { transparent: true, opacity: 0.18, depthWrite: false }],
};
C.mat = (name) => {
  if (name in C.mats) { const m = C.mats[name]; if (m && m.isMaterial) return m; }
  const f = FALLBACK[name] || [0xff00ff, 0.8];
  return util.stdMat(f[0], f[1], f[2] || 0, f[3] || {});
};
C.registerLight = (light, meta = {}) => { C.lights.push(Object.assign({ light }, meta)); return light; };

// ---------------------------------------------------------------------------------------------------------------------
// Debug API
// ---------------------------------------------------------------------------------------------------------------------
const frameWaiters = [];
let fps = 0, fpsFrames = 0, fpsTime = 0;
C.debug = {
  errors: [], frames: 0,
  setView(x, y, z, yaw = 0, pitch = 0, freecam = true) {
    const p = C.player;
    if (p.mode === 'sit') { p.seat = null; }
    p.yaw = yaw; p.pitch = pitch; p.velocity.set(0, 0, 0);
    p.position.set(x, y, z);
    p.mode = freecam ? 'noclip' : 'walk';
    C.emit('teleport', { x, y, z, freecam });
  },
  waitFrames(n = 1) { return new Promise(r => frameWaiters.push({ at: C.frame + n, r })); },
  info() {
    let meshes = 0; scene.traverse(o => { if (o.isMesh) meshes++; });
    return {
      fps: +fps.toFixed(1), drawCalls: lastCalls, triangles: lastTris, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      programs: renderer.info.programs ? renderer.info.programs.length : 0, lights: C.lights.length, meshes, colliders: physics.colliders.length,
      interactables: interactables.length, modules: C.modules.map(m => ({ name: m.name, order: m.order, initMs: m.initMs ? +m.initMs.toFixed(1) : null, error: !!m._failed })),
      player: { x: +C.player.position.x.toFixed(3), y: +C.player.position.y.toFixed(3), z: +C.player.position.z.toFixed(3), mode: C.player.mode },
    };
  },
  interact(id) {
    const it = C.interact.get(id);
    if (!it) throw new Error('no interactable with id ' + id);
    it.onUse();
    C.emit('interact', { id });
    return true;
  },
  listInteractables() { return C.interact.list(); },
  simulate() { throw new Error('player module missing'); },
  lightning() {},
  physics,
};
let lastCalls = 0, lastTris = 0;

// ---------------------------------------------------------------------------------------------------------------------
// Modules, boot, loop
// ---------------------------------------------------------------------------------------------------------------------
C.register = (def) => {
  if (!def || !def.name) throw new Error('module needs a name');
  if (C.modules.some(m => m.name === def.name)) { console.warn('[COZY] module registered twice: ' + def.name); return; }
  def.order = def.order ?? 50;
  C.modules.push(def);
};
let sorted = [];
const FLAVOR = ['putting the kettle on…', 'fluffing the cushions…', 'stacking firewood…', 'lighting the lamps…', 'finding the good blanket…',
  'waking the cat (gently)…', 'listening to the rain…', 'brewing tea…', 'dusting the bookshelves…', 'drawing the curtains…', 'warming the teapot…'];
C.boot = async () => {
  if (C._booting) return;
  C._booting = true;
  sorted = C.modules.slice().sort((a, b) => a.order - b.order);
  const msgEl = document.querySelector('#boot-loading .msg');
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (msgEl) msgEl.textContent = FLAVOR[i % FLAVOR.length];
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    try { if (m.init) await m.init(C); } catch (e) { m._failed = true; reportError(m, 'init', e); }
    m.initMs = performance.now() - t0;
  }
  let hasLight = false;
  scene.traverse(o => { if (o.isLight) hasLight = true; });
  if (!hasLight) { const h = new THREE.HemisphereLight(0xdde6ff, 0x554433, 1.2); h.name = 'core.fallbackLight'; scene.add(h); const d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(5, 10, 4); scene.add(d); }
  const cam = params.get('cam');
  if (cam) { const v = cam.split(',').map(Number); if (v.length >= 3 && v.every(n => isFinite(n))) C.debug.setView(v[0], v[1], v[2], v[3] || 0, v[4] || 0, true); }
  if (params.get('colliders') === '1') physics.debugDraw(true);
  if (params.get('freecam') === '1' && C.player.mode !== 'noclip') C.player.mode = 'noclip';
  applyCamera();
  try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  const loading = document.getElementById('boot-loading');
  if (loading) { loading.classList.add('hidden'); setTimeout(() => loading.remove(), 1000); }
  C.ready = true;
  C.emit('ready');
  if (AUTOSTART) C.start({ auto: true });
  else if (!C.ui) {
    // minimal fallback when no UI module is present
    const go = () => { renderer.domElement.removeEventListener('click', go); C.start(); };
    renderer.domElement.addEventListener('click', go);
  }
  C.clock.getDelta();
  renderer.setAnimationLoop(loop);
};

function applyCamera() {
  const p = C.player;
  if (p.mode === 'noclip') camera.position.copy(p.position);
  else camera.position.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function loop() {
  const raw = C.clock.getDelta();
  const dt = Math.min(raw, 0.05);
  C.time += dt;
  C.frame++;
  C.debug.frames = C.frame;
  renderer.info.reset();
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (!m.update || m._failed || m._disabled) continue;
    try { m.update(dt, C.time, C); }
    catch (e) { m._errCount = (m._errCount || 0) + 1; reportError(m, 'update', e); if (m._errCount > 20) m._disabled = true; }
  }
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (!m.lateUpdate || m._failed || m._disabled) continue;
    try { m.lateUpdate(dt, C.time, C); }
    catch (e) { m._errCount = (m._errCount || 0) + 1; reportError(m, 'lateUpdate', e); if (m._errCount > 20) m._disabled = true; }
  }
  if (!C.player.cameraOwner) applyCamera();
  updateInteraction();
  if (C.renderOverride) {
    try { C.renderOverride(dt); } catch (e) { reportError({ name: 'renderOverride' }, 'render', e); C.renderOverride = null; }
  } else renderer.render(scene, camera);
  lastCalls = renderer.info.render.calls; lastTris = renderer.info.render.triangles;
  // fps + waiters + overlay
  fpsFrames++; fpsTime += raw;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0;
    if (debugOverlayOn) {
      const p = C.player.position;
      hudDebug.textContent = `fps ${fps.toFixed(0)}  calls ${lastCalls}  tris ${(lastTris / 1000).toFixed(0)}k\n` +
        `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  yaw ${C.player.yaw.toFixed(2)}\n` +
        `room ${C.world.roomAt(p.x, p.y + 0.5, p.z)}  mode ${C.player.mode}  ${C.env.preset} rain ${C.env.rain.toFixed(2)}`;
    }
  }
  for (let i = frameWaiters.length - 1; i >= 0; i--) if (C.frame >= frameWaiters[i].at) { frameWaiters[i].r(); frameWaiters.splice(i, 1); }
}
C._applyCamera = applyCamera;

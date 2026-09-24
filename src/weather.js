// =====================================================================================================================
//  WEATHER — sky, fog, sky light, time of day, rain, drips, splashes, lightning, chimney smoke, rain-on-glass.
//  (SPEC §9 weather, §3.10, §4.8, §5)                                                              module order 30
// ---------------------------------------------------------------------------------------------------------------------
//  Public API  (C.weather)
//    setPreset(name, {instant, silent})   'afternoon' | 'dusk' | 'night'   (T key cycles; ?time=)
//    cycleTime()                          afternoon → dusk → night → afternoon (toast + 'timeofday' event)
//    setRain(level, {instant, silent})    0..1 (0 = dry). Presets: drizzle 0.35, rain 0.7, storm 1.0 (?rain=)
//    cycleRain()                          drizzle → rain → storm → drizzle (toast + 'rain' event)
//    lightning({strength, distance, dirX, dirZ, bolt})   trigger a strike now (also C.debug.lightning(opts))
//    setLightningEnabled(bool)            random strikes on/off (?lightning=0 disables them)
//    applyGlass(mesh) / refreshGlass()    put the rain-on-glass shader on a pane (all of C.house.glassPanes are
//                                         picked up automatically at init, on 'ready' and when the list grows)
//    get preset / get rain / presets / rainLevels / lights {hemi, dir, window[]} / uniforms (shared, read-only)
//  Writes every frame: C.env.preset, daylight (smoothed 0..1), rain (smoothed 0..1), wind {x,z} (same object,
//    m/s-ish, gusty), lightningFlash (0..1+), indoor (smoothed C.world.indoorAmount at the camera).
//  Events emitted: 'timeofday' {preset, daylight(target)}, 'rain' {level}, 'lightning' {strength, distance(km), dirX,
//    dirZ} (+ on 'ready' one 'timeofday' and one 'rain' so listeners can sync). Consumed: 'teleport', 'settings', 'ready'.
//  Draw calls: sky 1, rain 1, splashes 1 (ground + drip + downspout splashes), drips 1 (eaves, porch roof, downspout
//    gushes), smoke 1, bolt 1 (only while a bolt is visible), + 1 per glass pane (house meshes, material swapped).
//  Rain/splash occlusion = GLSL copy of the SPEC §4.8 occluders (identical to C.world.isUnderRoof).
// =====================================================================================================================
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
const C = window.COZY;

// ---------------------------------------------------------------------------------------------------------------------
// Presets (colours are sRGB hex; converted to linear by THREE.Color)
// ---------------------------------------------------------------------------------------------------------------------
const PRESETS = {
  afternoon: {
    daylight: 0.8, toast: 'Afternoon — soft grey light',
    zenith: 0x7f8a98, cloudLight: 0xa3abb6, cloudDark: 0x6c7582, horizon: 0x939ca7, glow: 0x000000,
    fog: 0x939ca7, fogOut: 0.021, fogIn: 0.010,
    hemiSky: 0xc4cfdc, hemiGround: 0x4b4a3f, hemi: 2.1, dirColor: 0xdfe6ef, dir: 1.25,
    winColor: 0xb7c7dc, win: 2.2, rain: 0xb4bdc8, rainBright: 1.1,
  },
  dusk: {
    daylight: 0.45, toast: 'Dusk — the lamps glow warmer',
    zenith: 0x2e3848, cloudLight: 0x4d596b, cloudDark: 0x262e3b, horizon: 0x4f5a6b, glow: 0x0a0806,
    fog: 0x4f5a6b, fogOut: 0.027, fogIn: 0.010,
    hemiSky: 0x7c8eaa, hemiGround: 0x2b2b28, hemi: 1.35, dirColor: 0x9cadc9, dir: 0.5,
    winColor: 0x8ea3c2, win: 1.1, rain: 0x8390a3, rainBright: 1.0,
  },
  night: {
    daylight: 0.1, toast: 'Night — rain in the dark',
    zenith: 0x080b12, cloudLight: 0x1a2130, cloudDark: 0x0b0e15, horizon: 0x1b2230, glow: 0x1c1208,
    fog: 0x1b2230, fogOut: 0.03, fogIn: 0.010,
    hemiSky: 0x40527a, hemiGround: 0x121212, hemi: 0.55, dirColor: 0x6c83b5, dir: 0.14,
    winColor: 0x4a5f88, win: 0.25, rain: 0x4c5870, rainBright: 0.8,
  },
};
const PRESET_ORDER = ['afternoon', 'dusk', 'night'];
const RAIN_LEVELS = [
  { name: 'drizzle', level: 0.35, toast: 'A soft drizzle' },
  { name: 'rain', level: 0.7, toast: 'Steady rain' },
  { name: 'storm', level: 1.0, toast: 'A storm rolls in' },
];
const INDOOR_HEMI = 0.13, INDOOR_DIR = 0.06;         // sky light multipliers when the camera is fully indoors
const GROUND_Y = -0.45;
const OUTLETS = [[7.1, -5.15], [-7.1, -5.15], [7.1, 5.15], [-7.1, 5.15]];

// ---------------------------------------------------------------------------------------------------------------------
// GLSL snippets
// ---------------------------------------------------------------------------------------------------------------------
const GLSL_HASH = /* glsl */`
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash21(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash31(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;
// SPEC §4.8 occluders — keep identical to C.world.isUnderRoof
const GLSL_OCCLUDE = /* glsl */`
bool underRoof(vec3 p) {
  vec3 a = abs(p);
  if (a.x <= 7.4 && a.z <= 5.6 && p.y < 7.77 - 0.7 * a.z) return true;
  if (p.x >= -7.9 && p.x <= -7.0 && p.z >= 1.8 && p.z <= 3.2 && p.y < 8.4) return true;
  if (p.x >= 1.0 && p.x <= 7.0 && p.z >= 5.0 && p.z <= 7.4 && p.y < 3.27 - 0.25 * (p.z - 5.0)) return true;
  return false;
}
`;
const HIDE = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

// ---------------------------------------------------------------------------------------------------------------------
C.register({
  name: 'weather',
  order: 30,
  init(C) {
    const U = C.util, P = C.params;
    const root = new THREE.Group(); root.name = 'weather';
    C.scene.add(root);
    const rnd = U.rng(4242);

    // ------------------------------------------------------------------ state
    const startPreset = PRESETS[P.get('time')] ? P.get('time') : 'dusk';
    let rainParam = parseFloat(P.get('rain'));
    const startRain = isFinite(rainParam) ? U.clamp(rainParam, 0, 1) : 0.7;
    const st = {
      preset: startPreset, blendFrom: startPreset, blend: 1,           // preset cross-fade 0..1
      rainTarget: startRain, rain: startRain,
      lightningOn: P.get('lightning') !== '0',
      nextStrike: 18 + rnd() * 20,
      indoor: 1, daylight: PRESETS[startPreset].daylight,
      fire: 1, windPhase: rnd() * 100,
    };
    const env = C.env;
    env.preset = startPreset; env.rain = startRain; env.daylight = st.daylight;
    if (!env.wind) env.wind = { x: 0.35, z: 0.15 };

    // current blended preset values (linear colours)
    const cur = {};
    const colKeys = ['zenith', 'cloudLight', 'cloudDark', 'horizon', 'glow', 'fog', 'hemiSky', 'hemiGround', 'dirColor', 'winColor', 'rain'];
    const numKeys = ['daylight', 'fogOut', 'fogIn', 'hemi', 'dir', 'win', 'rainBright'];
    const presetCols = {};
    for (const k of Object.keys(PRESETS)) {
      presetCols[k] = {};
      for (const c of colKeys) presetCols[k][c] = new THREE.Color(PRESETS[k][c]);
    }
    for (const c of colKeys) cur[c] = new THREE.Color();
    function blendPresets() {
      const a = PRESETS[st.blendFrom], b = PRESETS[st.preset], ca = presetCols[st.blendFrom], cb = presetCols[st.preset];
      const t = st.blend * st.blend * (3 - 2 * st.blend);
      for (const c of colKeys) cur[c].copy(ca[c]).lerp(cb[c], t);
      for (const n of numKeys) cur[n] = a[n] + (b[n] - a[n]) * t;
    }
    blendPresets();

    // ------------------------------------------------------------------ shared uniforms
    const uni = {
      time: { value: 0 }, rain: { value: startRain }, flash: { value: 0 },
      flashDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() }, flashCol: { value: new THREE.Color(0xc9d6ff) },
      fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.02 },
      day: { value: st.daylight }, indoor: { value: 1 },
      pix: { value: 0.001 },
      zenith: { value: cur.zenith }, horizon: { value: cur.horizon }, cloudLight: { value: cur.cloudLight },
      cloudDark: { value: cur.cloudDark }, glow: { value: cur.glow },
    };

    // ------------------------------------------------------------------ fog
    C.scene.fog = new THREE.FogExp2(cur.fog.getHex(), cur.fogOut);
    C.scene.background = cur.horizon.clone();

    // ------------------------------------------------------------------ lights
    const hemi = new THREE.HemisphereLight(cur.hemiSky, cur.hemiGround, cur.hemi);
    hemi.name = 'weather.hemi';
    root.add(hemi);
    const dir = new THREE.DirectionalLight(cur.dirColor, cur.dir);
    dir.name = 'weather.key';
    const DIR_BASE = new THREE.Vector3(-5, 12, 7);
    dir.position.copy(DIR_BASE);
    dir.target.position.set(0, 0, 0);
    root.add(dir, dir.target);
    C.registerLight(hemi, { id: 'sky_hemi', room: 'outside', kind: 'hemisphere' });
    C.registerLight(dir, { id: 'sky_key', room: 'outside', kind: 'directional' });
    // soft cool window light (RectAreaLight) on the big living-room window
    const windowLights = [];
    if (P.get('winlight') !== '0') {
      try {
        RectAreaLightUniformsLib.init();
        const defs = [{ id: 'window_living_s', w: 2.5, h: 1.65, pos: [-3.9, 1.43, 4.72], look: [-3.9, 1.1, 0], k: 1 }];
        for (const d of defs) {
          const l = new THREE.RectAreaLight(cur.winColor, cur.win, d.w, d.h);
          l.position.set(d.pos[0], d.pos[1], d.pos[2]);
          l.lookAt(d.look[0], d.look[1], d.look[2]);
          l.name = 'weather.' + d.id; l.userData.k = d.k;
          root.add(l);
          C.registerLight(l, { id: d.id, room: 'living', kind: 'rectarea' });
          windowLights.push(l);
        }
      } catch (e) { C.log('weather', 'rect lights unavailable', e); }
    }

    // ------------------------------------------------------------------ helpers: quad-particle geometry
    function quadGeometry(n, attrs) {
      // attrs: { name: [itemSize, fn(i, out[]) ] } per-particle values replicated on the 4 corners
      const g = new THREE.BufferGeometry();
      const corner = new Float32Array(n * 8);
      const idx = new Uint32Array(n * 6);
      const cs = [-1, 0, 1, 0, 1, 1, -1, 1];
      for (let i = 0; i < n; i++) {
        corner.set(cs, i * 8);
        const v = i * 4, o = i * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
      }
      g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
      // three needs a position attribute for bookkeeping; the vertex shaders ignore it
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
      const tmp = [0, 0, 0, 0];
      for (const name of Object.keys(attrs)) {
        const [size, fn] = attrs[name];
        const arr = new Float32Array(n * 4 * size);
        for (let i = 0; i < n; i++) {
          fn(i, tmp);
          for (let c = 0; c < 4; c++) for (let k = 0; k < size; k++) arr[(i * 4 + c) * size + k] = tmp[k];
        }
        g.setAttribute(name, new THREE.BufferAttribute(arr, size));
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      return g;
    }
    const OUT_CHUNKS = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

    // =================================================================================================================
    // SKY DOME
    // =================================================================================================================
    const skyMat = new THREE.ShaderMaterial({
      name: 'weather.sky',
      uniforms: {
        uTime: uni.time, uFlash: uni.flash, uFlashDir: uni.flashDir, uFlashCol: uni.flashCol,
        uZenith: uni.zenith, uHorizon: uni.horizon, uCloudLight: uni.cloudLight, uCloudDark: uni.cloudDark, uGlow: uni.glow,
        uOff1: { value: new THREE.Vector2(3.1, 7.7) }, uOff2: { value: new THREE.Vector2(1.3, 2.9) }, uOff3: { value: new THREE.Vector2(5.5, 0.4) },
        uRain: uni.rain,
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
          gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_HASH}
        uniform float uTime, uFlash, uRain;
        uniform vec3 uFlashDir, uFlashCol, uZenith, uHorizon, uCloudLight, uCloudDark, uGlow;
        uniform vec2 uOff1, uOff2, uOff3;
        varying vec3 vDir;
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          float hc = max(h, 0.0);
          vec2 uv = d.xz / (hc + 0.12);
          float big = fbm(uv * 0.16 + uOff1);
          float det = fbm(uv * 0.55 + uOff2 + big * 0.8);
          float scud = fbm(uv * 0.3 + uOff3);
          float dens = clamp(big * 1.05 + det * 0.55 - 0.42 + uRain * 0.12, 0.0, 1.0);
          vec3 cl = mix(uCloudLight, uCloudDark, smoothstep(0.15, 0.85, dens));
          cl = mix(cl, uCloudDark * 0.75, smoothstep(0.5, 0.78, scud) * 0.55);
          cl = mix(cl, uZenith, smoothstep(0.35, 1.0, h) * 0.35);
          vec3 col = mix(uHorizon, cl, smoothstep(0.0, 0.3, h));
          col += uGlow * exp(-hc * 9.0);
          // lightning: clouds lit from inside around the strike direction + general sky brightening
          float fd = max(dot(d, uFlashDir), 0.0);
          float g = pow(fd, 10.0) * (0.5 + 1.8 * dens) + pow(fd, 3.0) * 0.35 + 0.1;
          col += uFlashCol * uFlash * g * (0.6 + 0.8 * det);
          gl_FragColor = vec4(col, 1.0);
          ${OUT_CHUNKS}
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat);
    sky.name = 'weather.sky'; sky.frustumCulled = false; sky.renderOrder = -1000;
    sky.userData.dynamic = true;
    root.add(sky);

    // =================================================================================================================
    // RAIN STREAKS
    // =================================================================================================================
    const RAIN_MAX = 12000;
    const BOX = new THREE.Vector3(26, 14, 26);
    const rainGeo = quadGeometry(RAIN_MAX, { aSeed: [4, (i, o) => { o[0] = rnd(); o[1] = rnd(); o[2] = rnd(); o[3] = rnd(); }] });
    const rainOffsets = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const rainLPos = [new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0), new THREE.Vector3(0, -999, 0)];
    const rainLCol = [new THREE.Color(0), new THREE.Color(0), new THREE.Color(0), new THREE.Color(0)];
    const rainMat = new THREE.ShaderMaterial({
      name: 'weather.rain',
      uniforms: {
        uOff: { value: rainOffsets }, uBox: { value: BOX }, uBottom: { value: -1 },
        uDir: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 0.45 }, uWidth: { value: 0.01 },
        uPix: uni.pix, uOpacity: { value: 0.3 }, uAmb: { value: new THREE.Color(0.1, 0.1, 0.1) },
        uLPos: { value: rainLPos }, uLCol: { value: rainLCol },
        uFogColor: uni.fogColor, uFogDensity: uni.fogDensity,
      },
      vertexShader: /* glsl */`
        ${GLSL_OCCLUDE}
        attribute vec4 aSeed;
        attribute vec2 aCorner;
        uniform vec3 uOff[4];
        uniform vec3 uBox, uDir, uAmb, uFogColor;
        uniform float uBottom, uLen, uWidth, uPix, uOpacity, uFogDensity;
        uniform vec3 uLPos[4];
        uniform vec3 uLCol[4];
        varying vec2 vUv; varying float vA; varying vec3 vCol;
        void main() {
          int k = int(aSeed.w * 3.999);
          vec3 p = aSeed.xyz * uBox + uOff[k];
          vec3 h;
          h.xz = cameraPosition.xz + mod(p.xz - cameraPosition.xz + 0.5 * uBox.xz, uBox.xz) - 0.5 * uBox.xz;
          h.y = uBottom + mod(p.y - uBottom, uBox.y);
          float r2 = fract(aSeed.w * 37.17);
          float len = uLen * (0.6 + 0.8 * r2) * (0.85 + 0.1 * float(k));
          vec3 pos = h - uDir * (len * aCorner.y);
          vec3 toCam = cameraPosition - pos;
          float dist = length(toCam);
          vec3 side = normalize(cross(uDir, toCam));
          float w = uWidth * (0.6 + 0.8 * fract(aSeed.w * 91.3));
          float px = dist * uPix * 1.2;
          float we = max(w, px);
          float a = w / we;
          pos += side * (aCorner.x * 0.5 * we);
          float hd = length(h.xz - cameraPosition.xz);
          a *= 1.0 - smoothstep(0.34 * uBox.x, 0.5 * uBox.x, hd);
          a *= smoothstep(0.3, 1.6, dist);
          float fy = (h.y - uBottom) / uBox.y;
          a *= smoothstep(0.0, 0.05, fy) * (1.0 - smoothstep(0.82, 1.0, fy));
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          vec3 col = uAmb;
          for (int i = 0; i < 4; i++) { vec3 d = uLPos[i] - h; col += uLCol[i] / (0.3 + dot(d, d)); }
          col = mix(col, uFogColor, ff * 0.7);
          a *= 1.0 - ff * 0.5;
          vA = a * uOpacity; vCol = col; vUv = aCorner;
          if (h.y < ${GROUND_Y.toFixed(2)} || vA < 0.002 || underRoof(h)) { ${HIDE} return; }
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vCol;
        void main() {
          float x = vUv.x;
          float edge = 1.0 - x * x;
          float l = smoothstep(0.0, 0.08, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.8);
          float a = vA * edge * l;
          gl_FragColor = vec4(vCol, a);
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const rain = new THREE.Mesh(rainGeo, rainMat);
    rain.name = 'weather.rain'; rain.frustumCulled = false; rain.renderOrder = 10;
    rain.userData.dynamic = true;
    root.add(rain);

    // =================================================================================================================
    // DRIPS (eaves, porch roof front edge, downspout gushes) — ballistic particles, one draw call
    // =================================================================================================================
    const drips = []; // [ox, oy, oz, landY, vx, vy, vz, hang, period, phase, size, threshold, kind]
    const G = 9.8;
    // main eaves (north full length; south except above the porch roof x 1.0..7.0)
    for (const zs of [-1, 1]) {
      for (let x = -7.35; x <= 7.35; x += 0.11) {
        if (zs > 0 && x > 0.95 && x < 7.05) continue;
        const jx = x + (rnd() - 0.5) * 0.06;
        drips.push([jx, 3.56, zs * 5.63, GROUND_Y, 0, 0, 0, 0.5 + rnd() * 1.4, 0, 0, 0.012 + rnd() * 0.008, rnd(), 1]);
      }
    }
    // porch roof front edge
    for (let x = 1.05; x <= 6.95; x += 0.09) {
      drips.push([x + (rnd() - 0.5) * 0.05, 2.57, 7.44, GROUND_Y, 0, 0, 0, 0.4 + rnd() * 1.2, 0, 0, 0.012 + rnd() * 0.008, rnd(), 1]);
    }
    const nDripsEave = drips.length;
    // downspout gushes: outlets at (±7.1, −0.3, ±5.15) — spill away from the house along z (splash blocks)
    for (const [ox, oz] of OUTLETS) {
      const sz = Math.sign(oz), sx = Math.sign(ox);
      for (let i = 0; i < 70; i++) {
        const sp = 0.55 + rnd() * 0.45;
        drips.push([ox + (rnd() - 0.5) * 0.04, -0.3 + (rnd() - 0.5) * 0.02, oz + sz * 0.05, GROUND_Y + 0.05,
          (rnd() - 0.5) * 0.18 + sx * 0.03, 0.05 + rnd() * 0.1, sz * sp, 0, 0.24 + rnd() * 0.12, 0, 0.018 + rnd() * 0.01, rnd(), 2]);
      }
    }
    for (const d of drips) {
      const [, oy, , landY, , vy, , hang] = d;
      // fall time from oy to landY with initial vy (up positive): landY = oy + vy t − g t²/2
      const h = oy - landY;
      const tf = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
      d.fall = tf;
      if (d[12] === 1) d[8] = hang + tf + 0.1 + rnd() * 1.6;      // eave drip period (bead grows, falls, pause)
      d[9] = rnd() * 50;
    }
    const DRIP_N = drips.length;
    const dripGeo = quadGeometry(DRIP_N, {
      aOrig: [4, (i, o) => { const d = drips[i]; o[0] = d[0]; o[1] = d[1]; o[2] = d[2]; o[3] = d[3]; }],
      aVel: [4, (i, o) => { const d = drips[i]; o[0] = d[4]; o[1] = d[5]; o[2] = d[6]; o[3] = d[7]; }],
      aTime: [4, (i, o) => { const d = drips[i]; o[0] = d[8]; o[1] = d[9]; o[2] = d[10]; o[3] = d[11]; }],
      aKind: [1, (i, o) => { o[0] = drips[i][12]; }],
    });
    const dripMat = new THREE.ShaderMaterial({
      name: 'weather.drips',
      uniforms: {
        uTime: uni.time, uPix: uni.pix, uAmb: { value: new THREE.Color() }, uEave: { value: 0.7 }, uGush: { value: 0.7 },
        uFogColor: uni.fogColor, uFogDensity: uni.fogDensity, uLPos: { value: rainLPos }, uLCol: { value: rainLCol },
      },
      vertexShader: /* glsl */`
        attribute vec4 aOrig, aVel, aTime;
        attribute float aKind;
        attribute vec2 aCorner;
        uniform float uTime, uPix, uEave, uGush, uFogDensity;
        uniform vec3 uAmb, uFogColor;
        uniform vec3 uLPos[4];
        uniform vec3 uLCol[4];
        varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vBead;
        void main() {
          float actv = aKind < 1.5 ? uEave : uGush;
          float P = aTime.x;
          float lt = fract((uTime + aTime.y) / P) * P;
          float H = aVel.w;
          float size = aTime.z;
          vec3 c, dir; float len; float bead = 0.0; float a = 1.0;
          if (lt < H) {                                  // bead growing on the edge
            float g = lt / H;
            size *= 0.45 + 0.55 * g;
            c = aOrig.xyz - vec3(0.0, size * 0.9, 0.0);
            dir = vec3(0.0, -1.0, 0.0); len = size * 1.7; bead = 1.0; a = 0.55 + 0.45 * g;
          } else {
            float ft = lt - H;
            vec3 v = aVel.xyz + vec3(0.0, -9.8 * ft, 0.0);
            c = aOrig.xyz + aVel.xyz * ft + vec3(0.0, -4.9 * ft * ft, 0.0);
            float sp = length(v);
            dir = v / max(sp, 1e-3);
            len = size * 2.0 + sp * (aKind < 1.5 ? 0.045 : 0.06);
            if (c.y < aOrig.w) a = 0.0;
          }
          vec3 pos = c - dir * (len * aCorner.y);
          vec3 toCam = cameraPosition - pos;
          float dist = length(toCam);
          vec3 side = normalize(cross(dir, toCam));
          float w = size * (bead > 0.5 ? 1.4 : 0.8);
          float px = dist * uPix * 1.3;
          float we = max(w, px);
          a *= w / we;
          pos += side * (aCorner.x * 0.5 * we);
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          vec3 col = uAmb;
          for (int i = 0; i < 4; i++) { vec3 d = uLPos[i] - c; col += uLCol[i] * 1.5 / (0.3 + dot(d, d)); }
          vCol = mix(col, uFogColor, ff * 0.8);
          vA = a * (1.0 - ff * 0.6) * (aKind < 1.5 ? 0.75 : 0.5);
          vUv = aCorner; vBead = bead;
          if (aTime.w > actv || vA < 0.003) { ${HIDE} return; }
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vBead;
        void main() {
          float a;
          vec3 col = vCol;
          if (vBead > 0.5) {
            vec2 q = vec2(vUv.x, (vUv.y - 0.5) * 2.0);
            float r = length(q);
            a = smoothstep(1.0, 0.6, r);
            col *= 1.0 + 1.2 * smoothstep(0.5, 0.0, length(q - vec2(-0.3, -0.4)));
          } else {
            float edge = 1.0 - vUv.x * vUv.x;
            a = edge * smoothstep(0.0, 0.1, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.6);
          }
          gl_FragColor = vec4(col, a * vA);
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const dripMesh = new THREE.Mesh(dripGeo, dripMat);
    dripMesh.name = 'weather.drips'; dripMesh.frustumCulled = false; dripMesh.renderOrder = 9;
    dripMesh.userData.dynamic = true;
    root.add(dripMesh);

    // =================================================================================================================
    // SPLASHES (random ground splashes around the camera + drip / gush landing splashes)
    // =================================================================================================================
    const SPLASH_RANDOM = 1400;
    const fixedSplashes = [];
    for (let i = 0; i < DRIP_N; i++) {
      const d = drips[i];
      if (d[12] === 2 && (i % 5) !== 0) continue;      // one splash slot per 5 gush particles
      const ft = d.fall;
      const lx = d[0] + d[4] * ft, lz = d[2] + d[6] * ft;
      fixedSplashes.push({ x: lx, y: d[3] + (d[12] === 2 ? -0.02 : 0), z: lz, period: d[8], phase: d[9], delay: d[7] + ft,
        size: d[12] === 2 ? 0.1 : 0.07, thr: d[11], kind: d[12] });
    }
    const SPLASH_N = SPLASH_RANDOM + fixedSplashes.length;
    const splashGeo = quadGeometry(SPLASH_N, {
      aSeed: [4, (i, o) => { o[0] = rnd(); o[1] = rnd(); o[2] = rnd(); o[3] = rnd(); }],
      aFix: [4, (i, o) => {
        if (i < SPLASH_RANDOM) { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 0; return; }
        const f = fixedSplashes[i - SPLASH_RANDOM]; o[0] = f.x; o[1] = f.y; o[2] = f.z; o[3] = f.kind;
      }],
      aTime: [4, (i, o) => {
        if (i < SPLASH_RANDOM) { o[0] = 0.45 + rnd() * 0.5; o[1] = rnd() * 40; o[2] = 0; o[3] = 0.05 + rnd() * 0.05; return; }
        const f = fixedSplashes[i - SPLASH_RANDOM]; o[0] = f.period; o[1] = f.phase; o[2] = f.delay; o[3] = f.size;
      }],
      aThr: [1, (i, o) => { o[0] = i < SPLASH_RANDOM ? rnd() : fixedSplashes[i - SPLASH_RANDOM].thr; }],
    });
    const splashMat = new THREE.ShaderMaterial({
      name: 'weather.splash',
      uniforms: {
        uTime: uni.time, uPix: uni.pix, uAmb: { value: new THREE.Color() }, uRandom: { value: 0.7 }, uEave: { value: 0.7 },
        uGush: { value: 0.7 }, uRadius: { value: 13 }, uFogColor: uni.fogColor, uFogDensity: uni.fogDensity,
        uLPos: { value: rainLPos }, uLCol: { value: rainLCol },
      },
      vertexShader: /* glsl */`
        ${GLSL_HASH}
        ${GLSL_OCCLUDE}
        attribute vec4 aSeed, aFix, aTime;
        attribute float aThr;
        attribute vec2 aCorner;
        uniform float uTime, uPix, uRandom, uEave, uGush, uRadius, uFogDensity;
        uniform vec3 uAmb, uFogColor;
        uniform vec3 uLPos[4];
        uniform vec3 uLCol[4];
        varying vec2 vQ; varying float vTau; varying float vA; varying vec3 vCol; varying vec2 vRnd;
        void main() {
          float P = aTime.x;
          float cyc = (uTime + aTime.y) / P;
          float ci = floor(cyc);
          float lt = fract(cyc) * P - aTime.z;
          float life = aFix.w > 1.5 ? 0.22 : 0.3;
          float tau = lt / life;
          vec3 c;
          float actv;
          if (aFix.w < 0.5) {
            vec2 r = hash21(ci * 17.31 + aSeed.x * 911.7);
            float rad = uRadius * sqrt(r.x);
            float an = r.y * 6.2831853;
            c = vec3(cameraPosition.x + cos(an) * rad, ${GROUND_Y.toFixed(2)}, cameraPosition.z + sin(an) * rad);
            actv = uRandom;
            if (underRoof(c + vec3(0.0, 0.12, 0.0)) || c.x < -15.4 || c.x > 15.4 || c.z < -12.4 || c.z > 23.4) actv = -1.0;
            vRnd = r;
          } else {
            c = aFix.xyz;
            actv = aFix.w < 1.5 ? uEave : uGush;
            vRnd = aSeed.xy;
          }
          vec3 toCam = cameraPosition - c;
          float dist = length(toCam);
          vec3 fwd = vec3(toCam.x, 0.0, toCam.z);
          fwd = length(fwd) > 1e-3 ? normalize(fwd) : vec3(0.0, 0.0, 1.0);
          vec3 right = vec3(fwd.z, 0.0, -fwd.x);
          float size = aTime.w;
          float px = dist * uPix * 2.5;
          float se = max(size, px);
          float a = pow(max(size / se, 0.0), 1.5);
          vec3 pos = c + right * (aCorner.x * se) + vec3(0.0, aCorner.y * se, 0.0) + fwd * 0.02;
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          vec3 col = uAmb;
          for (int i = 0; i < 4; i++) { vec3 d = uLPos[i] - c; col += uLCol[i] * 1.5 / (0.3 + dot(d, d)); }
          vCol = mix(col, uFogColor, ff * 0.8);
          a *= (1.0 - ff * 0.7) * (1.0 - smoothstep(uRadius * 0.7, uRadius, dist));
          vA = a; vQ = aCorner; vTau = tau;
          if (tau < 0.0 || tau > 1.0 || aThr > actv || a < 0.004) { ${HIDE} return; }
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vQ; varying float vTau; varying float vA; varying vec3 vCol; varying vec2 vRnd;
        void main() {
          float tau = vTau;
          vec2 q = vQ;
          float e = length(vec2(q.x, (q.y - 0.05) * 5.0));
          float ring = smoothstep(0.14, 0.0, abs(e - (0.2 + 0.8 * tau))) * (1.0 - tau) * 0.6;
          float dots = 0.0;
          for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float ang = (fi + 0.5 + (vRnd.x - 0.5) * 0.6) / 5.0 * 3.14159;
            float sp = 0.75 + 0.5 * fract(vRnd.y * 7.0 + fi * 0.37);
            vec2 s = vec2(cos(ang) * (0.15 + 0.8 * tau) * sp, 0.04 + sin(ang) * (2.6 * tau - 2.6 * tau * tau) * sp);
            dots += smoothstep(0.14, 0.03, length(q - s));
          }
          dots *= 1.0 - tau * tau;
          float a = clamp(max(ring, dots), 0.0, 1.0) * vA;
          gl_FragColor = vec4(vCol, a);
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const splash = new THREE.Mesh(splashGeo, splashMat);
    splash.name = 'weather.splash'; splash.frustumCulled = false; splash.renderOrder = 8;
    splash.userData.dynamic = true;
    root.add(splash);

    // =================================================================================================================
    // CHIMNEY SMOKE
    // =================================================================================================================
    const SMOKE_N = 44;
    const smokeGeo = quadGeometry(SMOKE_N, { aSeed: [4, (i, o) => { o[0] = i / SMOKE_N; o[1] = rnd(); o[2] = rnd(); o[3] = rnd(); }] });
    const smokeWind = new THREE.Vector2(0.4, 0.2);
    const smokeMat = new THREE.ShaderMaterial({
      name: 'weather.smoke',
      uniforms: {
        uTime: uni.time, uLevel: { value: 1 }, uOrigin: { value: new THREE.Vector3(-7.45, 8.5, 2.5) }, uWind: { value: smokeWind },
        uCol: { value: new THREE.Color() }, uFogColor: uni.fogColor, uFogDensity: uni.fogDensity, uFlash: uni.flash, uFlashCol: uni.flashCol,
      },
      vertexShader: /* glsl */`
        attribute vec4 aSeed;
        attribute vec2 aCorner;
        uniform float uTime, uLevel, uFogDensity;
        uniform vec3 uOrigin;
        uniform vec2 uWind;
        varying vec2 vUv; varying float vA; varying float vFog; varying vec2 vSeed; varying float vLife;
        void main() {
          float PER = 10.0;
          float lt = fract(uTime / PER + aSeed.x);
          float age = lt * PER;
          vec3 c = uOrigin;
          c.xz += uWind * age * (0.55 + 0.5 * aSeed.y);
          c.y += age * (0.42 + 0.2 * aSeed.z) - age * age * 0.008;
          c.x += sin(uTime * 0.6 + aSeed.y * 20.0) * 0.12 * age;
          c.z += cos(uTime * 0.5 + aSeed.z * 17.0) * 0.12 * age;
          float size = 0.35 + age * 0.34;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float an = aSeed.w * 6.2831 + age * 0.15;
          vec2 q = vec2(aCorner.x, aCorner.y * 2.0 - 1.0);
          vec2 rq = vec2(q.x * cos(an) - q.y * sin(an), q.x * sin(an) + q.y * cos(an));
          vec3 pos = c + (right * rq.x + up * rq.y) * size;
          float dist = length(cameraPosition - c);
          vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          vA = uLevel * smoothstep(0.0, 0.06, lt) * pow(clamp(1.0 - lt, 0.0, 1.0), 1.4) * 0.42;
          vUv = q; vSeed = aSeed.yz; vLife = lt;
          if (vA < 0.002) { ${HIDE} return; }
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_HASH}
        uniform vec3 uCol, uFogColor, uFlashCol;
        uniform float uFlash;
        varying vec2 vUv; varying float vA; varying float vFog; varying vec2 vSeed; varying float vLife;
        void main() {
          float r = length(vUv);
          float n = vnoise(vUv * 2.2 + vSeed * 40.0) * 0.6 + vnoise(vUv * 5.0 + vSeed * 13.0) * 0.4;
          float a = smoothstep(1.0, 0.15, r) * (0.45 + 0.75 * n) * vA;
          vec3 col = uCol * (0.85 + 0.3 * n) + uFlashCol * uFlash * 0.3;
          col = mix(col, uFogColor, vFog);
          gl_FragColor = vec4(col, a * (1.0 - vFog * 0.5));
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const smoke = new THREE.Mesh(smokeGeo, smokeMat);
    smoke.name = 'weather.smoke'; smoke.frustumCulled = false; smoke.renderOrder = 7;
    smoke.userData.dynamic = true;
    root.add(smoke);

    // =================================================================================================================
    // LIGHTNING BOLT (ribbon geometry regenerated per strike into preallocated buffers)
    // =================================================================================================================
    const BOLT_SEGS = 180;
    const boltPos = new Float32Array(BOLT_SEGS * 6 * 3);
    const boltUv = new Float32Array(BOLT_SEGS * 6 * 2);
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    boltGeo.setAttribute('uv', new THREE.BufferAttribute(boltUv, 2).setUsage(THREE.DynamicDrawUsage));
    boltGeo.setDrawRange(0, 0);
    boltGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const boltMat = new THREE.ShaderMaterial({
      name: 'weather.bolt',
      uniforms: { uA: { value: 0 }, uCol: uni.flashCol },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform float uA; uniform vec3 uCol; varying vec2 vUv;
        void main() {
          float x = abs(vUv.x);
          float core = smoothstep(0.35, 0.0, x);
          float glow = (1.0 - x) * (1.0 - x) * 0.35;
          float a = (core * 1.0 + glow) * uA * vUv.y;
          gl_FragColor = vec4(uCol * (1.0 + core * 3.0) * a, a);
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    });
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.name = 'weather.bolt'; bolt.frustumCulled = false; bolt.visible = false; bolt.renderOrder = -900;
    bolt.userData.dynamic = true;
    root.add(bolt);

    const _bp = [];                   // reusable point list for bolt generation (allocated once)
    for (let i = 0; i < 80; i++) _bp.push(new THREE.Vector3());
    const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
    let boltVerts = 0;
    function makeBolt(dirX, dirZ, distM) {
      boltVerts = 0;
      const cam = C.camera.position;
      const bx = cam.x + dirX * distM, bz = cam.z + dirZ * distM;
      const top = 70 + rnd() * 40, bottom = -5;
      const n = 40;
      // main channel: random walk downwards
      const px = -dirZ, pz = dirX;             // perpendicular (screen-horizontal) direction
      let off = 0;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        off += (rnd() - 0.5) * 9;
        _bp[i].set(bx + px * off + dirX * (rnd() - 0.5) * 4, top + (bottom - top) * t, bz + pz * off + dirZ * (rnd() - 0.5) * 4);
      }
      ribbonFrom(0, n, 1.2 + distM / 400, 1.0, cam);
      // branches
      const nb = 2 + Math.floor(rnd() * 3);
      for (let b = 0; b < nb; b++) {
        const si = 4 + Math.floor(rnd() * 22);
        const m = 12;
        const side = rnd() < 0.5 ? -1 : 1;
        const s0 = _bp[si];
        _v4.copy(s0);
        let o = 0;
        for (let i = 0; i < m; i++) {
          o += (0.4 + rnd()) * 3.5 * side;
          _bp[n + i].set(_v4.x + px * o, _v4.y - i * (2 + rnd() * 3), _v4.z + pz * o);
        }
        ribbonFrom(n, m, 0.55 + distM / 800, 0.7, cam);
      }
      boltGeo.setDrawRange(0, boltVerts);
      boltGeo.attributes.position.needsUpdate = true;
      boltGeo.attributes.uv.needsUpdate = true;
    }
    const _P6 = [0, -1, 0, 0, 1, 0, 1, 1, 1, 0, -1, 0, 1, 1, 1, 1, -1, 1];   // (end, side, end) per ribbon vertex
    function ribbonFrom(start, m, width, bright, cam) {
      for (let i = 0; i < m - 1 && boltVerts + 6 <= BOLT_SEGS * 6; i++) {
        const a = _bp[start + i], b = _bp[start + i + 1];
        _v1.subVectors(b, a); _v2.subVectors(cam, a);
        _v3.crossVectors(_v1, _v2).normalize().multiplyScalar(width * (1 - 0.5 * i / m));
        for (let k = 0; k < 18; k += 3) {
          const pt = _P6[k] ? b : a, s = _P6[k + 1], y = bright * (0.55 + 0.45 * (1 - (i + _P6[k + 2]) / (m - 1)));
          boltPos[boltVerts * 3] = pt.x + _v3.x * s; boltPos[boltVerts * 3 + 1] = pt.y + _v3.y * s; boltPos[boltVerts * 3 + 2] = pt.z + _v3.z * s;
          boltUv[boltVerts * 2] = s; boltUv[boltVerts * 2 + 1] = y;
          boltVerts++;
        }
      }
    }

    // lightning flash state (pulses preallocated)
    const pulses = [{ t0: -99, amp: 0, dur: 0.1 }, { t0: -99, amp: 0, dur: 0.1 }, { t0: -99, amp: 0, dur: 0.1 }, { t0: -99, amp: 0, dur: 0.1 }];
    let boltUntil = -1, boltStrength = 0;
    const strikePayload = { strength: 0, distance: 0, dirX: 0, dirZ: 0 };
    function strike(opts = {}) {
      const t = C.time;
      const strength = U.clamp(opts.strength !== undefined ? opts.strength : 0.35 + rnd() * 0.65, 0, 1);
      const distance = opts.distance !== undefined ? opts.distance : U.lerp(4.5, 0.6, strength) * (0.8 + rnd() * 0.4);
      let a = rnd() * Math.PI * 2;
      if (opts.dirX !== undefined && opts.dirZ !== undefined) a = Math.atan2(opts.dirZ, opts.dirX);
      const dirX = Math.cos(a), dirZ = Math.sin(a);
      uni.flashDir.value.set(dirX, 0.25 + rnd() * 0.25, dirZ).normalize();
      const n = 1 + Math.floor(rnd() * 3.5);
      let tt = t;
      for (let i = 0; i < 4; i++) {
        const p = pulses[i];
        if (i < n) { p.t0 = tt; p.amp = strength * (i === 0 ? 1 : 0.5 + rnd() * 0.6); p.dur = 0.06 + rnd() * 0.12; tt += 0.07 + rnd() * 0.16; }
        else p.amp = 0;
      }
      const wantBolt = opts.bolt !== undefined ? !!opts.bolt : (distance < 3.2 && rnd() < 0.55);
      if (wantBolt) {
        makeBolt(dirX, dirZ, 150 + Math.min(distance, 4) * 30);
        boltUntil = tt + 0.05; boltStrength = strength;
      }
      strikePayload.strength = strength; strikePayload.distance = +distance.toFixed(2); strikePayload.dirX = dirX; strikePayload.dirZ = dirZ;
      C.emit('lightning', { strength, distance: strikePayload.distance, dirX, dirZ });
      return strikePayload;
    }
    function flashAt(t) {
      let f = 0;
      for (let i = 0; i < 4; i++) {
        const p = pulses[i];
        if (p.amp <= 0) continue;
        const dt = t - p.t0;
        if (dt < 0) continue;
        const v = p.amp * Math.min(1, dt / 0.015) * Math.exp(-dt / p.dur);
        if (v > f) f = v;
      }
      return f;
    }

    // =================================================================================================================
    // RAIN-ON-GLASS
    // =================================================================================================================
    const glassUni = {
      uTime: uni.time, uRain: uni.rain, uFlash: uni.flash, uFlashCol: uni.flashCol, uDay: uni.day,
      uZenith: uni.zenith, uHorizon: uni.horizon, uFogColor: uni.fogColor, uFogDensity: uni.fogDensity,
      uHaze: { value: new THREE.Color() }, uWarm: { value: new THREE.Color(0xffb46b) }, uIndoor: uni.indoor,
    };
    const glassMat = new THREE.ShaderMaterial({
      name: 'weather.glass',
      uniforms: glassUni,
      vertexShader: /* glsl */`
        varying vec3 vWP, vN, vT, vB;
        varying vec2 vP;
        varying float vSky;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * normal);
          float sky = abs(n.y) > 0.3 ? 1.0 : 0.0;
          if (sky > 0.5) { if (n.y < 0.0) n = -n; }
          else if (dot(n.xz, wp.xz) < 0.0) n = -n;
          vec3 down = vec3(0.0, -1.0, 0.0) - n * (-n.y);
          down = length(down) > 1e-3 ? normalize(down) : vec3(0.0, 0.0, 1.0);
          vec3 tang = normalize(cross(n, down));
          vP = vec2(dot(wp.xyz, tang), -dot(wp.xyz, down));
          vWP = wp.xyz; vN = n; vT = tang; vB = -down; vSky = sky;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        ${GLSL_HASH}
        uniform float uTime, uRain, uFlash, uDay, uFogDensity, uIndoor;
        uniform vec3 uFlashCol, uZenith, uHorizon, uFogColor, uHaze, uWarm;
        varying vec3 vWP, vN, vT, vB;
        varying vec2 vP;
        varying float vSky;
        #define S(a, b, t) smoothstep(a, b, t)
        float Saw(float b, float t) { return S(0.0, b, t) * S(1.0, b, t); }
        // running drops with trails (after BigWings' "Heartfelt"), uv in scaled metres
        vec2 DropLayer(vec2 uv, float t) {
          vec2 UV = uv;
          uv.y += t * 0.75;
          vec2 a = vec2(6.0, 1.0);
          vec2 grid = a * 2.0;
          vec2 id = floor(uv * grid);
          float colShift = hash11(id.x * 7.13 + 3.1);
          uv.y += colShift;
          id = floor(uv * grid);
          vec3 n = hash31(id.x * 35.2 + id.y * 2376.1);
          vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
          float x = n.x - 0.5;
          float y = UV.y * 20.0;
          float wiggle = sin(y + sin(y));
          x += wiggle * (0.5 - abs(x)) * (n.z - 0.5);
          x *= 0.7;
          float ti = fract(t + n.z);
          y = (Saw(0.85, ti) - 0.5) * 0.9 + 0.5;
          vec2 p = vec2(x, y);
          float d = length((st - p) * a.yx);
          float mainDrop = S(0.4, 0.0, d);
          float r = sqrt(S(1.0, y, st.y));
          float cd = abs(st.x - x);
          float trail = S(0.23 * r, 0.15 * r * r, cd);
          float trailFront = S(-0.02, 0.02, st.y - y);
          trail *= trailFront * r * r;
          y = UV.y;
          y = fract(y * 10.0) + (st.y - 0.5);
          float dd = length(st - vec2(x, y));
          float droplets = S(0.3, 0.0, dd);
          float m = mainDrop + droplets * r * trailFront;
          // only a fraction of columns carry a running drop
          m *= step(n.y, 0.75);
          trail *= step(n.y, 0.75);
          return vec2(m, trail);
        }
        float StaticDrops(vec2 uv, float t, float splat) {
          vec2 id = floor(uv);
          uv = fract(uv) - 0.5;
          vec3 n = hash31(id.x * 107.45 + id.y * 3543.654);
          vec2 p = (n.xy - 0.5) * 0.7;
          float d = length(uv - p);
          float ph = fract(t + n.z);
          float fade = Saw(0.025, ph);
          float sz = fract(n.z * 10.0);
          float c = S(0.3, 0.0, d) * sz * fade;
          // skylight splats: a quick ring when the drop lands
          c += splat * S(0.05, 0.0, abs(d - ph * 9.0)) * S(0.04, 0.0, ph) * 0.8;
          return c;
        }
        vec2 Drops(vec2 uv, float t, float l0, float l1, float l2, float splat) {
          float s = StaticDrops(uv * 12.0, t * 0.35, splat) * l0 + StaticDrops(uv * 26.0 + 3.7, t * 0.5, splat) * l0 * 0.6;
          vec2 m1 = DropLayer(uv * 1.1, t) * l1;
          vec2 m2 = DropLayer(uv * 2.0 + 1.3, t * 1.1) * l2;
          float c = s + m1.x + m2.x;
          c = S(0.3, 1.0, c);
          return vec2(c, max(m1.y * l0, m2.y * l1));
        }
        void main() {
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWP);
          float ndv = dot(N, V);
          float outside = step(0.0, ndv);
          float cosT = abs(ndv);
          float sky = vSky;
          float rain = uRain;
          float t = uTime * (sky > 0.5 ? 0.12 : 0.22) + 7.0;
          vec2 uv = vP * 2.4;
          float fw = length(fwidth(vP));
          float detail = 1.0 - S(0.003, 0.012, fw);
          float l0 = S(-0.5, 1.0, rain) * (sky > 0.5 ? 2.2 : 1.6);
          float l1 = S(0.25, 0.75, rain) * (sky > 0.5 ? 0.6 : 1.0);
          float l2 = S(0.0, 0.5, rain);
          float splat = sky * S(0.2, 0.8, rain);
          vec2 c = Drops(uv, t, l0, l1, l2, splat);
          vec2 e = vec2(0.004, 0.0);
          float cx = Drops(uv + e, t, l0, l1, l2, splat).x;
          float cy = Drops(uv + e.yx, t, l0, l1, l2, splat).x;
          vec2 grad = vec2(cx - c.x, cy - c.x) / e.x;
          float m = c.x * detail;
          float trail = c.y * detail;
          vec2 dn = grad * 0.35 * detail;
          float tilt = clamp(length(dn), 0.0, 1.0);
          // droplet surface normal facing the viewer
          vec3 Nv = N * (outside > 0.5 ? 1.0 : -1.0);
          vec3 nd = normalize(Nv * 1.0 - vT * dn.x * (outside > 0.5 ? 1.0 : -1.0) - vB * dn.y);
          // fine misting / micro droplets (average of what can't be resolved)
          float mist = vnoise(vP * 60.0) * 0.5 + vnoise(vP * 23.0) * 0.5;
          float fresnel = 0.04 + 0.96 * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
          vec3 prem; float alpha;
          float flash = uFlash;
          if (outside < 0.5) {
            // ---- seen from inside: dim blue-grey outdoors through a wet pane
            float hazeA = (0.09 + 0.1 * rain) * (1.0 - 0.65 * trail) * (0.8 + 0.4 * mist) + fresnel * 0.4;
            vec3 haze = uHaze;
            // droplets are little lenses: the bright sky appears inverted (bottom of the drop brighter)
            float lensY = clamp(0.5 - dn.y * 0.8, 0.0, 1.0);
            vec3 body = mix(uHaze * 0.55, uZenith * 1.6 + uHaze * 0.9, lensY);
            body = mix(body, uHaze * 0.35, tilt * 0.55);
            float dropA = 0.62 - 0.25 * lensY;
            alpha = mix(hazeA, dropA, m);
            prem = mix(haze * hazeA, body * dropA, m);
            // warm lamp glints from the room behind the viewer + faint room reflection at night
            vec3 L = normalize(V + vB * 0.9 + vT * 0.3);
            float sp = pow(max(dot(nd, L), 0.0), 60.0) * m;
            prem += uWarm * sp * (0.25 + 0.5 * (1.0 - uDay));
            prem += uWarm * 0.012 * (1.0 - uDay) * (1.0 - m);
          } else {
            // ---- seen from outside: dark, reflective glass with the lamp-lit room showing through
            vec3 R = reflect(-V, N);
            vec3 env = mix(uHorizon * 0.9, uZenith * 1.15, S(-0.05, 0.6, R.y));
            env = mix(uHorizon * 0.25, env, S(-0.25, 0.02, R.y));
            float refl = mix(0.12, 0.85, fresnel);
            float baseA = 0.18 + refl * 0.6;
            vec3 base = env * refl;
            float lensY = clamp(0.5 + dn.y * 0.8, 0.0, 1.0);
            vec3 body = mix(env * 0.35, env * 1.25 + uWarm * 0.05 * (1.0 - uDay), lensY);
            float dropA = 0.55;
            alpha = mix(baseA, dropA, m) + trail * 0.02;
            prem = mix(base, body * dropA, m);
            vec3 L = normalize(vec3(0.0, 1.0, 0.0) + V * 0.6);
            float sp = pow(max(dot(nd, L), 0.0), 50.0) * m;
            prem += (uZenith * 3.0 + vec3(0.03)) * sp;
          }
          // lightning lights up the pane and its drops
          prem += uFlashCol * flash * (0.05 + 0.4 * m + 0.1 * trail);
          alpha = clamp(alpha + flash * 0.05, 0.0, 1.0);
          // fog
          float dist = length(cameraPosition - vWP);
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          prem = mix(prem, uFogColor * alpha, ff);
          gl_FragColor = vec4(prem, alpha);
          ${OUT_CHUNKS}
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: true, fog: false,
      extensions: {},
    });
    const glassDone = new WeakSet();
    const glassList = [];
    function applyGlass(mesh) {
      if (!mesh || !mesh.isMesh || glassDone.has(mesh)) return false;
      glassDone.add(mesh);
      mesh.userData.origMaterial = mesh.material;
      if (mesh.geometry && !mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
      mesh.material = glassMat;
      mesh.userData.dynamic = true;
      glassList.push(mesh);
      return true;
    }
    let knownPanes = 0;
    function refreshGlass() {
      const panes = (C.house && C.house.glassPanes) || [];
      for (let i = 0; i < panes.length; i++) applyGlass(panes[i]);
      knownPanes = panes.length;
      return glassList.length;
    }
    refreshGlass();

    // =================================================================================================================
    // rain lights: outdoor point/spot lights make nearby rain glint (collected on 'ready')
    // =================================================================================================================
    const rainLights = [];
    function collectRainLights() {
      rainLights.length = 0;
      const cands = [];
      C.scene.traverse(o => {
        if (!(o.isPointLight || o.isSpotLight)) return;
        if (o.parent === C.camera || o.name === 'flashlight') return;
        o.getWorldPosition(_v1);
        if (C.world.indoorAmount(_v1.x, _v1.y, _v1.z) >= 1) return;
        cands.push({ light: o, pos: _v1.clone() });
      });
      cands.sort((a, b) => b.light.intensity - a.light.intensity);
      for (let i = 0; i < Math.min(4, cands.length); i++) rainLights.push(cands[i]);
    }

    // =================================================================================================================
    // presets / rain API
    // =================================================================================================================
    function setPreset(name, opts = {}) {
      if (!PRESETS[name]) return false;
      if (name === st.preset && !opts.force) return true;
      if (opts.instant) { st.blendFrom = name; st.preset = name; st.blend = 1; }
      else {
        // start the cross-fade from the currently displayed mix
        st.blendFrom = st.blend < 0.5 ? st.blendFrom : st.preset;
        st.preset = name; st.blend = 0;
      }
      env.preset = name;
      if (opts.instant) { blendPresets(); st.daylight = cur.daylight; }
      if (!opts.silent) C.hud.toast(PRESETS[name].toast, 2.6);
      C.emit('timeofday', { preset: name, daylight: PRESETS[name].daylight });
      return true;
    }
    function cycleTime() {
      const i = PRESET_ORDER.indexOf(st.preset);
      setPreset(PRESET_ORDER[(i + 1) % PRESET_ORDER.length]);
      return st.preset;
    }
    function setRain(level, opts = {}) {
      level = U.clamp(+level || 0, 0, 1);
      st.rainTarget = level;
      if (opts.instant) st.rain = level;
      if (!opts.silent) {
        const lv = RAIN_LEVELS.find(r => Math.abs(r.level - level) < 0.01);
        C.hud.toast(lv ? lv.toast : level <= 0 ? 'The rain stops' : `Rain ${(level * 100) | 0}%`, 2.6);
      }
      C.emit('rain', { level });
      return level;
    }
    function cycleRain() {
      const next = RAIN_LEVELS.find(r => r.level > st.rainTarget + 0.01) || RAIN_LEVELS[0];
      setRain(next.level);
      return next.name;
    }
    C.input.onKey('KeyT', () => cycleTime());
    C.input.onKey('KeyR', () => cycleRain());

    C.weather = {
      setPreset, cycleTime, setRain, cycleRain,
      lightning: (opts) => strike(opts || {}),
      setLightningEnabled(on) { st.lightningOn = !!on; if (on) st.nextStrike = C.time + 8 + rnd() * 10; },
      applyGlass, refreshGlass,
      get preset() { return st.preset; },
      get rain() { return st.rainTarget; },
      presets: PRESET_ORDER.slice(), rainLevels: RAIN_LEVELS.map(r => ({ name: r.name, level: r.level })),
      lights: { hemi, dir, window: windowLights },
      uniforms: uni, glassMaterial: glassMat, root,
    };
    C.debug.lightning = (opts) => strike(opts || { strength: 0.9, bolt: true });

    // ------------------------------------------------------------------ events
    C.on('teleport', () => { st.snapIndoor = true; });
    C.on('ready', () => {
      refreshGlass();
      collectRainLights();
      C.emit('timeofday', { preset: st.preset, daylight: PRESETS[st.preset].daylight });
      C.emit('rain', { level: st.rainTarget });
    });
    const qualityFactor = () => (C.settings.quality === 'low' ? 0.4 : C.settings.quality === 'medium' ? 0.75 : 1);

    // ------------------------------------------------------------------ per-frame scratch
    const eye = new THREE.Vector3();
    const tmpC = new THREE.Color();
    const velK = new THREE.Vector3();
    let frameCount = 0;

    this._frame = (dt, t) => {
      frameCount++;
      const p = C.player;
      if (p.mode === 'noclip') eye.copy(p.position);
      else if (p.mode === 'sit' && p.seat && p.seat.position) eye.set(p.seat.position[0], p.seat.position[1], p.seat.position[2]);
      else eye.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);

      // ---- indoor amount
      const target = C.world.indoorAmount(eye.x, eye.y, eye.z);
      if (st.snapIndoor) { st.indoor = target; st.snapIndoor = false; }
      else st.indoor = U.damp(st.indoor, target, 3.5, dt);
      env.indoor = st.indoor;
      const ind = st.indoor;

      // ---- preset blend + daylight
      if (st.blend < 1) { st.blend = Math.min(1, st.blend + dt / 3.5); }
      blendPresets();
      st.daylight = cur.daylight;
      env.daylight = st.daylight;
      env.preset = st.preset;

      // ---- rain level (smoothed) + wind
      st.rain = U.damp(st.rain, st.rainTarget, 1.2, dt);
      if (Math.abs(st.rain - st.rainTarget) < 1e-3) st.rain = st.rainTarget;
      env.rain = st.rain;
      const r = st.rain;
      const windStrength = 0.3 + 1.6 * r * r;
      const gust = 0.75 + 0.45 * U.noise2D(t * 0.13, 3.7) + 0.25 * U.noise2D(t * 0.6, 9.1);
      const wa = 0.4 + 0.35 * U.noise2D(t * 0.02, 1.3);
      env.wind.x = Math.cos(wa) * windStrength * gust;
      env.wind.z = Math.sin(wa) * windStrength * gust;

      // ---- lightning
      if (st.lightningOn && r > 0.2 && t > st.nextStrike) {
        strike({});
        const rate = r > 0.9 ? 1 : r > 0.5 ? 0.45 : 0.15;
        st.nextStrike = t + (10 + rnd() * 26) / rate;
      }
      const flash = flashAt(t);
      env.lightningFlash = flash;
      uni.flash.value = flash;
      if (boltUntil > 0) {
        const vis = t < boltUntil + 0.1;
        bolt.visible = vis;
        boltMat.uniforms.uA.value = vis ? Math.min(1.2, flash * 1.4 + 0.15) * (0.6 + boltStrength * 0.6) : 0;
        if (!vis) boltUntil = -1;
      }

      // ---- fog
      const fogDen = U.lerp(cur.fogOut * (0.85 + 0.25 * r), cur.fogIn, ind);
      C.scene.fog.color.copy(cur.fog);
      C.scene.fog.density = fogDen;
      if (C.scene.background && C.scene.background.isColor) C.scene.background.copy(cur.horizon);
      uni.fogColor.value.copy(cur.fog);
      uni.fogDensity.value = fogDen;
      uni.day.value = st.daylight;
      uni.indoor.value = ind;
      uni.time.value = t % 3600;
      uni.rain.value = r;
      const cam = C.camera;
      uni.pix.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / Math.max(1, C.renderer.domElement.height);

      // ---- lights
      const hemiK = U.lerp(1, INDOOR_HEMI, ind), dirK = U.lerp(1, INDOOR_DIR, ind);
      const flashK = U.lerp(1, 0.35, ind);
      hemi.color.copy(cur.hemiSky).lerp(uni.flashCol.value, Math.min(1, flash * 0.6));
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemi * hemiK + flash * 2.2 * flashK;
      dir.color.copy(cur.dirColor).lerp(uni.flashCol.value, Math.min(1, flash));
      dir.intensity = cur.dir * dirK + flash * 5.0 * flashK;
      const fw = Math.min(1, flash * 2);
      dir.position.set(
        U.lerp(DIR_BASE.x, uni.flashDir.value.x * 12, fw),
        U.lerp(DIR_BASE.y, 8, fw),
        U.lerp(DIR_BASE.z, uni.flashDir.value.z * 12, fw));
      for (const l of windowLights) {
        l.color.copy(cur.winColor).lerp(uni.flashCol.value, Math.min(1, flash));
        l.intensity = cur.win * l.userData.k + flash * 6;
      }

      // ---- sky clouds drift
      const su = skyMat.uniforms;
      su.uOff1.value.x += env.wind.x * dt * 0.004; su.uOff1.value.y += env.wind.z * dt * 0.004;
      su.uOff2.value.x += env.wind.x * dt * 0.012; su.uOff2.value.y += env.wind.z * dt * 0.012;
      su.uOff3.value.x += env.wind.x * dt * 0.03; su.uOff3.value.y += env.wind.z * dt * 0.03;

      // ---- rain streaks
      const speed = U.lerp(4.5, 9.0, U.smoothstep(0.2, 1.0, r));
      const ru = rainMat.uniforms;
      for (let k = 0; k < 4; k++) {
        const sf = 0.85 + 0.1 * k;
        velK.set(env.wind.x * 0.9, -speed * sf, env.wind.z * 0.9).multiplyScalar(dt);
        const o = rainOffsets[k];
        o.add(velK);
        o.x = ((o.x % BOX.x) + BOX.x) % BOX.x; o.y = ((o.y % BOX.y) + BOX.y) % BOX.y; o.z = ((o.z % BOX.z) + BOX.z) % BOX.z;
      }
      ru.uDir.value.set(env.wind.x * 0.9, -speed, env.wind.z * 0.9).normalize();
      ru.uBottom.value = Math.max(GROUND_Y - 0.3, eye.y - 5.5);
      ru.uLen.value = speed * 0.05;
      ru.uWidth.value = U.lerp(0.006, 0.012, r);
      const bright = cur.rainBright;
      tmpC.copy(cur.rain).multiplyScalar(bright).lerp(uni.flashCol.value, Math.min(1, flash * 0.8));
      ru.uAmb.value.copy(tmpC);
      ru.uOpacity.value = U.lerp(0.3, 0.55, r) * U.lerp(1, 0.55, ind) * (1 + flash * 1.5);
      const countFrac = r <= 0.001 ? 0 : U.clamp(0.12 + r * 0.88, 0, 1);
      const rainCount = Math.floor(RAIN_MAX * countFrac * qualityFactor());
      rainGeo.setDrawRange(0, rainCount * 6);
      rain.visible = rainCount > 0;
      rain.renderOrder = ind > 0.75 ? -5 : 10;       // indoors: draw before the glass panes; outdoors: after them
      // outdoor lights that make rain glint
      for (let i = 0; i < 4; i++) {
        const rl = rainLights[i];
        if (rl && rl.light.visible && rl.light.intensity > 0) {
          rainLPos[i].copy(rl.pos);
          rainLCol[i].copy(rl.light.color).multiplyScalar(Math.sqrt(rl.light.intensity) * 0.02);
        } else { rainLPos[i].set(0, -999, 0); rainLCol[i].setRGB(0, 0, 0); }
      }

      // ---- drips & splashes
      const du = dripMat.uniforms;
      du.uAmb.value.copy(tmpC).multiplyScalar(1.3);
      du.uEave.value = r <= 0.001 ? -1 : U.clamp(0.15 + r * 0.95, 0, 1);
      du.uGush.value = r <= 0.001 ? -1 : U.clamp(0.25 + r * 0.8, 0, 1);
      const spu = splashMat.uniforms;
      spu.uAmb.value.copy(tmpC).multiplyScalar(0.8);
      spu.uRandom.value = r <= 0.001 ? -1 : U.clamp(r * 1.05, 0, 1) * qualityFactor();
      spu.uEave.value = du.uEave.value;
      spu.uGush.value = du.uGush.value;
      dripMesh.visible = splash.visible = r > 0.001;

      // ---- chimney smoke
      st.fire = U.damp(st.fire, env.fireLevel > 0 ? U.clamp(env.fireLevel, 0.3, 1) : 0, 0.5, dt);
      smokeMat.uniforms.uLevel.value = st.fire;
      smoke.visible = st.fire > 0.01;
      smokeWind.x = U.damp(smokeWind.x, env.wind.x * 0.6, 0.3, dt);
      smokeWind.y = U.damp(smokeWind.y, env.wind.z * 0.6, 0.3, dt);
      smokeMat.uniforms.uCol.value.copy(cur.cloudLight).multiplyScalar(1.05).lerp(cur.fog, 0.3);

      // ---- glass
      glassUni.uHaze.value.copy(cur.fog).multiplyScalar(0.8).lerp(cur.cloudLight, 0.3);
      if ((frameCount & 63) === 0) {
        const panes = C.house && C.house.glassPanes;
        if (panes && panes.length !== knownPanes) refreshGlass();
        for (let i = 0; i < rainLights.length; i++) rainLights[i].light.getWorldPosition(rainLights[i].pos);
      }
    };
  },
  update(dt, t) { if (this._frame) this._frame(dt, t); },
});

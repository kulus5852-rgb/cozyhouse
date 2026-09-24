// =====================================================================================================================
//  OUTDOOR — terrain, yard, fence + gate, lane, hedges, trees, pond + puddles (rain ripple water), garden structures,
//  streetlamp, porch furniture + porch lantern, distant hills / neighbours.            (SPEC §4.7, §4.8, §4.10, §9)
// =====================================================================================================================
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const C = window.COZY;
const GY = -0.45;                 // outdoor ground level
const TAU = Math.PI * 2;
const GATE_OPEN = -1.62;          // gate swings outward (towards the lane), hinge x = 3.0
const LAMP_ON_BELOW = 0.6;        // daylight threshold for the automatic lamps

let S = null;                     // runtime state (filled by build)

C.register({
  name: 'outdoor',
  order: 40,
  init(C) { build(C); },
  update(dt, t, C) { if (S) tick(dt, t, C); },
});

// ---------------------------------------------------------------------------------------------------------------------
// shared uniforms
// ---------------------------------------------------------------------------------------------------------------------
const SH = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.35, 0.15) } };
const WT = { uTime: SH.uTime, uRain: { value: 0.7 }, uSky: { value: new THREE.Color(0x4b5566) } };

const SWAY_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  float sw = aSway;
  float ph = dot( mvPosition.xz, vec2( 0.173, 0.131 ) );
  float wl = length( uWind );
  float gust = 0.65 + 0.35 * sin( uTime * 0.63 + ph * 0.45 ) * sin( uTime * 0.27 + ph * 0.11 + 1.7 );
  vec2 bend = uWind * uAmp * sw * sw * ( gust + 0.22 * sin( uTime * 1.9 + ph * 2.3 ) );
  vec3 fl = vec3( sin( uTime * 4.3 + ph * 11.0 + mvPosition.y * 3.1 ), 0.6 * sin( uTime * 5.7 + ph * 7.3 ),
                  cos( uTime * 3.9 + ph * 9.1 + mvPosition.y * 2.3 ) );
  mvPosition.xz += bend;
  mvPosition.xyz += fl * uFlutter * sw * ( 0.25 + wl );
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

function makeSway(mat, amp, flutter, keepNormals) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SH.uTime; sh.uniforms.uWind = SH.uWind;
    sh.uniforms.uAmp = { value: amp }; sh.uniforms.uFlutter = { value: flutter };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uAmp;\nuniform float uFlutter;')
      .replace('#include <project_vertex>', SWAY_PROJECT);
    if (keepNormals) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
    }
  };
  mat.customProgramCacheKey = () => 'cozySway' + (keepNormals ? 'N' : '');
  return mat;
}

const WATER_FRAG_HEAD = /* glsl */`
uniform float uTime;
uniform float uRain;
uniform float uSkyAmt;
uniform float uRipAmp;
uniform vec3 uSky;
varying float vEdge;
varying vec3 vWPos;
float oh12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec2 oh22( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
vec2 ripLayer( vec2 p, float cell, float speed, float seed ) {
  vec2 q = p / cell;
  vec2 ip = floor( q );
  vec2 g = vec2( 0.0 );
  for ( int j = -1; j <= 1; j ++ ) {
    for ( int i = -1; i <= 1; i ++ ) {
      vec2 c = ip + vec2( float( i ), float( j ) );
      float ph = oh12( c + seed );
      float tt = uTime * speed + ph;
      float cyc = floor( tt );
      float f = tt - cyc;
      vec2 k = c + vec2( cyc * 7.13, cyc * 3.71 ) + seed;
      if ( oh12( k ) > uRain ) continue;
      vec2 ctr = c + 0.2 + 0.6 * oh22( k );
      vec2 d = q - ctr;
      float r = length( d );
      float x = r - f * 0.72;
      float env = exp( - x * x * 110.0 ) * ( 1.0 - f ) * ( 1.0 - f );
      g += d / max( r, 1e-3 ) * cos( x * 48.0 ) * env;
    }
  }
  return g;
}
vec2 rippleGrad( vec2 p ) {
  vec2 g = ripLayer( p, 0.42, 1.25, 0.0 ) + 0.75 * ripLayer( p + 3.7, 0.3, 1.55, 17.0 );
  g += 0.06 * vec2( sin( p.x * 3.1 + uTime * 1.3 + p.y * 1.7 ), cos( p.y * 2.7 - uTime * 1.1 + p.x * 1.3 ) );
  return g * uRipAmp;
}
`;

function makeWater(color, skyAmt, ripAmp, rough) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.name = 'outdoor.water';
  const u = { uSkyAmt: { value: skyAmt }, uRipAmp: { value: ripAmp } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: WT.uTime, uRain: WT.uRain, uSky: WT.uSky }, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nvarying float vEdge;\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvEdge = aSway;\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep( 0.55, 1.0, vEdge );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 rg = rippleGrad( vWPos.xz ) * ( 1.0 - smoothstep( 9.0, 30.0, length( vViewPosition ) ) );
  vec3 nw = normalize( vec3( - rg.x, 1.0, - rg.y ) );
  normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 Vw = normalize( vViewPosition );
  float ndv = clamp( dot( normal, Vw ), 0.0, 1.0 );
  float fr = 0.03 + 0.97 * pow( clamp( 1.0 - ndv, 0.0, 1.0 ), 4.0 );
  totalEmissiveRadiance += uSky * fr * uSkyAmt;
}`);
  };
  m.customProgramCacheKey = () => 'cozyWater';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry builder (non-indexed triangle soup with position/normal/uv/aSway[/color])
// ---------------------------------------------------------------------------------------------------------------------
class GB {
  constructor(color = false) { this.p = []; this.n = []; this.u = []; this.w = []; this.c = color ? [] : null; }
  vert(p, n, uv, w, col) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); this.w.push(w);
    if (this.c) { const c = col || [1, 1, 1]; this.c.push(c[0], c[1], c[2]); }
  }
  tri(a, b, c, na, nb, nc, ua, ub, uc, wa, wb, wc, ca, cb, cc) {
    this.vert(a, na, ua, wa, ca); this.vert(b, nb, ub, wb, cb); this.vert(c, nc, uc, wc, cc);
  }
  quad(ps, ns, uvs, ws, cs) {
    const N = i => (Array.isArray(ns[0]) ? ns[i] : ns), Cc = i => (cs ? (Array.isArray(cs[0]) ? cs[i] : cs) : null);
    this.tri(ps[0], ps[1], ps[2], N(0), N(1), N(2), uvs[0], uvs[1], uvs[2], ws[0], ws[1], ws[2], Cc(0), Cc(1), Cc(2));
    this.tri(ps[0], ps[2], ps[3], N(0), N(2), N(3), uvs[0], uvs[2], uvs[3], ws[0], ws[2], ws[3], Cc(0), Cc(2), Cc(3));
  }
  addGeo(geo, matrix, swayFn, colorFn) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z);
      this.u.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.w.push(swayFn ? swayFn(v.x, v.y, v.z) : 0);
      if (this.c) { const c = colorFn ? colorFn(v.x, v.y, v.z, n) : [1, 1, 1]; this.c.push(c[0], c[1], c[2]); }
    }
    if (g !== geo) g.dispose();
  }
  get count() { return this.p.length / 3; }
  build(swayName = 'aSway') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute(swayName, new THREE.Float32BufferAttribute(this.w, 1));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// foliage atlas painting (two 1024² atlases, 2×2 cells of 512)
// ---------------------------------------------------------------------------------------------------------------------
const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const rgbStr = (h, k) => `rgb(${clamp255(((h >> 16) & 255) * k)},${clamp255(((h >> 8) & 255) * k)},${clamp255((h & 255) * k)})`;
const SHAPES = {
  oval(ctx, L, W) { ctx.beginPath(); ctx.moveTo(-L, 0); ctx.quadraticCurveTo(0, -W * 1.3, L, 0); ctx.quadraticCurveTo(0, W * 1.3, -L, 0); ctx.fill(); },
  round(ctx, L, W) { ctx.beginPath(); ctx.ellipse(0, 0, L, W, 0, 0, TAU); ctx.fill(); },
  maple(ctx, L, W) {
    for (const a of [-1.25, -0.62, 0, 0.62, 1.25]) {
      ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(0, 0);
      const l = a === 0 ? L : Math.abs(a) < 1 ? L * 0.85 : L * 0.6;
      ctx.quadraticCurveTo(W * 0.7, -l * 0.5, 0, -l); ctx.quadraticCurveTo(-W * 0.7, -l * 0.5, 0, 0); ctx.fill(); ctx.restore();
    }
  },
};
function drawLeafCell(ctx, x0, y0, S0, rnd, o) {
  const cx = x0 + S0 / 2, cy = y0 + S0 / 2;
  const subs = [];
  for (let k = 0; k < o.subs; k++) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * S0 * o.spread; subs.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85]); }
  if (o.twig) {
    ctx.lineCap = 'round'; ctx.strokeStyle = o.twig;
    for (const s of subs) {
      ctx.lineWidth = 1.5 + rnd() * 2.5; ctx.beginPath(); ctx.moveTo(cx + (rnd() - 0.5) * S0 * 0.1, cy + S0 * 0.24);
      ctx.quadraticCurveTo(cx + (rnd() - 0.5) * S0 * 0.2, cy, s[0], s[1]); ctx.stroke();
    }
  }
  for (let i = 0; i < o.n; i++) {
    const s = subs[(rnd() * subs.length) | 0];
    const a = rnd() * TAU, r = Math.pow(rnd(), 0.6) * S0 * o.r;
    const x = s[0] + Math.cos(a) * r, y = s[1] + Math.sin(a) * r;
    const layer = i / o.n;
    const k = (0.5 + 0.6 * layer + (cy - y) / S0 * 0.5 + (rnd() - 0.5) * 0.25) * (o.bright || 1);
    ctx.fillStyle = rgbStr(o.pal[(rnd() * o.pal.length) | 0], k);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * TAU);
    SHAPES[o.shape](ctx, o.len * (0.7 + rnd() * 0.6), o.wid * (0.7 + rnd() * 0.6));
    ctx.restore();
  }
}
function drawPine(ctx, x0, y0, S0, rnd) {
  const pal = [0x1f3524, 0x27402b, 0x2e4a33, 0x35533a, 0x223a28];
  const y = y0 + S0 / 2;
  ctx.lineCap = 'round';
  const needles = (xa, ya, xb, yb, len, dens) => {
    const dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const steps = Math.floor(L / dens);
    for (let i = 0; i < steps; i++) {
      const t = i / steps, px = xa + dx * t, py = ya + dy * t, l = len * (1 - t * 0.45);
      for (const sd of [-1, 1]) {
        const ang = sd * (0.7 + rnd() * 0.4), cs = Math.cos(ang), sn = Math.sin(ang);
        const nx = ux * cs - uy * sn, ny = ux * sn + uy * cs;
        ctx.strokeStyle = rgbStr(pal[(rnd() * pal.length) | 0], 0.75 + rnd() * 0.6 + (py < y ? 0.12 : -0.1));
        ctx.lineWidth = 1.3 + rnd() * 0.9;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * l, py + ny * l); ctx.stroke();
      }
    }
  };
  ctx.strokeStyle = '#3a2c20'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0 + 6, y); ctx.lineTo(x0 + S0 - 22, y); ctx.stroke();
  for (let b = 0; b < 10; b++) {
    const t = 0.06 + b * 0.085, bx = x0 + S0 * t, len = S0 * 0.3 * (1 - t * 0.75);
    for (const sd of [-1, 1]) {
      const ang = sd * (0.55 + rnd() * 0.3), ex = bx + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      ctx.strokeStyle = '#3a2c20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(ex, ey); ctx.stroke();
      needles(bx, y, ex, ey, 17, 3);
    }
  }
  needles(x0 + 6, y, x0 + S0 - 18, y, 22, 3);
}
function drawHydrangea(ctx, x0, y0, S0, rnd) {
  drawLeafCell(ctx, x0, y0, S0, rnd, { subs: 6, spread: 0.22, r: 0.2, n: 170, len: 30, wid: 13, shape: 'oval', pal: [0x2b4424, 0x33502a, 0x3b5a2e], twig: null });
  const cols = [0x6c7cc4, 0x7f86cc, 0x8b7cc2, 0x5f72b8, 0x9a8cd0, 0xb08cc8];
  for (let h = 0; h < 8; h++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * S0 * 0.2;
    const hx = x0 + S0 / 2 + Math.cos(a) * r, hy = y0 + S0 / 2 + Math.sin(a) * r * 0.8 - S0 * 0.03, hr = S0 * (0.075 + rnd() * 0.04);
    const base = cols[h % cols.length];
    for (let f = 0; f < 160; f++) {
      const fa = rnd() * TAU, fr = Math.sqrt(rnd()) * hr, fx = hx + Math.cos(fa) * fr, fy = hy + Math.sin(fa) * fr;
      const k = 0.55 + 0.5 * (1 - fr / hr) + ((hy - fy) / hr) * 0.25 + (rnd() - 0.5) * 0.2;
      ctx.fillStyle = rgbStr(base, k);
      const ps = 3 + rnd() * 3;
      for (let p = 0; p < 4; p++) { const pa = p * Math.PI / 2 + fa; ctx.beginPath(); ctx.arc(fx + Math.cos(pa) * ps * 0.6, fy + Math.sin(pa) * ps * 0.6, ps * 0.6, 0, TAU); ctx.fill(); }
    }
  }
}
function drawFlowers(ctx, x0, y0, S0, rnd) {
  for (let i = 0; i < 150; i++) {
    const bx = x0 + S0 * (0.08 + rnd() * 0.84), h = S0 * (0.3 + rnd() * 0.45);
    ctx.strokeStyle = rgbStr([0x2e4a28, 0x3a5a2e, 0x466833][i % 3], 0.6 + rnd() * 0.6);
    ctx.lineWidth = 2 + rnd() * 3; ctx.beginPath(); ctx.moveTo(bx, y0 + S0 - 6);
    ctx.quadraticCurveTo(bx + (rnd() - 0.5) * 40, y0 + S0 - h * 0.5, bx + (rnd() - 0.5) * 60, y0 + S0 - h); ctx.stroke();
  }
  const cols = [0xd98aa0, 0xe8e0d0, 0x9a86c0, 0xd8b848, 0xc76a7a, 0xf0d8e0, 0xe8e8f0];
  for (let i = 0; i < 120; i++) {
    const fx = x0 + S0 * (0.1 + rnd() * 0.8), fy = y0 + S0 * (0.22 + rnd() * 0.42), r = 5 + rnd() * 6, c = cols[(rnd() * cols.length) | 0];
    for (let p = 0; p < 5; p++) { const a = p / 5 * TAU; ctx.fillStyle = rgbStr(c, 0.8 + rnd() * 0.3); ctx.beginPath(); ctx.arc(fx + Math.cos(a) * r * 0.55, fy + Math.sin(a) * r * 0.55, r * 0.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#d8b040'; ctx.beginPath(); ctx.arc(fx, fy, r * 0.25, 0, TAU); ctx.fill();
  }
  for (let i = 0; i < 20; i++) {
    const bx = x0 + S0 * (0.1 + rnd() * 0.8), top = y0 + S0 * (0.14 + rnd() * 0.2);
    for (let k = 0; k < 14; k++) { ctx.fillStyle = rgbStr(0x8a78b8, 0.7 + rnd() * 0.4); ctx.beginPath(); ctx.arc(bx + (rnd() - 0.5) * 5, top + k * 5, 3.2, 0, TAU); ctx.fill(); }
  }
}
function drawRoses(ctx, x0, y0, S0, rnd) {
  drawLeafCell(ctx, x0, y0, S0, rnd, { subs: 7, spread: 0.24, r: 0.18, n: 560, len: 13, wid: 7, shape: 'oval', pal: [0x2a4424, 0x335028, 0x3d5a2e, 0x24401f], twig: '#3a2e22' });
  const cols = [0xc2485a, 0xe4a0a8, 0xf0e2d0, 0xb03040, 0xe8b8b0];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * S0 * 0.34;
    const fx = x0 + S0 / 2 + Math.cos(a) * r, fy = y0 + S0 / 2 + Math.sin(a) * r, rr = 9 + rnd() * 8, c = cols[(rnd() * cols.length) | 0];
    ctx.fillStyle = rgbStr(c, 0.7); ctx.beginPath(); ctx.arc(fx, fy, rr, 0, TAU); ctx.fill();
    ctx.fillStyle = rgbStr(c, 1.0); ctx.beginPath(); ctx.arc(fx - rr * 0.15, fy - rr * 0.15, rr * 0.7, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgbStr(c, 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(fx, fy, rr * 0.4, 0.5, 5.2); ctx.stroke();
  }
}
const ATLAS_CELLS = {
  oak: [0, 0], maple: [0, 1], birch: [0, 2], bush: [0, 3],
  pine: [1, 0], hydrangea: [1, 1], flowers: [1, 2], roses: [1, 3],
};
function paintAtlas(U, which) {
  return U.canvasTexture(1024, 1024, (ctx) => {
    for (let i = 0; i < 4; i++) {
      const x0 = (i % 2) * 512, y0 = Math.floor(i / 2) * 512, rnd = U.rng(900 + which * 10 + i);
      ctx.save(); ctx.beginPath(); ctx.rect(x0 + 3, y0 + 3, 506, 506); ctx.clip();
      if (which === 0) {
        if (i === 0) drawLeafCell(ctx, x0, y0, 512, rnd, { subs: 7, spread: 0.25, r: 0.17, n: 700, len: 19, wid: 9, shape: 'oval', pal: [0x2f4a26, 0x3a5a2c, 0x45652f, 0x29401f, 0x52703a], twig: '#3b2e22' });
        if (i === 1) drawLeafCell(ctx, x0, y0, 512, rnd, { subs: 7, spread: 0.25, r: 0.17, n: 460, len: 17, wid: 16, shape: 'maple', pal: [0x8a3b1c, 0xa2522a, 0xb8742f, 0x6e2f1a, 0xc28a3a, 0x9a4a22, 0x6a6a2e], twig: '#3b2e22', bright: 1.05 });
        if (i === 2) drawLeafCell(ctx, x0, y0, 512, rnd, { subs: 9, spread: 0.27, r: 0.15, n: 520, len: 11, wid: 7, shape: 'oval', pal: [0x7d8a3a, 0x9a9a3e, 0x6b7a33, 0xb0a24a, 0x5d7030], twig: '#4a3a2c' });
        if (i === 3) drawLeafCell(ctx, x0, y0, 512, rnd, { subs: 8, spread: 0.26, r: 0.17, n: 1100, len: 9, wid: 5, shape: 'oval', pal: [0x243d22, 0x2c4a28, 0x355430, 0x1f361e, 0x3c5c34], twig: '#2e2418' });
      } else {
        if (i === 0) drawPine(ctx, x0, y0, 512, rnd);
        if (i === 1) drawHydrangea(ctx, x0, y0, 512, rnd);
        if (i === 2) drawFlowers(ctx, x0, y0, 512, rnd);
        if (i === 3) drawRoses(ctx, x0, y0, 512, rnd);
      }
      ctx.restore();
    }
  }, { wrap: false });
}

// ---------------------------------------------------------------------------------------------------------------------
// layout data
// ---------------------------------------------------------------------------------------------------------------------
const PUDDLES = [
  // yard
  { x: 4.9, z: 8.7, rx: 0.55, rz: 0.38, a: 0.3 },
  { x: 2.45, z: 12.3, rx: 0.8, rz: 0.48, a: -0.2 },
  { x: -2.6, z: 11.3, rx: 1.35, rz: 0.72, a: 0.4 },
  { x: 8.6, z: 15.4, rx: 0.9, rz: 0.55, a: 1.1 },
  { x: 0.4, z: 17.0, rx: 0.7, rz: 0.42, a: 0.2 },
  { x: 3.95, z: 18.45, rx: 0.55, rz: 0.32, a: 0.05 },
  { x: 7.65, z: 5.95, rx: 0.55, rz: 0.4, a: 0.0 },
  { x: -7.6, z: 5.95, rx: 0.5, rz: 0.38, a: 0.2 },
  { x: 7.65, z: -5.95, rx: 0.5, rz: 0.4, a: 0.0 },
  { x: -7.55, z: -5.95, rx: 0.52, rz: 0.42, a: 0.3 },
  { x: 6.75, z: -8.5, rx: 0.22, rz: 0.9, a: 0.0 },
  { x: -11.1, z: -6.1, rx: 0.6, rz: 0.4, a: 0.1 },
  { x: -12.0, z: 15.6, rx: 0.9, rz: 0.55, a: -0.5 },
  { x: 9.8, z: 1.5, rx: 0.8, rz: 0.5, a: 0.7 },
  { x: 11.3, z: 17.6, rx: 0.6, rz: 0.4, a: 0.2 },
  { x: -4.8, z: -8.8, rx: 0.9, rz: 0.5, a: -0.3 },
  // lane (in the ruts)
  { x: 3.1, z: 20.55, rx: 1.0, rz: 0.36, a: 0.03, lane: true },
  { x: 5.4, z: 22.05, rx: 1.3, rz: 0.42, a: -0.04, lane: true },
  { x: 7.9, z: 20.6, rx: 0.9, rz: 0.34, a: 0.02, lane: true },
  { x: -3.8, z: 22.05, rx: 1.6, rz: 0.4, a: 0.02, lane: true },
  { x: -1.2, z: 20.5, rx: 0.7, rz: 0.3, a: 0.0, lane: true },
  { x: 11.0, z: 22.0, rx: 1.0, rz: 0.36, a: 0.0, lane: true },
  { x: -10.5, z: 20.6, rx: 1.2, rz: 0.4, a: 0.03, lane: true },
  { x: 15.5, z: 20.6, rx: 1.3, rz: 0.4, a: 0.0, lane: true },
  { x: -16.5, z: 22.0, rx: 1.4, rz: 0.42, a: 0.0, lane: true },
  { x: 22.0, z: 22.05, rx: 1.5, rz: 0.4, a: 0.0, lane: true },
  { x: -25.0, z: 20.6, rx: 1.6, rz: 0.42, a: 0.0, lane: true },
  { x: 30.0, z: 20.55, rx: 1.4, rz: 0.4, a: 0.0, lane: true },
];
const POND = { x: -9, z: 9.5, r: 2.4 };
const pondR = (U, a) => POND.r * (1 + 0.09 * U.noise2D(Math.cos(a) * 1.1 + 4.2, Math.sin(a) * 1.1 - 2.3) + 0.04 * Math.sin(a * 3 + 1));

function rectDist(x, z, x0, z0, x1, z1) { const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); return Math.hypot(dx, dz); }
const flatDist = (x, z) => Math.min(rectDist(x, z, -16.5, -13.2, 16.5, 19.3), rectDist(x, z, -1000, 18.6, 1000, 25.0));

function blocksTestLine(minX, minZ, maxX, maxZ) {
  const m = 0.6;
  if (maxZ > 16.5 - m && minZ < 16.5 + m && maxX > -14.8 && minX < 14.8) return true;
  if (maxX > 3.75 - m && minX < 3.75 + m && maxZ > 7.8 && minZ < 23) return true;
  if (maxX > 12.5 - m && minX < 12.5 + m && maxZ > -11.8 && minZ < 18.8) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// BUILD
// ---------------------------------------------------------------------------------------------------------------------
function build(C) {
  const U = C.util, P = C.physics;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V3(0, 1, 0), XA = V3(1, 0, 0);
  const root = new THREE.Group(); root.name = 'outdoor'; C.scene.add(root);
  const stat = new THREE.Group(); stat.name = 'outdoor.static'; root.add(stat);
  const rnd = U.rng(40401);
  S = { root, gate: null, rocker: null, porch: null, street: null, grass: null, autoOn: null, nbWin: null, trunks: [] };

  const sec = (name, fn) => {
    try { fn(); } catch (e) {
      const message = `section ${name}: ${e && e.message}`;
      C.debug.errors.push({ module: 'outdoor', phase: 'init', message, stack: String((e && e.stack) || '').slice(0, 1500) });
      console.error('[COZY] outdoor init error: ' + message + '\n' + (e && e.stack));
    }
  };
  const box = (min, max, opts = {}) => {
    const a = min, b = max;
    if (!opts.force && blocksTestLine(Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]))) { C.log('outdoor', 'collider skipped (test line)', opts.name); return null; }
    return P.addBox(min, max, Object.assign({ tag: 'furniture', blocksInteract: false }, opts));
  };
  const cyl = (x, z, r, y0, y1, opts = {}) => {
    if (!opts.force && blocksTestLine(x - r, z - r, x + r, z + r)) { C.log('outdoor', 'cyl collider skipped (test line)', opts.name); return null; }
    return P.addCylinder(x, z, r, y0, y1, Object.assign({ tag: 'furniture' }, opts));
  };
  const shadow = (x, y, z, w, d, o) => U.blobShadow(stat, x, y, z, w, d, o);

  // ------------------------------------------------------------------ materials
  const M = {};
  const wet = (name, color, rough, extra) => {
    const m = C.mat(name).clone(); m.name = 'outdoor.' + name + '_wet';
    if (color !== undefined && color !== null) m.color.set(color);
    if (rough !== undefined && rough !== null) m.roughness = rough;
    if (extra) Object.assign(m, extra);
    return m;
  };
  sec('materials', () => {
    M.ground = wet('grass', 0xffffff, 0.9, { vertexColors: true });
    M.gravel = wet('gravel', 0x9a968f, 0.8, { vertexColors: true });
    M.hedge = wet('hedge', 0xb8c2b0, 0.85);
    M.fence = wet('woodPainted', 0xd6d1c4, 0.62, { vertexColors: true });
    M.rock = wet('concrete', 0x8c8b87, 0.5, { vertexColors: true });
    M.wood = wet('woodWeathered', 0x8d8b86, 0.72);
    M.shedWall = wet('woodWeathered', 0x7d9486, 0.7);
    M.trim = wet('woodPainted', 0xe8e2d4, 0.5);
    M.doorGreen = wet('woodPaintedGreen', null, 0.4);
    M.woodMed = C.mat('woodMedium');
    M.woodDark = C.mat('woodDark');
    M.iron = C.mat('ironBlack');
    M.brass = C.mat('brass');
    M.soil = wet('soil', 0xa89a90, 0.7);
    M.shingles = C.mat('shingles');
    M.terracotta = wet('ceramicTerracotta', 0xd8c8c0, 0.6);
    M.logEnd = C.mat('logEnd');
    M.barkLog = wet('bark', 0xa09a92, 0.85);
    M.bark = makeSway(wet('bark', 0x8e8a84, 0.8), 0.9, 0, false);
    const rb = U.rng(77);
    const birchTex = U.canvasTexture(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#dcd8ce'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 420; i++) { ctx.fillStyle = `rgba(${150 + rb() * 60 | 0},${150 + rb() * 55 | 0},${140 + rb() * 50 | 0},0.25)`; ctx.fillRect(rb() * w, rb() * h, 2 + rb() * 22, 1 + rb() * 3); }
      for (let i = 0; i < 170; i++) { ctx.fillStyle = `rgba(40,34,30,${0.5 + rb() * 0.4})`; ctx.fillRect(rb() * w, rb() * h, 6 + rb() * 30, 1 + rb() * 2.5); }
      for (let i = 0; i < 28; i++) { ctx.fillStyle = `rgba(28,24,22,${0.7 + rb() * 0.3})`; ctx.beginPath(); ctx.ellipse(rb() * w, rb() * h, 6 + rb() * 22, 3 + rb() * 9, (rb() - 0.5) * 0.4, 0, TAU); ctx.fill(); }
    });
    birchTex.repeat.set(2, 1);
    M.birch = makeSway(new THREE.MeshStandardMaterial({ map: birchTex, roughness: 0.72, name: 'outdoor.birchBark' }), 0.9, 0, false);
    M.leafA = makeSway(new THREE.MeshStandardMaterial({ map: paintAtlas(U, 0), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.6, name: 'outdoor.foliageA' }), 0.9, 0.035, true);
    M.leafB = makeSway(new THREE.MeshStandardMaterial({ map: paintAtlas(U, 1), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.6, name: 'outdoor.foliageB' }), 0.9, 0.03, true);
    M.core = makeSway(new THREE.MeshStandardMaterial({ color: 0x24371f, roughness: 0.9, name: 'outdoor.foliageCore' }), 0.9, 0, false);
    M.grass = makeSway(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, name: 'outdoor.grassTufts' }), 0.2, 0.01, true);
    M.puddle = makeWater(0x0b1013, 0.95, 0.38, 0.06);
    M.pond = makeWater(0x0a1311, 0.8, 0.34, 0.05);
    M.lily = U.stdMat(0x3b5a2a, 0.4, 0);
    M.pumpkin = U.stdMat(0xb8581c, 0.5, 0);
    M.cabbage = U.stdMat(0x5b7a5e, 0.55, 0);
    M.lettuce = U.stdMat(0x7a9a45, 0.55, 0);
    M.stem = U.stdMat(0x5a6a3a, 0.7, 0);
    M.rubber = U.stdMat(0x2c3a2c, 0.35, 0);
    M.rubberY = U.stdMat(0xb8902a, 0.4, 0);
    M.umbrella = U.stdMat(0x8e2b24, 0.45, 0, { side: THREE.DoubleSide });
    M.galv = U.stdMat(0x7b847e, 0.4, 0.6);
    M.mailbox = U.stdMat(0x2f4a3a, 0.35, 0.3);
    M.flag = U.stdMat(0xa0281e, 0.5, 0);
    M.glassDark = U.stdMat(0x141b1f, 0.08, 0.3);
    M.nbWall = U.stdMat(0x7e7a72, 0.9, 0);
    M.nbRoof = U.stdMat(0x2c3136, 0.8, 0);
    M.nbDark = U.stdMat(0x1a1e22, 0.3, 0);
    M.nbWin = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 0.32), name: 'outdoor.neighbourWindows' });
    M.shedWin = new THREE.MeshStandardMaterial({ color: 0x1e1a16, emissive: 0xffa24a, emissiveIntensity: 0.35, roughness: 0.15, name: 'outdoor.shedWindow' });
    M.far = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, name: 'outdoor.farTrees' });
    M.cushion = C.mat('fabricChair');
    M.knit = C.mat('knit');
  });

  // ------------------------------------------------------------------ foliage builders (shared)
  const leafGB = [new GB(), new GB()], barkGB = new GB(), birchGB = new GB(), coreGB = new GB();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _one = V3(1, 1, 1);
  function randUnit(r) { const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u); return V3(s * Math.cos(a), u, s * Math.sin(a)); }
  function branch(gb, p0, p1, r0, r1, radial, swayFn) {
    const dir = p1.clone().sub(p0); const len = dir.length(); if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r1, r0, len * 1.04, radial, 1, true);
    const uv = g.attributes.uv; const circ = Math.max(0.25, TAU * r0);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * len);
    g.translate(0, len * 0.5, 0);
    _q.setFromUnitVectors(UP, dir.normalize());
    _m4.compose(p0, _q, _one);
    gb.addGeo(g, _m4, swayFn);
    g.dispose();
  }
  function card(kind, c, size, nrm, swayFn, r, mode) {
    const [atlas, idx] = ATLAS_CELLS[kind];
    const u0 = (idx % 2) * 0.5 + 0.004, v0 = (idx < 2 ? 0.5 : 0) + 0.004, du = 0.492;
    let ax, ay;
    if (mode === 'upright') { const a = r() * TAU; ax = V3(Math.cos(a), 0, Math.sin(a)); ay = UP.clone(); }
    else if (mode && mode.isVector3) { ax = mode.clone(); ay = V3().crossVectors(nrm, ax).normalize(); }
    else { const nd = randUnit(r); ax = V3().crossVectors(nd, Math.abs(nd.y) < 0.9 ? UP : XA).normalize(); ay = V3().crossVectors(nd, ax); }
    const h = size / 2;
    const ps = [
      c.clone().addScaledVector(ax, -h).addScaledVector(ay, mode === 'upright' ? 0 : -h),
      c.clone().addScaledVector(ax, h).addScaledVector(ay, mode === 'upright' ? 0 : -h),
      c.clone().addScaledVector(ax, h).addScaledVector(ay, mode === 'upright' ? size : h),
      c.clone().addScaledVector(ax, -h).addScaledVector(ay, mode === 'upright' ? size : h),
    ];
    const uvs = [[u0, v0], [u0 + du, v0], [u0 + du, v0 + du], [u0, v0 + du]];
    const ws = ps.map(p => swayFn(p.x, p.y, p.z));
    const n = [nrm.x, nrm.y, nrm.z];
    leafGB[atlas].quad(ps.map(p => [p.x, p.y, p.z]), n, uvs, ws);
  }
  // radial card (pine branches): from base point outward along dir, width w
  function radialCard(kind, base, dir, len, w0, w1, roll, nrm, swayFn) {
    const [atlas, idx] = ATLAS_CELLS[kind];
    const u0 = (idx % 2) * 0.5 + 0.004, v0 = (idx < 2 ? 0.5 : 0) + 0.004, du = 0.492;
    const side = V3().crossVectors(dir, UP).normalize();
    side.applyAxisAngle(dir, roll);
    const tip = base.clone().addScaledVector(dir, len);
    const ps = [base.clone().addScaledVector(side, -w0), tip.clone().addScaledVector(side, -w1), tip.clone().addScaledVector(side, w1), base.clone().addScaledVector(side, w0)];
    const uvs = [[u0, v0], [u0 + du, v0], [u0 + du, v0 + du], [u0, v0 + du]];
    leafGB[atlas].quad(ps.map(p => [p.x, p.y, p.z]), [nrm.x, nrm.y, nrm.z], uvs, ps.map(p => swayFn(p.x, p.y, p.z)));
  }
  const heightSway = (H, base = GY, k = 1) => (x, y) => Math.min(1, Math.max(0, (y - base) / H)) * k;

  function deciduous(o) {
    const r = U.rng(o.seed);
    const sway = heightSway(o.H);
    const lean = V3((r() - 0.5) * o.lean, 0, (r() - 0.5) * o.lean);
    const base = V3(o.x, GY - 0.25, o.z);
    const tMid = V3(o.x + lean.x * 0.35, GY + o.trunkH * 0.5, o.z + lean.z * 0.35);
    const tTop = V3(o.x + lean.x, GY + o.trunkH, o.z + lean.z);
    const gb = o.birch ? birchGB : barkGB;
    branch(gb, base, tMid, o.trunkR * 1.2, o.trunkR * 0.9, 12, sway);
    branch(gb, tMid, tTop, o.trunkR * 0.9, o.trunkR * 0.68, 12, sway);
    // root flare
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * TAU + r() * 0.5;
      const p0 = V3(o.x + Math.cos(a) * o.trunkR * 0.6, GY + o.trunkR * 1.1, o.z + Math.sin(a) * o.trunkR * 0.6);
      const p1 = V3(o.x + Math.cos(a) * o.trunkR * 2.4, GY - 0.08, o.z + Math.sin(a) * o.trunkR * 2.4);
      branch(gb, p0, p1, o.trunkR * 0.42, o.trunkR * 0.12, 6, sway);
    }
    const clusters = [];
    const limbDirs = [];
    for (let i = 0; i < o.limbs; i++) {
      const az = i / o.limbs * TAU + r() * 0.7;
      const el = o.elev[0] + r() * (o.elev[1] - o.elev[0]);
      const d = V3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      limbDirs.push(d);
      const start = tTop.clone().addScaledVector(UP, -r() * o.trunkH * 0.28);
      const L = o.limbLen * (0.75 + r() * 0.5);
      const mid = start.clone().addScaledVector(d, L * 0.5);
      const d2 = d.clone().add(V3((r() - 0.5) * 0.4, o.upturn, (r() - 0.5) * 0.4)).normalize();
      const end = mid.clone().addScaledVector(d2, L * 0.5);
      const r0 = o.trunkR * 0.55, r1 = o.trunkR * 0.33, r2 = o.trunkR * 0.12;
      branch(gb, start, mid, r0, r1, 8, sway);
      branch(gb, mid, end, r1, r2, 6, sway);
      clusters.push(end);
      for (let k = 0; k < o.subs; k++) {
        const from = start.clone().lerp(end, 0.35 + r() * 0.45);
        const sd = V3(d.x + (r() - 0.5) * 1.3, d.y * 0.4 + 0.25 + r() * 0.55, d.z + (r() - 0.5) * 1.3).normalize();
        const sl = L * (0.3 + r() * 0.3);
        const se = from.clone().addScaledVector(sd, sl);
        branch(gb, from, se, r1 * 0.55, r2 * 0.4, 5, sway);
        clusters.push(se);
      }
    }
    const cc = V3(); clusters.forEach(c => cc.add(c)); cc.multiplyScalar(1 / clusters.length);
    for (let k = 0; k < o.fill; k++) clusters.push(cc.clone().add(V3((r() - 0.5) * o.spread, (r() - 0.3) * o.spread * 0.55, (r() - 0.5) * o.spread)));
    for (const c of clusters) {
      for (let k = 0; k < o.cards; k++) {
        const p = c.clone().add(randUnit(r).multiplyScalar(Math.cbrt(r()) * o.clusterR));
        if (o.droop) p.y -= r() * o.droop;
        if (p.y < GY + o.minLeafY) p.y = GY + o.minLeafY + r() * 0.5;
        const nrm = p.clone().sub(cc); nrm.y *= 1.3; nrm.normalize(); nrm.y += 0.4; nrm.normalize();
        card(o.kind, p, o.card * (0.75 + r() * 0.5), nrm, sway, r);
      }
    }
    S.trunks.push({ x: o.x, z: o.z, r: o.trunkR * 1.05 });
    return cc;
  }
  function pine(x, z, H, R, seed) {
    const r = U.rng(seed);
    const sway = heightSway(H, GY, 0.8);
    branch(barkGB, V3(x, GY - 0.2, z), V3(x, GY + H * 0.55, z), 0.05 * H * 0.5 + 0.1, 0.05 * H * 0.3, 8, sway);
    branch(barkGB, V3(x, GY + H * 0.55, z), V3(x, GY + H, z), 0.05 * H * 0.3, 0.02, 6, sway);
    const cg = new THREE.ConeGeometry(R * 0.6, H * 0.82, 9, 3);
    cg.translate(0, GY + 1.2 + H * 0.41, 0);
    _m4.makeTranslation(x, 0, z);
    coreGB.addGeo(cg, _m4, sway); cg.dispose();
    const tiers = Math.round(H * 1.5);
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      const y = GY + 1.3 + f * (H - 1.5);
      const rr = R * Math.pow(1 - f, 0.95) + 0.3;
      const n = 8 + Math.floor(rr * 4);
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + r() * 0.6 + t * 0.9;
        const dir = V3(Math.cos(a), -0.28 - r() * 0.2, Math.sin(a)).normalize();
        const nrm = V3(Math.cos(a), 0.7, Math.sin(a)).normalize();
        const roll = (r() - 0.5) * 0.9, ln = rr * (0.9 + r() * 0.3), y1 = y + (r() - 0.5) * 0.2;
        radialCard('pine', V3(x, y1, z), dir, ln, 0.14, rr * 0.45 + 0.15, roll, nrm, sway);
        if (k % 2 === 0) radialCard('pine', V3(x, y1 - 0.1, z), dir, ln * 0.85, 0.12, rr * 0.4 + 0.12, roll + 1.4, nrm, sway);
      }
    }
    for (let k = 0; k < 3; k++) {
      const a = r() * TAU;
      radialCard('pine', V3(x, GY + H - 0.9, z), V3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize(), 1.1, 0.1, 0.3, r() * 3, V3(Math.cos(a), 0.6, Math.sin(a)).normalize(), sway);
    }
    S.trunks.push({ x, z, r: 0.05 * H * 0.5 + 0.12 });
  }
  function bush(x, z, rad, h, kind, seed, opts = {}) {
    const r = U.rng(seed);
    const y0 = opts.y0 !== undefined ? opts.y0 : GY;
    const sway = (px, py) => Math.min(1, Math.max(0, (py - y0) / h)) * 0.35;
    const g = new THREE.SphereGeometry(1, 10, 7);
    g.scale(rad * 0.62, h * 0.36, rad * 0.62); g.translate(x, y0 + h * 0.4, z);
    _m4.identity(); coreGB.addGeo(g, _m4, sway); g.dispose();
    const n = opts.cards || Math.round(14 + rad * rad * 44);
    const cc = V3(x, y0 + h * 0.35, z);
    for (let k = 0; k < n; k++) {
      const d = randUnit(r); d.y = Math.abs(d.y) * 0.9 + 0.05;
      const p = V3(x + d.x * rad * (0.55 + r() * 0.5), y0 + h * 0.45 + d.y * h * 0.5, z + d.z * rad * (0.55 + r() * 0.5));
      const nrm = p.clone().sub(cc).normalize(); nrm.y += 0.3; nrm.normalize();
      card(kind, p, (opts.card || rad * 1.1) * (0.8 + r() * 0.4), nrm, sway, r);
    }
    if (opts.collide) cyl(x, z, rad * 0.6, GY, GY + h, { name: 'bush' });
  }

  // ------------------------------------------------------------------ terrain
  const hillH = (x, z) => {
    const d = flatDist(x, z);
    if (d <= 0) return GY;
    const m = U.smoothstep(0.5, 38, d);
    const n1 = U.fbm2D(x * 0.0065 + 3.1, z * 0.0065 - 1.7, 4) * 0.5 + 0.5;
    const n2 = U.fbm2D(x * 0.021 - 7.3, z * 0.021 + 2.2, 3);
    const far = U.smoothstep(90, 240, Math.hypot(x, z * 0.9));
    return GY + m * (1.0 + n1 * 11 + n2 * 2.0) + far * 16;
  };
  S.hillH = hillH;
  sec('terrain', () => {
    const axis = (a, b, step, far, grow) => {
      const mid = []; for (let x = a; x <= b + 1e-6; x += step) mid.push(+x.toFixed(4));
      const lo = [], hi = []; let s = step, x = a;
      while (x > -far) { s *= grow; x -= s; lo.push(Math.max(x, -far)); }
      s = step; x = b; while (x < far) { s *= grow; x += s; hi.push(Math.min(x, far)); }
      return lo.reverse().concat(mid, hi);
    };
    const xs = axis(-18, 18, 0.5, 280, 1.16), zs = axis(-15, 26.5, 0.5, 280, 1.16);
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    const mudC = [0.9, 0.6, 0.42];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      let h = hillH(x, z);
      // pond basin
      const dpx = x - POND.x, dpz = z - POND.z, dp = Math.hypot(dpx, dpz);
      if (dp < POND.r + 1.2) { const pr = pondR(U, Math.atan2(dpz, dpx)); h -= U.smoothstep(pr + 0.4, pr - 0.9, dp) * 0.5; }
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      uv[k * 2] = x; uv[k * 2 + 1] = -z;
      // colour
      const n = U.fbm2D(x * 0.17, z * 0.17, 3);
      let r = 1, g = 1, b = 1, v = 0.9 + n * 0.14, mud = 0;
      const fd = flatDist(x, z);
      if (fd < 0.01) {
        const hx = Math.max(Math.abs(x) - 7, 0), hz = Math.max(Math.abs(z) - 5, 0), dh = Math.hypot(hx, hz);
        if (dh < 1.1 && !(z > 4.9 && x > 1.0 && x < 7.0)) mud = Math.max(mud, (1 - dh / 1.1) * 0.6);
        if (z > 7.5 && z < 19.2) { const px = Math.abs(x - 3.75); if (px < 1.4) mud = Math.max(mud, Math.max(0, 1 - Math.abs(px - 0.7) / 0.6) * 0.55 * (0.7 + 0.3 * n)); }
        const dg = Math.hypot(x - 3.75, z - 19); if (dg < 2.4) mud = Math.max(mud, (1 - dg / 2.4) * 0.9);
        const dst = Math.hypot(x - 3.75, z - 8.0); if (dst < 1.6) mud = Math.max(mud, (1 - dst / 1.6) * 0.7);
        if (x > 1.5 && x < 9.6 && z > -10.7 && z < -6.3) mud = Math.max(mud, 0.8);
        const ds = Math.hypot(x + 11.5, z + 6.2); if (ds < 1.8) mud = Math.max(mud, (1 - ds / 1.8) * 0.75);
        if (x < -6.9 && x > -9.4 && z > -2.1 && z < 1.7) mud = Math.max(mud, 0.55);
        if (dp < 3.4) mud = Math.max(mud, U.smoothstep(3.4, 2.3, dp) * 0.85);
        const db = Math.hypot(x + 9, z - 12.6); if (db < 1.3) mud = Math.max(mud, (1 - db / 1.3) * 0.6);
        for (const p of PUDDLES) { const dd = Math.hypot((x - p.x) / (p.rx + 0.9), (z - p.z) / (p.rz + 0.9)); if (dd < 1) mud = Math.max(mud, (1 - dd) * 0.9); }
        const dOak = Math.hypot(x + 6.5, z - 14); if (dOak < 6.5) v *= 0.72 + 0.28 * dOak / 6.5;
        const dMap = Math.hypot(x - 11, z - 12); if (dMap < 4.5) { v *= 0.8 + 0.2 * dMap / 4.5; r *= 1.08; }
        if (z > 18.9 && z < 25) { v *= 0.95; }
      } else {
        const f = U.fbm2D(x * 0.028 + 11, z * 0.028 - 5, 3);
        r *= 1 + f * 0.35; g *= 1 + f * 0.16; b *= 1 - f * 0.1;
        v *= 0.95 + 0.1 * U.fbm2D(x * 0.08, z * 0.08, 2);
      }
      mud = Math.min(1, mud * (0.85 + 0.3 * (n * 0.5 + 0.5)));
      col[k * 3] = (r * v) * (1 - mud) + mudC[0] * mud * v;
      col[k * 3 + 1] = (g * v) * (1 - mud) + mudC[1] * mud * v;
      col[k * 3 + 2] = (b * v) * (1 - mud) + mudC[2] * mud * v;
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, M.ground);
    mesh.name = 'outdoor.terrain'; mesh.receiveShadow = true; mesh.userData.dynamic = true;
    root.add(mesh);
  });

  // ------------------------------------------------------------------ lane, verges, hedge
  sec('lane', () => {
    const g = new THREE.PlaneGeometry(200, 3.5, 100, 14);
    g.rotateX(-Math.PI / 2); g.translate(0, GY + 0.004, 21.3);
    U.worldUV(g, 1);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const rut = Math.min(Math.abs(z - 20.55), Math.abs(z - 22.05));
      let v = 0.95 + 0.12 * U.noise2D(x * 0.4, z * 0.9);
      if (rut < 0.35) v *= 0.7 + 0.3 * (rut / 0.35);
      const edge = Math.min(z - 19.55, 23.05 - z);
      if (edge < 0.3) v *= 0.8;
      const mid = Math.abs(z - 21.3) < 0.3 ? 1 : 0;
      col[i * 3] = v * (mid ? 0.85 : 1); col[i * 3 + 1] = v * (mid ? 0.95 : 1); col[i * 3 + 2] = v * (mid ? 0.75 : 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, M.gravel); m.name = 'outdoor.lane'; m.receiveShadow = true;
    stat.add(m);
    // hedge row
    let hg = new THREE.BoxGeometry(200, 1.8, 1.25, 400, 8, 6);
    hg.deleteAttribute('uv'); hg.deleteAttribute('normal');
    hg = mergeVertices(hg);
    const hp = hg.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      let x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
      const ny = y / 0.9, nz = z / 0.625;
      const rr = Math.hypot(Math.max(0, ny) * 0.8, nz);
      if (ny > 0.2) { const k = 1 - 0.18 * Math.max(0, ny - 0.2) * Math.abs(nz); z *= k; }
      const dsp = 0.16 * U.fbm2D(x * 0.7, y * 1.1 + z * 0.8, 3) + 0.05 * U.noise2D(x * 3.1 + z * 2.0, y * 3.3);
      const dir = V3(0, Math.max(0, ny), nz).normalize();
      x += 0; y += dir.y * dsp + (ny > 0.9 ? 0.08 * U.noise2D(x * 0.35, 3.1) : 0); z += dir.z * dsp;
      hp.setXYZ(i, x, y + GY + 0.9, z + 24.15);
      void rr;
    }
    hg.computeVertexNormals();
    U.worldUV(hg, 1);
    const hm = new THREE.Mesh(hg, M.hedge); hm.name = 'outdoor.hedge'; hm.receiveShadow = true;
    stat.add(hm);
    const r = U.rng(51);
    const hsway = (x, y) => Math.max(0, (y - GY - 1.2)) * 0.25;
    for (let x = -40; x <= 40; x += 0.45) {
      const p = V3(x + (r() - 0.5) * 0.3, GY + 1.72 + r() * 0.2, 24.15 + (r() - 0.5) * 1.0);
      card('bush', p, 0.8 + r() * 0.4, V3(0, 1, (p.z - 24.15)).normalize(), hsway, r);
      if (r() < 0.6) { const q = V3(x + (r() - 0.5) * 0.3, GY + 0.4 + r() * 1.2, 23.52 + r() * 0.08); card('bush', q, 0.6 + r() * 0.3, V3(0, 0.3, -1).normalize(), hsway, r); }
    }
    // a few stones along the lane edges
    const sg = new THREE.DodecahedronGeometry(1, 0);
    for (let k = 0; k < 40; k++) {
      const x = -30 + r() * 60, z = r() < 0.5 ? 19.5 + r() * 0.15 : 23.05 + r() * 0.2, s = 0.06 + r() * 0.1;
      if (Math.abs(x - 3.75) < 1.2) continue;
      const mm = new THREE.Mesh(sg, M.rock); mm.position.set(x, GY + s * 0.3, z); mm.scale.set(s * 1.3, s * 0.7, s); mm.rotation.set(r(), r() * 3, r()); stat.add(mm);
    }
  });

  // ------------------------------------------------------------------ fence + gate + arbour
  sec('fence', () => {
    const pk = new THREE.Shape();
    pk.moveTo(-0.037, 0); pk.lineTo(0.037, 0); pk.lineTo(0.037, 0.87); pk.lineTo(0, 0.94); pk.lineTo(-0.037, 0.87); pk.lineTo(-0.037, 0);
    const pg = new THREE.ExtrudeGeometry(pk, { depth: 0.02, bevelEnabled: false }); pg.translate(0, 0, -0.01);
    { const p = pg.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const y = p.getY(i); const v = 0.55 + 0.45 * U.smoothstep(0.0, 0.3, y); c[i * 3] = v * 0.97; c[i * 3 + 1] = v; c[i * 3 + 2] = v * 0.93; } pg.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    const runs = [
      { a: [-15, 19], b: [2.93, 19], n: [0, 1] }, { a: [4.57, 19], b: [15, 19], n: [0, 1] },
      { a: [15, 19], b: [15, -12], n: [1, 0] }, { a: [15, -12], b: [-15, -12], n: [0, -1] }, { a: [-15, -12], b: [-15, 19], n: [-1, 0] },
    ];
    const r = U.rng(61);
    const mats = [];
    const pColor = [];
    const railC = (x, y, z) => { const v = 0.6 + 0.4 * U.smoothstep(GY, GY + 0.35, y); return [v * 0.97, v, v * 0.93]; };
    const postG = new THREE.BoxGeometry(0.09, 1.25, 0.09); postG.translate(0, 0.525, 0);
    const capG = new THREE.ConeGeometry(0.075, 0.07, 4, 1); capG.rotateY(Math.PI / 4); capG.translate(0, 1.185, 0);
    const fenceGB = new GB(true);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1), ps = V3();
    for (const run of runs) {
      const ax = run.a[0], az = run.a[1], bx = run.b[0], bz = run.b[1];
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
      const rotY = Math.atan2(run.n[0], run.n[1]);
      q.setFromAxisAngle(UP, rotY);
      const nPosts = Math.ceil(L / 2.4), step = L / nPosts;
      const postTs = [];
      for (let k = 0; k <= nPosts; k++) postTs.push(k * step);
      for (const t of postTs) {
        mtx.compose(ps.set(ax + dx * t, GY - 0.1, az + dz * t), q, sc);
        fenceGB.addGeo(postG, mtx, null, railC); fenceGB.addGeo(capG, mtx, null, railC);
      }
      for (let k = 0; k < nPosts; k++) {
        for (const ry of [0.3, 0.78]) {
          const rg = new THREE.BoxGeometry(step, 0.07, 0.035);
          rg.translate(0, 0, 0);
          U.worldUV(rg, 1);
          mtx.compose(ps.set(ax + dx * (k + 0.5) * step, GY + ry, az + dz * (k + 0.5) * step), q.setFromAxisAngle(UP, Math.atan2(-dz, dx)), sc);
          fenceGB.addGeo(rg, mtx, null, railC); rg.dispose();
        }
        q.setFromAxisAngle(UP, rotY);
      }
      for (let t = 0.1; t < L - 0.05; t += 0.14) {
        if (postTs.some(pt => Math.abs(pt - t) < 0.08)) continue;
        const e = new THREE.Euler(0, rotY, (r() - 0.5) * 0.03, 'YXZ');
        const qq = new THREE.Quaternion().setFromEuler(e);
        const m = new THREE.Matrix4().compose(V3(ax + dx * t + run.n[0] * 0.035, GY + 0.05, az + dz * t + run.n[1] * 0.035), qq, V3(1, 0.96 + r() * 0.08, 1));
        mats.push(m);
        const tint = 0.86 + r() * 0.16, gtint = r() < 0.15 ? 0.94 : 1;
        pColor.push(new THREE.Color(tint * gtint, tint, tint * (0.95 + r() * 0.05)));
      }
    }
    const pickets = new THREE.InstancedMesh(pg, M.fence, mats.length);
    mats.forEach((m, i) => { pickets.setMatrixAt(i, m); pickets.setColorAt(i, pColor[i]); });
    pickets.instanceMatrix.needsUpdate = true; if (pickets.instanceColor) pickets.instanceColor.needsUpdate = true;
    pickets.name = 'outdoor.pickets'; pickets.receiveShadow = true;
    root.add(pickets);
    const fm = new THREE.Mesh(fenceGB.build('aUnused'), M.fence); fm.name = 'outdoor.fenceRails';
    stat.add(fm);
    // colliders
    box([-16, GY - 0.1, 18.95], [3.0, 1.3, 19.05], { tag: 'fence', name: 'fence_s_w' });
    box([4.5, GY - 0.1, 18.95], [16, 1.3, 19.05], { tag: 'fence', name: 'fence_s_e' });
    box([14.95, GY - 0.1, -12.05], [15.05, 1.3, 19.05], { tag: 'fence', name: 'fence_e' });
    box([-15.05, GY - 0.1, -12.05], [-14.95, 1.3, 19.05], { tag: 'fence', name: 'fence_w' });
    box([-15.05, GY - 0.1, -12.05], [15.05, 1.3, -11.95], { tag: 'fence', name: 'fence_n' });

    // ---- gate posts + arbour
    const arb = new THREE.Group(); arb.name = 'outdoor.arbour'; stat.add(arb);
    for (const x of [2.93, 4.57]) for (const z of [19.0, 18.5]) {
      U.box(arb, 0.1, 2.3, 0.1, M.trim, x, GY + 1.1, z);
      U.box(arb, 0.14, 0.12, 0.14, M.trim, x, GY + 0.0, z);
    }
    const archG = new THREE.TorusGeometry(0.82, 0.04, 6, 22, Math.PI);
    for (const z of [19.0, 18.5]) { const a = new THREE.Mesh(archG, M.trim); a.position.set(3.75, GY + 2.2, z); a.scale.set(1, 0.55, 1.2); arb.add(a); }
    for (let k = 0; k <= 8; k++) {
      const a = k / 8 * Math.PI, x = 3.75 + Math.cos(a) * 0.82, y = GY + 2.2 + Math.sin(a) * 0.82 * 0.55;
      U.box(arb, 0.04, 0.04, 0.7, M.trim, x, y + 0.03, 18.75);
    }
    for (const x of [2.93, 4.57]) {
      for (let k = 0; k < 5; k++) { U.box(arb, 0.03, 0.03, 0.46, M.trim, x, GY + 0.45 + k * 0.38, 18.75); }
      U.box(arb, 0.025, 1.9, 0.025, M.trim, x, GY + 1.2, 18.75);
    }
    // climbing roses over the arbour
    const rr = U.rng(71);
    const rsway = (x, y) => Math.max(0, y - GY - 0.5) * 0.12;
    for (let k = 0; k < 46; k++) {
      const a = rr() * Math.PI, onArch = rr() < 0.65;
      let p;
      if (onArch) p = V3(3.75 + Math.cos(a) * 0.85, GY + 2.2 + Math.sin(a) * 0.5 + (rr() - 0.3) * 0.15, 18.45 + rr() * 0.6);
      else { const x = rr() < 0.5 ? 2.93 : 4.57; p = V3(x + (x < 3.75 ? -0.05 : 0.05) * rr(), GY + 0.6 + rr() * 1.6, 18.45 + rr() * 0.6); }
      const nrm = V3(p.x - 3.75, 0.8, (rr() - 0.5)).normalize();
      card('roses', p, 0.45 + rr() * 0.3, nrm, rsway, rr);
    }
    cyl(2.93, 18.5, 0.07, GY, GY + 2.3, { name: 'arbour_post_w', force: true });
    cyl(4.57, 18.5, 0.07, GY, GY + 2.3, { name: 'arbour_post_e', force: true });

    // ---- gate leaf (dynamic, hinge at x = 3.0)
    const pivot = new THREE.Group(); pivot.name = 'outdoor.gate'; pivot.position.set(3.0, GY, 19.0); pivot.userData.dynamic = true;
    root.add(pivot);
    const leaf = new THREE.Group(); pivot.add(leaf);
    const gw = 1.5;
    U.box(leaf, 0.07, 0.95, 0.045, M.fence, 0.05, 0.08 + 0.475, 0);
    U.box(leaf, 0.07, 0.95, 0.045, M.fence, gw - 0.05, 0.08 + 0.475, 0);
    U.box(leaf, gw - 0.04, 0.07, 0.045, M.fence, gw / 2, 0.24, -0.005);
    U.box(leaf, gw - 0.04, 0.07, 0.045, M.fence, gw / 2, 0.84, -0.005);
    { const len = Math.hypot(gw - 0.24, 0.58), ang = Math.atan2(0.58, gw - 0.24); U.box(leaf, len, 0.06, 0.04, M.fence, gw / 2, 0.54, -0.006, { rz: ang }); }
    for (let k = 0; k < 9; k++) {
      const x = 0.16 + k * ((gw - 0.32) / 8), t = (x - gw / 2) / (gw / 2);
      const h = 0.78 + 0.14 * t * t;
      const m = new THREE.Mesh(pg, M.fence); m.position.set(x, 0.1, 0.03); m.scale.set(0.9, h / 0.94, 1); leaf.add(m);
    }
    for (const y of [0.24, 0.84]) U.box(leaf, 0.3, 0.035, 0.012, M.iron, 0.14, y, -0.033);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), M.iron); ring.position.set(gw - 0.05, 0.72, 0.05); leaf.add(ring);
    U.bakeStatic(leaf);
    const gate = S.gate = { pivot, open: false, angle: 0, collider: null };
    gate.collider = P.addBox([3.0, GY - 0.1, 18.96], [4.5, 1.3, 19.04], { tag: 'door', name: 'gate', blocksInteract: false });
    C.interact.add({
      id: 'gate', object: pivot, range: 2.6,
      label: () => (gate.open ? 'Close the gate' : 'Open the gate'),
      onUse: () => {
        gate.open = !gate.open;
        if (gate.open) gate.collider.set([2.95, GY - 0.1, 19.0], [3.05, 1.3, 20.5]);
        else gate.collider.set([3.0, GY - 0.1, 18.96], [4.5, 1.3, 19.04]);
        C.emit('door', { id: 'gate', open: gate.open, x: 3.75, y: GY + 0.6, z: 19.0 });
      },
    });
  });

  // ------------------------------------------------------------------ flagstone path + stepping stones
  function flagstone(x, z, w, d, rot, r) {
    const sh = new THREE.Shape(); const n = 7 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + (r() - 0.5) * 0.5, rad = 0.78 + r() * 0.32;
      const px = Math.cos(a) * w * 0.5 * rad, pz = Math.sin(a) * d * 0.5 * rad;
      if (k === 0) sh.moveTo(px, pz); else sh.lineTo(px, pz);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 1 });
    g.rotateX(Math.PI / 2); // shape y -> z, extrude +z -> -y
    g.translate(0, 0.05, 0);
    g.rotateY(rot);
    U.worldUV(g, 1);
    const tone = 0.85 + r() * 0.4, warm = (r() - 0.5) * 0.06;
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length / 3; i++) { const y = g.attributes.position.getY(i); const e = y < 0.03 ? 0.7 : 1; c[i * 3] = (tone + warm) * e; c[i * 3 + 1] = tone * e; c[i * 3 + 2] = (tone - warm) * e * 0.98; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, M.rock); m.position.set(x, GY - 0.03, z); m.receiveShadow = true; stat.add(m);
    return m;
  }
  sec('path', () => {
    const r = U.rng(81);
    let z = 7.92;
    while (z < 18.75) {
      const sz = Math.min(0.48 + r() * 0.22, 18.9 - z);
      if (sz < 0.25) break;
      if (r() < 0.5) flagstone(3.75 + (r() - 0.5) * 0.1, z + sz / 2, 1.0 + r() * 0.15, sz, (r() - 0.5) * 0.2, r);
      else { const w1 = 0.5 + r() * 0.12; flagstone(3.75 - 0.55 + w1 / 2, z + sz / 2, w1, sz, (r() - 0.5) * 0.3, r); flagstone(3.75 + w1 / 2 + 0.02, z + sz / 2 + (r() - 0.5) * 0.06, 1.08 - w1, sz * 0.95, (r() - 0.5) * 0.3, r); }
      z += sz + 0.07 + r() * 0.06;
    }
    P.addSurfaceTag(3.05, 7.8, 4.45, 19.0, GY - 0.3, GY + 0.3, 'stone');
    // stepping stones towards the pond bench
    const pts = [];
    for (let k = 0; k < 13; k++) { const t = k / 12; pts.push([2.75 - t * 10.4, 12.75 + Math.sin(t * Math.PI) * 0.45 - t * 0.35]); }
    for (const [x, zz] of pts) {
      const s = 0.42 + r() * 0.12;
      flagstone(x, zz, s * 1.15, s, r() * 3, r);
      P.addSurfaceTag(x - s * 0.5, zz - s * 0.45, x + s * 0.5, zz + s * 0.45, GY - 0.3, GY + 0.3, 'stone');
    }
    // lane lip stones at the gate
    flagstone(3.75, 19.35, 1.4, 0.55, 0.02, r);
  });

  // ------------------------------------------------------------------ puddles + pond
  sec('water', () => {
    const gb = new GB();
    const ring = (cx, cy, cz, rFn, rings, seg) => {
      const pts = [];
      for (let ri = 0; ri < rings.length; ri++) {
        const row = [];
        for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rr = rFn(a), k = rings[ri]; row.push([cx + Math.cos(a) * rr[0] * k, cy, cz + Math.sin(a) * rr[1] * k]); }
        pts.push(row);
      }
      const N = [0, 1, 0];
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        gb.tri([cx, cy, cz], pts[0][s1], pts[0][s], N, N, N, [0, 0], [0, 0], [0, 0], 0, rings[0], rings[0]);
        for (let ri = 0; ri < rings.length - 1; ri++) {
          const a = pts[ri][s], b = pts[ri][s1], c = pts[ri + 1][s1], d = pts[ri + 1][s];
          gb.tri(a, b, c, N, N, N, [0, 0], [0, 0], [0, 0], rings[ri], rings[ri], rings[ri + 1]);
          gb.tri(a, c, d, N, N, N, [0, 0], [0, 0], [0, 0], rings[ri], rings[ri + 1], rings[ri + 1]);
        }
      }
    };
    const puddle = (p, y) => {
      const ca = Math.cos(p.a || 0), sa = Math.sin(p.a || 0), seed = p.x * 1.7 + p.z * 0.3;
      const rFn = a => { const k = 1 + 0.22 * U.noise2D(Math.cos(a) * 1.2 + seed, Math.sin(a) * 1.2 - seed); return [p.rx * k, p.rz * k]; };
      const start = gb.count;
      ring(0, 0, 0, rFn, [0.45, 0.75, 0.9, 1.0], 28);
      for (let i = start * 3; i < gb.p.length; i += 3) {
        const x = gb.p[i], z = gb.p[i + 2];
        gb.p[i] = p.x + x * ca - z * sa; gb.p[i + 1] = y; gb.p[i + 2] = p.z + x * sa + z * ca;
      }
    };
    for (const p of PUDDLES) {
      puddle(p, p.lane ? GY + 0.012 : GY + 0.008);
      P.addSurfaceTag(p.x - p.rx * 0.7, p.z - p.rz * 0.7, p.x + p.rx * 0.7, p.z + p.rz * 0.7, GY - 0.3, GY + 0.3, 'water');
    }
    // small water surfaces: wheelbarrow tray, rain barrel, umbrella drip on the porch
    S.extraWater = (x, y, z, rx, rz) => puddle({ x, z, rx, rz, a: 0 }, y);
    S.waterGB = gb;
    // pond
    const pg = new GB();
    const save = gb; // reuse ring() with the pond builder
    const ringP = (rings, seg) => {
      const pts = [];
      for (let ri = 0; ri < rings.length; ri++) {
        const row = [];
        for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rr = pondR(U, a) * rings[ri]; row.push([POND.x + Math.cos(a) * rr, GY - 0.06, POND.z + Math.sin(a) * rr]); }
        pts.push(row);
      }
      const N = [0, 1, 0], c0 = [POND.x, GY - 0.06, POND.z];
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        pg.tri(c0, pts[0][s1], pts[0][s], N, N, N, [0, 0], [0, 0], [0, 0], 0, 0, 0);
        for (let ri = 0; ri < rings.length - 1; ri++) {
          const e0 = ri === 0 ? 0 : rings[ri], e1 = rings[ri + 1];
          const a = pts[ri][s], b = pts[ri][s1], c = pts[ri + 1][s1], d = pts[ri + 1][s];
          pg.tri(a, b, c, N, N, N, [0, 0], [0, 0], [0, 0], e0 * 0.9, e0 * 0.9, e1 * 0.9);
          pg.tri(a, c, d, N, N, N, [0, 0], [0, 0], [0, 0], e0 * 0.9, e1 * 0.9, e1 * 0.9);
        }
      }
    };
    void save;
    ringP([0.5, 0.8, 0.95, 1.04, 1.1], 48);
    const pond = new THREE.Mesh(pg.build(), M.pond); pond.name = 'outdoor.pond'; pond.renderOrder = 2; pond.userData.dynamic = true;
    root.add(pond);
    cyl(POND.x, POND.z, POND.r - 0.2, GY - 1, GY + 2, { tag: 'water', name: 'pond' });
    P.addSurfaceTag(POND.x - 3.3, POND.z - 3.3, POND.x + 3.3, POND.z + 3.3, GY - 0.3, GY + 0.3, 'mud');
    // shore stones
    const r = U.rng(91);
    const sg = new THREE.DodecahedronGeometry(1, 1);
    for (let k = 0; k < 34; k++) {
      const a = k / 34 * TAU + r() * 0.12, pr = pondR(U, a) * (1.0 + r() * 0.1);
      if (a > 1.2 && a < 1.9 && r() < 0.6) continue;
      const s = 0.14 + r() * 0.22;
      const g = sg.clone(); const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) { const f = 1 + 0.25 * U.noise3D(pp.getX(i) * 1.7 + k, pp.getY(i) * 1.7, pp.getZ(i) * 1.7); pp.setXYZ(i, pp.getX(i) * f, pp.getY(i) * f * 0.6, pp.getZ(i) * f); }
      g.computeVertexNormals(); g.scale(s * (1 + r() * 0.5), s, s);
      U.worldUV(g, 1);
      const c = new Float32Array(pp.count * 3), nn = g.attributes.normal;
      for (let i = 0; i < pp.count; i++) { const up = Math.max(0, nn.getY(i)); const moss = up > 0.6 && r() < 0.8 ? 0.6 : 0; c[i * 3] = 0.9 - moss * 0.45; c[i * 3 + 1] = 0.9 - moss * 0.05; c[i * 3 + 2] = 0.88 - moss * 0.5; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const m = new THREE.Mesh(g, M.rock); m.position.set(POND.x + Math.cos(a) * pr, GY - 0.05, POND.z + Math.sin(a) * pr); m.rotation.y = r() * TAU; stat.add(m);
    }
    // lily pads + a few flowers
    const lg = new THREE.CircleGeometry(1, 16, 0.35, TAU - 0.35); lg.rotateX(-Math.PI / 2);
    for (let k = 0; k < 16; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * POND.r * 0.72, s = 0.12 + r() * 0.12;
      const m = new THREE.Mesh(lg, M.lily); m.position.set(POND.x + Math.cos(a) * d, GY - 0.055, POND.z + Math.sin(a) * d); m.scale.setScalar(s); m.rotation.y = r() * TAU; stat.add(m);
      if (k % 5 === 0) {
        const fl = new THREE.Group(); fl.position.copy(m.position); fl.position.y += 0.01; stat.add(fl);
        for (let pI = 0; pI < 7; pI++) { const pe = U.sphere(fl, 0.03, U.stdMat(0xe8c8d0, 0.5, 0), 0, 0.02, 0, { w: 6, h: 4, sx: 0.5, sy: 0.35, sz: 1.2 }); const aa = pI / 7 * TAU; pe.position.set(Math.cos(aa) * 0.025, 0.02, Math.sin(aa) * 0.025); pe.rotation.set(0.5, -aa + Math.PI / 2, 0); }
        U.sphere(fl, 0.012, U.stdMat(0xd8b040, 0.6, 0), 0, 0.035, 0, { w: 6, h: 4 });
      }
    }
  });

  // ------------------------------------------------------------------ trees, bushes, beds (foliage)
  sec('trees', () => {
    deciduous({ x: -6.5, z: 14, H: 11, trunkR: 0.5, trunkH: 3.1, limbs: 6, limbLen: 4.6, elev: [0.35, 0.8], upturn: 0.45, subs: 3, fill: 7, spread: 6,
      cards: 20, clusterR: 1.45, card: 1.6, kind: 'oak', seed: 101, lean: 0.4, minLeafY: 2.6 });
    deciduous({ x: 11, z: 12, H: 9, trunkR: 0.34, trunkH: 2.5, limbs: 5, limbLen: 3.3, elev: [0.7, 1.1], upturn: 0.5, subs: 3, fill: 6, spread: 4.5,
      cards: 18, clusterR: 1.2, card: 1.35, kind: 'maple', seed: 202, lean: 0.3, minLeafY: 2.2 });
    const birches = [[13.9, -3.6, 8.8, 301], [14.3, -1.1, 7.6, 302], [10.7, 5.2, 8.2, 303], [-12.9, 6.3, 8.5, 304], [-13.7, 4.3, 7.2, 305]];
    for (const [x, z, H, sd] of birches) {
      deciduous({ x, z, H, trunkR: 0.13, trunkH: H * 0.55, limbs: 5, limbLen: H * 0.28, elev: [0.9, 1.25], upturn: 0.2, subs: 2, fill: 3, spread: 2.2,
        cards: 10, clusterR: 0.85, card: 0.85, kind: 'birch', seed: sd, lean: 0.8, droop: 0.5, birch: true, minLeafY: 2.3 });
    }
    const r = U.rng(111);
    for (let x = -13.5; x <= 13.8; x += 3.1 + r() * 0.8) pine(x + (r() - 0.5) * 0.8, -13.6 - r() * 2.2, 9 + r() * 5, 2.4 + r() * 0.9, 400 + Math.round(x * 10));
    pine(-13.6, -10.6, 10.5, 2.6, 481);
    pine(13.5, -10.3, 9.2, 2.3, 482);
    for (let k = 0; k < 7; k++) pine(-16.5 - r() * 3, -9 + k * 3.1 + r(), 9 + r() * 5, 2.4 + r() * 0.8, 490 + k);
    for (let k = 0; k < 6; k++) pine(16.8 + r() * 3, -9 + k * 3.4 + r(), 9 + r() * 5, 2.4 + r() * 0.8, 500 + k);
    // tree trunk colliders (inside the yard)
    for (const t of S.trunks) if (Math.abs(t.x) < 15 && t.z > -12 && t.z < 19) cyl(t.x, t.z, t.r, GY - 0.5, GY + 4, { tag: 'tree', name: 'trunk' });
  });
  sec('bushes', () => {
    const list = [
      [7.9, 4.1, 0.75, 1.1, 1], [7.8, -4.3, 0.7, 1.0, 2], [-7.9, 4.3, 0.6, 1.0, 3], [-7.8, -3.9, 0.65, 1.1, 4],
      [-12.5, 18.1, 0.8, 1.2, 5], [-2.2, 18.2, 0.6, 0.9, 6], [1.3, 18.25, 0.5, 0.8, 7], [7.5, 18.1, 0.7, 1.1, 8], [13.6, 17.9, 0.8, 1.2, 9],
      [14.1, 7.5, 0.7, 1.1, 10], [14.0, 2.0, 0.6, 1.0, 11], [-14.1, -2.5, 0.8, 1.2, 12], [-14.0, 11.8, 0.7, 1.1, 13],
      [-7.5, -11.1, 0.9, 1.3, 14], [9.8, -11.1, 0.8, 1.1, 15], [0.7, -11.2, 0.7, 1.0, 16],
      [0.75, 7.55, 0.55, 0.85, 17], [7.35, 7.3, 0.55, 0.9, 18], [-10.4, 11.9, 0.45, 0.6, 19], [-6.2, 10.6, 0.4, 0.55, 20],
      [2.15, 18.35, 0.38, 0.6, 21], [5.35, 18.35, 0.38, 0.6, 22], [2.35, 8.3, 0.4, 0.55, 23], [5.2, 8.3, 0.4, 0.55, 24],
    ];
    for (const [x, z, rad, h, sd] of list) bush(x, z, rad, h, 'bush', 600 + sd, { collide: rad >= 0.6 });
    // hydrangeas + flower bed along the south facade (low, no colliders)
    for (const [x, z, s, sd] of [[-6.3, 5.55, 0.42, 1], [-5.75, 5.5, 0.36, 2], [-2.05, 5.55, 0.4, 3], [-1.35, 5.5, 0.36, 4], [-0.35, 5.55, 0.4, 5], [0.55, 5.5, 0.34, 6]]) {
      bush(x, z, s, 0.78 + s * 0.3, 'hydrangea', 700 + sd, { cards: 16, card: 0.5 });
    }
    const r = U.rng(121);
    const fsway = (x, y) => Math.max(0, y - GY) * 0.6;
    for (let k = 0; k < 34; k++) {
      const x = -5.1 + r() * 2.5, z = 5.2 + r() * 0.62;
      card('flowers', V3(x, GY + 0.04, z), 0.38 + r() * 0.18, V3(0, 0.8, 0.6).normalize(), fsway, r, 'upright');
    }
    for (let k = 0; k < 14; k++) {
      const x = -6.7 + r() * 7.6, z = 5.72 + r() * 0.15;
      card('flowers', V3(x, GY + 0.04, z), 0.3 + r() * 0.12, V3(0, 0.8, 0.6).normalize(), fsway, r, 'upright');
    }
    // flower-bed soil + stone edging
    const bed = U.boxAt(stat, -6.8, GY - 0.02, 5.08, 1.0, GY + 0.045, 5.92, M.soil); bed.name = 'outdoor.flowerbed';
    const eg = new THREE.DodecahedronGeometry(1, 0);
    for (let x = -6.75; x < 0.98; x += 0.2 + r() * 0.06) {
      const m = new THREE.Mesh(eg, M.rock); const s = 0.07 + r() * 0.03;
      m.position.set(x, GY + 0.03, 5.95 + (r() - 0.5) * 0.03); m.scale.set(s * 1.3, s * 0.8, s); m.rotation.set(r(), r() * 3, r()); stat.add(m);
    }
  });

  // ------------------------------------------------------------------ grass tufts (one instanced draw call) + reeds
  sec('grass', () => {
    const tuft = new GB(true);
    { const r = U.rng(131);
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + r() * 0.6, dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
        const h = 0.18 + r() * 0.2, w = 0.011 + r() * 0.008, lean = 0.05 + r() * 0.12, r0 = 0.012 + r() * 0.03;
        const b0 = [dx * r0 - px * w, 0, dz * r0 - pz * w], b1 = [dx * r0 + px * w, 0, dz * r0 + pz * w];
        const mo = r0 + lean * 0.45, m0 = [dx * mo - px * w * 0.7, h * 0.55, dz * mo - pz * w * 0.7], m1 = [dx * mo + px * w * 0.7, h * 0.55, dz * mo + pz * w * 0.7];
        const tp = [dx * (r0 + lean * 1.25), h, dz * (r0 + lean * 1.25)];
        const n = new THREE.Vector3(dx * 0.35, 1, dz * 0.35).normalize(), N = [n.x, n.y, n.z];
        const cb = [0.03, 0.055, 0.025], cm = [0.075, 0.12, 0.045], ct = [0.14 + r() * 0.04, 0.2, 0.07];
        const sw = y => y / 0.38;
        tuft.tri(b0, b1, m1, N, N, N, [0, 0], [1, 0], [1, 0.5], 0, 0, sw(h * 0.55), cb, cb, cm);
        tuft.tri(b0, m1, m0, N, N, N, [0, 0], [1, 0.5], [0, 0.5], 0, sw(h * 0.55), sw(h * 0.55), cb, cm, cm);
        tuft.tri(m0, m1, tp, N, N, N, [0, 0.5], [1, 0.5], [0.5, 1], sw(h * 0.55), sw(h * 0.55), sw(h), cm, cm, ct);
      }
    }
    const tg = tuft.build();
    const r = U.rng(141);
    const inHouse = (x, z) => x > -7.1 && x < 7.1 && z > -5.1 && z < 5.1;
    const blocked = (x, z) => {
      if (inHouse(x, z)) return true;
      if (x > 1.1 && x < 6.9 && z > 4.9 && z < 7.85) return true;
      if (z > 7.7 && z < 19.1 && Math.abs(x - 3.75) < 0.6) return true;
      if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 0.95) return true;
      if (x > -6.8 && x < 1.0 && z > 5.05 && z < 5.95) return true;
      if (x > 1.9 && x < 9.1 && z > -10.1 && z < -6.9) return true;
      if (x > -13.1 && x < -9.9 && z > -9.3 && z < -6.7) return true;
      if (x > -8.35 && x < -7.0 && z > -1.6 && z < 1.3) return true;
      if (z > 19.55 && z < 23.05 && Math.abs(z - 21.3) > 0.28) return true;
      if (z > 23.4 && z < 24.9) return true;
      for (const p of PUDDLES) if (Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz) < 0.95) return true;
      return false;
    };
    const pts = [];
    const push = (x, z, s = 1, tall = 1, dry = 0) => { if (!blocked(x, z)) pts.push([x, z, s, tall, dry]); };
    for (let k = 0; k < 1500; k++) { // house perimeter
      const side = r(), off = Math.pow(r(), 1.6) * 1.3 + 0.05;
      let x, z;
      if (side < 0.3) { x = -7 + r() * 14; z = -5 - off; } else if (side < 0.5) { x = -7 - off; z = -5 + r() * 10; }
      else if (side < 0.7) { x = 7 + off; z = -5 + r() * 10; } else { x = -7.3 + r() * 14.6; z = 5 + off; }
      push(x, z, 0.8 + r() * 0.5, 1.1);
    }
    for (let k = 0; k < 900; k++) { const z = 7.8 + r() * 11.2, sd = r() < 0.5 ? -1 : 1; push(3.75 + sd * (0.6 + Math.pow(r(), 1.5) * 0.8), z, 0.7 + r() * 0.5, 1); }
    const fenceLen = [[-15, 19, 15, 19], [15, -12, 15, 19], [-15, -12, 15, -12], [-15, -12, -15, 19]];
    for (let k = 0; k < 2600; k++) {
      const f = fenceLen[(r() * 4) | 0], t = r();
      const x = f[0] + (f[2] - f[0]) * t, z = f[1] + (f[3] - f[1]) * t, off = (r() - 0.5) * 1.3;
      const horiz = f[1] === f[3];
      push(horiz ? x : x + off, horiz ? z + off : z, 0.9 + r() * 0.6, 1.3 + r() * 0.5, r() < 0.3 ? 1 : 0);
    }
    for (const t of S.trunks) if (Math.abs(t.x) < 16 && t.z > -12.5 && t.z < 19.5) for (let k = 0; k < 70; k++) { const a = r() * TAU, d = t.r + 0.05 + Math.pow(r(), 1.5) * 1.4; push(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.8 + r() * 0.6, 1.2); }
    for (let k = 0; k < 500; k++) { const a = r() * TAU, d = pondR(U, a) * (1.0 + r() * 0.35); push(POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d, 0.9 + r() * 0.6, 1.4); }
    for (let k = 0; k < 1600; k++) { const x = -40 + r() * 80, z = r() < 0.55 ? 19.08 + r() * 0.5 : 23.05 + r() * 0.4; push(x, z, 0.9 + r() * 0.6, 1.3, r() < 0.35 ? 1 : 0); }
    for (let k = 0; k < 260; k++) { push(-40 + r() * 80, 21.3 + (r() - 0.5) * 0.5, 0.6 + r() * 0.3, 0.7); }
    for (let c = 0; c < 110; c++) { // lawn clumps
      const cx = -14.5 + r() * 29, cz = -11.5 + r() * 30;
      const n = 6 + (r() * 12) | 0;
      for (let k = 0; k < n; k++) push(cx + (r() - 0.5) * 1.2, cz + (r() - 0.5) * 1.2, 0.6 + r() * 0.5, 0.9);
    }
    for (let k = 0; k < 500; k++) { // around structures & puddles
      const p = PUDDLES[(r() * PUDDLES.length) | 0], a = r() * TAU, d = 1.0 + r() * 0.35;
      push(p.x + Math.cos(a) * p.rx * d, p.z + Math.sin(a) * p.rz * d, 0.7 + r() * 0.4, 1);
    }
    const im = new THREE.InstancedMesh(tg, M.grass, pts.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = V3(), pv = V3(), col = new THREE.Color();
    pts.forEach(([x, z, s, tall, dry], i) => {
      qq.setFromAxisAngle(UP, r() * TAU);
      m4.compose(pv.set(x, GY - 0.01, z), qq, sv.set(s, s * tall * (0.8 + r() * 0.4), s));
      im.setMatrixAt(i, m4);
      const v = 0.8 + r() * 0.35;
      if (dry) col.setRGB(v * 1.45, v * 1.2, v * 0.8); else col.setRGB(v * (0.95 + r() * 0.1), v, v * (0.9 + r() * 0.1));
      im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.name = 'outdoor.grassTufts'; im.receiveShadow = true;
    root.add(im);
    S.grass = { mesh: im, count: pts.length };
    // reeds at the pond (second instanced mesh)
    const reed = new GB(true);
    { const rr = U.rng(151);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU + rr(), dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx, h = 1.0 + rr() * 0.5, w = 0.012, lean = 0.1 + rr() * 0.15;
        const b0 = [-px * w, 0, -pz * w], b1 = [px * w, 0, pz * w], tp = [dx * lean, h, dz * lean];
        const m0 = [dx * lean * 0.3 - px * w * 0.8, h * 0.5, dz * lean * 0.3 - pz * w * 0.8], m1 = [dx * lean * 0.3 + px * w * 0.8, h * 0.5, dz * lean * 0.3 + pz * w * 0.8];
        const N = [dx * 0.3, 1, dz * 0.3], cb = [0.05, 0.07, 0.03], cm = [0.12, 0.14, 0.05], ct = [0.25, 0.24, 0.1];
        reed.tri(b0, b1, m1, N, N, N, [0, 0], [1, 0], [1, 0.5], 0, 0, 0.5, cb, cb, cm);
        reed.tri(b0, m1, m0, N, N, N, [0, 0], [1, 0.5], [0, 0.5], 0, 0.5, 0.5, cb, cm, cm);
        reed.tri(m0, m1, tp, N, N, N, [0, 0.5], [1, 0.5], [0.5, 1], 0.5, 0.5, 1, cm, cm, ct);
      }
      const head = new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6); head.translate(0.02, 1.25, 0.01);
      reed.addGeo(head, new THREE.Matrix4(), (x, y) => y / 1.4, () => [0.13, 0.07, 0.035]);
      const stalk = new THREE.CylinderGeometry(0.005, 0.006, 1.35, 4); stalk.translate(0.02, 0.67, 0.01);
      reed.addGeo(stalk, new THREE.Matrix4(), (x, y) => y / 1.4, () => [0.12, 0.13, 0.05]);
    }
    const rpts = [];
    for (let c = 0; c < 7; c++) {
      const a = c / 7 * TAU + r() * 0.5; if (a > 1.1 && a < 2.1) continue;
      const pr = pondR(U, a);
      for (let k = 0; k < 9; k++) { const aa = a + (r() - 0.5) * 0.3, d = pr * (0.88 + r() * 0.2); rpts.push([POND.x + Math.cos(aa) * d, POND.z + Math.sin(aa) * d]); }
    }
    const rm = new THREE.InstancedMesh(reed.build(), M.grass, rpts.length);
    rpts.forEach(([x, z], i) => { qq.setFromAxisAngle(UP, r() * TAU); const s = 0.8 + r() * 0.4; m4.compose(pv.set(x, GY - 0.08, z), qq, sv.set(s, s, s)); rm.setMatrixAt(i, m4); rm.setColorAt(i, col.setRGB(0.9 + r() * 0.2, 0.9 + r() * 0.2, 0.9)); });
    rm.instanceMatrix.needsUpdate = true; if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    rm.name = 'outdoor.reeds'; root.add(rm);
  });

  // ------------------------------------------------------------------ garden structures
  sec('shed', () => {
    const g = new THREE.Group(); g.name = 'outdoor.shed'; g.position.set(-11.5, GY, -8); stat.add(g);
    const W = 3.0, D = 2.4, Hw = 2.05, Hr = 2.8;
    U.boxAt(g, -1.58, -0.1, -1.28, 1.58, 0.12, 1.28, M.rock);
    U.boxAt(g, -1.5, 0.12, -1.2, 1.5, Hw, -1.1, M.shedWall);
    U.boxAt(g, -1.5, 0.12, 1.1, 1.5, Hw, 1.2, M.shedWall);
    U.boxAt(g, -1.5, 0.12, -1.1, -1.4, Hw, 1.1, M.shedWall);
    U.boxAt(g, 1.4, 0.12, -1.1, 1.5, Hw, 1.1, M.shedWall);
    // battens
    for (let x = -1.45; x <= 1.46; x += 0.3) { U.box(g, 0.045, Hw - 0.12, 0.025, M.shedWall, x, 0.12 + (Hw - 0.12) / 2, 1.215); U.box(g, 0.045, Hw - 0.12, 0.025, M.shedWall, x, 0.12 + (Hw - 0.12) / 2, -1.215); }
    // gables
    const gs = new THREE.Shape(); gs.moveTo(-1.2, Hw); gs.lineTo(1.2, Hw); gs.lineTo(0, Hr); gs.lineTo(-1.2, Hw);
    for (const x of [-1.5, 1.4]) { const m = U.extrude(g, gs, 0.1, M.shedWall); m.rotation.y = Math.PI / 2; m.position.x = x; }
    // roof
    const ang = Math.atan2(Hr - Hw, 1.2), half = 1.45, slab = half / Math.cos(ang);
    for (const sgn of [1, -1]) {
      const m = U.box(g, W + 0.5, 0.07, slab, M.shingles, 0, Hr + 0.04 - (half / 2) * Math.tan(ang), sgn * half / 2, { rx: sgn * ang });
      m.name = 'outdoor.shedRoof';
      U.box(g, W + 0.52, 0.12, 0.04, M.trim, 0, Hr + 0.0 - half * Math.tan(ang) + 0.02, sgn * (half + 0.0));
    }
    U.box(g, W + 0.55, 0.08, 0.14, M.trim, 0, Hr + 0.08, 0);
    // door + window on the south face
    const door = U.boxAt(g, -1.1, 0.14, 1.2, -0.28, 1.9, 1.245, M.doorGreen);
    door.name = 'outdoor.shedDoor';
    U.box(g, 0.78, 0.07, 0.03, M.trim, -0.69, 0.45, 1.26); U.box(g, 0.78, 0.07, 0.03, M.trim, -0.69, 1.6, 1.26);
    U.box(g, 0.95, 0.06, 0.03, M.trim, -0.69, 1.02, 1.26, { rz: 1.02 });
    U.box(g, 0.08, 0.08, 0.05, M.brass, -0.38, 1.02, 1.28);
    U.boxAt(g, 0.3, 1.0, 1.2, 1.1, 1.65, 1.235, M.shedWin);
    for (const [x0, y0, x1, y1] of [[0.25, 0.95, 1.15, 1.0], [0.25, 1.65, 1.15, 1.7], [0.25, 0.95, 0.3, 1.7], [1.1, 0.95, 1.15, 1.7], [0.68, 1.0, 0.72, 1.65], [0.3, 1.305, 1.1, 1.345]]) U.boxAt(g, x0, y0, 1.225, x1, y1, 1.26, M.trim);
    U.boxAt(g, 0.2, 0.9, 1.22, 1.2, 0.95, 1.33, M.trim);
    // window box with flowers
    U.boxAt(g, 0.28, 0.72, 1.24, 1.12, 0.9, 1.44, M.woodDark);
    const r = U.rng(161);
    for (let k = 0; k < 7; k++) card('flowers', V3(-11.5 + 0.35 + k * 0.11, GY + 0.86, -8 + 1.34 + (r() - 0.5) * 0.06), 0.3, V3(0, 0.6, 0.8).normalize(), () => 0.1, r, 'upright');
    // rain barrel
    const bx = -9.72, bz = -6.85;
    U.cyl(stat, 0.3, 0.27, 0.9, M.woodMed, bx, GY + 0.45, bz, { radial: 16 });
    for (const y of [0.15, 0.45, 0.78]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.29 + (y < 0.4 ? -0.01 : 0.005), 0.012, 4, 20), M.iron); t.rotation.x = Math.PI / 2; t.position.set(bx, GY + y, bz); stat.add(t); }
    S.extraWater(bx, GY + 0.86, bz, 0.27, 0.27);
    cyl(bx, bz, 0.32, GY, GY + 0.95, { name: 'rain_barrel' });
    // downpipe from the shed gutter into the barrel
    U.cyl(stat, 0.035, 0.035, 1.3, M.galv, -10.0, GY + 1.45, -6.78, { radial: 8 });
    U.box(stat, 3.1, 0.07, 0.09, M.galv, -11.5, GY + Hw - 0.02 + 0.03, -6.66);
    // tools leaning + pots
    const rake = new THREE.Group(); rake.position.set(-13.1, GY, -7.3); rake.rotation.z = -0.22; stat.add(rake);
    U.cyl(rake, 0.015, 0.015, 1.6, M.woodMed, 0, 0.8, 0, { radial: 6 }); U.box(rake, 0.02, 0.03, 0.4, M.iron, 0, 0.02, 0);
    for (let k = 0; k < 3; k++) U.lathe(stat, [[0.001, 0], [0.09, 0], [0.12, 0.16], [0.13, 0.17], [0.12, 0.17]], M.terracotta, -10.35, GY + k * 0.13, -6.45, { segments: 14 });
    shadow(-11.5, GY, -8, 3.6, 3.0, 0.3);
    box([-13.05, GY, -9.25], [-9.95, GY + 2.9, -6.75], { tag: 'wall', name: 'shed', blocksInteract: true });
  });
  sec('woodpile', () => {
    // log stack: instanced cylinders along X, two rows deep, below the window sills (top ≤ y 0.82)
    const r = U.rng(171);
    const logs = [];
    for (const [xc, len] of [[-7.34, 0.5], [-7.86, 0.46]]) {
      let y = GY + 0.1, layer = 0;
      while (y < 0.72) {
        const rad = 0.075;
        const zs = -1.42 + (layer % 2 ? rad : 0);
        for (let z = zs + rad; z < 1.12 - rad * 0.5; z += rad * 2 + 0.006) {
          const rr = rad * (0.8 + r() * 0.35);
          logs.push([xc + (r() - 0.5) * 0.05, y + rr, z, rr, len * (0.9 + r() * 0.15), r() * TAU]);
        }
        y += rad * 1.75; layer++;
      }
    }
    const lg = new THREE.CylinderGeometry(1, 1, 1, 9, 1);
    const im = new THREE.InstancedMesh(lg, [M.barkLog, M.logEnd, M.logEnd], logs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    logs.forEach(([x, y, z, rr, len, roll], i) => { e.set(0, roll, Math.PI / 2, 'ZYX'); q.setFromEuler(e); m4.compose(V3(x, y, z), q, V3(rr, len, rr)); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; im.name = 'outdoor.woodpile';
    root.add(im);
    // base rails, lean-to roof on posts
    for (const z of [-1.3, -0.2, 0.9]) U.boxAt(stat, -8.12, GY, z - 0.05, -7.05, GY + 0.1, z + 0.05, M.wood);
    for (const z of [-1.6, 1.3]) { U.boxAt(stat, -8.4, GY, z - 0.045, -8.31, GY + 2.21, z + 0.045, M.wood); }
    U.boxAt(stat, -7.12, GY + 2.72, -1.75, -7.02, GY + 2.84, 1.45, M.wood);
    const ang = Math.atan2(0.62, 1.55), len = 1.62 / Math.cos(ang);
    const roof = U.box(stat, len, 0.06, 3.3, M.shingles, -7.02 - 0.8, GY + 2.84 - 0.8 * Math.tan(ang) + 0.03, -0.15, { rz: ang });
    roof.name = 'outdoor.leanToRoof';
    U.boxAt(stat, -8.46, GY + 2.21, -1.75, -8.26, GY + 2.31, 1.45, M.wood);
    for (const z of [-1.6, -0.15, 1.3]) U.box(stat, len, 0.07, 0.06, M.wood, -7.02 - 0.8, GY + 2.84 - 0.8 * Math.tan(ang) - 0.04, z, { rz: ang });
    // chopping block + axe + kindling
    U.cyl(stat, 0.22, 0.24, 0.45, M.barkLog, -8.95, GY + 0.225, -0.95, { radial: 14 });
    U.cyl(stat, 0.215, 0.215, 0.01, M.logEnd, -8.95, GY + 0.455, -0.95, { radial: 14 });
    const axe = new THREE.Group(); axe.position.set(-8.93, GY + 0.46, -0.95); axe.rotation.set(0.25, 0.4, 0.5); stat.add(axe);
    U.cyl(axe, 0.018, 0.022, 0.75, M.woodMed, 0, 0.36, 0, { radial: 6 }); U.box(axe, 0.03, 0.09, 0.16, M.iron, 0, 0.02, 0.05);
    for (let k = 0; k < 6; k++) { const m = U.box(stat, 0.05, 0.3, 0.05, M.logEnd, -8.7 + r() * 0.2, GY + 0.03, -1.3 + r() * 0.2, { rx: 1.5 + r() * 0.2, ry: r() * 3 }); m.name = 'kindling'; }
    shadow(-7.6, GY, -0.15, 1.6, 3.2, 0.4);
    box([-8.45, GY, -1.65], [-7.0, GY + 1.3, 1.35], { name: 'woodpile' });
    cyl(-8.95, -0.95, 0.25, GY, GY + 0.5, { name: 'chopping_block' });
  });
  sec('vegbeds', () => {
    const r = U.rng(181);
    const plantSway = (x, y) => Math.max(0, y - GY - 0.3) * 0.5;
    const beds = [[2.0, 4.0, 'cabbage'], [4.5, 6.5, 'lettuce'], [7.0, 9.0, 'beans']];
    for (const [x0, x1, kind] of beds) {
      const z0 = -10, z1 = -7, h = 0.38, t = 0.05;
      U.boxAt(stat, x0, GY - 0.05, z0, x1, GY + h, z0 + t, M.wood);
      U.boxAt(stat, x0, GY - 0.05, z1 - t, x1, GY + h, z1, M.wood);
      U.boxAt(stat, x0, GY - 0.05, z0 + t, x0 + t, GY + h, z1 - t, M.wood);
      U.boxAt(stat, x1 - t, GY - 0.05, z0 + t, x1, GY + h, z1 - t, M.wood);
      for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) U.box(stat, 0.08, 0.5, 0.08, M.wood, px + (px === x0 ? 0.04 : -0.04), GY + 0.2, pz + (pz === z0 ? 0.04 : -0.04));
      U.boxAt(stat, x0 + t, GY, z0 + t, x1 - t, GY + h - 0.06, z1 - t, M.soil);
      shadow((x0 + x1) / 2, GY, (z0 + z1) / 2, x1 - x0 + 0.5, 3.5, 0.3);
      for (let row = 0; row < 3; row++) {
        const x = x0 + 0.42 + row * ((x1 - x0 - 0.84) / 2);
        for (let z = z0 + 0.35; z < z1 - 0.3; z += 0.42) {
          const px = x + (r() - 0.5) * 0.08, pz = z + (r() - 0.5) * 0.08, top = GY + h - 0.06;
          if (kind === 'cabbage') {
            U.sphere(stat, 0.12 + r() * 0.03, M.cabbage, px, top + 0.08, pz, { w: 9, h: 7, sy: 0.8 });
            for (let k = 0; k < 4; k++) card('bush', V3(px + (r() - 0.5) * 0.12, top + 0.06, pz + (r() - 0.5) * 0.12), 0.28, V3(0, 1, 0), () => 0.05, r);
          } else if (kind === 'lettuce') {
            U.sphere(stat, 0.1, M.lettuce, px, top + 0.05, pz, { w: 8, h: 6, sy: 0.6 });
            card('flowers', V3(px, top, pz), 0.22, V3(0, 1, 0), plantSway, r, 'upright');
          }
        }
      }
      if (kind === 'beans') {
        for (let k = 0; k < 3; k++) {
          const cz = z0 + 0.6 + k * 0.9, cx = (x0 + x1) / 2, top = GY + h + 1.75;
          for (let c = 0; c < 5; c++) {
            const a = c / 5 * TAU, bx = cx + Math.cos(a) * 0.45, bz = cz + Math.sin(a) * 0.3;
            const len = Math.hypot(cx - bx, top - GY - h, cz - bz);
            const cane = U.cyl(stat, 0.01, 0.012, len, U.stdMat(0x8a7a52, 0.8, 0), (bx + cx) / 2, (GY + h + top) / 2, (bz + cz) / 2, { radial: 5 });
            cane.lookAt(cx, top, cz); cane.rotateX(Math.PI / 2);
            for (let l = 0; l < 4; l++) { const t = 0.15 + l * 0.2; card('bush', V3(bx + (cx - bx) * t, GY + h + (top - GY - h) * t, bz + (cz - bz) * t), 0.42, V3(Math.cos(a), 0.4, Math.sin(a)).normalize(), plantSway, r); }
          }
        }
      }
      box([x0, GY, z0], [x1, GY + 0.55, z1], { name: 'vegbed' });
    }
    P.addSurfaceTag(1.6, -10.6, 9.6, -6.4, GY - 0.3, GY + 0.3, 'mud');
    // pumpkins
    for (const [x, z, s] of [[9.45, -7.4, 0.24], [9.6, -8.1, 0.18], [9.35, -9.2, 0.21]]) {
      const g = new THREE.SphereGeometry(s, 16, 10); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 4)), 0.5); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.72, p.getZ(i) * k); }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, M.pumpkin); m.position.set(x, GY + s * 0.66, z); stat.add(m);
      U.cyl(stat, 0.018, 0.024, 0.08, M.stem, x, GY + s * 1.38, z, { radial: 6 });
      shadow(x, GY, z, s * 2.6, s * 2.6, 0.4);
    }
    // wheelbarrow (with rainwater) + watering can
    const wb = new THREE.Group(); wb.name = 'outdoor.wheelbarrow'; wb.position.set(10.2, GY, -8.6); wb.rotation.y = 0.5; stat.add(wb);
    const tray = [[0, 0.42, 0, 0.62, 0.03, 0.9], [0, 0.6, -0.47, 0.66, 0.36, 0.03, 0.35], [0, 0.6, 0.47, 0.66, 0.36, 0.03, -0.35], [-0.33, 0.6, 0, 0.03, 0.36, 0.95, 0, 0.3], [0.33, 0.6, 0, 0.03, 0.36, 0.95, 0, -0.3]];
    for (const [x, y, z, w, h, d, rx = 0, rz = 0] of tray) U.box(wb, w, h, d, M.galv, x, y, z, { rx, rz });
    for (const sx of [-0.22, 0.22]) { U.box(wb, 0.04, 0.04, 1.5, M.woodMed, sx, 0.45, 0.25, { rx: -0.12 }); U.box(wb, 0.035, 0.4, 0.035, M.galv, sx, 0.2, 0.35); }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 18), M.rubber); wheel.rotation.y = Math.PI / 2; wheel.position.set(0, 0.2, -0.62); wb.add(wheel);
    U.cyl(wb, 0.04, 0.04, 0.12, M.galv, 0, 0.2, -0.62, { rz: Math.PI / 2, radial: 8 });
    wb.updateMatrixWorld(true);
    { const wp = V3(0, 0.7, 0).applyMatrix4(wb.matrixWorld); S.extraWater(wp.x, wp.y, wp.z, 0.28, 0.4); }
    shadow(10.2, GY, -8.6, 1.0, 1.6, 0.35);
    box([9.55, GY, -9.4], [10.85, GY + 0.8, -7.8], { name: 'wheelbarrow' });
    const can = new THREE.Group(); can.position.set(1.55, GY, -6.65); can.rotation.y = 0.8; stat.add(can);
    U.cyl(can, 0.11, 0.12, 0.28, M.galv, 0, 0.14, 0, { radial: 14 });
    const spout = U.cyl(can, 0.015, 0.025, 0.36, M.galv, 0.18, 0.24, 0, { rz: -0.9, radial: 6 }); void spout;
    U.cyl(can, 0.035, 0.02, 0.05, M.galv, 0.32, 0.37, 0, { rz: -0.9, radial: 8 });
    const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 5, 12, Math.PI), M.galv); hdl.position.set(-0.02, 0.28, 0); can.add(hdl);
    shadow(1.55, GY, -6.65, 0.4, 0.4, 0.4);
  });
  sec('bench', () => {
    const g = new THREE.Group(); g.name = 'outdoor.bench'; g.position.set(-9, GY, 13.2); g.rotation.y = Math.PI; g.userData.dynamic = true; root.add(g);
    for (let k = 0; k < 4; k++) U.box(g, 1.5, 0.035, 0.09, M.woodMed, 0, 0.45, 0.17 - k * 0.105, { round: 0.012 });
    for (let k = 0; k < 3; k++) U.box(g, 1.5, 0.09, 0.03, M.woodMed, 0, 0.62 + k * 0.13, -0.24 - k * 0.025, { rx: -0.2, round: 0.01 });
    for (const sx of [-0.68, 0.68]) {
      U.box(g, 0.05, 0.45, 0.05, M.iron, sx, 0.225, 0.18);
      U.box(g, 0.05, 0.92, 0.05, M.iron, sx, 0.46, -0.22, { rx: -0.12 });
      U.box(g, 0.05, 0.04, 0.5, M.iron, sx, 0.43, -0.02);
      U.box(g, 0.06, 0.04, 0.48, M.iron, sx, 0.68, 0.02);
      U.box(g, 0.045, 0.24, 0.045, M.iron, sx, 0.56, 0.2);
    }
    U.bakeStatic(g);
    shadow(-9, GY, 13.2, 1.9, 0.9, 0.45);
    box([-9.8, GY, 12.9], [-8.2, GY + 0.95, 13.5], { name: 'bench' });
    const seat = { id: 'bench', position: [-9, GY + 1.17, 13.28], yaw: 0, pitch: -0.08, yawRange: 1.3, pitchMin: -0.9, pitchMax: 0.9, exit: [-9, GY, 12.45], label: 'Stand up' };
    C.interact.add({ id: 'bench', object: g, label: 'Sit on the bench', range: 2.3, onUse: () => C.player.sitAt(seat) });
  });
  sec('mailbox', () => {
    const g = new THREE.Group(); g.name = 'outdoor.mailbox'; g.position.set(2.2, GY, 19.8); stat.add(g);
    U.box(g, 0.09, 1.05, 0.09, M.wood, 0, 0.52, 0);
    U.box(g, 0.24, 0.04, 0.46, M.wood, 0, 1.05, 0.02);
    U.box(g, 0.22, 0.14, 0.44, M.mailbox, 0, 1.14, 0.02);
    U.cyl(g, 0.11, 0.11, 0.44, M.mailbox, 0, 1.21, 0.02, { rx: -Math.PI / 2, thetaStart: -Math.PI / 2, thetaLength: Math.PI, radial: 14 });
    U.box(g, 0.012, 0.2, 0.03, M.flag, 0.12, 1.28, -0.05); U.box(g, 0.012, 0.07, 0.1, M.flag, 0.12, 1.34, -0.1);
    U.box(g, 0.2, 0.2, 0.015, M.mailbox, 0, 1.18, 0.245);
    shadow(2.2, GY + 0.01, 19.8, 0.4, 0.4, 0.4);
    cyl(2.2, 19.8, 0.14, GY, GY + 1.35, { name: 'mailbox' });
  });

  // ------------------------------------------------------------------ streetlamp (lamp_street)
  sec('streetlamp', () => {
    const X = 6.2, Z = 20.2;
    const g = new THREE.Group(); g.name = 'outdoor.streetlamp'; g.position.set(X, GY, Z); stat.add(g);
    U.lathe(g, [[0.001, 0], [0.22, 0], [0.22, 0.08], [0.17, 0.12], [0.15, 0.32], [0.12, 0.36], [0.09, 0.5], [0.07, 0.62], [0.001, 0.62]], M.iron, 0, 0, 0, { segments: 16 });
    U.cyl(g, 0.045, 0.055, 2.5, M.iron, 0, 0.62 + 1.25, 0, { radial: 12 });
    U.cyl(g, 0.07, 0.06, 0.08, M.iron, 0, 3.12, 0, { radial: 12 });
    U.box(g, 0.56, 0.035, 0.035, M.iron, 0, 2.8, 0);
    for (const sx of [-0.28, 0.28]) U.sphere(g, 0.03, M.iron, sx, 2.8, 0, { w: 8, h: 6 });
    U.cyl(g, 0.17, 0.1, 0.07, M.iron, 0, 3.19, 0, { radial: 4, ry: Math.PI / 4 });
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; const b = U.box(g, 0.02, 0.5, 0.02, M.iron, Math.cos(a) * 0.19, 3.47, Math.sin(a) * 0.19); b.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 4, 1), M.iron); cap.rotation.y = Math.PI / 4; cap.position.set(0, 3.84, 0); g.add(cap);
    U.sphere(g, 0.045, M.iron, 0, 4.0, 0, { w: 8, h: 6 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffbf70, emissiveIntensity: 2.2, roughness: 0.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, name: 'outdoor.streetGlass' });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.15, 0.5, 4, 1, true), glassM);
    glass.rotation.y = Math.PI / 4; glass.position.set(X, GY + 3.47, Z); glass.userData.dynamic = true; glass.name = 'outdoor.streetGlass'; root.add(glass);
    const bulbM = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffc27a, emissiveIntensity: 5, roughness: 0.3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bulbM); bulb.position.set(X, GY + 3.42, Z); bulb.userData.dynamic = true; root.add(bulb);
    const glow = U.glowSprite(0xffc27a, 2.2, 0.55); glow.position.set(X, GY + 3.45, Z); root.add(glow);
    const light = new THREE.SpotLight(0xffc070, 150, 0, 0.82, 0.6, 2);
    light.name = 'lamp_street'; light.position.set(X, GY + 3.35, Z); light.target.position.set(X, GY, Z);
    light.castShadow = false;
    root.add(light); root.add(light.target);
    C.registerLight(light, { id: 'lamp_street', room: 'lane', kind: 'spot' });
    // visible light cone with rain streaks
    const coneM = new THREE.ShaderMaterial({
      uniforms: { uTime: SH.uTime, uRain: WT.uRain, uInt: { value: 1 }, uColor: { value: new THREE.Color(0xffc27a) } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV;\nvoid main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime; uniform float uRain; uniform float uInt; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float soft = pow(max(facing, 0.0), 1.8);
  float y = vUv.y;
  float fall = mix(0.15, 1.0, y * y) * smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.93, y);
  float cols = 160.0; float cx = floor(vUv.x * cols);
  float sp = 2.0 + h1(vec2(cx, 1.0)) * 1.6;
  float yy = y * 7.0 + uTime * sp + h1(vec2(cx, 7.0)) * 10.0;
  float cell = floor(yy); float f = yy - cell;
  float on = step(1.0 - uRain * 0.5, h1(vec2(cx, cell)));
  float streak = on * smoothstep(0.0, 0.05, f) * smoothstep(0.4, 0.06, f) * smoothstep(0.5, 0.1, abs(fract(vUv.x * cols) - 0.5));
  float a = (0.045 * soft + 0.3 * streak * soft) * fall * uInt;
  gl_FragColor = vec4(uColor * a, 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const coneH = 3.5;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 2.6, coneH, 36, 1, true), coneM);
    cone.position.set(X, GY + 3.3 - coneH / 2, Z); cone.name = 'outdoor.lightCone'; cone.userData.dynamic = true; cone.renderOrder = 5;
    root.add(cone);
    S.street = { light, glassM, bulbM, glow, coneM, level: 1, target: 1 };
    cyl(X, Z, 0.2, GY, GY + 4, { name: 'streetlamp' });
    shadow(X, GY + 0.005, Z, 0.8, 0.8, 0.4);
  });

  // ------------------------------------------------------------------ porch: lantern + furniture
  sec('porch_lantern', () => {
    const pos = [4.85, 1.95, 5.02];
    const on0 = (C.env.daylight ?? 0.45) < LAMP_ON_BELOW;
    if (C.props && typeof C.props.lamp === 'function') {
      const lamp = C.props.lamp({ id: 'lamp_porch', type: 'lantern', position: pos, rotationY: 0, on: on0, color: 0xffb060, intensity: 10,
        metal: 'iron', label: 'porch lantern', parent: root, room: 'porch' });
      S.porch = { props: lamp, setOn: (v) => { if (lamp.on !== v) lamp.setOn(v); } };
      return;
    }
    const g = new THREE.Group(); g.name = 'outdoor.lamp_porch'; g.position.set(pos[0], pos[1], pos[2]); g.userData.dynamic = true; root.add(g);
    U.box(g, 0.13, 0.26, 0.025, M.iron, 0, 0, 0.0125, { round: 0.008 });
    U.box(g, 0.03, 0.03, 0.2, M.iron, 0, -0.08, 0.11);
    const cur = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.01, 5, 12, Math.PI / 2), M.iron); cur.position.set(0, 0.0, 0.1); cur.rotation.y = Math.PI / 2; g.add(cur);
    U.cyl(g, 0.075, 0.06, 0.03, M.iron, 0, -0.06, 0.21, { radial: 4, ry: Math.PI / 4 });
    const glassM = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffb060, emissiveIntensity: 2.0, roughness: 0.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.065, 0.2, 4, 1, true), glassM); glass.rotation.y = Math.PI / 4; glass.position.set(0, 0.06, 0.21); g.add(glass);
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + Math.PI / 4; U.box(g, 0.012, 0.21, 0.012, M.iron, Math.cos(a) * 0.083, 0.06, 0.21 + Math.sin(a) * 0.083); }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.1, 4), M.iron); cap.rotation.y = Math.PI / 4; cap.position.set(0, 0.21, 0.21); g.add(cap);
    U.sphere(g, 0.018, M.iron, 0, 0.27, 0.21, { w: 6, h: 5 });
    const bulbM = new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffb060, emissiveIntensity: 4, roughness: 0.3 });
    U.sphere(g, 0.025, bulbM, 0, 0.05, 0.21, { w: 8, h: 6 });
    const glow = U.glowSprite(0xffb060, 0.7, 0.7); glow.position.set(0, 0.06, 0.21); g.add(glow);
    const light = new THREE.PointLight(0xffb060, 10, 0, 2); light.name = 'lamp_porch'; light.position.set(0, 0.04, 0.26); g.add(light);
    C.registerLight(light, { id: 'lamp_porch', room: 'porch', kind: 'point' });
    const st = { on: on0, level: on0 ? 1 : 0, light, glassM, bulbM, glow };
    S.porch = st;
    st.setOn = (v) => {
      if (st.on === v) return; st.on = v;
      g.updateMatrixWorld(true); const wp = light.getWorldPosition(V3());
      C.emit('lamp', { id: 'lamp_porch', on: v, x: wp.x, y: wp.y, z: wp.z });
    };
    C.interact.add({ id: 'lamp_porch', object: g, range: 2.4, label: () => (st.on ? 'Turn off the porch lantern' : 'Turn on the porch lantern'),
      onUse: () => { st.setOn(!st.on); C.audio.play && C.audio.play('switch', { x: pos[0], y: pos[1], z: pos[2] }); } });
    applyPorchLevel(st);
  });
  sec('porch_furniture', () => {
    const r = U.rng(191);
    // --- rocking chair (dynamic; rocks when sat in)
    const th = 0.3, cx = 2.05, cz = 6.05, R = 1.1;
    const pivot = new THREE.Group(); pivot.name = 'outdoor.porch_rocker'; pivot.position.set(cx, 0, cz); pivot.rotation.y = th; pivot.userData.dynamic = true; root.add(pivot);
    const inner = new THREE.Group(); inner.position.set(0, R, 0); pivot.add(inner);
    const ch = new THREE.Group(); ch.position.set(0, -R, 0); inner.add(ch);
    const W = M.woodMed;
    for (const sx of [-0.25, 0.25]) {
      const curve = new THREE.ArcCurve(0, 0, R, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42, false);
      const pts = curve.getPoints(14).map(p => V3(0, p.y + R, p.x));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 6, false), W); tube.position.x = sx; ch.add(tube);
      U.cyl(ch, 0.02, 0.022, 0.42, W, sx, 0.23, 0.2, { radial: 8 });
      U.cyl(ch, 0.02, 0.022, 0.42, W, sx, 0.23, -0.2, { radial: 8 });
      const post = U.cyl(ch, 0.022, 0.024, 0.72, W, sx, 0.78, -0.27, { radial: 8, rx: -0.2 }); void post;
      U.box(ch, 0.06, 0.035, 0.5, W, sx + (sx < 0 ? -0.02 : 0.02), 0.66, 0.0, { round: 0.012 });
      U.cyl(ch, 0.015, 0.015, 0.22, W, sx, 0.55, 0.2, { radial: 6 });
    }
    U.box(ch, 0.56, 0.04, 0.48, W, 0, 0.45, 0, { round: 0.015 });
    for (let k = 0; k < 6; k++) { const x = -0.18 + k * 0.072; U.cyl(ch, 0.011, 0.011, 0.58, W, x, 0.77, -0.285, { radial: 6, rx: -0.2 }); }
    U.box(ch, 0.6, 0.07, 0.04, W, 0, 1.08, -0.35, { rx: -0.2, round: 0.015 });
    U.box(ch, 0.48, 0.07, 0.44, M.cushion, 0, 0.5, 0.01, { round: 0.03, segments: 3 });
    // knitted blanket over the back
    U.box(ch, 0.5, 0.5, 0.03, M.knit, 0.02, 0.8, -0.31, { rx: -0.2, round: 0.012 });
    U.box(ch, 0.5, 0.03, 0.2, M.knit, 0.02, 1.07, -0.43, { rx: 0.3, round: 0.012 });
    U.bakeStatic(ch);
    shadow(cx, 0.0, cz, 0.8, 1.0, 0.35);
    const fwd = (lx, lz) => [cx + Math.cos(th) * lx + Math.sin(th) * lz, cz - Math.sin(th) * lx + Math.cos(th) * lz];
    { const pts = [fwd(-0.33, -0.48), fwd(0.33, -0.48), fwd(-0.33, 0.45), fwd(0.33, 0.45)]; const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
      box([Math.min(...xs), 0, Math.min(...zs)], [Math.max(...xs), 1.1, Math.max(...zs)], { name: 'porch_rocker' }); }
    const eye = fwd(0, -0.06), exit = fwd(0.75, 0.2);
    const seat = { id: 'porch_rocker', position: [eye[0], 1.12, eye[1]], yaw: Math.PI + th, pitch: -0.06, yawRange: 1.4, pitchMin: -0.9, pitchMax: 1.0,
      exit: [exit[0], 0, exit[1]], label: 'Stand up' };
    S.rocker = { pivot, inner, seat, amp: 0, phase: 0, R, th, cx, cz, eyeY: 1.12, eyeZ: -0.06 };
    C.interact.add({ id: 'porch_rocker', object: pivot, label: 'Sit in the rocking chair', range: 2.3, onUse: () => C.player.sitAt(seat) });

    // --- small table with a mug and a book
    const tx = 1.58, tz = 6.55;
    const tg = new THREE.Group(); tg.position.set(tx, 0, tz); stat.add(tg);
    U.cyl(tg, 0.23, 0.23, 0.035, M.woodMed, 0, 0.52, 0, { radial: 20 });
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; const l = U.cyl(tg, 0.016, 0.02, 0.52, M.woodMed, Math.cos(a) * 0.13, 0.25, Math.sin(a) * 0.13, { radial: 6 }); l.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14); }
    U.box(tg, 0.16, 0.03, 0.22, U.stdMat(0x6b2f2a, 0.7, 0), -0.05, 0.553, 0.04, { ry: 0.4 });
    U.box(tg, 0.15, 0.022, 0.21, C.mat('paper'), -0.05, 0.553, 0.04, { ry: 0.4 });
    if (C.props && typeof C.props.mug === 'function') {
      try { C.props.mug({ position: [tx + 0.08, 0.538, tz - 0.07], color: 0xd9c9a8, steam: true, parent: root }); } catch (e) { fallbackMug(); }
    } else fallbackMug();
    function fallbackMug() {
      const mg = new THREE.Group(); mg.position.set(tx + 0.08, 0.538, tz - 0.07); stat.add(mg);
      U.lathe(mg, [[0.001, 0], [0.036, 0], [0.04, 0.005], [0.041, 0.095], [0.037, 0.095], [0.035, 0.012], [0.001, 0.012]], U.stdMat(0xd9c9a8, 0.25, 0), 0, 0, 0, { segments: 18 });
      const hd = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), U.stdMat(0xd9c9a8, 0.25, 0)); hd.position.set(0.045, 0.05, 0); mg.add(hd);
      U.cyl(mg, 0.034, 0.034, 0.004, U.stdMat(0x3a2415, 0.15, 0), 0, 0.08, 0, { radial: 16 });
    }
    shadow(tx, 0, tz, 0.55, 0.55, 0.4);
    cyl(tx, tz, 0.24, 0, 0.6, { name: 'porch_table' });

    // --- doormat
    const matTex = U.canvasTexture(256, 160, (ctx, w, h) => {
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) { const v = 90 + r() * 70; ctx.fillStyle = `rgba(${v + 20 | 0},${v * 0.75 | 0},${v * 0.45 | 0},0.5)`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
      ctx.strokeStyle = 'rgba(40,26,16,0.8)'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = 'rgba(40,26,16,0.75)'; ctx.font = 'bold 34px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('WELCOME', w / 2, h / 2 + 2);
    }, { wrap: false });
    const mat = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.02, 0.56, 2, 0.008), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }));
    mat.position.set(3.75, 0.01, 5.4); mat.name = 'outdoor.doormat'; stat.add(mat);

    // --- potted plants
    const pot = (x, z, s, kind, seed, y = 0) => {
      U.lathe(stat, [[0.001, 0], [0.13 * s, 0], [0.17 * s, 0.3 * s], [0.19 * s, 0.31 * s], [0.19 * s, 0.35 * s], [0.165 * s, 0.35 * s], [0.16 * s, 0.31 * s], [0.001, 0.31 * s]], M.terracotta, x, y, z, { segments: 18 });
      U.cyl(stat, 0.155 * s, 0.155 * s, 0.01, M.soil, x, y + 0.3 * s, z, { radial: 14 });
      bush(x, z, 0.28 * s, 0.6 * s, kind, seed, { y0: y + 0.3 * s, cards: 12, card: 0.42 * s });
      shadow(x, y, z, 0.5 * s, 0.5 * s, 0.4);
      cyl(x, z, 0.2 * s, y, y + 0.6 * s, { name: 'pot' });
    };
    pot(1.55, 5.35, 1.3, 'bush', 801);
    pot(6.45, 5.35, 1.15, 'roses', 802);
    pot(6.45, 6.8, 1.0, 'hydrangea', 803);
    pot(5.45, 5.3, 0.8, 'flowers', 804);
    pot(2.55, 7.95, 1.0, 'hydrangea', 805, GY);
    pot(4.95, 7.95, 1.0, 'hydrangea', 806, GY);

    // --- wellington boots by the door
    const boot = (x, z, rot, m) => {
      const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rot; stat.add(b);
      U.cyl(b, 0.052, 0.058, 0.3, m, 0, 0.17, 0, { radial: 12 });
      U.box(b, 0.1, 0.07, 0.24, m, 0, 0.035, 0.05, { round: 0.03 });
      U.cyl(b, 0.057, 0.057, 0.02, U.stdMat(0x3a2a1c, 0.9, 0), 0, 0.02, 0, { radial: 12 });
    };
    boot(4.58, 5.28, 0.2, M.rubber); boot(4.72, 5.32, -0.15, M.rubber);
    boot(5.02, 5.25, 0.5, M.rubberY); boot(5.16, 5.4, 1.4, M.rubberY);
    shadow(4.85, 0, 5.3, 0.8, 0.45, 0.35);

    // --- open umbrella drying on the porch
    const ug = new THREE.Group(); ug.position.set(6.1, 0.0, 6.55); ug.rotation.set(0, -0.6, 0); stat.add(ug);
    const canopy = new THREE.Group(); canopy.position.set(0, 0.3, 0); canopy.rotation.set(0, 0, 1.2); ug.add(canopy);
    const cg = new THREE.ConeGeometry(0.5, 0.26, 8, 1, true); cg.translate(0, -0.13, 0);
    { const p = cg.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const rr = Math.hypot(p.getX(i), p.getZ(i)); if (rr > 0.3) p.setY(i, p.getY(i) + 0.03 * Math.cos(a * 8)); } cg.computeVertexNormals(); }
    const cm = new THREE.Mesh(cg, M.umbrella); cm.rotation.x = Math.PI; canopy.add(cm);
    U.cyl(canopy, 0.008, 0.008, 0.8, M.iron, 0, -0.26, 0, { radial: 5 });
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 5, 10, Math.PI), M.woodDark); hk.position.set(-0.04, -0.66, 0); hk.rotation.z = Math.PI; canopy.add(hk);
    S.extraWater(6.05, 0.004, 6.62, 0.45, 0.32);

    // --- hanging flower baskets from the porch beam
    for (const [hx, seed] of [[2.1, 811], [6.25, 812]]) {
      const hy = 1.95, hz = 7.02;
      U.lathe(stat, [[0.001, 0], [0.06, 0.0], [0.17, 0.12], [0.19, 0.2], [0.001, 0.2]], C.mat('wickerBasket'), hx, hy - 0.2, hz, { segments: 14 });
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; const ch2 = U.cyl(stat, 0.004, 0.004, 0.62, M.iron, hx + Math.cos(a) * 0.08, hy + 0.3, hz + Math.sin(a) * 0.08, { radial: 3 }); ch2.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
      const rrr = U.rng(seed);
      for (let k = 0; k < 11; k++) {
        const a = rrr() * TAU, p = V3(hx + Math.cos(a) * 0.16, hy - 0.05 - rrr() * 0.3, hz + Math.sin(a) * 0.16);
        card(k % 2 ? 'roses' : 'flowers', p, 0.26 + rrr() * 0.1, V3(Math.cos(a), 0.3, Math.sin(a)).normalize(), () => 0.15, rrr);
      }
    }
  });

  // ------------------------------------------------------------------ distant: neighbours + far tree lines
  sec('distant', () => {
    const r = U.rng(211);
    const houses = [[-30, 52, 8, 5.5, 3.2, 1], [48, -50, 9, 6, 3.4, 2], [-56, -24, 7, 5, 3.0, 3]];
    const nbGlows = [];
    for (const [x, z, w, d, hw, sd] of houses) {
      let y = Infinity; for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) y = Math.min(y, hillH(x + ox, z + oz));
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(-x, -z) + (r() - 0.5) * 0.5; stat.add(g);
      U.boxAt(g, -w / 2, -1.5, -d / 2, w / 2, hw, d / 2, M.nbWall);
      const sh = new THREE.Shape(); sh.moveTo(-d / 2 - 0.4, hw); sh.lineTo(d / 2 + 0.4, hw); sh.lineTo(0, hw + d * 0.42); sh.lineTo(-d / 2 - 0.4, hw);
      const rf = U.extrude(g, sh, w + 0.6, M.nbRoof); rf.rotation.y = Math.PI / 2; rf.position.x = -w / 2 - 0.3;
      U.boxAt(g, w / 2 - 1.4, hw, -0.4, w / 2 - 0.8, hw + d * 0.55, 0.3, M.nbWall);
      const wins = [[-w * 0.3, 0.9], [w * 0.3, 0.9], [-w * 0.3, 2.3], [w * 0.12, 2.3], [w * 0.36, 2.3]];
      wins.forEach(([wx, wy], i) => { const lit = (i + sd) % 3 !== 0; U.boxAt(g, wx - 0.35, wy, d / 2, wx + 0.35, wy + 0.8, d / 2 + 0.05, lit ? M.nbWin : M.nbDark); });
      U.boxAt(g, -0.45, 0, d / 2, 0.45, 2.0, d / 2 + 0.04, M.nbDark);
      g.updateMatrixWorld(true);
      const gp = V3(0, 1.6, d / 2 + 0.8).applyMatrix4(g.matrixWorld);
      const glow = U.glowSprite(0xffb46b, 7, 0.22); glow.position.copy(gp); root.add(glow); nbGlows.push(glow);
      S.trunks.push({ x, z, r: 0, far: true });
    }
    S.nbGlows = nbGlows;
    // far tree lines on the hills
    const blob = new THREE.IcosahedronGeometry(1, 1); { const p = blob.attributes.position; for (let i = 0; i < p.count; i++) { const f = 1 + 0.18 * U.noise3D(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); } blob.computeVertexNormals(); blob.translate(0, 0.75, 0); }
    const coneG = new THREE.ConeGeometry(1, 1, 7, 1); coneG.translate(0, 0.5, 0);
    const bl = [], co = [];
    for (let k = 0; k < 9000 && (bl.length + co.length) < 1400; k++) {
      const a = r() * TAU, d = 42 + Math.pow(r(), 0.8) * 190;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (flatDist(x, z) < 9) continue;
      if (houses.some(h => Math.hypot(h[0] - x, h[1] - z) < 13)) continue;
      const wood = U.fbm2D(x * 0.018 + 5, z * 0.018 - 9, 3);
      if (wood < 0.05 && r() > 0.08) continue;
      const y = hillH(x, z) - 0.4;
      if (r() < 0.4) co.push([x, y, z, 1.4 + r() * 0.9, 6 + r() * 5]); else bl.push([x, y, z, 2.0 + r() * 1.8, 4 + r() * 3]);
    }
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), col = new THREE.Color();
    const mk = (geo, list, base, name) => {
      const im = new THREE.InstancedMesh(geo, M.far, list.length);
      list.forEach(([x, y, z, rr, h], i) => {
        qq.setFromAxisAngle(V3(0, 1, 0), r() * TAU); m4.compose(V3(x, y, z), qq, V3(rr, name === 'blob' ? h / 1.5 : h, rr)); im.setMatrixAt(i, m4);
        const v = 0.7 + r() * 0.5; col.setHex(base).multiplyScalar(v); if (r() < 0.12) col.setRGB(0.16 * v, 0.1 * v, 0.05 * v); im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.name = 'outdoor.far_' + name; root.add(im);
    };
    mk(blob, bl, 0x26361f, 'blob');
    mk(coneG, co, 0x1d2c20, 'conifer');
  });

  // ------------------------------------------------------------------ build merged vegetation meshes
  sec('vegetation_meshes', () => {
    const add = (gb, mat, name) => { if (!gb.count) return; const m = new THREE.Mesh(gb.build(), mat); m.name = name; m.receiveShadow = true; m.userData.dynamic = true; root.add(m); };
    add(barkGB, M.bark, 'outdoor.treeBark');
    add(birchGB, M.birch, 'outdoor.birchBark');
    add(coreGB, M.core, 'outdoor.foliageCore');
    add(leafGB[0], M.leafA, 'outdoor.foliageA');
    add(leafGB[1], M.leafB, 'outdoor.foliageB');
    if (S.waterGB && S.waterGB.count) { const pm = new THREE.Mesh(S.waterGB.build(), M.puddle); pm.name = 'outdoor.puddles'; pm.renderOrder = 2; pm.userData.dynamic = true; root.add(pm); }
  });

  // ------------------------------------------------------------------ physics: floors + bounds
  sec('physics', () => {
    P.addFloor(-15, -12, 15, 19, GY, { surface: 'grass', name: 'yard' });
    P.addFloor(-16, 19, 16, 23.5, GY, { surface: 'gravel', name: 'lane' });
    box([-16.6, GY - 0.5, 23.5], [16.6, GY + 3.5, 24.4], { tag: 'bound', name: 'bound_lane_s', force: true });
    box([16.0, GY - 0.5, 18.9], [16.6, GY + 3.5, 23.6], { tag: 'bound', name: 'bound_lane_e', force: true });
    box([-16.6, GY - 0.5, 18.9], [-16.0, GY + 3.5, 23.6], { tag: 'bound', name: 'bound_lane_w', force: true });
    P.addSurfaceTag(-8.5, -2.0, -6.9, 1.6, GY - 0.3, GY + 0.3, 'mud');
  });

  // ------------------------------------------------------------------ bake statics
  sec('bake', () => { U.bakeStatic(stat); });

  // automatic lamps
  S.autoOn = (C.env.daylight ?? 0.45) < LAMP_ON_BELOW;
  if (S.street) { S.street.level = S.street.target = S.autoOn ? 1 : 0; applyStreet(); }
  if (S.porch && S.porch.setOn) S.porch.setOn(S.autoOn);
  C.on('timeofday', (p) => {
    const d = p && typeof p.daylight === 'number' ? p.daylight : C.env.daylight;
    const want = d < LAMP_ON_BELOW;
    S.autoOn = want; if (S.street) S.street.target = want ? 1 : 0;
    if (S.porch && S.porch.setOn) S.porch.setOn(want);
  });
  C.on('settings', (s) => { if (S.grass) S.grass.mesh.count = s.quality === 'low' ? Math.floor(S.grass.count * 0.5) : S.grass.count; });
  if (C.settings.quality === 'low' && S.grass) S.grass.mesh.count = Math.floor(S.grass.count * 0.5);
  S.M = M;
}

// ---------------------------------------------------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------------------------------------------------
function applyPorchLevel(st) {
  const k = st.level;
  st.light.intensity = 10 * k;
  st.glassM.emissiveIntensity = 2.0 * k + 0.02;
  st.bulbM.emissiveIntensity = 4 * k;
  st.glow.material.opacity = 0.7 * k;
  st.glow.visible = k > 0.01;
}
function applyStreet() {
  const s = S.street; if (!s) return;
  const k = s.level;
  s.light.intensity = 150 * k;
  s.glassM.emissiveIntensity = 2.2 * k + 0.02;
  s.bulbM.emissiveIntensity = 5 * k;
  s.glow.material.opacity = 0.55 * k; s.glow.visible = k > 0.01;
  s.coneM.uniforms.uInt.value = k;
}
function tick(dt, t, C) {
  const U = C.util;
  SH.uTime.value = t;
  const w = C.env.wind; if (w) SH.uWind.value.set(w.x || 0, w.z || 0);
  WT.uRain.value = U.clamp(0.12 + (C.env.rain ?? 0.7) * 0.88, 0, 1);
  const f = C.scene.fog, bg = C.scene.background;
  if (f && f.color) WT.uSky.value.copy(f.color); else if (bg && bg.isColor) WT.uSky.value.copy(bg);
  const lf = C.env.lightningFlash || 0;
  if (lf > 0) { WT.uSky.value.r += lf * 0.9; WT.uSky.value.g += lf * 0.95; WT.uSky.value.b += lf; }
  // gate swing
  const g = S.gate;
  if (g) { g.angle = U.damp(g.angle, g.open ? GATE_OPEN : 0, 4.0, dt); g.pivot.rotation.y = g.angle; }
  // rocking chair
  const rk = S.rocker;
  if (rk) {
    const p = C.player, seated = p.mode === 'sit' && p.seat && p.seat.id === 'porch_rocker';
    rk.amp = U.damp(rk.amp, seated ? 0.065 : 0, seated ? 1.2 : 0.8, dt);
    rk.phase += dt * TAU / 3.3;
    const a = rk.amp * Math.sin(rk.phase);
    rk.inner.rotation.x = a; rk.inner.position.z = rk.R * a;
    if (seated || rk.amp > 1e-4) {
      const ly0 = rk.eyeY - rk.R, lz0 = rk.eyeZ, ca = Math.cos(a), sa = Math.sin(a);
      const ly = rk.R + ly0 * ca - lz0 * sa, lz = rk.R * a + ly0 * sa + lz0 * ca;
      const sp = rk.seat.position;
      sp[0] = rk.cx + Math.sin(rk.th) * lz; sp[1] = ly; sp[2] = rk.cz + Math.cos(rk.th) * lz;
    }
  }
  // automatic lamps (poll daylight too, in case no event fires)
  const want = (C.env.daylight ?? 0.45) < LAMP_ON_BELOW, s0 = S.street;
  if (want !== S.autoOn) { S.autoOn = want; if (s0) s0.target = want ? 1 : 0; if (S.porch && S.porch.setOn) S.porch.setOn(want); }
  const s = S.street;
  if (s && Math.abs(s.level - s.target) > 1e-3) { s.level = U.damp(s.level, s.target, 2.5, dt); applyStreet(); }
  const pl = S.porch;
  if (pl && pl.light) { const tgt = pl.on ? 1 : 0; if (Math.abs(pl.level - tgt) > 1e-3) { pl.level = U.damp(pl.level, tgt, 20, dt); applyPorchLevel(pl); } }
  // neighbour windows glow more at night
  const day = C.env.daylight ?? 0.45;
  const k = 0.45 + 0.75 * (1 - U.clamp(day, 0, 1));
  if (S.M && S.M.nbWin) S.M.nbWin.color.setRGB(2.2 * k, 1.0 * k, 0.32 * k);
  if (S.nbGlows) for (let i = 0; i < S.nbGlows.length; i++) S.nbGlows[i].material.opacity = 0.25 * k;
}

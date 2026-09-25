// =====================================================================================================================
//  AUDIO (order 50) — a fully procedural WebAudio soundscape (SPEC §3.7, §9 audio). No sample files: every sound is
//  synthesized, either rendered once into AudioBuffers with small JS DSP helpers (textures, one-shots, instrument
//  samples) or built live from nodes (mix automation, kettle whistle, wind gusts, the music sequencer).
//
//  Graph:  sources → [emitter: occlusion LP → gain → Panner] → group gain → bus (music/ambience/sfx, settings volume)
//          → master (masterVolume) → pause duck → duck LP → glue compressor → limiter → soft clipper → mute → out
//  Acoustics: every emitter also sends (pre-distance, post-occlusion) into the reverb of the space it is in — a
//          furnished-cottage room response indoors, an open-air response outside — so distant sounds get more
//          reverberant (direct/reverberant ratio is the main distance cue). Each reverb return is muffled when the
//          listener is on the other side of the walls. Non-positional sfx (own footsteps) use the listener's space.
//  Rain is built from located sources: every window pane, both roof slopes (loft), the skylights, the porch roof,
//          the eave drip lines, downspouts, the pond and the trees, over open-sky beds that crossfade drizzle→storm.
//          Runoff (gutters, drips) lags the rain; wind gusts travel across the garden and lash the windward panes.
// =====================================================================================================================
const C = window.COZY;

// ---------------------------------------------------------------------------------------------------------------------
// constants / small helpers
// ---------------------------------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const mr = (a, b) => a + (b - a) * Math.random();                 // runtime randomness (playback variation)
const mpick = arr => arr[(Math.random() * arr.length) | 0];
function interp(bp, u) {                                           // piecewise-linear breakpoints [[u, v], ...]
  if (u <= bp[0][0]) return bp[0][1];
  for (let i = 1; i < bp.length; i++) {
    if (u <= bp[i][0]) { const a = bp[i - 1], b = bp[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / ((b[0] - a[0]) || 1); }
  }
  return bp[bp.length - 1][1];
}

// Level table (linear gains, calibrated with tools/audiocap.mjs captures and build/audio_test.js).
const LV = {
  wash: 0.38, light: 0.34, ticks: 0.38, low: 0.42, inside: 0.3, leak: 0.45,                    // open sky / through walls
  window: 0.24, sky: 0.46, roof: 0.36, porch: 0.37, gutter: 0.42, drip: 0.32, pond: 0.38, leaves: 0.28, canopy: 0.24, drop: 0.18,
  wind: 0.36, moan: 0.5, whistle: 0.05, rustle: 0.34, pines: 0.3, creak: 0.26,                  // wind
  fireBed: 0.35, fireCrackle: 0.2, fireHiss: 0.24, crk: 0.3, pop: 0.26, settle: 0.34, clock: 0.36,
  thunder: 0.95, rattle: 0.3,
  revIn: 0.5, revOut: 0.34,                                                                     // reverb returns (unit-energy IRs)
  piano: 0.14, bass: 0.28, drums: 0.17, vinyl: 0.25, loop: 0.5, kettle: 0.45, whistleK: 0.022, purr: 0.3,
};
const STEP_GAIN = { wood: 0.26, stairs: 0.3, tile: 0.28, rug: 0.24, carpet: 0.22, porch: 0.27, grass: 0.3, mud: 0.28,
  gravel: 0.34, stone: 0.34, water: 0.28 };
const TOE_GAIN = { wood: 0.42, stairs: 0.5, tile: 0.45, rug: 0.5, carpet: 0.5, porch: 0.42, grass: 0.7, mud: 0.85, gravel: 0.75,
  stone: 0.42, water: 0.6 };
const SFX_GAIN = { click: 0.3, switch: 0.3, creak: 0.3, door_open: 0.34, door_close: 0.3, thud: 0.28, page: 0.24, pour: 0.26,
  sip: 0.22, meow: 0.15, chime: 0.24, match: 0.3, whoosh: 0.22, drawer: 0.25, curtain: 0.24, splash: 0.34, clink: 0.22,
  gate: 0.3, gate_close: 0.32, cushion: 0.16, needle: 0.25, floor_creak: 0.16, chair_creak: 0.2, board: 0.2, squeak: 0.09,
  wet: 0.12, cloth: 0.07, rocker: 0.24, house_creak: 0.2, rattle: 0.3 };
const SURF = { wood: 'wood', stairs: 'stairs', tile: 'tile', rug: 'rug', carpet: 'carpet', porch: 'porch', grass: 'grass',
  mud: 'mud', gravel: 'gravel', stone: 'stone', water: 'water', dirt: 'mud', path: 'stone', deck: 'porch' };
const STEP_VARIANTS = 5;

// =====================================================================================================================
//  DSPLIB — every offline renderer. Fully self-contained (references nothing outside itself) so the same source text
//  (DSPLIB.toString()) also runs inside a Blob-URL Web Worker; the main thread only falls back to it when needed.
// =====================================================================================================================
function DSPLIB(SR0) {
'use strict';
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const STEP_VARIANTS = 5;
function interp(bp, u) {
  if (u <= bp[0][0]) return bp[0][1];
  for (let i = 1; i < bp.length; i++) {
    if (u <= bp[i][0]) { const a = bp[i - 1], b = bp[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / ((b[0] - a[0]) || 1); }
  }
  return bp[bp.length - 1][1];
}
// seeded rng for deterministic rendering
let SR = SR0;
let _s = 1;
const srand = s => { _s = (s >>> 0) || 1; };
const R = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * R();
const rs1 = () => R() * 2 - 1;
const rlog = (a, b) => a * Math.pow(b / a, R());

// ---------------------------------------------------------------------------------------------------------------------
// tiny offline DSP toolkit (Float32Array in, in-place where sensible). `circ` = seamless-loop mode (state pre-warmed
// by a first pass over the same data, so the loop seam is inaudible).
// ---------------------------------------------------------------------------------------------------------------------
const _cf = new Float64Array(5);
function coef(type, f, Q, db) {
  const w = TAU * clamp(f, 10, SR * 0.45) / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q), A = Math.pow(10, (db || 0) / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; } // peaking
  _cf[0] = b0 / a0; _cf[1] = b1 / a0; _cf[2] = b2 / a0; _cf[3] = a1 / a0; _cf[4] = a2 / a0;
  return _cf;
}
const D = {
  n: s => Math.max(1, Math.round(s * SR)),
  zeros: s => new Float32Array(D.n(s)),
  white(n) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R() * 2 - 1; return x; },
  // circ: the state is pre-warmed over the tail of the buffer only (a few time constants), which is equivalent to a
  // full pre-pass for these short-memory filters but much cheaper.
  pink(n, circ) {
    const w = D.white(n), x = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0;
    if (circ) for (let i = Math.max(0, n - 6000); i < n; i++) { const v = w[i]; b0 = 0.99765 * b0 + v * 0.0990460; b1 = 0.96300 * b1 + v * 0.2965164; b2 = 0.57000 * b2 + v * 1.0526913; }
    for (let i = 0; i < n; i++) {
      const v = w[i]; b0 = 0.99765 * b0 + v * 0.0990460; b1 = 0.96300 * b1 + v * 0.2965164; b2 = 0.57000 * b2 + v * 1.0526913;
      x[i] = (b0 + b1 + b2 + v * 0.1848) * 0.2;
    }
    return x;
  },
  brown(n, circ) {
    const w = D.white(n), x = new Float32Array(n);
    let b = 0;
    if (circ) for (let i = Math.max(0, n - 2000); i < n; i++) b = (b + 0.02 * w[i]) / 1.02;
    for (let i = 0; i < n; i++) { b = (b + 0.02 * w[i]) / 1.02; x[i] = b * 3.5; }
    return x;
  },
  noise(n, color, circ) { return color === 'pink' ? D.pink(n, circ) : color === 'brown' ? D.brown(n, circ) : D.white(n); },
  biquad(x, type, f, Q = 0.707, db = 0, circ = false) {
    const c = coef(type, f, Q, db), b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4], n = x.length;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    if (circ) for (let i = Math.max(0, n - Math.round(SR * (14 + 4 * Q) / Math.max(20, f))); i < n; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; }
    for (let i = 0; i < n; i++) { const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y; }
    return x;
  },
  // time-varying filter: fFn(u in 0..1) → Hz, coefficients refreshed every 32 samples
  tv(x, type, fFn, Q) {
    const n = x.length; let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < n; i++) {
      if ((i & 31) === 0) { const c = coef(type, fFn(i / n), Q, 0); b0 = c[0]; b1 = c[1]; b2 = c[2]; a1 = c[3]; a2 = c[4]; }
      const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
  },
  // damped resonant mode: an impulse of height h produces h·amp·r^n·sin(ω(n+1)) (unit-amplitude ringing)
  mode(inp, out, f, tau, amp = 1, circ = false) {
    if (f >= SR * 0.47 || f <= 0) return;
    const w = TAU * f / SR, r = Math.exp(-1 / (tau * SR)), c1 = 2 * r * Math.cos(w), c2 = r * r, g = Math.sin(w) * amp, n = inp.length;
    let y1 = 0, y2 = 0;
    if (circ) for (let i = Math.max(0, n - Math.round(tau * SR * 14)); i < n; i++) { const y = inp[i] * g + c1 * y1 - c2 * y2; y2 = y1; y1 = y; }
    for (let i = 0; i < n; i++) { const y = inp[i] * g + c1 * y1 - c2 * y2; y2 = y1; y1 = y; out[i] += y; }
  },
  lp1(x, f) { const a = 1 - Math.exp(-TAU * f / SR); let y = 0; for (let i = 0; i < x.length; i++) { y += a * (x[i] - y); x[i] = y; } return x; },
  rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); },
  peak(x) { let p = 0; for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; } return p; },
  normRms(chs, target) { let s = 0, n = 0; for (const x of chs) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; } const r = Math.sqrt(s / Math.max(1, n)) || 1; for (const x of chs) for (let i = 0; i < x.length; i++) x[i] *= target / r; return chs; },
  normPeak(chs, target) { let p = 0; for (const x of chs) p = Math.max(p, D.peak(x)); p = p || 1; for (const x of chs) for (let i = 0; i < x.length; i++) x[i] *= target / p; return chs; },
  fadeOut(x, sec) { const m = Math.min(x.length, D.n(sec)); for (let i = 0; i < m; i++) x[x.length - 1 - i] *= i / m; return x; },
  // periodic smooth random curve (cosine interpolated control points) — safe for loops
  curve(n, pts, lo, hi) {
    const v = new Float32Array(pts); for (let k = 0; k < pts; k++) v[k] = lo + (hi - lo) * R();
    const out = new Float32Array(n), seg = n / pts;
    for (let i = 0; i < n; i++) { const p = i / seg, k = Math.floor(p), f = p - k, a = v[k % pts], b = v[(k + 1) % pts]; out[i] = a + (b - a) * (1 - Math.cos(Math.PI * f)) * 0.5; }
    return out;
  },
  // feedback comb (pipe / cavity resonance) y[n] = x[n] + g·y[n−d]; circ: wrapped steady state (loop-safe)
  comb(x, sec, g, circ = false) {
    const d = Math.max(1, Math.round(sec * SR)), n = x.length, y = new Float32Array(n);
    const passes = circ ? 1 + Math.ceil(Math.log(1e-4) / Math.log(Math.abs(g) || 0.5) * d / n) : 1;
    for (let p = 0; p < passes; p++) for (let i = 0; i < n; i++) { const j = i - d; y[i] = x[i] + g * (j >= 0 ? y[j] : circ ? y[j + n] : 0); }
    x.set(y); return x;
  },
  // Minnaert-style water bubble: decaying sine with a rising chirp (the "plink" of drops on water)
  bubble(out, i0, f0, tau, amp, rise = 0.3, wrap = false) {
    const n = out.length, len = Math.min(n, Math.round(tau * 6 * SR)), k1 = rise / (3 * tau);
    let ph = 0;
    for (let k = 0; k < len; k++) {
      const t = k / SR; ph += f0 * (1 + k1 * t) / SR;
      let idx = i0 + k; if (idx >= n) { if (!wrap) break; idx -= n; }
      out[idx] += amp * Math.exp(-t / tau) * (1 - Math.exp(-t * 3000)) * Math.sin(TAU * ph);
    }
  },
};
function mixAt(out, x, t0, k = 1) { const i0 = Math.round(t0 * SR); for (let i = 0; i < x.length && i0 + i < out.length; i++) out[i0 + i] += x[i] * k; }
function fin(o, pk = 0.9) { D.fadeOut(o, 0.01); D.normPeak([o], pk); return [o]; }
// short noise burst (a drop hitting something, a splash, a leaf-on-leaf contact): decaying white noise through a
// band-pass, optionally with a low thump (heavy drop into soil or water). tgt = [[buffer, gain], ...]
function splat(tgt, i0, dur, fc, q, wrap, thump) {
  const c = coef('bandpass', fc, q, 0), b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4];
  const n = tgt[0][0].length, len = Math.max(8, Math.round(dur * SR)), ring = len + Math.round(SR * 2 * q / Math.max(200, fc)), dk = 4 / len;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let k = 0; k < ring; k++) {
    const xi = k < len ? rs1() * Math.exp(-k * dk) * (k < 4 ? k / 4 : 1) : 0;
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y;
    let idx = i0 + k; if (idx >= n) { if (!wrap) break; idx -= n; }
    for (let t = 0; t < tgt.length; t++) tgt[t][0][idx] += y * tgt[t][1];
  }
  if (thump) {
    const f0 = rr(150, 260), tl = Math.round(SR * 0.03); let ph = 0;
    for (let k = 0; k < tl; k++) {
      ph += f0 * (1 - 0.4 * k / tl) / SR;
      let idx = i0 + k; if (idx >= n) { if (!wrap) break; idx -= n; }
      const v = thump * Math.sin(TAU * ph) * Math.exp(-k / (tl * 0.3)) * (1 - Math.exp(-k / 8));
      for (let t = 0; t < tgt.length; t++) tgt[t][0][idx] += v * tgt[t][1];
    }
  }
}
// noise burst with envelope/filters. o: {dur, amp, att, dec, hp, lp, bp:[f,Q], sweep:[f0,f1,Q], sweepFn, am(Hz), shape(u), color}
function addNoise(out, t0, o) {
  const i0 = Math.round(t0 * SR); if (i0 >= out.length) return;
  const len = Math.min(out.length - i0, D.n(o.dur));
  const x = D.noise(len, o.color || 'white');
  if (o.hp) D.biquad(x, 'highpass', o.hp, 0.7);
  if (o.lp) D.biquad(x, 'lowpass', o.lp, 0.7);
  if (o.bp) D.biquad(x, 'bandpass', o.bp[0], o.bp[1]);
  if (o.sweep) { const [f0, f1, Q] = o.sweep; D.tv(x, 'bandpass', o.sweepFn || (u => f0 * Math.pow(f1 / f0, u)), Q); }
  const k = (o.amp === undefined ? 1 : o.amp) * 0.35 / (D.rms(x) || 1);
  const att = o.att === undefined ? 0.002 : o.att, dec = o.dec === undefined ? o.dur / 4 : o.dec;
  const amStep = o.am ? Math.max(1, Math.round(SR / o.am)) : 0;
  let amT = 1, amC = 1;
  for (let j = 0; j < len; j++) {
    const t = j / SR;
    const e = o.shape ? o.shape(j / len) : (t < att ? t / att : Math.exp(-(t - att) / dec));
    if (amStep) { if (j % amStep === 0) amT = 0.2 + 0.8 * R(); amC += (amT - amC) * 0.02; }
    const fade = len - j < 64 ? (len - j) / 64 : 1;
    out[i0 + j] += x[j] * k * e * (amStep ? amC : 1) * fade;
  }
}
// sine thump with a pitch glide f0 → f1 (kick drums, heel thumps, plops)
function addThump(out, t0, f0, f1, tau, amp, ptau = 0.025) {
  const i0 = Math.round(t0 * SR), len = Math.min(out.length - i0, Math.round(tau * 7 * SR));
  let ph = 0;
  for (let j = 0; j < len; j++) { const t = j / SR; ph += (f1 + (f0 - f1) * Math.exp(-t / ptau)) / SR; out[i0 + j] += amp * Math.sin(TAU * ph) * Math.exp(-t / tau) * (1 - Math.exp(-t * 2500)); }
}
// struck object: a short noise burst exciting a bank of damped modes [[f, tau, amp], ...]
function strike(out, t0, modes, amp = 1, burst = 0.0008, jit = 0.05) {
  const n = out.length, i0 = Math.round(t0 * SR); if (i0 >= n) return;
  let maxTau = 0; for (const m of modes) if (m[1] > maxTau) maxTau = m[1];
  const len = Math.min(n - i0, Math.round((burst + maxTau * 7) * SR)); if (len <= 0) return;
  const e = new Float32Array(len), seg = new Float32Array(len), bl = Math.max(1, Math.round(burst * SR)), ks = 1.7 / Math.sqrt(bl);
  for (let k = 0; k < bl && k < len; k++) e[k] = rs1() * (1 - k / bl) * ks;
  for (const [f, tau, a] of modes) D.mode(e, seg, f * (1 + rs1() * jit), tau, a * amp);
  for (let k = 0; k < len; k++) out[i0 + k] += seg[k];
}
// dense granular impacts (gravel crunch, curtain rings, grass crinkle)
function addGrains(out, t0, dur, count, modes, amp, shape) {
  const i0 = Math.round(t0 * SR); let maxTau = 0; for (const m of modes) if (m[1] > maxTau) maxTau = m[1];
  const len = Math.min(out.length - i0, D.n(dur + maxTau * 8)); if (len <= 0) return;
  const imp = new Float32Array(len), seg = new Float32Array(len), dn = D.n(dur);
  for (let k = 0; k < count; k++) {
    const u = shape === 'decay' ? Math.min(0.999, -Math.log(1 - R() * 0.95) / 3) : R();
    imp[Math.min(len - 1, (u * dn) | 0)] += rs1() * Math.pow(R(), 1.5);
  }
  for (const [f, tau, a] of modes) D.mode(imp, seg, f * rr(0.9, 1.1), tau, a);
  for (let j = 0; j < len; j++) out[i0 + j] += (seg[j] + imp[j] * 0.12) * amp;
}
// decaying sinusoid via a rotating phasor (cheap bell/metal partials)
function addPartial(out, i0, f, amp, tau, att = 0.001) {
  if (f >= SR * 0.47) return;
  const len = Math.min(out.length - i0, Math.round(tau * 7 * SR)), w = TAU * f / SR, cw = Math.cos(w), sw = Math.sin(w), r = Math.exp(-1 / (tau * SR)), an = Math.max(1, att * SR);
  let re = 1, im = 0, env = amp;
  for (let k = 0; k < len; k++) { const nr = re * cw - im * sw; im = re * sw + im * cw; re = nr; env *= r; out[i0 + k] += im * env * (k < an ? k / an : 1); }
}
// stick-slip friction (creaks, squeaks): jittered pulse train with a rate contour through wood/metal resonances
function creakSig(o) {
  const n = D.n(o.dur), exc = new Float32Array(n);
  let t = 0.004;
  while (t < o.dur - 0.005) {
    const u = t / o.dur, rate = interp(o.rates, u), e = interp(o.amp, u);
    exc[Math.round(t * SR)] += e * rr(0.55, 1) * (R() < (o.skip || 0.04) ? 0.2 : 1);
    t += (1 / rate) * (1 + rs1() * (o.jit || 0.15));
  }
  const out = new Float32Array(n);
  for (const [f, tau, a] of o.modes) D.mode(exc, out, f, tau, a);
  if (o.rasp) { const x = D.white(n); D.biquad(x, 'bandpass', o.rasp[0], o.rasp[1]); for (let i = 0; i < n; i++) out[i] += x[i] * interp(o.amp, i / n) * o.rasp[2]; }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// looping textures (rain layers, gutters, fire, boil...) — impulses through resonant bands + bubbles + noise beds
// ---------------------------------------------------------------------------------------------------------------------
// run a renderer at a lower sample rate (band-limited layers: saves memory and render time)
function at(sr, fn) { const save = SR; SR = Math.min(SR, sr); try { const r = fn(); return { ch: Array.isArray(r) ? r : r.ch, sr: SR }; } finally { SR = save; } }
function texture(o) { return at(o.sr || 96000, () => texture0(o)); }
function texture0(o) {
  srand(o.seed || 7);
  const n = D.n(o.sec), nch = o.stereo ? 2 : 1, outs = [];
  for (let c = 0; c < nch; c++) outs.push(new Float32Array(n));
  const pan = a => { const p = R() * 1.5708; return [a * Math.cos(p), a * Math.sin(p)]; };
  if (o.bands) for (const [f, tau, amp, rate] of o.bands) {
    const imps = outs.map(() => new Float32Array(n)), cnt = Math.round(rate * o.sec);
    for (let k = 0; k < cnt; k++) {
      const i = (R() * n) | 0, a = (R() < 0.5 ? -1 : 1) * Math.pow(R(), o.pow || 2.5);
      if (nch === 2) { const p = R() * 1.5708; imps[0][i] += a * Math.cos(p); imps[1][i] += a * Math.sin(p); } else imps[0][i] += a;
    }
    for (let c = 0; c < nch; c++) D.mode(imps[c], outs[c], f * (c ? 1.03 : 1), tau, amp, true);
  }
  // impact bands: `rate` impacts/s spread over `n` resonances log-spaced (and jittered, so nothing sounds pitched)
  // across f, decaying tau[0]→tau[1] across the range, weighted by `tilt`; `click` adds the raw impact transient
  if (o.ibands) for (const ib of [].concat(o.ibands)) {
    const nb = ib.n || 16, imps = outs.map(() => new Float32Array(n)), clk = ib.click ? outs.map(() => new Float32Array(n)) : null;
    for (let b = 0; b < nb; b++) {
      const u = (b + R()) / nb, f = ib.f[0] * Math.pow(ib.f[1] / ib.f[0], u), tau = ib.tau[0] * Math.pow(ib.tau[1] / ib.tau[0], u) * rr(0.8, 1.25);
      const w = ib.tilt ? interp(ib.tilt, u) : 1, cnt = Math.round(ib.rate * o.sec / nb * rr(0.75, 1.25));
      for (const x of imps) x.fill(0);
      for (let k = 0; k < cnt; k++) {
        const i = (R() * n) | 0, a = (R() < 0.5 ? -1 : 1) * Math.pow(R(), ib.pow || 2.5);
        if (nch === 2) { const [l, r] = pan(a); imps[0][i] += l; imps[1][i] += r; } else imps[0][i] += a;
      }
      for (let c = 0; c < nch; c++) {
        D.mode(imps[c], outs[c], f * (c ? rr(0.97, 1.03) : 1), tau, w, true);
        if (clk) { const s = imps[c], d = clk[c]; for (let i = 0; i < n; i++) d[i] += s[i] * w; }
      }
    }
    if (clk) for (let c = 0; c < nch; c++) {
      D.biquad(clk[c], 'highpass', ib.clickHp || 2500, 0.7, 0, true);
      const d = clk[c], oc = outs[c]; for (let i = 0; i < n; i++) oc[i] += d[i] * ib.click;
    }
  }
  if (o.bubbles) for (const bb of [].concat(o.bubbles)) {
    const cnt = Math.round(bb.rate * o.sec);
    for (let k = 0; k < cnt; k++) {
      const i0 = (R() * n) | 0, burst = bb.burst ? 1 + ((R() * bb.burst) | 0) : 1;
      for (let j = 0; j < burst; j++) {
        const ii = (i0 + (j ? (R() * (bb.spread || 0.08) * SR) | 0 : 0)) % n;
        const f0 = rlog(bb.f[0], bb.f[1]), tau = rr(bb.tau[0], bb.tau[1]), a = bb.amp * Math.pow(R(), bb.pow || 1.5), rise = bb.rise === undefined ? 0.3 : bb.rise;
        if (nch === 2) { const p = R() * 1.5708; D.bubble(outs[0], ii, f0, tau, a * Math.cos(p), rise, true); D.bubble(outs[1], ii, f0, tau, a * Math.sin(p), rise, true); }
        else D.bubble(outs[0], ii, f0, tau, a, rise, true);
      }
    }
  }
  if (o.splats) for (const sp of [].concat(o.splats)) {
    const cnt = Math.round(sp.rate * o.sec);
    for (let k = 0; k < cnt; k++) {
      const i0 = (R() * n) | 0, a = sp.amp * Math.pow(R(), sp.pow || 1.5), fc = rlog(sp.f[0], sp.f[1]), dur = rr(sp.dur[0], sp.dur[1]);
      const tgt = nch === 2 ? (([l, r]) => [[outs[0], l], [outs[1], r]])(pan(a)) : [[outs[0], a]];
      splat(tgt, i0, dur, fc, sp.q || 1, true, sp.thump || 0);
      if (sp.bub && R() < sp.bub.p) for (const [buf, g] of tgt) D.bubble(buf, (i0 + D.n(0.002)) % n, rlog(sp.bub.f[0], sp.bub.f[1]), rr(sp.bub.tau[0], sp.bub.tau[1]), g * (sp.bub.amp || 1), sp.bub.rise || 0.4, true);
    }
  }
  if (o.bands || o.ibands || o.bubbles || o.splats) D.normRms(outs, 1);
  if (o.bed) for (const bd of [].concat(o.bed)) for (let c = 0; c < nch; c++) {
    const x = D.noise(n, bd.color || 'pink', true);
    if (bd.hp) D.biquad(x, 'highpass', bd.hp, 0.7, 0, true);
    if (bd.lp) D.biquad(x, 'lowpass', bd.lp, 0.7, 0, true);
    if (bd.bp) D.biquad(x, 'bandpass', bd.bp[0], bd.bp[1], 0, true);
    D.normRms([x], 1);
    const am = bd.am ? D.curve(n, bd.am[0], bd.am[1], bd.am[2]) : null, pw = bd.amPow || 1, o2 = outs[c];
    for (let i = 0; i < n; i++) o2[i] += x[i] * bd.amp * (am ? Math.pow(am[i], pw) : 1);
  }
  for (let c = 0; c < nch; c++) {
    if (o.hp) D.biquad(outs[c], 'highpass', o.hp, 0.7, 0, true);
    if (o.lp) D.biquad(outs[c], 'lowpass', o.lp, 0.7, 0, true);
  }
  D.normRms(outs, o.rms || 0.15);
  return outs;
}

// ---------------------------------------------------------------------------------------------------------------------
// render functions → arrays of channel data (or {ch, sr})
// ---------------------------------------------------------------------------------------------------------------------
const RENDER = Object.create(null);
Object.assign(RENDER, {
  // --- rain ---
  // heavy rain: ~16k drop impacts/s on 26 jittered resonances (leaves, grass, soil, puddles) with their crisp impact
  // transients, a splash bed with slow intensity swells and a fizzy spray layer — never flat filtered noise
  rainWash: () => texture({ sr: 32000, sec: 9.3, stereo: true, seed: 11,
    ibands: { f: [260, 9500], n: 26, tau: [0.006, 0.0008], rate: 16000, pow: 2.2, tilt: [[0, 0.5], [0.3, 0.95], [0.55, 1], [0.8, 0.6], [1, 0.3]], click: 0.18, clickHp: 3000 },
    bed: [{ color: 'pink', hp: 300, lp: 4500, amp: 0.45, am: [36, 0.65, 1.0] }, { color: 'white', hp: 4000, lp: 11000, amp: 0.12, am: [160, 0.25, 1], amPow: 2 }],
    hp: 120, lp: 12000, rms: 0.16 }),
  // drizzle: sparse fine drops (small drops ring higher and shorter) and a faint mist of high hiss
  rainLight: () => texture({ sr: 32000, sec: 7.7, stereo: true, seed: 13,
    ibands: { f: [650, 11000], n: 20, tau: [0.004, 0.0006], rate: 1400, pow: 2.8, tilt: [[0, 0.35], [0.4, 1], [0.75, 0.9], [1, 0.45]], click: 0.25, clickHp: 3500 },
    bubbles: { rate: 18, f: [1800, 5000], tau: [0.002, 0.006], amp: 0.35, rise: 0.3 },
    bed: { color: 'pink', hp: 1800, lp: 9000, amp: 0.22, am: [30, 0.5, 1] }, hp: 250, lp: 13000, rms: 0.12 }),
  // sparse, distinct nearby drops (leaves, wood, puddle plinks) — two loops of coprime length
  rainTicksA: () => texture({ sr: 32000, sec: 6.7, stereo: true, seed: 21, pow: 3,
    ibands: { f: [450, 5200], n: 14, tau: [0.009, 0.0018], rate: 55, pow: 3, tilt: [[0, 0.7], [0.5, 1], [1, 0.5]] },
    bubbles: { rate: 12, f: [1200, 3600], tau: [0.004, 0.012], amp: 0.6, rise: 0.35 }, hp: 200, lp: 9000, rms: 0.1 }),
  rainTicksB: () => texture({ sr: 32000, sec: 9.1, stereo: true, seed: 22, pow: 3,
    ibands: { f: [480, 5600], n: 14, tau: [0.009, 0.0018], rate: 55, pow: 3, tilt: [[0, 0.7], [0.5, 1], [1, 0.5]] },
    bubbles: { rate: 12, f: [1100, 3400], tau: [0.004, 0.012], amp: 0.6, rise: 0.35 }, hp: 200, lp: 9000, rms: 0.1 }),
  // heavy-rain low roar
  rainLow: () => texture({ sr: 8000, sec: 8.3, stereo: true, seed: 12, bed: { color: 'brown', lp: 380, amp: 1, am: [16, 0.6, 1] }, hp: 30, rms: 0.18 }),
  // rain on the slate roof heard from under it (loft): soft dense patter, the odd heavier drop, boards damp the top end
  roof: () => texture({ sr: 16000, sec: 8.9, seed: 31,
    ibands: { f: [120, 3600], n: 18, tau: [0.035, 0.003], rate: 2600, pow: 2.3, tilt: [[0, 0.7], [0.3, 1], [0.6, 0.7], [1, 0.25]] },
    bed: { color: 'pink', lp: 900, hp: 70, amp: 0.35, am: [28, 0.7, 1] }, hp: 55, lp: 4200, rms: 0.16 }),
  // drops tapping on a window pane, heard from inside (two variants so neighbouring panes never phase together)
  glassA: () => rGlass(41, 6.3),
  glassB: () => rGlass(43, 7.1),
  // porch roof drumming, heard from below
  porch: () => texture({ sr: 24000, sec: 7.1, seed: 51,
    ibands: { f: [110, 3600], n: 18, tau: [0.05, 0.003], rate: 1900, pow: 2.3, tilt: [[0, 0.8], [0.3, 1], [0.6, 0.65], [1, 0.25]] },
    bed: { color: 'pink', hp: 200, lp: 3000, amp: 0.3 }, hp: 60, lp: 6500, rms: 0.16 }),
  // downspout: water gushing out onto the splash block + slugs gurgling down the hollow metal pipe
  gutter: () => at(24000, () => {
    const sec = 6.7, n = D.n(sec);
    const [out] = texture0({ sec, seed: 61, bubbles: { rate: 70, f: [380, 1800], tau: [0.005, 0.018], amp: 0.6, rise: 0.4 },
      splats: { rate: 40, dur: [0.004, 0.02], f: [700, 5000], q: 0.9, amp: 0.5 },
      bed: { color: 'white', bp: [1500, 0.7], amp: 0.55, am: [110, 0.15, 1], amPow: 2 }, hp: 120, lp: 7000, rms: 1 });
    const [pipe] = texture0({ sec, seed: 62, bubbles: { rate: 5, burst: 7, spread: 0.14, f: [140, 460], tau: [0.02, 0.05], amp: 1, rise: 0.25 }, rms: 1 });
    D.comb(pipe, 0.0068, 0.55, true);                   // ~147 Hz pipe resonance → the hollow, metallic gurgle
    D.biquad(pipe, 'lowpass', 1800, 0.7, 0, true); D.normRms([pipe], 1);
    for (let i = 0; i < n; i++) out[i] = out[i] * 0.8 + pipe[i] * 0.55;
    D.normRms([out], 0.14); return [out];
  }),
  // heavy drops falling off the eaves / porch-roof edge: splats into puddles and soil, some with a bubble plink
  dripLine: () => texture({ sr: 32000, sec: 8.3, seed: 73,
    splats: { rate: 26, dur: [0.004, 0.018], f: [600, 5000], q: 0.8, amp: 1, pow: 1.4, thump: 0.3, bub: { p: 0.35, f: [550, 1700], tau: [0.008, 0.028], amp: 0.8, rise: 0.45 } },
    bed: { color: 'pink', hp: 900, lp: 6000, amp: 0.12 }, hp: 90, lp: 11000, rms: 0.12 }),
  drip: () => texture({ sr: 32000, sec: 7.9, seed: 71, bands: [[2600, 0.0015, 0.4, 1.1]],
    bubbles: { rate: 1.3, f: [650, 1500], tau: [0.012, 0.03], amp: 1, rise: 0.45, pow: 0.7 }, hp: 150, lp: 9000, rms: 0.05 }),
  // rain on the pond: a fizz of tiny bubbles (small drops on water peak around 13-15 kHz), plinks, soft splash hiss
  pond: () => texture({ sr: 32000, sec: 7.3, seed: 75,
    bubbles: [{ rate: 520, f: [5000, 14500], tau: [0.0007, 0.002], amp: 0.45, rise: 0.2 }, { rate: 28, f: [900, 3400], tau: [0.004, 0.012], amp: 0.8, rise: 0.35 },
      { rate: 2, f: [380, 900], tau: [0.01, 0.03], amp: 0.6, rise: 0.3 }],
    splats: { rate: 140, dur: [0.002, 0.006], f: [2500, 9000], q: 0.8, amp: 0.3, pow: 2 },
    bed: { color: 'white', hp: 7000, lp: 15000, amp: 0.25, am: [30, 0.6, 1] }, hp: 250, lp: 15500, rms: 0.12 }),
  // rain on a tree canopy: dense soft leaf taps (lower and duller than on hard ground) with slow swells
  leaves: () => texture({ sr: 24000, sec: 8.7, seed: 77,
    ibands: { f: [300, 5200], n: 20, tau: [0.012, 0.0015], rate: 5200, pow: 2.4, tilt: [[0, 0.6], [0.35, 1], [0.7, 0.7], [1, 0.35]] },
    bed: { color: 'pink', bp: [1500, 0.5], amp: 0.3, am: [30, 0.45, 1] }, hp: 150, lp: 9000, rms: 0.14 }),
  // leaves rustling in the wind: thousands of tiny leaf-on-leaf contacts
  rustle: () => texture({ sr: 24000, sec: 9.1, seed: 79,
    splats: { rate: 900, dur: [0.001, 0.006], f: [1400, 7500], q: 1.1, amp: 1, pow: 2 },
    bed: { color: 'pink', hp: 1200, lp: 8000, amp: 0.35, am: [70, 0.25, 1], amPow: 2 }, hp: 400, lp: 10000, rms: 0.14 }),
  wind: () => texture({ sr: 16000, sec: 9.7, stereo: true, seed: 97, bed: { color: 'pink', lp: 2500, amp: 1, am: [10, 0.35, 1], amPow: 2 }, hp: 60, rms: 0.14 }),
  // --- kitchen / misc loops ---
  boil: () => texture({ sr: 24000, sec: 6.1, seed: 81,
    bubbles: [{ rate: 90, f: [180, 900], tau: [0.008, 0.03], amp: 0.8, rise: 0.25 }, { rate: 5, burst: 6, spread: 0.1, f: [120, 350], tau: [0.02, 0.05], amp: 1 }],
    bed: [{ color: 'brown', lp: 260, amp: 0.7, am: [18, 0.4, 1] }, { color: 'white', hp: 2500, lp: 7000, amp: 0.15, am: [25, 0.3, 1] }], hp: 50, lp: 6000, rms: 0.15 }),
  simmer: () => texture({ sr: 32000, sec: 5.3, seed: 91, bubbles: { rate: 28, f: [900, 3000], tau: [0.003, 0.009], amp: 0.5, rise: 0.3 },
    bed: [{ color: 'white', hp: 1500, lp: 6000, amp: 0.8, am: [20, 0.5, 1] }, { color: 'brown', lp: 200, amp: 0.3 }], hp: 80, lp: 8000, rms: 0.1 }),
  steam: () => texture({ sr: 16000, sec: 3.1, seed: 95, bed: { color: 'white', bp: [2800, 0.6], amp: 1, am: [16, 0.5, 1] }, rms: 0.1 }),
  hum: () => at(8000, () => { const n = D.n(1.0), o = new Float32Array(n); srand(5); const nz = D.pink(n, true); D.biquad(nz, 'lowpass', 400, 0.7, 0, true);
    for (let i = 0; i < n; i++) { const t = i / SR; o[i] = 0.5 * Math.sin(TAU * 50 * t) + 0.35 * Math.sin(TAU * 100 * t) + 0.15 * Math.sin(TAU * 150 * t) + 0.08 * Math.sin(TAU * 200 * t) + nz[i] * 0.3; }
    D.normRms([o], 0.08); return [o]; }),
  // --- fire ---
  fireBed: () => at(32000, () => {
    srand(101); const n = D.n(7.9), out = new Float32Array(n);
    const roar = D.brown(n, true); D.biquad(roar, 'lowpass', 170, 0.7, 0, true); D.normRms([roar], 1);
    const lap = D.pink(n, true); D.biquad(lap, 'bandpass', 380, 0.8, 0, true); D.normRms([lap], 1);
    const hiss = D.white(n); D.biquad(hiss, 'highpass', 3500, 0.7, 0, true); D.normRms([hiss], 1);
    const a1 = D.curve(n, 14, 0.45, 1), a2 = D.curve(n, 50, 0, 1), a3 = D.curve(n, 30, 0, 1);
    for (let i = 0; i < n; i++) out[i] = roar[i] * a1[i] * 0.6 + lap[i] * a2[i] * a2[i] * 0.35 + hiss[i] * a3[i] * a3[i] * a3[i] * 0.08;
    D.biquad(out, 'highpass', 40, 0.7, 0, true);
    D.normRms([out], 0.12); return [out];
  }),
  fireCrackle: () => at(32000, () => {
    srand(111); const sec = 12.1, n = D.n(sec), out = new Float32Array(n);
    const bands = [[1500, 0.0012, 0.8], [2400, 0.0009, 0.9], [3600, 0.0007, 0.8], [5200, 0.0005, 0.55]];
    const imps = bands.map(() => new Float32Array(n));
    for (let k = 0, cl = Math.round(9 * sec); k < cl; k++) {
      const i0 = (R() * n) | 0, cnt = 2 + ((Math.pow(R(), 2) * 12) | 0), spread = rr(0.01, 0.07) * SR, ca = Math.pow(R(), 2.2);
      for (let j = 0; j < cnt; j++) imps[(R() * bands.length) | 0][(i0 + ((R() * spread) | 0)) % n] += rs1() * ca * rr(0.3, 1);
    }
    for (let k = 0; k < 25 * sec; k++) imps[(R() * bands.length) | 0][(R() * n) | 0] += rs1() * 0.08;
    bands.forEach((b, j) => D.mode(imps[j], out, b[0], b[1], b[2], true));
    D.biquad(out, 'highpass', 700, 0.7, 0, true);
    D.normRms([out], 0.05); return [out];
  }),
  // wet wood hissing: moisture escaping as a fizzing high hiss with slow swells and the odd narrow steam squeal
  fireHiss: () => at(32000, () => {
    srand(105); const sec = 9.7, n = D.n(sec), o = new Float32Array(n);
    const h = D.white(n); D.biquad(h, 'highpass', 3800, 0.7, 0, true); D.biquad(h, 'lowpass', 9500, 0.7, 0, true); D.normRms([h], 1);
    const am = D.curve(n, 12, 0, 1), fz = D.curve(n, 180, 0.3, 1);
    for (let i = 0; i < n; i++) o[i] = h[i] * Math.pow(am[i], 2.2) * fz[i];
    for (let k = 0; k < 3; k++) {                       // steam squeals: noise ringing a very narrow resonance
      const i0 = D.n(rr(0, sec - 1.5)), len = D.n(rr(0.4, 1.2)), ex = new Float32Array(len), sq = new Float32Array(len);
      for (let j = 0; j < len; j++) ex[j] = rs1() * Math.pow(Math.sin(Math.PI * j / len), 1.5);
      D.mode(ex, sq, rr(2400, 4800), 0.012, 0.02);
      for (let j = 0; j < len; j++) o[(i0 + j) % n] += sq[j];
    }
    D.normRms([o], 0.05); return [o];
  }),
  // grandfather clock, 8 beats: escape-wheel drop + lock on every beat, a small beat error (tick and tock not quite
  // evenly spaced), per-beat variation, and the tall wooden case ringing underneath
  clock: () => at(32000, () => {
    srand(121); const o = D.zeros(8.0), CASE = [[182, 0.05, 0.35], [305, 0.035, 0.3], [470, 0.03, 0.22], [860, 0.02, 0.15]];
    for (let k = 0; k < 8; k++) {
      const tock = k % 2 === 1, t0 = 0.01 + k + (tock ? 0.014 : 0) + rs1() * 0.0012, s = (tock ? 0.87 : 1) * rr(0.99, 1.01), a = (tock ? 0.9 : 1) * rr(0.93, 1.05);
      const esc = [[2350 * s, 0.009, 1], [3720 * s, 0.006, 0.7], [5480 * s, 0.0035, 0.4], [1180 * s, 0.016, 0.5]];
      strike(o, t0, esc, a, 0.0005, 0.012);
      strike(o, t0 + rr(0.009, 0.013), esc, a * rr(0.28, 0.4), 0.0004, 0.012);
      strike(o, t0, CASE, a * 0.7, 0.002, 0.02);
    }
    D.normPeak([o], 0.9); return [o];
  }),
  // cat purr: ~25 Hz laryngeal pulses on the exhale (stronger) and inhale (softer, lower); breaths of varying length
  // so the loop never sounds mechanical
  purr: () => at(8000, () => {
    srand(131); const sec = 9.6, n = D.n(sec), o = new Float32Array(n), nz = D.white(n); D.biquad(nz, 'lowpass', 900, 0.7);
    const segs = []; let tot = 0;
    for (let k = 0; k < 4; k++) {
      const ex = rr(1.3, 1.9), inh = rr(0.8, 1.2), g1 = rr(0.06, 0.14), g2 = rr(0.06, 0.14);
      segs.push([ex, rr(24, 27.5), rr(0.85, 1.05), g1], [inh, rr(20, 23), rr(0.48, 0.65), g2]); tot += ex + inh + g1 + g2;
    }
    let t = 0; const sc = sec / tot;
    for (const [dur0, f0, amp, gap] of segs) {
      const dur = dur0 * sc, i0 = D.n(t), len = D.n(dur); let ph = 0;
      for (let j = 0; j < len; j++) {
        const tt = j / SR, env = Math.pow(Math.sin(Math.PI * tt / dur), 0.6), idx = (i0 + j) % n;
        ph += f0 * (1 + 0.05 * Math.sin(TAU * 0.8 * tt)) / SR;
        const fr = ph - Math.floor(ph), pulse = Math.exp(-fr / 0.14);
        o[idx] += amp * env * (pulse * (0.65 + 0.8 * nz[idx]) + 0.12 * nz[idx]);
      }
      t += (dur0 + gap) * sc;
    }
    D.biquad(o, 'lowpass', 520, 0.7, 0, true); D.biquad(o, 'lowpass', 700, 0.7, 0, true); D.biquad(o, 'highpass', 28, 0.7, 0, true);
    D.normRms([o], 0.2); return [o];
  }),
  // vinyl surface noise: hiss, crackles, a few pops and the once-per-revolution tick (33⅓ rpm = 1.8 s)
  vinyl: () => at(32000, () => {
    srand(141); const sec = 7.2, n = D.n(sec), o = new Float32Array(n);
    const hiss = D.pink(n, true); D.biquad(hiss, 'highpass', 1500, 0.7, 0, true); D.biquad(hiss, 'lowpass', 7000, 0.7, 0, true); D.normRms([hiss], 0.012);
    const imp = new Float32Array(n); for (let k = 0; k < 9 * sec; k++) imp[(R() * n) | 0] += rs1() * Math.pow(R(), 2.5) * 0.6;
    for (let j = 0; j < 4; j++) imp[D.n(0.7 + 1.8 * j)] += 0.25;
    const cl = new Float32Array(n); D.mode(imp, cl, 3200, 0.0004, 1, true); D.mode(imp, cl, 1600, 0.0008, 0.6, true);
    const pops = new Float32Array(n); for (let k = 0; k < 0.4 * sec; k++) pops[(R() * n) | 0] += rr(0.2, 0.4);
    D.mode(pops, cl, 420, 0.004, 0.5, true);
    const rum = D.brown(n, true); D.biquad(rum, 'lowpass', 45, 0.7, 0, true); D.normRms([rum], 0.006);
    for (let i = 0; i < n; i++) o[i] = hiss[i] + cl[i] + rum[i];
    return [o];
  }),
  // indoor response (unit energy): a furnished ~90 m³ cottage room — discrete early reflections (floor, ceiling, walls,
  // each a little duller) melting into a decorrelated late field, RT60 ≈ 0.62 s low / 0.5 s mid / 0.28 s high
  irRoom() {
    srand(5); const n = D.n(1.0), chs = [];
    const BANDS = [[0, 300, 0.62], [300, 1500, 0.5], [1500, 5000, 0.4], [5000, 0, 0.28]];
    const ER = [0.0031, 0.0052, 0.0069, 0.0086, 0.0094, 0.0118, 0.0135, 0.0151, 0.0173, 0.019, 0.0216, 0.0242, 0.0269, 0.0295, 0.0328, 0.0361, 0.0402, 0.0447];
    for (let c = 0; c < 2; c++) {
      const late = new Float32Array(n), early = new Float32Array(n);
      for (const [lo, hi, rt] of BANDS) {
        const x = D.white(n), k = 6.91 / rt;
        if (lo) { D.biquad(x, 'highpass', lo, 0.6); D.biquad(x, 'highpass', lo, 0.6); }
        if (hi) { D.biquad(x, 'lowpass', hi, 0.6); D.biquad(x, 'lowpass', hi, 0.6); }
        for (let i = 0; i < n; i++) { const t = i / SR; late[i] += x[i] * Math.exp(-k * t) * clamp((t - 0.008) / 0.03, 0, 1); }
      }
      ER.forEach((t0, j) => {
        const t = t0 * (c ? rr(1.03, 1.12) : rr(0.94, 1.02)), w = Math.max(2, Math.round(SR * (0.0001 + t * 0.01))), i0 = D.n(t);
        const a = (R() < 0.3 ? -1 : 1) * Math.pow(0.86, j) * rr(0.7, 1.1);
        for (let q = 0; q < 2 * w && i0 + q < n; q++) early[i0 + q] += a * (1 - Math.cos(Math.PI * q / w)) * 0.5 / Math.sqrt(w);
      });
      let el = 0, ee = 0; for (let i = 0; i < n; i++) { el += late[i] * late[i]; ee += early[i] * early[i]; }
      const kl = Math.sqrt(0.58 / (el || 1)), ke = Math.sqrt(0.42 / (ee || 1)), x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = late[i] * kl + early[i] * ke;
      D.fadeOut(x, 0.05); chs.push(x);
    }
    return chs;
  },
  // outdoor response (unit energy): open air — a slap off the house front, sparse returns from trees and the fence,
  // the hills' faint late echoes and a dark, low diffuse tail
  irOut() {
    srand(9); const n = D.n(1.6), chs = [];
    for (let c = 0; c < 2; c++) {
      const taps = new Float32Array(n), tail = D.white(n);
      const TAPS = [[rr(0.011, 0.017), 0.6, 0.0002], [rr(0.02, 0.03), 0.36, 0.0003]];
      for (let k = 0; k < 9; k++) TAPS.push([rr(0.04, 0.17), rr(0.07, 0.2) * (1 - k / 12), rr(0.0004, 0.0012)]);
      TAPS.push([rr(0.42, 0.55), 0.13, 0.0025], [rr(0.72, 0.95), 0.08, 0.0035]);
      for (const [t, a0, wd] of TAPS) {
        const i0 = D.n(t * (c ? rr(1.02, 1.09) : 1)), w = Math.max(2, Math.round(wd * SR)), a = (R() < 0.35 ? -1 : 1) * a0;
        for (let q = 0; q < 2 * w && i0 + q < n; q++) taps[i0 + q] += a * (1 - Math.cos(Math.PI * q / w)) * 0.5 / Math.sqrt(w);
      }
      D.biquad(tail, 'lowpass', 1500, 0.6); D.biquad(tail, 'lowpass', 1800, 0.6);
      for (let i = 0; i < n; i++) { const t = i / SR; tail[i] *= Math.exp(-5.3 * t) * clamp((t - 0.03) / 0.08, 0, 1); }
      let et = 0, ea = 0; for (let i = 0; i < n; i++) { et += tail[i] * tail[i]; ea += taps[i] * taps[i]; }
      const kt = Math.sqrt(0.35 / (et || 1)), ka = Math.sqrt(0.65 / (ea || 1)), x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = taps[i] * ka + tail[i] * kt;
      D.fadeOut(x, 0.1); chs.push(x);
    }
    return chs;
  },
});
// drops tapping on glass: bright ticks with their impact transient, the odd fat drop thocking the pane, rivulets
function rGlass(seed, sec) {
  return texture({ sr: 32000, sec, seed,
    ibands: [{ f: [1700, 9500], n: 14, tau: [0.003, 0.0006], rate: 75, pow: 2.6, tilt: [[0, 0.6], [0.4, 1], [1, 0.5]], click: 0.3, clickHp: 3500 },
      { f: [170, 950], n: 6, tau: [0.02, 0.007], rate: 7, pow: 1.8, tilt: [[0, 0.6], [1, 0.35]] }],
    bubbles: { rate: 14, f: [2500, 6500], tau: [0.0015, 0.004], amp: 0.2, rise: 0.25 },
    bed: { color: 'pink', bp: [3200, 0.8], amp: 0.07, am: [20, 0.3, 1] }, hp: 130, lp: 12500, rms: 0.12 });
}

// fire, live-scheduled on top of the bed so nothing repeats in a pattern: crackles (bursts of micro-cracks), pops (a
// sharp snap, a charred-wood knock, sometimes an ember spray or a puff of steam) and logs settling in the grate
for (let k = 0; k < 12; k++) RENDER['crk' + k] = () => at(32000, () => {
  srand(800 + k); const o = D.zeros(0.25), cnt = 2 + ((R() * R() * 9) | 0), spread = rr(0.004, 0.06);
  for (let j = 0; j < cnt; j++) {
    const t = Math.pow(R(), 1.6) * spread, a = rr(0.25, 1) * (j ? 0.7 : 1);
    strike(o, t, [[rlog(1300, 3000), rr(0.0006, 0.0014), 1], [rlog(3000, 7000), rr(0.0003, 0.0008), 0.7]], a, 0.00015, 0.05);
  }
  if (R() < 0.5) addNoise(o, 0, { dur: 0.02, amp: 0.2, att: 0.0002, dec: 0.003, hp: 3000 });
  return fin(o);
});
for (let k = 0; k < 8; k++) RENDER['pop' + k] = () => at(32000, () => {
  srand(200 + k); const o = D.zeros(0.45), nl = D.n(rr(0.0006, 0.0015));
  for (let i = 0; i < nl; i++) o[i] += 0.8 * (1 - 2 * i / nl);                           // N-shaped pressure snap
  strike(o, 0.0005, [[rr(450, 900), rr(0.008, 0.016), 0.8], [rr(1300, 2300), 0.005, 0.6], [rr(2800, 4800), 0.0025, 0.45]], 1, 0.0004);
  addNoise(o, 0, { dur: 0.03, amp: 0.45, att: 0.0003, dec: 0.004, hp: 1500 });
  if (R() < 0.55) for (let j = 0, m = 3 + ((R() * 8) | 0); j < m; j++) strike(o, rr(0.02, 0.3), [[rlog(2500, 7000), 0.0006, 1]], rr(0.05, 0.25), 0.0002);
  if (R() < 0.35) addNoise(o, 0.01, { dur: 0.25, amp: 0.1, att: 0.01, dec: 0.08, bp: [5500, 0.8] });
  return fin(o);
});
for (let k = 0; k < 3; k++) RENDER['settle' + k] = () => at(32000, () => {
  srand(830 + k); const o = D.zeros(1.6), t = rr(0.18, 0.4);
  addNoise(o, 0, { dur: rr(0.25, 0.5), amp: 0.35, shape: u => Math.pow(Math.sin(Math.PI * u), 1.2), bp: [rr(900, 1600), 0.9], am: 70 });   // log slides
  addThump(o, t, rr(110, 150), rr(60, 80), 0.07, 0.7);
  strike(o, t, [[rr(180, 260), 0.03, 0.7], [rr(420, 600), 0.02, 0.55], [rr(900, 1300), 0.01, 0.35]], 0.9, 0.002);
  for (let j = 0; j < 14; j++) strike(o, t + Math.pow(R(), 1.5) * 0.9, [[rlog(2500, 8000), rr(0.0005, 0.0012), 1]], rr(0.05, 0.3), 0.0002);  // embers
  addNoise(o, t, { dur: 0.9, amp: 0.15, att: 0.05, dec: 0.3, bp: [2800, 0.6], am: 40 });                                            // flare-up
  return fin(o, 0.85);
});
// random nearby raindrops: puddle plinks and leaf/wood ticks
for (let k = 0; k < 8; k++) RENDER['drop' + k] = () => {
  srand(300 + k); const o = D.zeros(0.12);
  if (k < 4) { strike(o, 0, [[rr(2000, 3500), 0.0015, 1]], 0.4, 0.0003); D.bubble(o, D.n(0.002), rlog(1100, 2600), rr(0.006, 0.014), 1, 0.5); }
  else strike(o, 0, [[rr(500, 900), 0.006, 0.6], [rr(1200, 2200), 0.004, 0.8], [rr(2800, 4000), 0.002, 0.5]], 1, 0.0004);
  return fin(o);
};

// ---- footsteps ----
// heel strike ('h') and toe roll-off ('t') are separate buffers so the engine sets the gait timing (walk / run /
// crouch / stairs up or down). Outdoors everything is wet.
function rStep(s, part, seed) {
  srand(seed);
  const heel = part === 'h', out = D.zeros(0.32), J = () => rr(0.92, 1.08);
  switch (s) {
    case 'wood': case 'stairs': {
      const st = s === 'stairs';
      const m = st ? [[112 * J(), 0.06, 0.8], [240 * J(), 0.04, 0.65], [505 * J(), 0.022, 0.45], [1050 * J(), 0.011, 0.3], [2100 * J(), 0.005, 0.14]]
        : [[160 * J(), 0.035, 0.6], [385 * J(), 0.022, 0.55], [810 * J(), 0.012, 0.4], [1600 * J(), 0.006, 0.24], [2900 * J(), 0.003, 0.1]];
      if (heel) { addThump(out, 0, 125, 80, st ? 0.05 : 0.035, 0.5); strike(out, 0.001, m, 1, 0.0018); addNoise(out, 0.001, { dur: 0.04, amp: 0.1, dec: 0.01, bp: [2600, 0.8] }); }
      else { strike(out, 0.002, m, 0.45, 0.003); addNoise(out, 0, { dur: 0.1, amp: 0.16, att: 0.012, dec: 0.03, bp: [rr(2000, 3200), 0.9], am: 160 }); }
      break;
    }
    case 'tile': {        // ceramic tiles on a screed, soft-soled shoes: a dull tap rather than a click
      const m = [[rr(850, 1000), 0.006, 0.5], [rr(1650, 1900), 0.0045, 0.5], [rr(2900, 3300), 0.003, 0.35], [rr(4800, 5600), 0.0016, 0.2]];
      if (heel) { strike(out, 0, m, 1, 0.0012); addThump(out, 0, 150, 105, 0.018, 0.35); addNoise(out, 0, { dur: 0.012, amp: 0.25, dec: 0.003, hp: 5000 }); }
      else { strike(out, 0.001, m, 0.5, 0.0015); addNoise(out, 0, { dur: 0.06, amp: 0.2, att: 0.008, dec: 0.02, bp: [rr(1700, 2600), 2.5], am: 220 }); }
      break;
    }
    case 'rug': case 'carpet': {
      const c = s === 'carpet', lp = c ? 230 : 300;
      if (heel) { addNoise(out, 0, { dur: 0.15, amp: 1, att: 0.006, dec: 0.04, lp, color: 'pink' }); addThump(out, 0, 100, 70, 0.03, 0.35); addNoise(out, 0.008, { dur: 0.14, amp: c ? 0.05 : 0.08, att: 0.015, dec: 0.05, bp: [1800, 0.7] }); }
      else { addNoise(out, 0, { dur: 0.11, amp: 0.8, att: 0.008, dec: 0.03, lp, color: 'pink' }); addNoise(out, 0.01, { dur: 0.12, amp: c ? 0.05 : 0.07, att: 0.02, dec: 0.04, bp: [2400, 0.7], am: 90 }); }
      break;
    }
    case 'porch': {       // deck boards over a hollow crawl space: a boomy knock and a loose-board rattle
      const m = [[88 * J(), 0.09, 0.8], [196 * J(), 0.055, 0.6], [420 * J(), 0.026, 0.45], [860 * J(), 0.012, 0.3], [1750 * J(), 0.005, 0.14]];
      if (heel) { addThump(out, 0, 115, 72, 0.065, 0.5); strike(out, 0.001, m, 1, 0.0018); strike(out, rr(0.018, 0.035), [[m[2][0] * 1.3, 0.015, 0.4], [m[3][0] * 1.2, 0.008, 0.3]], 0.28, 0.001); }
      else { strike(out, 0.002, m, 0.4, 0.003); addNoise(out, 0, { dur: 0.09, amp: 0.13, att: 0.01, dec: 0.03, bp: [rr(1800, 2800), 0.9], am: 150 }); }
      break;
    }
    case 'stone': {       // wet flagstones: a hard contact, grit under the sole, a thin film of water
      const m = [[rr(600, 700), 0.01, 0.5], [rr(1400, 1600), 0.006, 0.45], [rr(2600, 3000), 0.0035, 0.3], [rr(4300, 5000), 0.002, 0.18]];
      if (heel) {
        strike(out, 0, m, 1, 0.001); addNoise(out, 0, { dur: 0.06, amp: 0.45, att: 0.002, dec: 0.016, lp: 260, color: 'pink' });
        addGrains(out, 0.002, 0.05, 14, [[3600, 0.0008, 0.5], [5600, 0.0006, 0.4]], 0.3, 'decay'); addNoise(out, 0.002, { dur: 0.05, amp: 0.25, att: 0.002, dec: 0.012, hp: 1800 });
      } else { strike(out, 0.001, m, 0.4, 0.001); addGrains(out, 0.004, 0.07, 22, [[3200, 0.0009, 0.5], [5000, 0.0006, 0.4]], 0.4); addNoise(out, 0, { dur: 0.08, amp: 0.14, att: 0.01, dec: 0.025, bp: [2800, 1], am: 200 }); }
      break;
    }
    case 'grass': {       // wet turf: a soft squish, blades swishing, a little water
      if (heel) {
        addNoise(out, 0, { dur: 0.09, amp: 0.55, att: 0.005, dec: 0.028, lp: 190, color: 'pink' }); addNoise(out, 0.015, { dur: 0.12, amp: 0.3, att: 0.01, dec: 0.04, sweep: [450, 1100, 3] });
        addNoise(out, 0, { dur: 0.18, amp: 0.4, att: 0.015, dec: 0.055, bp: [3000, 0.7] }); addGrains(out, 0.005, 0.12, 36, [[3200, 0.0012, 0.6], [5200, 0.0008, 0.5]], 0.45);
        for (let k = 0; k < 3; k++) D.bubble(out, D.n(rr(0.01, 0.1)), rlog(900, 2600), rr(0.003, 0.008), 0.1, 0.3);
      } else { addNoise(out, 0, { dur: 0.16, amp: 0.4, att: 0.012, dec: 0.05, bp: [3300, 0.7] }); addGrains(out, 0.01, 0.1, 26, [[3400, 0.0012, 0.6], [5600, 0.0008, 0.5]], 0.4); addNoise(out, 0, { dur: 0.06, amp: 0.25, att: 0.005, dec: 0.02, lp: 220, color: 'pink' }); }
      break;
    }
    case 'mud': {         // squelch in, then the suction as the sole pulls free
      if (heel) {
        addNoise(out, 0, { dur: 0.08, amp: 0.6, att: 0.004, dec: 0.03, lp: 200, color: 'pink' }); addNoise(out, 0.01, { dur: 0.2, amp: 0.6, att: 0.02, dec: 0.07, sweep: [320, 950, 4.5], am: 60 });
        for (let k = 0; k < 3; k++) D.bubble(out, D.n(rr(0.03, 0.18)), rlog(250, 700), rr(0.01, 0.03), 0.25, 0.3);
      } else {
        addNoise(out, 0, { dur: 0.22, amp: 0.5, att: 0.03, dec: 0.06, sweep: [950, 360, 4], am: 45 });
        for (let k = 0; k < 2; k++) D.bubble(out, D.n(rr(0.08, 0.2)), rlog(280, 650), rr(0.012, 0.03), 0.3, 0.25);
        addNoise(out, 0.16, { dur: 0.03, amp: 0.3, att: 0.001, dec: 0.006, bp: [1200, 1] });
      }
      break;
    }
    case 'gravel': {      // crunch on landing, a longer grind as the foot rolls
      const gm = [[1700, 0.0015, 0.6], [2900, 0.001, 0.7], [4600, 0.0007, 0.55], [6500, 0.0005, 0.35]];
      if (heel) { addGrains(out, 0, 0.14, 170, gm, 1, 'decay'); addNoise(out, 0, { dur: 0.06, amp: 0.35, att: 0.003, dec: 0.02, lp: 220, color: 'pink' }); }
      else { addGrains(out, 0, 0.17, 120, gm, 0.8); addNoise(out, 0, { dur: 0.15, amp: 0.1, att: 0.02, dec: 0.05, bp: [2500, 0.7], am: 120 }); }
      break;
    }
    case 'water': {       // puddle: splash, spray and bubbles
      if (heel) {
        addNoise(out, 0, { dur: 0.12, amp: 0.7, att: 0.003, dec: 0.04, bp: [900, 0.7] }); addNoise(out, 0.01, { dur: 0.26, amp: 0.35, att: 0.01, dec: 0.08, hp: 2500 });
        for (let k = 0; k < 7; k++) D.bubble(out, D.n(rr(0.01, 0.2)), rlog(400, 1800), rr(0.005, 0.02), 0.3, 0.4);
        addThump(out, 0, 160, 220, 0.04, 0.3);
      } else { addNoise(out, 0, { dur: 0.18, amp: 0.45, att: 0.02, dec: 0.05, bp: [1300, 0.8] }); for (let k = 0; k < 5; k++) D.bubble(out, D.n(rr(0.03, 0.25)), rlog(600, 2200), rr(0.004, 0.014), 0.25, 0.4); }
      break;
    }
    default: return rStep('wood', part, seed);
  }
  return fin(out);
}
for (const s of ['wood', 'stairs', 'tile', 'rug', 'carpet', 'porch', 'grass', 'mud', 'gravel', 'stone', 'water']) {
  for (let k = 0; k < STEP_VARIANTS; k++) {
    const sd = 1000 + s.length * 97 + k * 13 + s.charCodeAt(0);
    RENDER[`stepH_${s}_${k}`] = () => at(32000, () => rStep(s, 'h', sd));
    RENDER[`stepT_${s}_${k}`] = () => at(32000, () => rStep(s, 't', sd + 7919));
  }
}
// footstep overlays: wet rubber soles squeaking on smooth floors, a thin film of water on wet ground, jacket rustle
for (let k = 0; k < 4; k++) {
  RENDER['squeak' + k] = () => at(32000, () => {
    srand(900 + k); const f = rr(850, 1500);
    return fin(creakSig({ dur: rr(0.06, 0.14), rates: [[0, f], [0.5, f * rr(1.1, 1.35)], [1, f * rr(0.85, 1.05)]], jit: 0.03,
      amp: [[0, 0], [0.2, 1], [0.8, 0.7], [1, 0]], modes: [[rr(2000, 2600), 0.003, 0.6], [rr(3300, 3900), 0.002, 0.45], [rr(5000, 5800), 0.0015, 0.25]] }));
  });
  RENDER['wet' + k] = () => at(32000, () => {
    srand(910 + k); const o = D.zeros(0.2);
    addNoise(o, 0, { dur: rr(0.04, 0.08), amp: 1, att: 0.001, dec: 0.012, hp: rr(1200, 2000) });
    for (let j = 0; j < 3; j++) D.bubble(o, D.n(rr(0.004, 0.05)), rlog(1400, 4200), rr(0.002, 0.006), 0.3, 0.3);
    return fin(o);
  });
  RENDER['cloth' + k] = () => at(24000, () => {
    srand(920 + k); const o = D.zeros(0.35);
    addNoise(o, 0, { dur: rr(0.12, 0.25), amp: 1, shape: u => Math.pow(Math.sin(Math.PI * u), 1.4), bp: [rr(2200, 3800), 0.6], am: rr(60, 130) });
    addNoise(o, 0.01, { dur: 0.15, amp: 0.3, shape: u => Math.sin(Math.PI * u), hp: 5000, am: 200 });
    return fin(o);
  });
}
// creaks: individual floorboards / stair treads (the engine picks one per board, deterministically), the porch rocker,
// the house frame straining in gusts, a loose pane rattling when thunder hits
for (let k = 0; k < 6; k++) RENDER['board' + k] = () => at(32000, () => {
  srand(430 + k); const lo = rr(22, 40), hi = lo * rr(1.6, 2.6);
  return fin(creakSig({ dur: rr(0.22, 0.6), rates: [[0, lo], [rr(0.35, 0.65), hi], [1, lo * rr(0.8, 1.1)]], jit: rr(0.15, 0.3), skip: 0.06,
    amp: [[0, 0], [0.12, 1], [0.7, 0.75], [1, 0]], modes: [[rr(170, 280), 0.028, 0.6], [rr(360, 520), 0.016, 0.7], [rr(680, 950), 0.01, 0.5], [rr(1200, 1650), 0.007, 0.3], [rr(2100, 2700), 0.004, 0.15]] }));
});
for (let k = 0; k < 3; k++) RENDER['rocker' + k] = () => at(32000, () => {
  srand(440 + k); const o = D.zeros(0.9);
  mixAt(o, creakSig({ dur: rr(0.35, 0.6), rates: [[0, rr(35, 50)], [0.5, rr(70, 110)], [1, rr(35, 55)]], jit: 0.2, amp: [[0, 0], [0.15, 0.9], [0.75, 0.6], [1, 0]],
    modes: [[rr(260, 340), 0.02, 0.6], [rr(560, 700), 0.014, 0.65], [rr(1050, 1300), 0.009, 0.45], [rr(1900, 2300), 0.005, 0.25]] }), rr(0.02, 0.08), 0.7);
  strike(o, 0, [[rr(110, 140), 0.05, 0.6], [rr(240, 300), 0.03, 0.5], [rr(480, 600), 0.015, 0.3]], 0.35, 0.004);   // runners on the deck
  return fin(o, 0.85);
});
for (let k = 0; k < 3; k++) RENDER['house_creak' + k] = () => at(24000, () => {
  srand(450 + k); const lo = rr(9, 16);
  return fin(creakSig({ dur: rr(0.7, 1.5), rates: [[0, lo], [rr(0.3, 0.6), lo * rr(2, 3.2)], [1, lo * rr(0.9, 1.3)]], jit: 0.3, skip: 0.1,
    amp: [[0, 0], [0.2, 1], [0.6, 0.8], [1, 0]], modes: [[rr(85, 130), 0.05, 0.7], [rr(210, 300), 0.03, 0.6], [rr(430, 600), 0.018, 0.4], [rr(850, 1200), 0.01, 0.2]] }));
});
RENDER.rattle = () => at(32000, () => {
  srand(460); const o = D.zeros(1.0);
  mixAt(o, creakSig({ dur: 0.8, rates: [[0, 34], [0.5, 28], [1, 22]], jit: 0.35, skip: 0.1, amp: [[0, 0], [0.04, 1], [0.4, 0.5], [1, 0]],
    modes: [[rr(380, 440), 0.012, 0.6], [rr(820, 940), 0.008, 0.5], [rr(1550, 1750), 0.005, 0.45], [rr(2700, 3100), 0.003, 0.3], [rr(4300, 4900), 0.002, 0.2]] }), 0, 1);
  addThump(o, 0, 70, 45, 0.12, 0.5);
  return fin(o, 0.85);
});
for (let k = 0; k < 3; k++) {
  RENDER['floor_creak' + k] = () => { srand(400 + k); return fin(creakSig({ dur: rr(0.3, 0.55), rates: [[0, rr(25, 40)], [0.5, rr(45, 80)], [1, rr(25, 40)]], jit: 0.25,
    amp: [[0, 0], [0.15, 1], [0.7, 0.7], [1, 0]], modes: [[rr(180, 260), 0.025, 0.6], [rr(380, 480), 0.015, 0.7], [rr(700, 900), 0.01, 0.5], [rr(1200, 1500), 0.007, 0.3]] })); };
}
RENDER.chair_creak = () => { srand(410); return fin(creakSig({ dur: 0.4, rates: [[0, 60], [0.5, 110], [1, 70]], jit: 0.2, amp: [[0, 0], [0.1, 1], [0.8, 0.6], [1, 0]],
  modes: [[320, 0.02, 0.6], [640, 0.014, 0.7], [1150, 0.009, 0.5], [1900, 0.006, 0.3]] })); };

// ---- one-shots ----
const DOOR_MODES = [[230, 0.02, 0.5], [420, 0.012, 0.8], [780, 0.009, 0.7], [1250, 0.007, 0.55], [1900, 0.005, 0.4], [2600, 0.004, 0.25]];
function latch(o, t, a) {
  strike(o, t, [[2100, 0.015, 0.6], [3300, 0.012, 0.5], [5100, 0.008, 0.4], [1200, 0.02, 0.3]], a, 0.0005);
  strike(o, t + 0.03, [[2300, 0.01, 0.5], [3600, 0.008, 0.4]], a * 0.4, 0.0004);
}
Object.assign(RENDER, {
  click() { srand(501); const o = D.zeros(0.15), m = [[2800, 0.002, 0.7], [4500, 0.0015, 0.5], [1400, 0.004, 0.4]];
    strike(o, 0.002, m, 1, 0.0003); strike(o, 0.038, m.map(x => [x[0] * 1.12, x[1], x[2]]), 0.6, 0.0003);
    addNoise(o, 0.002, { dur: 0.02, amp: 0.15, dec: 0.004, lp: 600 }); return fin(o); },
  switch() { srand(502); const o = D.zeros(0.2); strike(o, 0.002, [[3600, 0.001, 0.4], [5200, 0.0008, 0.3]], 0.5, 0.0003);
    strike(o, 0.012, [[1900, 0.005, 0.7], [3100, 0.003, 0.6], [820, 0.008, 0.5], [380, 0.012, 0.35]], 1, 0.0005); return fin(o); },
  creak() { srand(503); return fin(creakSig({ dur: 1.35, rates: [[0, 38], [0.25, 85], [0.5, 110], [0.7, 75], [1, 48]], jit: 0.18,
    amp: [[0, 0], [0.06, 1], [0.75, 0.8], [1, 0]], modes: DOOR_MODES, rasp: [1400, 1.2, 0.04] })); },
  door_open() { srand(504); const o = D.zeros(1.2); latch(o, 0, 1);
    mixAt(o, creakSig({ dur: 0.9, rates: [[0, 45], [0.3, 95], [0.6, 120], [1, 60]], jit: 0.2, amp: [[0, 0], [0.1, 1], [0.7, 0.7], [1, 0]], modes: DOOR_MODES }), 0.12, 0.55);
    addNoise(o, 0.1, { dur: 0.6, amp: 0.12, att: 0.15, dec: 0.2, lp: 500, color: 'pink' }); return fin(o); },
  door_close() { srand(505); const o = D.zeros(1.0);
    addNoise(o, 0, { dur: 0.36, amp: 0.18, shape: u => Math.pow(u, 1.5), lp: 600, color: 'pink' });
    const t = 0.34; addThump(o, t, 95, 65, 0.09, 0.8);          // the leaf reaches the frame ~0.35 s into the swing
    strike(o, t, [[175, 0.06, 0.7], [340, 0.04, 0.6], [610, 0.025, 0.5], [1150, 0.012, 0.3], [2300, 0.005, 0.14]], 1, 0.002);
    addNoise(o, t, { dur: 0.08, amp: 0.3, dec: 0.015, lp: 1500 }); latch(o, t + 0.025, 0.7); return fin(o); },
  thud() { srand(506); const o = D.zeros(0.6); addThump(o, 0, 90, 55, 0.12, 1);
    strike(o, 0, [[140, 0.06, 0.6], [290, 0.03, 0.4], [600, 0.015, 0.2]], 1, 0.002); addNoise(o, 0, { dur: 0.1, amp: 0.35, dec: 0.02, lp: 800 }); return fin(o); },
  page() { srand(507); const o = D.zeros(0.5);
    addNoise(o, 0, { dur: 0.38, amp: 0.6, shape: u => Math.pow(Math.sin(Math.PI * u), 1.2), bp: [3000, 0.6], am: 90 });
    addNoise(o, 0.02, { dur: 0.3, amp: 0.25, shape: u => Math.sin(Math.PI * u), hp: 5000, am: 140 });
    addNoise(o, 0.32, { dur: 0.08, amp: 0.3, att: 0.002, dec: 0.015, lp: 500, color: 'pink' }); return fin(o); },
  pour() { srand(508); const dur = 2.4, o = D.zeros(dur + 0.1), env = u => Math.min(1, u * 14) * Math.min(1, (1 - u) * 6);
    addNoise(o, 0, { dur, amp: 1, shape: env, sweep: [450, 1400, 5], am: 22 });
    addNoise(o, 0, { dur, amp: 0.25, shape: env, hp: 3000, am: 30 });
    for (let k = 0; k < 70; k++) { const t = rr(0.05, dur - 0.15); D.bubble(o, D.n(t), rlog(600 + t * 300, 2200), rr(0.004, 0.015), rr(0.05, 0.25), 0.4); }
    addNoise(o, 0, { dur: 0.1, amp: 0.5, att: 0.003, dec: 0.03, bp: [900, 0.8] }); return fin(o); },
  sip() { srand(509); const o = D.zeros(0.5);
    addNoise(o, 0.02, { dur: 0.28, amp: 0.8, shape: u => Math.pow(Math.sin(Math.PI * u), 1.2), bp: [1600, 2.2], am: 30 });
    addNoise(o, 0.03, { dur: 0.2, amp: 0.2, shape: u => Math.sin(Math.PI * u), hp: 4000, am: 45 });
    D.bubble(o, D.n(0.36), 260, 0.035, 0.5, 0.2); return fin(o, 0.7); },
  // meow: additive glottal source with a pitch contour through moving formants ("m-i-a-o-w")
  meow() {
    srand(510); const dur = 0.85, n = D.n(dur), src = new Float32Array(n);
    const f0 = u => interp([[0, 480], [0.18, 640], [0.4, 720], [0.62, 640], [1, 420]], u);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n, f = f0(u) * (1 + 0.012 * Math.sin(TAU * 6 * i / SR)); ph += f / SR;
      let s = 0; for (let h = 1; h * f < 5500; h++) s += Math.sin(TAU * h * ph) / Math.pow(h, 1.15);
      src[i] = s + rs1() * 0.12;
    }
    const a = src.slice(), b = src.slice(), c = src.slice();
    D.tv(a, 'bandpass', u => interp([[0, 320], [0.15, 380], [0.4, 850], [0.7, 700], [1, 420]], u), 4);
    D.tv(b, 'bandpass', u => interp([[0, 1700], [0.15, 2200], [0.4, 1500], [0.7, 1150], [1, 900]], u), 6);
    D.tv(c, 'bandpass', u => interp([[0, 2900], [0.5, 2700], [1, 2500]], u), 8);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const u = i / n; out[i] = (a[i] + 0.7 * b[i] + 0.3 * c[i]) * interp([[0, 0], [0.06, 0.5], [0.16, 1], [0.6, 0.9], [0.85, 0.5], [1, 0]], u); }
    return fin(out);
  },
  // clock chime: Westminster-like 4-note phrase with inharmonic bell partials
  chime() {
    srand(511); const o = D.zeros(5.2), P = [[0.5, 0.35, 3.2], [1, 1, 2.6], [1.19, 0.4, 1.6], [1.5, 0.3, 1.3], [2, 0.45, 1.0], [2.51, 0.2, 0.7], [2.99, 0.14, 0.5], [4.16, 0.1, 0.3]];
    [68, 66, 64, 59].forEach((m, k) => { const i0 = D.n(k * 0.75), f = mtof(m); for (const [r, a, d] of P) addPartial(o, i0, f * r, a, d * 0.8, 0.0015); strike(o, k * 0.75, [[f * 6.1, 0.004, 0.2]], 0.3, 0.0005); });
    return fin(o, 0.85);
  },
  match() { srand(512); const o = D.zeros(1.3);
    addNoise(o, 0, { dur: 0.14, amp: 0.8, att: 0.005, dec: 0.05, hp: 1800, am: 300 });
    addGrains(o, 0, 0.12, 50, [[2500, 0.001, 0.6], [4200, 0.0007, 0.5]], 0.7);
    addNoise(o, 0.1, { dur: 0.5, amp: 0.7, att: 0.03, dec: 0.12, lp: 2500, color: 'pink' });
    addNoise(o, 0.1, { dur: 1.1, amp: 0.12, att: 0.1, dec: 0.5, bp: [700, 0.7] });
    for (let k = 0; k < 5; k++) strike(o, rr(0.15, 0.6), [[rr(1500, 3000), 0.001, 1]], rr(0.1, 0.3), 0.0003);
    return fin(o); },
  whoosh() { srand(513); const o = D.zeros(0.75);
    addNoise(o, 0, { dur: 0.72, amp: 1, shape: u => Math.pow(Math.sin(Math.PI * u), 1.6), sweep: [300, 1400, 1.4], sweepFn: u => 300 + 1300 * Math.pow(Math.sin(Math.PI * u), 2) });
    return fin(o); },
  drawer() { srand(514); const o = D.zeros(0.8);
    mixAt(o, creakSig({ dur: 0.45, rates: [[0, 50], [0.5, 70], [1, 40]], jit: 0.35, amp: [[0, 0], [0.1, 0.7], [0.8, 0.6], [1, 0]], modes: [[210, 0.03, 0.6], [460, 0.02, 0.5], [980, 0.01, 0.3]], rasp: [1200, 0.8, 0.15] }), 0, 0.7);
    strike(o, 0.47, [[150, 0.05, 0.8], [380, 0.03, 0.6], [900, 0.015, 0.4]], 1, 0.002); addThump(o, 0.47, 110, 70, 0.05, 0.4);
    for (let k = 0; k < 3; k++) strike(o, 0.49 + k * rr(0.01, 0.03), [[rr(2500, 4200), 0.02, 1], [rr(5000, 6500), 0.01, 0.5]], 0.12, 0.0003);
    return fin(o); },
  curtain() { srand(515); const o = D.zeros(1.0);
    addGrains(o, 0.02, 0.7, 55, [[3100, 0.006, 0.6], [4700, 0.004, 0.5], [6600, 0.003, 0.3]], 0.6);
    addNoise(o, 0, { dur: 0.9, amp: 0.35, shape: u => Math.pow(Math.sin(Math.PI * u), 1.3), bp: [2000, 0.5] }); return fin(o); },
  splash() { srand(516); const o = D.zeros(0.9);
    addNoise(o, 0, { dur: 0.15, amp: 0.9, att: 0.002, dec: 0.03, bp: [1200, 0.6] });
    addNoise(o, 0.01, { dur: 0.5, amp: 0.4, att: 0.01, dec: 0.12, hp: 3000 });
    addThump(o, 0, 170, 240, 0.05, 0.5);
    for (let k = 0; k < 18; k++) D.bubble(o, D.n(rr(0.01, 0.4)), rlog(450, 2500), rr(0.004, 0.02), rr(0.1, 0.4), 0.4);
    return fin(o); },
  clink() { srand(517); const o = D.zeros(0.7), m = [[2150, 0.09, 0.6], [3420, 0.06, 0.5], [5230, 0.035, 0.4], [7100, 0.02, 0.25]];
    strike(o, 0, m, 1, 0.0003, 0.02); strike(o, 0.085, m.map(([f, t, a]) => [f * 1.035, t * 0.8, a]), 0.45, 0.0003, 0.02); return fin(o, 0.8); },
  gate() { srand(518); const o = D.zeros(1.4);
    strike(o, 0, [[950, 0.06, 0.6], [1730, 0.04, 0.5], [2900, 0.025, 0.4], [4300, 0.015, 0.25]], 1, 0.0008);
    strike(o, 0.03, [[1100, 0.04, 0.4], [2400, 0.02, 0.3]], 0.5, 0.0005);
    mixAt(o, creakSig({ dur: 0.9, rates: [[0, 180], [0.3, 320], [0.6, 420], [1, 260]], jit: 0.06, amp: [[0, 0], [0.1, 0.8], [0.5, 1], [0.85, 0.6], [1, 0]],
      modes: [[640, 0.03, 0.6], [1280, 0.02, 0.5], [1920, 0.012, 0.35], [2600, 0.008, 0.2]] }), 0.12, 0.45);
    return fin(o); },
  // gate swinging shut: a shorter hinge squeak, then the latch bar clanking home as the gate meets the post
  gate_close() { srand(521); const o = D.zeros(1.5);
    mixAt(o, creakSig({ dur: 0.6, rates: [[0, 260], [0.5, 380], [1, 200]], jit: 0.06, amp: [[0, 0], [0.15, 0.7], [0.6, 0.9], [1, 0]],
      modes: [[640, 0.03, 0.6], [1280, 0.02, 0.5], [1920, 0.012, 0.35], [2600, 0.008, 0.2]] }), 0.05, 0.4);
    strike(o, 0.72, [[950, 0.07, 0.6], [1730, 0.045, 0.5], [2900, 0.03, 0.4], [4300, 0.018, 0.25]], 1, 0.0008);
    strike(o, 0.76, [[1100, 0.04, 0.4], [2400, 0.02, 0.3]], 0.45, 0.0005);
    addThump(o, 0.72, 120, 80, 0.05, 0.35);
    return fin(o); },
  cushion() { srand(519); const o = D.zeros(0.55);
    addNoise(o, 0, { dur: 0.5, amp: 1, att: 0.03, dec: 0.12, lp: 260, color: 'pink' });
    addNoise(o, 0.01, { dur: 0.4, amp: 0.18, att: 0.04, dec: 0.1, bp: [2200, 0.6], am: 50 }); return fin(o); },
  needle() { srand(520); const o = D.zeros(0.8); addThump(o, 0, 70, 45, 0.06, 0.7);
    addNoise(o, 0, { dur: 0.02, amp: 0.4, dec: 0.004, hp: 1500 }); addGrains(o, 0.01, 0.6, 25, [[2500, 0.0008, 0.8]], 0.3);
    addNoise(o, 0, { dur: 0.8, amp: 0.12, att: 0.02, dec: 0.3, hp: 1500, color: 'pink' }); return fin(o, 0.6); },
});

// ---- thunder, physically inspired: a tortuous channel (random walk up to the cloud base plus long in-cloud
// branches) whose 12 m segments each radiate an N-wave, mostly broadside (loud claps where the channel runs across
// the line of sight). Arrivals spread by path length at 343 m/s with 1/r spreading; each distance band gets its own
// air-absorption low-pass (the tearing crack only survives close by); 1-4 return strokes re-excite the main channel;
// echoes off the surrounding hills keep it rolling. p = { d: km, s: strength 0..1, seed } → { ch, sr, lead } where
// lead = travel time of the first arrival (s).
function rThunder(p) {
  const saveSR = SR, dKm = clamp(+p.d || 2, 0.2, 12), s = clamp(p.s === undefined ? 0.7 : +p.s, 0, 1);
  SR = Math.min(SR, dKm < 1.6 ? 32000 : 22050); srand((p.seed >>> 0) || 1);
  try {
    const c = 343, L = 12, EAR = 1.6, seg = [];
    let x = dKm * 1000, y = 0, z = 0, dx = rs1() * 0.3, dy = 1, dz = rs1() * 0.3;
    const top = rr(1300, 2800);
    while (y < top && seg.length < 400 * 8) {
      dx += rs1() * 0.5; dy += rs1() * 0.5 + 0.25; dz += rs1() * 0.5;
      let l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      if (dy < 0.2) { dy = 0.2; l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l; }
      x += dx * L; y += dy * L; z += dz * L;
      seg.push(x, y, z, dx, dy, dz, y < 400 ? 1.6 : 1, 1);   // position, direction, energy, main channel (hottest near the ground)
    }
    for (let b = 0, nb = 2 + ((R() * 3) | 0); b < nb; b++) {
      const a0 = R() * TAU, len = rr(1200, 4500) * (0.6 + 0.4 * s), e = rr(0.2, 0.45);
      let bx = x, by = y, bz = z, hx = Math.cos(a0), hy = rs1() * 0.15, hz = Math.sin(a0);
      for (let t = 0; t < len; t += L) {
        hx += rs1() * 0.4; hy += rs1() * 0.3 - hy * 0.2; hz += rs1() * 0.4;
        const l = Math.hypot(hx, hy, hz) || 1; hx /= l; hy /= l; hz /= l;
        bx += hx * L; by = Math.max(top * 0.7, by + hy * L); bz += hz * L;
        seg.push(bx, by, bz, hx, hy, hz, e * Math.exp(-1.6 * t / len), 0);   // branches fade out along their length
      }
    }
    const ns = seg.length / 8, dist = new Float32Array(ns);
    let rMin = Infinity, rMax = 0;
    for (let i = 0; i < ns; i++) { const k = i * 8, r = Math.hypot(seg[k], seg[k + 1] - EAR, seg[k + 2]); dist[i] = r; if (r < rMin) rMin = r; if (r > rMax) rMax = r; }
    const strokes = 1 + Math.min(3, Math.floor(s * 3.2 + R() * 1.2)), off = [0];
    for (let k = 1; k < strokes; k++) off.push(off[k - 1] + rr(0.035, 0.11));
    const ECHO = 3.2, dur = Math.min(16, (rMax - rMin) / c + off[strokes - 1] + ECHO + 0.5), n = D.n(dur);
    const NB = 7, lr0 = Math.log(rMin), lr1 = Math.log(rMax + 1), band = new Uint8Array(ns);
    for (let i = 0; i < ns; i++) band[i] = Math.min(NB - 1, Math.floor((Math.log(dist[i]) - lr0) / (lr1 - lr0 + 1e-9) * NB));
    const OL = new Float32Array(n), OR = new Float32Array(n), BL = new Float32Array(n), BR = new Float32Array(n);
    for (let b = 0; b < NB; b++) {
      BL.fill(0); BR.fill(0);
      for (let i = 0; i < ns; i++) {
        if (band[i] !== b) continue;
        const k = i * 8, r = dist[i], ux = seg[k] / r, uy = (seg[k + 1] - EAR) / r, uz = seg[k + 2] / r;
        const ct = ux * seg[k + 3] + uy * seg[k + 4] + uz * seg[k + 5], s2 = 1 - ct * ct;
        const amp = seg[k + 6] * (0.12 + 0.88 * s2 * s2 * s2) * (1000 / r) * rr(0.5, 1.5);
        const pan = clamp(Math.atan2(seg[k + 2], seg[k]) / 0.9, -1, 1) * 0.5 + 0.5, gl = Math.cos(pan * 1.5708), gr = Math.sin(pan * 1.5708);
        // N-wave lengthens with range; the channel's lowest few hundred metres (return stroke) snaps shortest → the crack
        const tl = Math.max(3, Math.round((seg[k + 1] < 400 && seg[k + 7] ? rr(0.0015, 0.005) : rr(0.004, 0.011)) * Math.pow(r / 1000, 0.25) * SR));
        for (let st = 0, m = seg[k + 7] ? strokes : 1; st < m; st++) {
          const i0 = Math.round(((r - rMin) / c + off[st]) * SR), a = amp * (st ? rr(0.35, 0.75) : 1);
          if (i0 + tl >= n) continue;
          for (let j = 0; j < tl; j++) { const v = a * (1 - 2 * j / tl); BL[i0 + j] += v * gl; BR[i0 + j] += v * gr; }
        }
      }
      const rb = Math.exp(lr0 + (b + 0.5) / NB * (lr1 - lr0)), fc = clamp(1700 * Math.pow(1000 / rb, 1.0), 120, SR * 0.42);
      for (const [src, dst] of [[BL, OL], [BR, OR]]) {
        D.biquad(src, 'lowpass', fc, 0.6); D.biquad(src, 'lowpass', fc * 1.4, 0.6);
        for (let i = 0; i < n; i++) dst[i] += src[i];
      }
    }
    const dkL = OL.slice(), dkR = OR.slice();                // landscape echoes: dark, delayed, scattered L/R
    for (const q of [dkL, dkR]) { D.biquad(q, 'lowpass', 420, 0.6); D.biquad(q, 'lowpass', 600, 0.6); }
    for (let k = 0, taps = 10 + ((R() * 6) | 0); k < taps; k++) {
      const dt = 0.25 + Math.pow(R(), 0.8) * ECHO, g = 0.34 * Math.exp(-dt / 1.6) * rr(0.5, 1.1), sL = D.n(dt), sR = D.n(dt + rr(0.004, 0.03));
      const gL = R() < 0.5 ? g : g * 0.45, gR = g * 1.45 - gL;
      for (let i = sL; i < n; i++) OL[i] += dkL[i - sL] * gL;
      for (let i = sR; i < n; i++) OR[i] += dkR[i - sR] * gR;
    }
    const chs = [OL, OR];
    for (const q of chs) { D.biquad(q, 'highpass', 24, 0.7); D.fadeOut(q, 0.4); }
    D.normPeak(chs, 1);                                      // gentle saturation: the rumble body carries, the crack keeps its bite
    const kS = 1.3, nk = Math.tanh(kS);
    for (const q of chs) for (let i = 0; i < q.length; i++) q[i] = Math.tanh(kS * q[i]) / nk;
    D.normPeak(chs, 0.9);
    return { ch: chs, sr: SR, lead: rMin / c };
  } finally { SR = saveSR; }
}
RENDER.thunderClose = () => rThunder({ d: 0.6, s: 1, seed: 601 });
RENDER.thunderMid = () => rThunder({ d: 2.0, s: 0.75, seed: 602 });
RENDER.thunderFar1 = () => rThunder({ d: 4.0, s: 0.6, seed: 603 });
RENDER.thunderFar2 = () => rThunder({ d: 5.5, s: 0.5, seed: 604 });

// ---- music instruments (sampled every 3 semitones, pitch-shifted by playbackRate) ----
const RH_BASES = [], BS_BASES = [];
for (let m = 48; m <= 84; m += 3) RH_BASES.push(m);
for (let m = 28; m <= 52; m += 3) BS_BASES.push(m);
// Rhodes-ish electric piano: 2-op FM body (1:1, decaying index = the "bark") + a 14:1 tine transient
function rRhodes(midi) {
  const f = mtof(midi), k = clamp((midi - 48) / 36, 0, 1), dur = 4.2 - 1.8 * k, n = D.n(dur), o = new Float32Array(n);
  const I0 = 1.5 - 0.7 * k, tI = 0.3 - 0.1 * k, t1 = 0.6 - 0.3 * k, t2 = 2.8 - 1.4 * k, w = f / SR;
  let pc = 0, pt = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, s = Math.sin(TAU * pc);
    const body = Math.sin(TAU * pc + (I0 * Math.exp(-t / tI) + 0.22) * s);
    const tine = Math.sin(TAU * pc + 1.1 * Math.exp(-t / 0.012) * Math.sin(TAU * pt)) * Math.exp(-t / 0.35);
    const env = (1 - Math.exp(-t / 0.002)) * (0.62 * Math.exp(-t / t1) + 0.38 * Math.exp(-t / t2));
    o[i] = Math.tanh(1.3 * env * (0.8 * body + 0.28 * tine)) / 1.3;
    pc += w; if (pc >= 1) pc -= 1; pt += 14 * w; if (pt >= 1) pt -= 1;
  }
  D.fadeOut(o, 0.06); D.normPeak([o], 0.8 * (1 - 0.35 * k)); return [o];
}
// upright bass: Karplus-Strong string + body thump + finger noise, warm low-passed
function rBass(midi) {
  srand(midi * 13 + 1);
  const f = mtof(midi), n = D.n(2.4), o = new Float32Array(n), N = Math.max(2, Math.round(SR / f - 0.5)), line = new Float32Array(N);
  let lp = 0, mean = 0;
  for (let k = 0; k < N; k++) { lp += 0.3 * (rs1() - lp); line[k] = lp; mean += lp; }
  mean /= N; for (let k = 0; k < N; k++) line[k] -= mean;
  const loss = Math.exp(-1 / (f * 0.85));
  let idx = 0;
  for (let i = 0; i < n; i++) { const nx = idx + 1 === N ? 0 : idx + 1, a = line[idx]; o[i] = a; line[idx] = loss * 0.5 * (a + line[nx]); idx = nx; }
  D.normPeak([o], 1);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += f / SR; o[i] = o[i] * (0.6 + 0.4 * Math.exp(-t / 0.3)) + 0.35 * Math.sin(TAU * ph) * Math.exp(-t / 0.35) * (1 - Math.exp(-t * 400)); }
  addNoise(o, 0, { dur: 0.03, amp: 0.15, att: 0.001, dec: 0.006, lp: 900 });
  D.biquad(o, 'lowpass', 1100, 0.6); D.biquad(o, 'highpass', 30, 0.7);
  D.fadeOut(o, 0.08); D.normPeak([o], 0.85); return [o];
}
for (const m of RH_BASES) RENDER['rh' + m] = () => at(24000, () => rRhodes(m));
for (const m of BS_BASES) RENDER['bs' + m] = () => at(16000, () => rBass(m));
Object.assign(RENDER, {
  kick() { srand(701); const o = D.zeros(0.45); addThump(o, 0, 95, 50, 0.16, 1, 0.03); addNoise(o, 0, { dur: 0.01, amp: 0.25, dec: 0.003, lp: 2500 }); D.biquad(o, 'lowpass', 900, 0.7); return fin(o); },
  brush() { srand(702); const o = D.zeros(0.4); addNoise(o, 0, { dur: 0.35, amp: 1, att: 0.002, dec: 0.06, bp: [2600, 0.6] });
    addNoise(o, 0, { dur: 0.3, amp: 0.35, att: 0.003, dec: 0.11, hp: 3500 }); addThump(o, 0, 210, 185, 0.04, 0.28); return fin(o); },
  sweep() { srand(703); const o = D.zeros(1.3); addNoise(o, 0, { dur: 1.25, amp: 1, shape: u => Math.pow(Math.sin(Math.PI * u), 1.5) * (0.7 + 0.3 * Math.sin(TAU * 2.4 * u)), bp: [3200, 0.7] }); return fin(o); },
  hat() { srand(704); const o = D.zeros(0.25), fs = [205.3, 304.4, 369.6, 522.7, 540, 800];
    for (let i = 0; i < o.length; i++) { const t = i / SR; let s = 0; for (const f of fs) s += Math.sin(TAU * f * 2.1 * t) > 0 ? 1 : -1; o[i] = s * Math.exp(-t / 0.03); }
    D.biquad(o, 'highpass', 7000, 0.7); D.biquad(o, 'highpass', 7000, 0.7); addNoise(o, 0, { dur: 0.1, amp: 0.2, dec: 0.02, hp: 8000 }); return fin(o); },
  ride() { srand(705); const o = D.zeros(1.6);
    for (const [f, a, d] of [[3150, 0.4, 0.9], [4270, 0.35, 0.7], [5340, 0.3, 0.6], [6120, 0.25, 0.5], [7440, 0.2, 0.4], [2380, 0.2, 1.1]]) addPartial(o, 0, f, a, d * 0.7, 0.001);
    addNoise(o, 0, { dur: 1.2, amp: 0.25, dec: 0.35, hp: 5000 }); strike(o, 0, [[8200, 0.003, 0.5]], 0.5, 0.0003); return fin(o, 0.7); },
});

function render(name) {
  if (name.startsWith('thunder|')) { const q = name.split('|'); return rThunder({ d: +q[1], s: +q[2], seed: +q[3] }); }
  const f = RENDER[name]; if (!f) return null;
  const save = SR;
  try { const r = f(); return Array.isArray(r) ? { ch: r, sr: SR } : r; } finally { SR = save; }
}
return { render, has: name => !!RENDER[name] || name.startsWith('thunder|'), names: () => Object.keys(RENDER) };
} // ================================================ end DSPLIB ========================================================

const RH_BASES = [], BS_BASES = [];
for (let m = 48; m <= 84; m += 3) RH_BASES.push(m);
for (let m = 28; m <= 52; m += 3) BS_BASES.push(m);

// chord qualities: v = rootless piano voicing intervals, t = chord tones for the bass
const CHORDS = {
  maj9: { v: [4, 7, 11, 14], t: [0, 4, 7, 11] }, '69': { v: [4, 7, 9, 14], t: [0, 4, 7, 9] },
  m9: { v: [3, 7, 10, 14], t: [0, 3, 7, 10] }, m7: { v: [3, 7, 10, 12], t: [0, 3, 7, 10] },
  '13': { v: [4, 10, 14, 21], t: [0, 4, 7, 10] }, '7b9': { v: [4, 10, 13, 19], t: [0, 4, 7, 10] },
  m7b5: { v: [3, 6, 10, 12], t: [0, 3, 6, 10] }, '9': { v: [4, 10, 14, 19], t: [0, 4, 7, 10] },
};
const PROGS = [
  [[2, 'm9'], [7, '13'], [0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, '7b9'], [0, 'maj9'], [0, '69']],
  [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [0, 'maj9'], [5, 'maj9'], [4, '7b9'], [9, 'm9'], [7, '13']],
  [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, '13'], [0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, '7b9']],
  [[11, 'm7b5'], [4, '7b9'], [9, 'm9'], [9, 'm9'], [2, 'm9'], [7, '13'], [0, 'maj9'], [0, 'maj9']],
  [[5, 'maj9'], [5, 'm9'], [4, 'm7'], [9, '7b9'], [2, 'm9'], [7, '13'], [0, 'maj9'], [0, '69']],
];
const COMP = [
  [[0, 3.8, 0.75]],
  [[0, 1.4, 0.7], [1.5, 2.3, 0.55]],
  [[0, 2.2, 0.72], [2.5, 1.3, 0.5]],
  [[0, 0.9, 0.7], [1.5, 0.9, 0.55], [3, 0.9, 0.5]],
  [[0, 2.8, 0.72], [3.5, 0.5, 0.45]],
];

// ---------------------------------------------------------------------------------------------------------------------
// engine state
// ---------------------------------------------------------------------------------------------------------------------
let A = null;                // === C.audio (the object core created)
let ctx = null;
const BUF = Object.create(null);
const META = Object.create(null);     // extras from the renderer (thunder: travel time of the first arrival)
const G = {};                // group gains
const GS = { in: {}, out: {} }, BS = { in: {}, out: {} };  // reverb send taps per group (follow solo) and per bus (follow volume)
const RV = { roomWet: 1 };   // reverbs: indoor room + open air, their returns, the listener-space send
let master, busMusic, busAmb, busSfx, duckG, duckLP, comp, limiter, shaper, muteG;
let tap = null, tapBuf = null;
const layers = {};
const emitters = [];
const occChains = [];
const lines = [];            // line / plane sources whose emitter follows the nearest point to the listener
const pendingLoops = new Set();
const liveLoops = new Set();
let listenerCam = null;
let stepPanL = null, stepPanR = null, stepSide = false, lastStepT = 0;
let dropPans = null;
let started = false;
let fireEvt = 1, fireS = 0, rainEvt = null;
const FIRE = { act: 0.5, actT: 0, nextSettle: 30, lvl: -1 };
const WET = { ground: -1, shoe: 0 };  // ground wetness (runoff, lags the rain) and how wet the player's shoes are
const GUST = { t: 0, W: 0.4, g: 0.5, env: 0.55, avg: -1, dx: 0.92, dz: 0.39 };
const STEP = { pos: null };
const ROCK = { on: false, prev: null, dir: 0, last: 0 };
const present = { fire: false, clock: false, t: -9 };
const recent = new Map();    // one-shot de-duplication (same sound, same place, same instant)
let houseCreakT = 0, gustHigh = false;
const doorState = { front: false };
const DOORWAY = [3.75, 1.1, 4.95];
// window panes (SPEC §4.6): centre just inside the glass, outward normal [x, z], size → ref distance; the hall
// window sits under the porch roof and stays mostly dry
const WINDOWS = [
  { p: [-3.9, 1.43, 4.62], n: [0, 1], ref: 1.3 }, { p: [-6.62, 1.6, 1.05], n: [-1, 0], ref: 0.8 }, { p: [-6.62, 1.6, 3.95], n: [-1, 0], ref: 0.8 },
  { p: [-3.6, 1.65, -4.62], n: [0, -1], ref: 0.9 }, { p: [-6.62, 1.55, -1.6], n: [-1, 0], ref: 1.0 }, { p: [4.3, 1.55, -4.62], n: [0, -1], ref: 1.2 },
  { p: [6.62, 1.55, -3.0], n: [1, 0], ref: 1.0 }, { p: [2.65, 1.5, 4.62], n: [0, 1], ref: 0.8, shelter: 0.25 },
  { p: [6.62, 4.45, -1.9], n: [1, 0], ref: 1.0 }, { p: [-6.62, 5.1, 0], n: [-1, 0], ref: 0.8 },
];
const SKYLIGHTS = [[-5.45, 1.75], [-2.85, 1.75], [4.25, -1.75]];
const DOWNSPOUTS = [[-7.1, 5.15], [7.1, 5.15], [-7.1, -5.15], [7.1, -5.15]];
const DRIPLINES = [{ x0: -7.4, x1: 1.0, y: -0.4, z: 5.75 }, { x0: -7.4, x1: 7.4, y: -0.4, z: -5.75 }, { x0: 1.0, x1: 7.0, y: -0.3, z: 7.55 }];
const TREES = [{ p: [-6.5, 3.6, 14], ref: 3.5 }, { p: [11, 3.4, 12], ref: 3.0 }];
const POND = [-9, -0.35, 9.5];
const ROOM_WET = { living: 0.9, kitchen: 1.15, hall: 1.2, study: 0.8, stairs: 1.25, loft: 0.95 };
const L = { x: 0.4, y: 1.62, z: 2, fx: 0, fy: 0, fz: -1, H: 1, U: 0, P: 0, leak: 0, front: 0, rain: 0.7 };
const stats = { voices: 0, peakVoices: 0, created: 0, loops: 0, updMs: 0, updN: 0, updMax: 0, renderMs: 0, renders: 0, mainRenders: 0, workerRenders: 0, rt: {} };
const MAX_VOICES = 90;

// ---------------------------------------------------------------------------------------------------------------------
// buffers: rendered in a Blob-URL worker (off the main thread); synchronous main-thread fallback for anything needed
// immediately (small one-shots) or if workers are unavailable.
// ---------------------------------------------------------------------------------------------------------------------
let SR = 48000;
let LIB = null, worker = null;
const waiters = Object.create(null);
const requested = new Set();
let fallbackQ = [], fallbackTimer = 0;
const lib = () => LIB || (LIB = DSPLIB(SR));
const hasSound = name => lib().has(name);
function mkBuffer(res) {
  const chs = res.ch, b = ctx.createBuffer(chs.length, chs[0].length, res.sr || SR);
  chs.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}
function deliver(name, res) {
  if (!BUF[name] && res && res.ch && res.ch.length) { BUF[name] = mkBuffer(res); if (res.lead !== undefined) META[name] = { lead: res.lead }; }
  const w = waiters[name];
  if (w) { delete waiters[name]; const b = BUF[name] || null; for (const cb of w) { try { cb(b); } catch (e) { C.log('audio', 'buffer callback failed', e); } } }
}
function renderMain(name) {
  const t0 = performance.now(); let res = null;
  try { res = lib().render(name); } catch (e) { C.log('audio', 'render failed ' + name, e); }
  const dt = performance.now() - t0;
  stats.renderMs += dt; stats.renders++; stats.mainRenders++; stats.rt[name] = +dt.toFixed(1);
  return res;
}
function getBuf(name) {                         // synchronous
  const b = BUF[name]; if (b) return b;
  if (!ctx || !hasSound(name)) return null;
  deliver(name, renderMain(name));
  return BUF[name] || null;
}
function whenBuf(name, cb, front) {             // asynchronous
  if (BUF[name]) { cb(BUF[name]); return; }
  if (!hasSound(name)) { cb(null); return; }
  (waiters[name] || (waiters[name] = [])).push(cb);
  request([name], front);
}
function whenAll(names, cb, front) {
  let left = names.length; if (!left) { cb(); return; }
  for (const n of names) whenBuf(n, () => { if (--left === 0) cb(); }, front);
}
function request(names, front) {
  const list = names.filter(n => !BUF[n] && hasSound(n) && (front || !requested.has(n)));
  if (!list.length) return;
  for (const n of list) requested.add(n);
  if (worker) { worker.postMessage({ names: list, front: !!front }); return; }
  if (front) fallbackQ.unshift(...list); else fallbackQ.push(...list);
  if (!fallbackTimer) fallbackTimer = setTimeout(pumpFallback, 0);
}
function pumpFallback() {
  fallbackTimer = 0;
  const t0 = performance.now();
  while (fallbackQ.length && performance.now() - t0 < 6) { const n = fallbackQ.shift(); if (!BUF[n]) deliver(n, renderMain(n)); }
  if (fallbackQ.length) fallbackTimer = setTimeout(pumpFallback, 20);
}
function startWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !window.URL) return;
  try {
    const src = `'use strict';const LIB=(${DSPLIB.toString()})(${SR});const Q=[],done=new Set();let busy=false;
function pump(){busy=false;const name=Q.shift();if(name!==undefined&&!done.has(name)){done.add(name);let r=null,err=null;
try{r=LIB.render(name);}catch(e){err=String((e&&e.message)||e);}
if(r)self.postMessage({name,ch:r.ch,sr:r.sr,lead:r.lead},r.ch.map(c=>c.buffer));else self.postMessage({name,error:err||'unknown'});}
if(Q.length){busy=true;setTimeout(pump,0);}}
self.onmessage=e=>{const d=e.data||{};const ns=(d.names||[]).filter(n=>!done.has(n));if(d.front)Q.unshift(...ns);else Q.push(...ns);if(!busy&&Q.length){busy=true;setTimeout(pump,0);}};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = e => {
      const d = e.data; if (!d || !d.name) return;
      if (d.ch) { stats.workerRenders++; stats.renders++; deliver(d.name, d); }
      else if (!BUF[d.name]) deliver(d.name, renderMain(d.name));
    };
    w.onerror = ev => {
      if (ev && ev.preventDefault) ev.preventDefault();
      C.log('audio', 'render worker failed; using the main thread');
      try { w.terminate(); } catch (e) { /* */ }
      if (worker === w) {
        worker = null;
        const pend = [...requested].filter(n => !BUF[n]); requested.clear(); request(pend);
      }
    };
    worker = w;
  } catch (e) { worker = null; }
}

// param smoothing with change threshold (avoids flooding the automation timeline every frame)
function setP(param, v, tau = 0.05) {
  const last = param._v;
  if (last !== undefined && Math.abs(v - last) <= Math.abs(last) * 0.004 + 1e-5) return;
  param._v = v;
  try { param.setTargetAtTime(v, ctx.currentTime, tau); } catch (e) { param.value = v; }
}
const gainNode = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; n.gain._v = v; return n; };
function filt(type, f, Q = 0.707) { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.frequency._v = f; n.Q.value = Q; return n; }
function setPannerPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else if (p.setPosition) p.setPosition(x, y, z);
}
const inHouse = (x, y, z) => x > -6.75 && x < 6.75 && z > -4.75 && z < 4.75 && y < 8;

// ---------------------------------------------------------------------------------------------------------------------
// emitters: positional sources with wall/floor occlusion, gentle air damping with range, and a reverb send
// (post-occlusion, pre-distance) into the space they are in
// ---------------------------------------------------------------------------------------------------------------------
const OCC_CUT = 0.035, OCC_LOSS = 0.62;              // fully behind a wall: low-pass ≈ 700 Hz and −8.4 dB
function occAmount(e) {
  if (e.edge) return L.U * 0.6 * L.H;                 // in a doorway: open to both sides (ground floor)
  let m;
  if (e.inH) {
    m = (1 - L.H) * (1 - 0.7 * L.leak);
    if (L.H > 0.01) m = Math.max(m, Math.abs((e.up ? 1 : 0) - L.U) * 0.6 * L.H);
  } else m = L.H * (1 - 0.7 * L.leak);
  return m;
}
const occCut = (m, d) => 20000 * Math.pow(OCC_CUT, m) / (1 + d / 40);
function applyOcc(e, m, d) {
  setP(e.occ.frequency, occCut(m, d), 0.08);
  setP(e.occG.gain, 1 - OCC_LOSS * m, 0.08);
}
// the reverberant level hardly falls with distance inside a room (the direct sound does), a bit more outdoors
function revAmount(e, d) { return e.rev * (e.space === 'out' ? 1 / (1 + d / 14) : 1 / (1 + d / 6)); }
function routeSend(e) {
  const sp = e.edge ? 'edge' : e.inH ? 'in' : 'out';
  if (sp === e.space) return;
  try { e.send.disconnect(); } catch (err) { /* not connected yet */ }
  e.space = sp;
  if (sp !== 'out') e.send.connect(GS.in[e.group] || GS.in.sfx);
  if (sp !== 'in') e.send.connect(GS.out[e.group] || GS.out.sfx);
}
function makeEmitter(o) {
  const group = o.group || 'sfx';
  const e = { x: o.x || 0, y: o.y || 0, z: o.z || 0, input: gainNode(1), occ: filt('lowpass', 20000, 0.5), occG: gainNode(1), send: gainNode(0),
    panner: ctx.createPanner(), out: o.out || G[group], group, follow: !!o.follow, persistent: o.persistent !== false,
    edge: !!o.edge, rev: o.rev === undefined ? 1 : o.rev, space: null };
  const p = e.panner;
  p.panningModel = o.model || 'HRTF'; p.distanceModel = 'inverse';
  p.refDistance = o.ref || 1; p.rolloffFactor = o.rolloff === undefined ? 1 : o.rolloff; p.maxDistance = o.max || 100;
  e.input.connect(e.occ); e.occ.connect(e.occG); e.occG.connect(p); p.connect(e.out); e.occG.connect(e.send);
  e.setPosition = (x, y, z) => {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    e.x = x; e.y = y; e.z = z; setPannerPos(p, x, y, z); e.inH = inHouse(x, y, z); e.up = e.inH && y > 2.9; routeSend(e);
  };
  e.setPosition(e.x, e.y, e.z);
  const m = occAmount(e), d = Math.hypot(e.x - L.x, e.y - L.y, e.z - L.z);
  e.occ.frequency.value = e.occ.frequency._v = occCut(m, d);
  e.occG.gain.value = e.occG.gain._v = 1 - OCC_LOSS * m;
  e.send.gain.value = e.send.gain._v = revAmount(e, d);
  e.dispose = () => {
    if (e.dead) return; e.dead = true;
    for (const nd of [e.input, e.occ, e.occG, e.send, p]) { try { nd.disconnect(); } catch (err) { /* already */ } }
    const i = emitters.indexOf(e); if (i >= 0) emitters.splice(i, 1);
  };
  if (e.persistent) emitters.push(e);
  return e;
}
// shared occlusion for non-positional layers; `inside`: the source is indoors (muffled when the listener is outside)
function makeOccChain(dest, loss = 0.55, cutK = 0.04, inside = false) {
  const oc = { f: filt('lowpass', 20000, 0.5), g: gainNode(1), loss, cutK, inside };
  oc.f.connect(oc.g); oc.g.connect(dest); oc.input = oc.f;
  occChains.push(oc);
  return oc;
}
// a source spread along a line (drip line, pine row) or over a plane (roof slope): its emitter sits at the point of
// the source nearest to the listener
function lineSource(em, fn) { const ln = { em, fn, pt: [0, 0, 0] }; lines.push(ln); fn(ln.pt); em.setPosition(ln.pt[0], ln.pt[1], ln.pt[2]); return ln; }

// ---------------------------------------------------------------------------------------------------------------------
// voices (one-shot buffer sources with automatic cleanup + live counter)
// ---------------------------------------------------------------------------------------------------------------------
function voice(buf, o = {}) {
  if (!ctx || !buf) return null;
  if (stats.voices >= MAX_VOICES && o.low) return null;
  const src = ctx.createBufferSource(); src.buffer = buf;
  if (o.rate) src.playbackRate.value = o.rate;
  if (o.loop) src.loop = true;
  const g = ctx.createGain(); g.gain.value = o.gain === undefined ? 1 : o.gain;
  src.connect(g);
  let pan = null, em = null;
  if (o.pos) {
    em = makeEmitter({ x: o.pos[0], y: o.pos[1], z: o.pos[2], group: o.group || 'sfx', out: o.out, ref: o.ref || 1.2, rolloff: o.rolloff || 1, persistent: false,
      edge: o.edge, rev: o.rev, model: o.model });
    g.connect(em.input);
  } else if (typeof o.pan === 'number') {
    pan = ctx.createStereoPanner(); pan.pan.value = clamp(o.pan, -1, 1); g.connect(pan); pan.connect(o.out || G[o.group || 'sfx']);
  } else g.connect(o.out || G[o.group || 'sfx']);
  if (!o.pos && o.ls) (pan || g).connect(RV.ls);         // non-positional: reverberates in the listener's own space
  const when = Math.max(o.when || 0, ctx.currentTime);
  src.start(when, o.offset || 0);
  if (o.dur) src.stop(when + o.dur);
  stats.voices++; stats.created++; if (stats.voices > stats.peakVoices) stats.peakVoices = stats.voices;
  const v = {
    src, g,
    stopAt(t, fade = 0.05) {
      try { const t0 = Math.max(t, ctx.currentTime); g.gain.cancelScheduledValues(t0); g.gain.setValueAtTime(g.gain.value, ctx.currentTime); g.gain.setTargetAtTime(0, t0, fade / 3); src.stop(t0 + fade + 0.02); } catch (e) { /* already stopped */ }
    },
    stop(fade = 0.05) { v.stopAt(ctx.currentTime, fade); },
  };
  src.onended = () => {
    try { src.disconnect(); g.disconnect(); if (pan) pan.disconnect(); } catch (e) { /* ignore */ }
    if (em) em.dispose();
    stats.voices--;
    if (o.onEnd) o.onEnd(v);
  };
  return v;
}
function loopSource(name, dest, gain = 0, offsetFrac = 0, rate = 1) {
  const buf = getBuf(name); if (!buf) return null;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
  const g = gainNode(gain);
  src.connect(g); g.connect(dest);
  src.start(ctx.currentTime + 0.02, (offsetFrac % 1) * buf.duration);
  stats.loops++;
  return { src, gain: g.gain, g, stop(t = 0.3) { try { g.gain.setTargetAtTime(0, ctx.currentTime, t / 3); src.stop(ctx.currentTime + t + 0.05); } catch (e) { /* */ } stats.loops--; setTimeout(() => { try { g.disconnect(); src.disconnect(); } catch (e) { /* */ } }, (t + 0.2) * 1000); } };
}
function posOf(o) { return o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z) ? [+o.x, +o.y, +o.z] : null; }

// ---------------------------------------------------------------------------------------------------------------------
// public API implementations
// ---------------------------------------------------------------------------------------------------------------------
const ALIAS = { door_creak: 'creak', knock: 'thud', bell: 'chime', lamp: 'switch', paper: 'page', book: 'page', cup: 'clink', glass: 'clink',
  latch: 'click', squeak: 'creak', fwoosh: 'whoosh', cat: 'meow', water: 'splash', drop: 'drop0', pop: 'pop0', gate_open: 'gate', crackle: 'crk0',
  rocker: 'rocker0', board: 'board0', settle: 'settle0', rattle_window: 'rattle' };
function play(name, opts = {}) {
  if (!ctx || !name) return null;
  let n = ALIAS[name] || name;
  if (n === 'floor_creak') n = 'floor_creak' + ((Math.random() * 3) | 0);
  if (n.startsWith('step_')) n = `stepH_${SURF[n.slice(5).replace(/_\d+$/, '')] || 'wood'}_${(Math.random() * STEP_VARIANTS) | 0}`;
  const buf = getBuf(n);
  if (!buf) { C.log('audio', 'unknown sound ' + name); return null; }
  const pos = posOf(opts), now = ctx.currentTime, last = recent.get(n);
  // the same sound at the same spot within a few ms is one event reported twice (e.g. a lamp event + a direct call)
  if (last && now - last.t < 0.06 && (!pos || !last.pos || Math.hypot(pos[0] - last.pos[0], pos[1] - last.pos[1], pos[2] - last.pos[2]) < 0.8)) return null;
  recent.set(n, { t: now, pos });
  const base = SFX_GAIN[name] || SFX_GAIN[n] || SFX_GAIN[n.replace(/\d+$/, '')] || 0.3;
  const vol = opts.volume === undefined ? 1 : clamp(+opts.volume || 0, 0, 4);
  return voice(buf, { gain: base * vol * mr(0.92, 1.05), rate: (opts.rate || 1) * mr(0.97, 1.03), pos, ref: opts.ref || 1.3, rolloff: opts.rolloff || 1,
    group: opts.bus === 'ambience' ? 'loops' : 'sfx', pan: opts.pan, when: opts.delay ? now + opts.delay : 0, edge: opts.edge, rev: opts.rev, ls: !pos });
}

// generic positional loop -------------------------------------------------------------------------------------------
const LOOPS = { rain: ['rainWash'], drizzle: ['rainLight'], rain_glass: ['glassA'], glass: ['glassA'], window: ['glassB'], roof: ['roof'], drip: ['drip'], drips: ['dripLine'],
  fire: ['fireBed', 'fireCrackle'], fireplace: ['fireBed', 'fireCrackle'], crackle: ['fireCrackle'], embers: ['fireCrackle'], gutter: ['gutter'],
  stream: ['gutter'], trickle: ['gutter'], downspout: ['gutter'], water: ['gutter'], pond: ['pond'], leaves: ['leaves'], rustle: ['rustle'], wind: ['wind'],
  boil: ['boil'], simmer: ['simmer'], purr: ['purr'], clock: ['clock'], tick: ['clock'], hum: ['hum'], fridge: ['hum'], steam: ['steam'], vinyl: ['vinyl'],
  porch: ['porch'], hiss: ['fireHiss'] };
function loop(name, opts = {}) {
  const h = {
    name, opts: Object.assign({}, opts), vol: opts.volume === undefined ? 1 : +opts.volume || 0,
    pos: posOf(opts), live: null, stopped: false,
    stop() {
      if (h.stopped) return; h.stopped = true; pendingLoops.delete(h);
      const lv = h.live; if (!lv) return; h.live = null; liveLoops.delete(h);
      for (const s of lv.srcs) s.stop(0.35);
      setTimeout(() => { try { lv.g.disconnect(); } catch (e) { /* */ } if (lv.em) lv.em.dispose(); }, 700);
    },
    setVolume(v) { h.vol = Math.max(0, +v || 0); if (h.live) setP(h.live.g.gain, h.vol * (h.opts.base || LV.loop), 0.1); },
    setPosition(x, y, z) { if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return; h.pos = [x, y, z]; if (h.live && h.live.em) h.live.em.setPosition(x, y, z); },
  };
  if (ctx) materialize(h); else pendingLoops.add(h);
  return h;
}
function materialize(h) {
  if (h.stopped || h.live) return;
  const names = LOOPS[h.name] || (hasSound(h.name) ? [h.name] : null);
  if (!names || !names.every(hasSound)) { C.log('audio', 'unknown loop ' + h.name); return; }    // (never wait on a buffer that cannot exist)
  if (!names.every(n => BUF[n])) { h.waiting = true; whenAll(names, () => { h.waiting = false; if (!h.stopped && !h.live) materialize(h); }); return; }
  const grp = h.opts.bus === 'sfx' ? 'loopsSfx' : h.opts.bus === 'music' ? 'music' : 'loops', bus = G[grp];
  const g = gainNode(0);
  let em = null;
  if (h.pos) { em = makeEmitter({ x: h.pos[0], y: h.pos[1], z: h.pos[2], group: grp, ref: h.opts.ref || 1, rolloff: h.opts.rolloff || 1.2 }); g.connect(em.input); }
  else g.connect(bus);
  const srcs = names.map(nm => loopSource(nm, g, 1, Math.random(), h.opts.rate || 1)).filter(Boolean);
  h.live = { g, em, srcs };
  liveLoops.add(h);
  setP(g.gain, h.vol * (h.opts.base || LV.loop), 0.15);
}

// kettle ------------------------------------------------------------------------------------------------------------
const KET = { on: false, em: null, parts: [], nodes: [], timers: [] };
function kettleStart(x, y, z) {
  if (!ctx) return;
  const pos = [isFinite(x) ? x : -4.6, isFinite(y) ? y : 1.0, isFinite(z) ? z : -4.3];
  if (KET.on) { KET.em.setPosition(pos[0], pos[1], pos[2]); return; }
  KET.on = true;
  const now = ctx.currentTime, em = KET.em = makeEmitter({ x: pos[0], y: pos[1], z: pos[2], group: 'kettle', ref: 1.0, rolloff: 1.1 });
  const sim = loopSource('simmer', em.input, 0, Math.random()), boil = loopSource('boil', em.input, 0, Math.random());
  const rum = loopSource('rainLow', em.input, 0, Math.random(), 0.7);
  KET.parts = [sim, boil, rum];
  const K = LV.kettle;
  sim.gain.setValueAtTime(0, now); sim.gain.linearRampToValueAtTime(0.55 * K, now + 3); sim.gain.linearRampToValueAtTime(0.3 * K, now + 6.5);
  boil.gain.setValueAtTime(0, now + 1.2); boil.gain.linearRampToValueAtTime(0.25 * K, now + 3.5); boil.gain.linearRampToValueAtTime(0.85 * K, now + 6.2);
  rum.gain.setValueAtTime(0, now); rum.gain.linearRampToValueAtTime(0.35 * K, now + 5.5);
  // whistle: two slightly detuned sines + 2nd harmonic + breathy band-passed noise, pressure-driven pitch glide
  const W = now + 6.3, wG = gainNode(0), wLP = filt('lowpass', 5200, 0.5);
  wG.connect(wLP); wLP.connect(em.input);
  const vib = ctx.createOscillator(), vibG = gainNode(9); vib.frequency.value = 5.3; vib.connect(vibG);
  const oscs = [[1, 1], [1.0065, 0.7], [2.003, 0.12]].map(([r, a]) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1300 * r, W); o.frequency.exponentialRampToValueAtTime(1870 * r, W + 1.4); o.frequency.linearRampToValueAtTime(1930 * r, W + 8);
    const g = gainNode(a); o.connect(g); g.connect(wG); vibG.connect(o.frequency); o.start(W); return [o, g];
  });
  const br = loopSource('steam', wG, 0.5, Math.random());
  const brBP = null; // steam texture already band-limited around 2.8 kHz
  vib.start(W);
  wG.gain.setValueAtTime(0, W); wG.gain.linearRampToValueAtTime(LV.whistleK, W + 1.8);
  KET.nodes = [vib, vibG, wG, wLP, ...oscs.flat()];
  KET.whistle = { wG, br, oscs, vib, brBP };
  KET.timers.push(setTimeout(() => { if (KET.on) C.emit('kettle', { state: 'whistle' }); }, 6300));
  KET.timers.push(setTimeout(() => { if (KET.on) kettleStop(); }, 60000));          // safety: never whistle forever
  C.emit('kettle', { state: 'boil' });
}
function kettleStop() {
  if (!ctx || !KET.on) return;
  KET.on = false;
  KET.timers.forEach(t => clearTimeout(t)); KET.timers = [];
  const now = ctx.currentTime, w = KET.whistle;
  w.wG.gain.cancelScheduledValues(now); w.wG.gain.setValueAtTime(w.wG.gain.value, now); w.wG.gain.setTargetAtTime(0, now, 0.08);
  for (const p of KET.parts) { p.gain.cancelScheduledValues(now); p.gain.setValueAtTime(p.gain.value, now); p.gain.setTargetAtTime(0, now, 0.6); }
  for (const [o] of w.oscs) { try { o.stop(now + 0.6); } catch (e) { /* */ } }
  try { w.vib.stop(now + 0.6); } catch (e) { /* */ }
  w.br.stop(0.5);
  const parts = KET.parts, nodes = KET.nodes, em = KET.em;
  KET.parts = []; KET.nodes = []; KET.em = null;
  setTimeout(() => { for (const p of parts) p.stop(0.05); }, 2500);
  setTimeout(() => { for (const nd of nodes) { try { nd.disconnect(); } catch (e) { /* */ } } if (em) em.dispose(); }, 2800);
  C.emit('kettle', { state: 'off' });
}

// purr --------------------------------------------------------------------------------------------------------------
const PURR = { on: false, em: null, src: null };
function purrStart(x, y, z) {
  if (!ctx) return;
  const pos = [isFinite(x) ? x : -3.0, isFinite(y) ? y : 0.6, isFinite(z) ? z : 4.45];
  if (PURR.on) { PURR.em.setPosition(pos[0], pos[1], pos[2]); return; }
  PURR.on = true;
  PURR.em = makeEmitter({ x: pos[0], y: pos[1], z: pos[2], group: 'purr', ref: 0.6, rolloff: 1.3 });
  PURR.src = loopSource('purr', PURR.em.input, 0, Math.random(), mr(0.95, 1.05));
  const now = ctx.currentTime;
  PURR.src.gain.setValueAtTime(0, now); PURR.src.gain.linearRampToValueAtTime(LV.purr, now + 0.8);
}
function purrStop() {
  if (!ctx || !PURR.on) return;
  PURR.on = false;
  const s = PURR.src, em = PURR.em; PURR.src = null; PURR.em = null;
  s.gain.cancelScheduledValues(ctx.currentTime); s.gain.setValueAtTime(s.gain.value, ctx.currentTime);
  s.stop(1.2);
  setTimeout(() => em.dispose(), 1600);
}

// ---------------------------------------------------------------------------------------------------------------------
// music: procedural lo-fi jazz with a look-ahead scheduler (events dispatched ≤ 0.35 s ahead of the audio clock)
// ---------------------------------------------------------------------------------------------------------------------
const MUS = { want: false, on: false, building: false, ready: false, cbs: [], chain: null, queue: [], qi: 0, nextBar: 0, bar: 0,
  prog: PROGS[0], key: 0, bpm: 74, sw: 0.62, walk: true, ride: true, lastMel: 74, lastBass: 38, pos: null, active: new Set(), crackle: null, em: null };
function setMusicFlag(on) {
  if (A.music.playing === on) return;
  A.music.playing = on;
  if (C.env) C.env.musicPlaying = on;
  C.emit('music', { playing: on });
}
function musicSampleNames() { return [...RH_BASES.map(m => 'rh' + m), ...BS_BASES.map(m => 'bs' + m), 'kick', 'brush', 'sweep', 'hat', 'ride', 'vinyl', 'needle']; }
function ensureMusic(cb) {
  if (MUS.ready) { cb(); return; }
  MUS.cbs.push(cb);
  if (MUS.building) return;
  MUS.building = true;
  whenAll(musicSampleNames(), () => {
    buildMusicChain(); MUS.ready = true; MUS.building = false;
    MUS.cbs.splice(0).forEach(f => f());
  }, true);
}
function buildMusicChain() {
  const ch = MUS.chain = {};
  ch.in = gainNode(1);
  ch.sat = ctx.createWaveShaper(); ch.sat.curve = satCurve(1.6); ch.sat.oversample = 'none';
  ch.lp = filt('lowpass', 3600, 0.55); ch.hp = filt('highpass', 55, 0.7);
  ch.wow = ctx.createDelay(0.1); ch.wow.delayTime.value = 0.014;
  ch.out = gainNode(0);
  ch.piano = gainNode(LV.piano); ch.bass = gainNode(LV.bass); ch.drums = gainNode(LV.drums); ch.crackle = gainNode(LV.vinyl);
  ch.piano.connect(ch.in); ch.bass.connect(ch.in); ch.drums.connect(ch.in);
  ch.in.connect(ch.sat); ch.sat.connect(ch.lp); ch.lp.connect(ch.hp); ch.hp.connect(ch.wow); ch.wow.connect(ch.out); ch.crackle.connect(ch.out);
  // wow (0.47 Hz, ~6 cents) + flutter (6.1 Hz, ~3 cents) by modulating a short delay line
  const wow = ctx.createOscillator(), wowG = gainNode(0.0011), flu = ctx.createOscillator(), fluG = gainNode(0.00006);
  wow.frequency.value = 0.47; flu.frequency.value = 6.1;
  wow.connect(wowG); wowG.connect(ch.wow.delayTime); flu.connect(fluG); fluG.connect(ch.wow.delayTime);
  wow.start(); flu.start();
  const p = MUS.pos || [L.x, L.y, L.z];
  MUS.em = makeEmitter({ x: p[0], y: p[1], z: p[2], group: 'music', ref: 1.6, rolloff: 1.0, follow: !MUS.pos });
  ch.out.connect(MUS.em.input);
}
function satCurve(k) { const n = 1024, c = new Float32Array(n), nk = Math.tanh(k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / nk; } return c; }
function musicPlay() {
  MUS.want = true; setMusicFlag(true);
  if (!ctx) return;
  resumeCtx();
  ensureMusic(() => { if (MUS.want && !MUS.on) startMusicNow(); });
}
function startMusicNow() {
  MUS.on = true;
  const now = ctx.currentTime, ch = MUS.chain;
  ch.out.gain.cancelScheduledValues(now); ch.out.gain.setValueAtTime(ch.out.gain.value, now); ch.out.gain.linearRampToValueAtTime(1, now + 0.4);
  voice(getBuf('needle'), { out: ch.crackle, gain: 1 });
  if (MUS.crackle) MUS.crackle.stop(0.1);
  MUS.crackle = voice(getBuf('vinyl'), { out: ch.crackle, loop: true, gain: 1, offset: Math.random() * 7 });
  MUS.nextBar = now + 0.9; MUS.bar = 0; MUS.queue = []; MUS.qi = 0;
  newSection(true);
  musicTick();
}
function musicStop() {
  MUS.want = false; setMusicFlag(false);
  if (!ctx || !MUS.on) return;
  MUS.on = false;
  const now = ctx.currentTime, ch = MUS.chain;
  ch.out.gain.cancelScheduledValues(now); ch.out.gain.setValueAtTime(ch.out.gain.value, now); ch.out.gain.linearRampToValueAtTime(0, now + 0.7);
  for (const v of MUS.active) v.stopAt(now + 0.72, 0.05);
  if (MUS.crackle) { MUS.crackle.stopAt(now + 0.72); MUS.crackle = null; }
  MUS.queue = []; MUS.qi = 0;
}
function newSection(first) {
  if (first || Math.random() < 0.3) MUS.key = mpick([0, 5, 10, 3, 7, 2]);
  MUS.prog = mpick(PROGS); MUS.walk = Math.random() < 0.6; MUS.ride = Math.random() < 0.5;
}
const nearestBase = (bases, m) => { let b = bases[0]; for (const x of bases) if (Math.abs(x - m) < Math.abs(b - m)) b = x; return b; };
function planBar(t0) {
  const beat = 60 / MUS.bpm, sw = MUS.sw, ev = [];
  const T = b => { const bi = Math.floor(b), fr = b - bi; return t0 + (bi + (fr <= 0.5 ? fr * 2 * sw : sw + (fr - 0.5) * 2 * (1 - sw))) * beat; };
  const hum = s => (Math.random() * 2 - 1) * s;
  const bi = MUS.bar % 8;
  if (bi === 0 && MUS.bar > 0) newSection(false);
  const [deg, q] = MUS.prog[bi], [ndeg] = MUS.prog[(bi + 1) % 8];
  const root = (MUS.key + deg) % 12, nroot = (MUS.key + ndeg) % 12, Q = CHORDS[q];
  // piano comping: close rootless voicing in G3..F#4, strummed a little
  const notes = Q.v.map(iv => { let m = root + iv; while (m < 55) m += 12; while (m >= 67) m -= 12; return m; }).sort((a, b) => a - b);
  for (const [b, d, v] of mpick(COMP)) {
    const tb = T(b) + hum(0.012);
    notes.forEach((m, i) => ev.push({ t: tb + i * mr(0.006, 0.016), k: 'rh', m, v: v * mr(0.85, 1) * (i === notes.length - 1 ? 1.05 : 0.9), d: d * beat }));
  }
  // sparse melody from chord tones
  if (Math.random() < 0.4) {
    const pool = [];
    for (const iv of [0, ...Q.v]) for (let m = root + iv; m <= 82; m += 12) if (m >= 67 && !pool.includes(m)) pool.push(m);
    pool.sort((a, b) => a - b);
    let cur = MUS.lastMel, pos = mpick([0.5, 1, 1.5]);
    const cnt = 2 + ((Math.random() * 3) | 0);
    for (let k = 0; k < cnt && pos < 3.8; k++) {
      const target = cur + ((Math.random() * 9) | 0) - 4;
      let best = pool[0]; for (const m of pool) if (Math.abs(m - target) < Math.abs(best - target)) best = m;
      ev.push({ t: T(pos) + hum(0.015), k: 'rh', m: best, v: mr(0.45, 0.6), d: beat * mr(0.5, 1.2) });
      cur = best; pos += mpick([0.5, 1, 1, 1.5]);
    }
    MUS.lastMel = cur;
  }
  // upright bass
  const place = (pc, near) => { let m = pc; while (m < 31) m += 12; while (m >= 43) m -= 12; if (near !== undefined && Math.abs(m + 12 - near) < Math.abs(m - near) && m + 12 <= 50) m += 12; return m; };
  const R0 = place(root);
  const tone = i => R0 + Q.t[i];
  if (MUS.walk) {
    const b1 = mpick([tone(1), tone(2)]), b2 = mpick([tone(2), R0 + 12, tone(3)]);
    const N = place(nroot, b2), appr = Math.random() < 0.6 ? (b2 > N ? N + 1 : N - 1) : (b2 > N ? N + 2 : N - 2);
    [[0, R0], [1, b1], [2, b2], [3, appr]].forEach(([b, m]) => ev.push({ t: T(b) + hum(0.006), k: 'bs', m, v: (b === 0 ? 0.9 : 0.75) * mr(0.9, 1), d: beat * 0.92 }));
  } else {
    ev.push({ t: T(0) + hum(0.005), k: 'bs', m: R0, v: 0.9, d: beat * 1.8 });
    const fifth = R0 + 7 <= 50 ? R0 + 7 : R0 - 5;
    ev.push({ t: T(2) + hum(0.005), k: 'bs', m: fifth, v: 0.78, d: beat * 1.4 });
    if (Math.random() < 0.35) { const N = place(nroot, fifth); ev.push({ t: T(3.5), k: 'bs', m: fifth > N ? N + 1 : N - 1, v: 0.6, d: beat * 0.4 }); }
  }
  // brushed drums
  const dr = (b, n, v, h = 0.006) => ev.push({ t: T(b) + hum(h), k: 'dr', n, v });
  dr(0, 'kick', 0.85); dr(2.5, 'kick', 0.6); if (Math.random() < 0.4) dr(1.5, 'kick', 0.38);
  dr(1, 'brush', 0.7); dr(3, 'brush', 0.72);
  dr(0, 'sweep', 0.5, 0.01); dr(2, 'sweep', 0.48, 0.01);
  if (MUS.ride) [[0, 0.5], [1, 0.42], [1.5, 0.3], [2, 0.46], [3, 0.42], [3.5, 0.3]].forEach(([b, v]) => dr(b, 'ride', v * 0.8));
  else for (let b = 0; b < 4; b += 0.5) dr(b, 'hat', (b % 1 === 0 ? 0.34 : 0.22) * mr(0.85, 1.1), 0.004);
  if (Math.random() < 0.25) dr(mpick([1.5, 3.5]), 'brush', 0.22);
  if (bi === 7) dr(3.5, 'brush', 0.45);
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
function fireEvent(ev) {
  const ch = MUS.chain;
  if (ev.k === 'rh') { const b = nearestBase(RH_BASES, ev.m); musicVoice(getBuf('rh' + b), Math.pow(2, (ev.m - b) / 12), ev.t, ev.v, ev.d, ch.piano, 0.35); }
  else if (ev.k === 'bs') { const b = nearestBase(BS_BASES, ev.m); musicVoice(getBuf('bs' + b), Math.pow(2, (ev.m - b) / 12), ev.t, ev.v, ev.d, ch.bass, 0.12); }
  else musicVoice(getBuf(ev.n), mr(0.97, 1.03), ev.t, ev.v, 0, ch.drums, 0);
}
function musicVoice(buf, rate, t, vel, dur, out, rel) {
  if (!buf) return;
  const v = voice(buf, { out, gain: vel, rate, when: t, dur: dur ? dur + rel * 2.5 : 0, onEnd: vv => MUS.active.delete(vv) });
  if (!v) return;
  if (dur) { const te = Math.max(t, ctx.currentTime) + dur; v.g.gain.setValueAtTime(vel, te); v.g.gain.setTargetAtTime(0, te, rel / 3); }
  MUS.active.add(v);
}
function musicTick() {
  if (!MUS.on || !ctx) return;
  const ahead = ctx.currentTime + 0.35, beat = 60 / MUS.bpm;
  if (MUS.nextBar < ctx.currentTime - 1) MUS.nextBar = ctx.currentTime + 0.1;     // recovered from a stall (tab hidden)
  for (let guard = 0; guard < 200; guard++) {
    if (MUS.qi >= MUS.queue.length) {
      if (MUS.nextBar < ahead) { MUS.queue = planBar(MUS.nextBar); MUS.qi = 0; MUS.nextBar += 4 * beat; MUS.bar++; } else break;
    } else {
      const ev = MUS.queue[MUS.qi]; if (ev.t > ahead) break;
      fireEvent(ev); MUS.qi++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// context / graph
// ---------------------------------------------------------------------------------------------------------------------
function resumeCtx() { if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => { /* needs a gesture */ }); }
function softClipCurve() {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.15 * Math.tanh((a - 0.8) / 0.15)); }
  return c;
}
function buildGraph() {
  master = gainNode(1); duckG = gainNode(1); duckLP = filt('lowpass', 20000, 0.5);
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 2.5; comp.attack.value = 0.01; comp.release.value = 0.25;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  shaper = ctx.createWaveShaper(); shaper.curve = softClipCurve(); shaper.oversample = 'none';
  muteG = gainNode(C.state.muted ? 0 : 1);
  master.connect(duckG); duckG.connect(duckLP); duckLP.connect(comp); comp.connect(limiter); limiter.connect(shaper); shaper.connect(muteG); muteG.connect(ctx.destination);
  busMusic = gainNode(1); busAmb = gainNode(1); busSfx = gainNode(1);
  busMusic.connect(master); busAmb.connect(master); busSfx.connect(master);
  // two reverbs (cottage room, open air); each return is muffled when the listener is on the other side of the walls
  RV.inIn = gainNode(1); RV.outIn = gainNode(1);
  RV.convIn = ctx.createConvolver(); RV.convOut = ctx.createConvolver(); RV.convIn.normalize = false; RV.convOut.normalize = false;
  whenBuf('irRoom', b => { if (b) RV.convIn.buffer = b; }, true);
  whenBuf('irOut', b => { if (b) RV.convOut.buffer = b; }, true);
  RV.retIn = gainNode(LV.revIn); RV.retOut = gainNode(LV.revOut);
  RV.inIn.connect(RV.convIn); RV.convIn.connect(RV.retIn); RV.outIn.connect(RV.convOut); RV.convOut.connect(RV.retOut);
  RV.ocIn = makeOccChain(master, 0.6, 0.05, true); RV.ocOut = makeOccChain(master, 0.6, 0.05);
  RV.retIn.connect(RV.ocIn.input); RV.retOut.connect(RV.ocOut.input);
  for (const b of ['music', 'amb', 'sfx']) { BS.in[b] = gainNode(1); BS.in[b].connect(RV.inIn); BS.out[b] = gainNode(1); BS.out[b].connect(RV.outIn); }
  for (const [name, bus, bk] of [['rain', busAmb, 'amb'], ['wind', busAmb, 'amb'], ['thunder', busAmb, 'amb'], ['fire', busAmb, 'amb'], ['clock', busAmb, 'amb'],
    ['loops', busAmb, 'amb'], ['music', busMusic, 'music'], ['sfx', busSfx, 'sfx'], ['steps', busSfx, 'sfx'], ['kettle', busSfx, 'sfx'], ['purr', busSfx, 'sfx'],
    ['loopsSfx', busSfx, 'sfx']]) {
    G[name] = gainNode(1); G[name].connect(bus);
    GS.in[name] = gainNode(1); GS.in[name].connect(BS.in[bk]); GS.out[name] = gainNode(1); GS.out[name].connect(BS.out[bk]);
  }
  // non-positional sounds (own footsteps, UI-ish one-shots) reverberate in whichever space the listener is in
  RV.ls = gainNode(0.65); RV.lsIn = gainNode(1); RV.lsOut = gainNode(0);
  RV.ls.connect(RV.lsIn); RV.ls.connect(RV.lsOut); RV.lsIn.connect(GS.in.steps); RV.lsOut.connect(GS.out.steps);
  stepPanL = ctx.createStereoPanner(); stepPanL.pan.value = -0.12; stepPanL.connect(G.steps);
  stepPanR = ctx.createStereoPanner(); stepPanR.pan.value = 0.12; stepPanR.connect(G.steps);
  stepPanL.connect(RV.ls); stepPanR.connect(RV.ls);
  layers.dropG = gainNode(1); layers.dropG.connect(G.rain);
  dropPans = [-0.75, -0.3, 0.3, 0.75].map(p => { const s = ctx.createStereoPanner(); s.pan.value = p; s.connect(layers.dropG); return s; });
  layers.windOcc = makeOccChain(G.wind);
  layers.thunderOcc = makeOccChain(G.thunder, 0.3, 0.025);          // thunder is mostly low end: it gets through walls
}
function applySettings() {
  if (!ctx) return;
  const s = C.settings || {}, v = (x, d) => { const n = +x; return clamp(isFinite(n) ? n : d, 0, 1); };
  setP(master.gain, Math.pow(v(s.masterVolume, 0.8), 2), 0.05);
  const vol = { music: Math.pow(v(s.musicVolume, 0.7), 2) / 0.49, amb: Math.pow(v(s.ambienceVolume, 0.9), 2) / 0.81, sfx: Math.pow(v(s.sfxVolume, 0.8), 2) / 0.64 };
  setP(busMusic.gain, vol.music, 0.05); setP(busAmb.gain, vol.amb, 0.05); setP(busSfx.gain, vol.sfx, 0.05);
  for (const b of ['music', 'amb', 'sfx']) { setP(BS.in[b].gain, vol[b], 0.05); setP(BS.out[b].gain, vol[b], 0.05); }   // reverb follows the bus volume
}
function applyMute() {
  if (A) A.muted = !!C.state.muted;
  if (ctx) setP(muteG.gain, C.state.muted ? 0 : 1, 0.06);
}
function setMuted(m) { C.state.muted = !!m; applyMute(); }
function toggleMute() {
  setMuted(!C.state.muted);
  if (C.hud && C.hud.toast) C.hud.toast(C.state.muted ? 'Sound off' : 'Sound on', 1.8);
  if (!C.state.muted) resumeCtx();
}

// ambience layers start as soon as their buffers arrive from the render worker (reverbs + rain first); everything
// else is pre-rendered in the background so later sounds never cause a hitch.
function startAmbience() {
  request(['irRoom', 'irOut', 'rainWash', 'rainLight', 'rainTicksA', 'rainTicksB', 'rainLow', 'glassA', 'glassB', 'roof', 'porch', 'wind', 'gutter',
    'dripLine', 'pond', 'leaves', 'rustle']);
  const later = [];
  for (let k = 0; k < 8; k++) later.push('drop' + k, 'pop' + k);
  for (let k = 0; k < 12; k++) later.push('crk' + k);
  later.push('fireBed', 'fireCrackle', 'fireHiss', 'settle0', 'settle1', 'settle2', 'clock');
  later.push('thunderMid', 'thunderFar1', 'thunderClose', 'thunderFar2');
  for (const s of ['wood', 'rug', 'stairs', 'tile', 'porch', 'grass', 'stone', 'gravel', 'mud', 'carpet', 'water']) for (let k = 0; k < STEP_VARIANTS; k++) later.push(`stepH_${s}_${k}`, `stepT_${s}_${k}`);
  for (let k = 0; k < 6; k++) later.push('board' + k);
  for (let k = 0; k < 4; k++) later.push('squeak' + k, 'wet' + k, 'cloth' + k);
  for (let k = 0; k < 3; k++) later.push('rocker' + k, 'house_creak' + k);
  later.push('rattle', 'floor_creak0', 'floor_creak1', 'floor_creak2', 'chair_creak', 'cushion', ...Object.keys(SFX_GAIN).filter(k => hasSound(k)));
  later.push('simmer', 'boil', 'steam', 'purr', 'drip', 'hum', ...musicSampleNames());
  request(later);
  whenAll(later, () => { A._warm = true; });
  whenAll(['rainWash', 'rainLight'], () => {   // open-sky beds (drizzle ↔ downpour), their transmission indoors, the open-door leak
    layers.wash = loopSource('rainWash', G.rain, 0, 0);
    layers.light = loopSource('rainLight', G.rain, 0, 0.37);
    // through walls and closed windows: mass-law transmission (a gentle low-pass plus a shelf cut), not an underwater muffle
    layers.inLP = filt('lowpass', 1000, 0.6); layers.inShelf = filt('highshelf', 2200); layers.inShelf.gain.value = -9;
    layers.inLP.connect(layers.inShelf); layers.inShelf.connect(G.rain);
    layers.inside = loopSource('rainWash', layers.inLP, 0, 0.46);
    layers.insideL = loopSource('rainLight', layers.inLP, 0, 0.81);
    const em = makeEmitter({ x: DOORWAY[0], y: DOORWAY[1], z: DOORWAY[2] + 0.4, group: 'rain', model: 'equalpower', ref: 1.5, rolloff: 1, edge: true, rev: 0.5 });
    const hp = filt('highpass', 250, 0.7); hp.connect(em.input);
    layers.leak = loopSource('rainWash', hp, 0, 0.71);
  });
  whenAll(['rainTicksA', 'rainTicksB'], () => {
    const g = gainNode(0); g.connect(G.rain); layers.ticks = { gain: g.gain };
    loopSource('rainTicksA', g, 1, 0); loopSource('rainTicksB', g, 1, 0.3);
  });
  whenBuf('rainLow', () => { const lp = filt('lowpass', 220, 0.6); lp.connect(G.rain); layers.low = loopSource('rainLow', lp, 0, 0); });
  whenAll(['glassA', 'glassB'], () => {        // rain on every window pane, located at the glass (heard indoors)
    layers.windows = WINDOWS.map((w, i) => {
      const em = makeEmitter({ x: w.p[0], y: w.p[1], z: w.p[2], group: 'rain', model: 'equalpower', ref: w.ref, rolloff: 1.6, rev: 0.3 });
      return { w, em, src: loopSource(i % 2 ? 'glassB' : 'glassA', em.input, 0, (i * 0.37) % 1, 0.94 + (i % 5) * 0.03) };
    });
    layers.sky = SKYLIGHTS.map(([x, z], i) => {                 // skylights take the rain head-on
      const em = makeEmitter({ x, y: 7.45 - 0.7 * Math.abs(z), z, group: 'rain', model: 'equalpower', ref: 1.2, rolloff: 1.3, rev: 0.35 });
      return loopSource(i % 2 ? 'glassA' : 'glassB', em.input, 0, 0.2 + i * 0.29, 1.05 + i * 0.04);
    });
  });
  whenBuf('roof', () => {                      // both slate slopes as plane sources: loudest where the ceiling comes down low
    layers.roof = [1, -1].map((sg, i) => {
      const em = makeEmitter({ group: 'rain', model: 'equalpower', ref: 1.0, rolloff: 0.9, rev: 0.35 });
      lineSource(em, pt => { const zs = clamp((sg * L.z - 0.7 * (L.y - 7.5)) / 1.49, 0.15, 4.75); pt[0] = clamp(L.x, -6.75, 6.75); pt[1] = 7.5 - 0.7 * zs; pt[2] = sg * zs; });
      return loopSource('roof', em.input, 0, i * 0.5, 1 + i * 0.04);
    });
  });
  whenBuf('porch', () => {                     // porch roof drumming: overhead on the porch, from its direction elsewhere
    const em = makeEmitter({ group: 'rain', model: 'equalpower', ref: 1.2, rolloff: 1.0, rev: 0.5 });
    lineSource(em, pt => { const zc = clamp(L.z, 5.05, 7.4); pt[0] = clamp(L.x, 1.0, 7.0); pt[1] = 3.2 - 0.25 * (zc - 5.0); pt[2] = zc; });
    layers.porchRoof = loopSource('porch', em.input, 0, 0);
  });
  whenBuf('gutter', () => {                    // the four downspouts gushing onto their splash blocks
    layers.gutters = DOWNSPOUTS.map(([x, z], i) => {
      const em = makeEmitter({ x, y: -0.3, z, group: 'rain', model: 'equalpower', ref: 0.9, rolloff: 1.3, rev: 0.8 });
      return loopSource('gutter', em.input, 0, i * 0.27, 0.92 + i * 0.05);
    });
  });
  whenBuf('dripLine', () => {                  // drops off the eaves and the porch-roof edge (line sources)
    layers.drips = DRIPLINES.map((d, i) => {
      const em = makeEmitter({ group: 'rain', model: 'equalpower', ref: 1.4, rolloff: 0.8, rev: 0.8 });
      lineSource(em, pt => { pt[0] = clamp(L.x, d.x0, d.x1); pt[1] = d.y; pt[2] = d.z; });
      return loopSource('dripLine', em.input, 0, i * 0.31, 0.95 + i * 0.05);
    });
  });
  whenBuf('pond', () => {
    const em = makeEmitter({ x: POND[0], y: POND[1], z: POND[2], group: 'rain', model: 'equalpower', ref: 2.4, rolloff: 1.0, rev: 0.8 });
    layers.pond = loopSource('pond', em.input, 0, 0);
  });
  whenAll(['leaves', 'rustle', 'dripLine'], () => {   // canopies: rain patter, fat drops falling through, leaves in the wind
    layers.trees = TREES.map((t, i) => {
      const em = makeEmitter({ x: t.p[0], y: t.p[1], z: t.p[2], group: 'rain', model: 'equalpower', ref: t.ref, rolloff: 1.0, rev: 0.8 });
      const wem = makeEmitter({ x: t.p[0], y: t.p[1] + 1.5, z: t.p[2], group: 'wind', model: 'equalpower', ref: t.ref, rolloff: 1.0, rev: 0.6 });
      return { t, leaves: loopSource('leaves', em.input, 0, i * 0.4, 1 + i * 0.05), drips: loopSource('dripLine', em.input, 0, 0.5 + i * 0.2, 0.85),
        rustle: loopSource('rustle', wem.input, 0, i * 0.33, 1 - i * 0.04) };
    });
    const pem = makeEmitter({ group: 'wind', model: 'equalpower', ref: 3.0, rolloff: 0.8, rev: 0.6 });   // pine row: needles sough
    lineSource(pem, pt => { pt[0] = clamp(L.x, -14, 14); pt[1] = 5; pt[2] = -11.3; });
    const plp = filt('lowpass', 2600, 0.6); plp.connect(pem.input);
    layers.pines = loopSource('rustle', plp, 0, 0.6, 0.8);
  });
  whenBuf('wind', () => {
    const bp = filt('bandpass', 400, 0.8); bp.connect(layers.windOcc.input);          // outdoor gusts
    layers.wind = loopSource('wind', bp, 0, 0); layers.wind.bp = bp;
    const mbp = filt('bandpass', 170, 1.2); mbp.connect(G.wind);                      // indoors: the low moan around the house
    layers.moan = loopSource('wind', mbp, 0, 0.35); layers.moan.bp = mbp;
    const wem = makeEmitter({ x: 3.75, y: 1.95, z: 4.8, group: 'wind', ref: 0.8, rolloff: 1.4, edge: true, rev: 0.7 });
    const wbp = filt('bandpass', 900, 18); wbp.connect(wem.input);                    // whistling through the front door's gaps
    layers.whistle = loopSource('wind', wbp, 0, 0.5); layers.whistle.bp = wbp;
  });
}
function worldPos(obj, out) {
  try { obj.updateMatrixWorld(true); const e = obj.matrixWorld.elements; out[0] = e[12]; out[1] = e[13]; out[2] = e[14]; return true; } catch (err) { return false; }
}
// the fire and the grandfather clock only sound once their objects exist (living / hallstudy modules): no crackle
// from an empty wall
function checkPresence() {
  const lt = C.lights && C.lights.find(l => l && l.id === 'fire'), fp = C.interact && C.interact.get ? C.interact.get('fireplace') : null;
  present.fire = !!(lt || fp);
  if (present.fire && !layers.fireEm && !layers.fireWait) {
    layers.fireWait = true;
    const pos = [-6.25, 0.55, 2.5];
    if (lt && lt.light) worldPos(lt.light, pos);
    whenAll(['fireBed', 'fireCrackle', 'fireHiss'], () => {
      const em = layers.fireEm = makeEmitter({ x: pos[0], y: pos[1], z: pos[2], group: 'fire', ref: 1.3, rolloff: 1.0, rev: 1 });
      layers.fireBed = loopSource('fireBed', em.input, 0, 0);
      layers.fireCr = loopSource('fireCrackle', em.input, 0, 0.3);
      layers.fireHiss = loopSource('fireHiss', em.input, 0, 0.6);
    });
  }
  const ck = C.interact && C.interact.get ? C.interact.get('clock') : null;
  present.clock = !!ck;
  if (ck && !layers.clock && !layers.clockWait) {
    layers.clockWait = true;
    const pos = [2.35, 1.2, -0.3];
    if (ck.object && worldPos(ck.object, pos)) pos[1] = Math.max(0, pos[1]) + 1.25;       // the movement sits up in the hood
    whenBuf('clock', () => {
      const em = makeEmitter({ x: pos[0], y: pos[1], z: pos[2], group: 'clock', ref: 0.9, rolloff: 1.2, rev: 1.2 });
      layers.clock = loopSource('clock', em.input, 0, 0);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------------------------------------------------
function onStart() {
  if (ctx) { resumeCtx(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return; } }
  SR = Math.min(48000, ctx.sampleRate || 48000);
  resumeCtx();
  startWorker();
  buildGraph();
  A.ctx = ctx; A.started = true; A.master = master;
  Object.assign(A.buses, { master, music: busMusic, ambience: busAmb, sfx: busSfx });
  applySettings(); applyMute();
  startAmbience();
  checkPresence();
  for (const h of pendingLoops) materialize(h);
  pendingLoops.clear();
  if (MUS.want) musicPlay();
}
// integer hash → [0, 1): stable per floorboard / stair tread
function hash01(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
const pickStep = (part, s) => getBuf(`step${part}_${s}_${(Math.random() * STEP_VARIANTS) | 0}`);
function onFootstep(p) {
  if (!ctx || !p || p.surface === 'none') return;
  const now = ctx.currentTime;
  if (now - lastStepT < 0.07) return;
  lastStepT = now;
  const s = SURF[p.surface] || 'wood', pos = posOf(p), vel = C.player && C.player.velocity;
  const v = vel ? Math.hypot(vel.x || 0, vel.z || 0) : (p.run ? 3.8 : 2);
  const run = !!p.run || v > 3.1, crouch = !!p.crouch && !run;
  const dy = pos && STEP.pos ? pos[1] - STEP.pos[1] : 0, up = s === 'stairs' && dy > 0.04, down = s === 'stairs' && dy < -0.04;
  STEP.pos = pos;
  stepSide = !stepSide;
  const out = stepSide ? stepPanL : stepPanR, t0 = now + 0.004;
  const force = (run ? 1.3 : crouch ? 0.45 : 1) * clamp(0.8 + v * 0.1, 0.85, 1.2) * mr(0.85, 1.05) * (p.volume === undefined ? 1 : p.volume);
  const hg = STEP_GAIN[s] * force * (up ? 0.55 : down ? 1.1 : crouch ? 0.8 : 1), tg = STEP_GAIN[s] * force * TOE_GAIN[s] * (up ? 1.7 : run ? 1.15 : 1);
  const gap = up ? 0.045 : down ? 0.05 : run ? mr(0.018, 0.035) : crouch ? mr(0.14, 0.2) : mr(0.075, 0.105);
  const rate = mr(0.96, 1.04) * (run ? 1.03 : 1), hb = pickStep('H', s), tb = pickStep('T', s);
  // heel strike then the roll onto the toe; climbing stairs lands on the ball of the foot first
  voice(up ? tb : hb, { out, gain: up ? tg : hg, rate, when: t0 });
  voice(up ? hb : tb, { out, gain: up ? hg : tg, rate: rate * mr(0.98, 1.02), when: t0 + gap });
  // creaky boards are fixed places (each with its own voice) — walk the same spot, hear the same board
  if (s === 'wood' || s === 'stairs' || s === 'porch') {
    const h = !pos ? 0.99 : s === 'stairs' ? hash01(Math.round((3.6 - pos[2]) / 0.27 + 0.5), 7, 3) * 0.55 : hash01(Math.floor(pos[0] / 0.55), Math.floor(pos[2] / 0.55), pos[1] > 2 ? 1 : 0);
    const creaky = h < (s === 'porch' ? 0.1 : 0.16);
    if ((creaky && Math.random() < 0.8) || Math.random() < 0.015) {
      const k = creaky ? ((h * 97) | 0) % 6 : (Math.random() * 6) | 0;
      voice(getBuf('board' + k), { out, gain: SFX_GAIN.board * (creaky ? 1 : 0.5) * (run ? 1.15 : crouch ? 0.85 : 1) * mr(0.85, 1.05),
        rate: (creaky ? 0.88 + ((h * 7919) % 1) * 0.3 : mr(0.85, 1.15)) * mr(0.98, 1.02), when: t0 + gap * 0.6 + mr(0.02, 0.06), low: true });
    }
  }
  // shoes pick up water outside and squeak on smooth floors for a while indoors; wet ground splashes underfoot
  const gw = Math.max(0, WET.ground), indoor = pos ? inHouse(pos[0], pos[1] + 0.5, pos[2]) : L.H > 0.5;
  if (!indoor) {
    const pick = s === 'water' ? 0.35 : s === 'mud' ? 0.25 : s === 'grass' ? 0.08 : (s === 'stone' || s === 'gravel') ? 0.05 : 0;
    WET.shoe = Math.min(1, WET.shoe + pick * (s === 'water' ? 1 : gw));
    if (gw > 0.12 && (s === 'stone' || s === 'gravel' || s === 'grass')) {
      voice(getBuf('wet' + ((Math.random() * 4) | 0)), { out, gain: SFX_GAIN.wet * gw * force * mr(0.7, 1.1), rate: mr(0.9, 1.1), when: t0 + mr(0, 0.01), low: true });
    }
  } else {
    WET.shoe *= 0.985;
    if (WET.shoe > 0.12 && (s === 'wood' || s === 'tile' || s === 'stairs') && Math.random() < WET.shoe * (s === 'tile' ? 0.7 : 0.45)) {
      voice(getBuf('squeak' + ((Math.random() * 4) | 0)), { out, gain: SFX_GAIN.squeak * (0.4 + WET.shoe) * mr(0.7, 1.1), rate: mr(0.9, 1.15), when: t0 + gap * mr(0.4, 1.1), low: true });
    }
  }
  if (run && Math.random() < 0.5) voice(getBuf('cloth' + ((Math.random() * 4) | 0)), { out, gain: SFX_GAIN.cloth * mr(0.6, 1), rate: mr(0.9, 1.1), when: t0, low: true });
}
function onJump(p) {
  if (!ctx) return;
  const s = SURF[(p && p.surface) || C.player.surface] || 'wood', now = ctx.currentTime;
  voice(pickStep('T', s), { out: stepSide ? stepPanR : stepPanL, gain: STEP_GAIN[s] * TOE_GAIN[s] * 1.3, rate: mr(0.95, 1.05) });      // push-off
  voice(getBuf('cloth' + ((Math.random() * 4) | 0)), { out: stepPanL, gain: SFX_GAIN.cloth * 1.2, rate: mr(0.9, 1.1), when: now + 0.02 });
  lastStepT = now;
}
function onLand(p) {
  if (!ctx) return;
  const sp = p && isFinite(p.speed) ? p.speed : 3.5, s = SURF[(p && p.surface) || C.player.surface] || 'wood', k = clamp(sp / 4.5, 0.4, 1.5), now = ctx.currentTime;
  voice(pickStep('H', s), { out: stepPanL, gain: STEP_GAIN[s] * 1.2 * k, rate: mr(0.84, 0.92), when: now });
  voice(pickStep('H', s), { out: stepPanR, gain: STEP_GAIN[s] * 0.9 * k, rate: mr(0.86, 0.94), when: now + mr(0.015, 0.04) });
  voice(pickStep('T', s), { out: stepPanR, gain: STEP_GAIN[s] * TOE_GAIN[s] * k, rate: mr(0.9, 1.0), when: now + mr(0.05, 0.08) });
  voice(getBuf('cloth' + ((Math.random() * 4) | 0)), { out: stepPanR, gain: SFX_GAIN.cloth * 1.4 * Math.min(1, k), rate: mr(0.85, 1), when: now });
  if ((s === 'wood' || s === 'stairs' || s === 'porch') && k > 0.8) {
    voice(getBuf('board' + ((Math.random() * 6) | 0)), { out: stepPanL, gain: SFX_GAIN.board * 0.8 * k, rate: mr(0.85, 1.05), when: now + mr(0.04, 0.1), low: true });
  }
  lastStepT = now;
}
// thunder: a fresh strike-specific render (distance, strength, seed) from the worker, timed by the real travel time
// of its first arrival; a pre-rendered one stands in if the render is late. Close strikes rattle the nearest panes.
function onLightning(p) {
  if (!ctx) return;
  const d = clamp(p && isFinite(p.distance) ? +p.distance : 2.5, 0.2, 12), s = clamp(p && isFinite(p.strength) ? +p.strength : 0.7, 0, 1), flash = ctx.currentTime;
  const lvl = LV.thunder * (0.55 + 0.45 * s) * clamp(Math.pow(0.9 / d, 0.85), 0.14, 1.25);
  let pan = 0;
  if (p && isFinite(p.dirX) && isFinite(p.dirZ)) { const rx = -L.fz, rz = L.fx, rl = Math.hypot(rx, rz) || 1, dl = Math.hypot(p.dirX, p.dirZ) || 1; pan = clamp((p.dirX * rx + p.dirZ * rz) / (rl * dl), -1, 1) * 0.55; }
  const fallback = d < 1.2 ? 'thunderClose' : d < 3.2 ? 'thunderMid' : (Math.random() < 0.5 ? 'thunderFar1' : 'thunderFar2');
  const name = `thunder|${d.toFixed(2)}|${s.toFixed(2)}|${(Math.random() * 1e9) | 0}`;
  let done = false;
  const fire = (nm, buf) => {
    const fresh = nm === name;
    if (done || !buf) { if (fresh) { delete BUF[nm]; delete META[nm]; } return; }
    done = true;
    const at = flash + Math.min(16, fresh && META[nm] ? META[nm].lead : d * 1000 / 343);
    if (ctx.currentTime > at + 1.0) { if (fresh) { delete BUF[nm]; delete META[nm]; } return; }
    voice(buf, { out: layers.thunderOcc.input, gain: lvl, rate: fresh ? 1 : mr(0.92, 1.06), when: at, pan, onEnd: fresh ? () => { delete BUF[nm]; delete META[nm]; } : null });
    if (d < 1.6 && L.H > 0.5) rattleWindows(at + 0.02, (1.6 - d) / 1.4 * (0.5 + 0.5 * s));
  };
  if (worker) {
    whenBuf(name, b => fire(name, b), true);
    setTimeout(() => { if (!done) whenBuf(fallback, b => fire(fallback, b), true); }, Math.max(250, d * 2915 - 450));
  } else whenBuf(fallback, b => fire(fallback, b), true);
}
function rattleWindows(at, k) {
  if (k <= 0.02) return;
  const ws = WINDOWS.map(w => [w, Math.hypot(w.p[0] - L.x, w.p[1] - L.y, w.p[2] - L.z)]).sort((a, b) => a[1] - b[1]).slice(0, 2);
  ws.forEach(([w], i) => voice(getBuf('rattle'), { pos: w.p, gain: SFX_GAIN.rattle * k * (i ? 0.6 : 1), rate: mr(0.85, 1.15), when: at + i * mr(0.02, 0.08), ref: 1, rolloff: 1.3 }));
}
function onDoor(p) {
  if (!p) return;
  const id = p.id || '';
  if (id === 'door_front') doorState.front = !!p.open;
  if (!ctx) return;
  const pos = posOf(p);
  // house doors sit in the wall: audible on both sides (the front door's centre is just outside the wall plane)
  const o = pos ? { x: pos[0], y: pos[1], z: pos[2], edge: id !== 'gate' } : {};
  if (id === 'gate') play(p.open ? 'gate' : 'gate_close', o);
  else play(p.open ? 'door_open' : 'door_close', o);
}
function onSit(p) {
  if (!ctx) return;
  const id = (p && p.id) || '', seat = C.player && C.player.seat;
  if (seat && seat.rock) { ROCK.on = true; ROCK.prev = null; ROCK.dir = 0; ROCK.last = ctx.currentTime; }
  if (/chair|bench|rocker|stool/.test(id) && !/arm/.test(id)) play('chair_creak', { volume: 0.9 });
  else play('cushion', { volume: 1 });
}
function onStand() { ROCK.on = false; if (ctx) play('cushion', { volume: 0.6, rate: 1.1 }); }
// rocking chair: a creak at each end of the swing, found from the seated camera's motion along the seat's axis
function trackRocker() {
  const pl = C.player, seat = pl && pl.seat;
  if (!ROCK.on || !seat || !seat.rock || pl.mode !== 'sit') return;
  const proj = -L.x * Math.sin(seat.yaw || 0) - L.z * Math.cos(seat.yaw || 0), now = ctx.currentTime;
  if (ROCK.prev !== null) {
    const dd = proj - ROCK.prev, dir = dd > 2e-5 ? 1 : dd < -2e-5 ? -1 : ROCK.dir;
    if (ROCK.dir && dir !== ROCK.dir && now - ROCK.last > 0.7) {
      ROCK.last = now;
      const sp = seat.position, pos = sp ? [sp[0], sp[1] - 0.7, sp[2]] : [L.x, L.y - 0.7, L.z];
      voice(getBuf('rocker' + ((Math.random() * 3) | 0)), { pos, gain: SFX_GAIN.rocker * mr(0.7, 1.1) * (dir > 0 ? 1 : 0.8), rate: mr(0.92, 1.08), ref: 1, rolloff: 1.2 });
    }
    ROCK.dir = dir;
  }
  ROCK.prev = proj;
}
function frontDoorOpen() {
  const d = C.house && C.house.doors && C.house.doors.front;
  if (d && typeof d.open === 'boolean') return d.open;
  return doorState.front;
}

// ---------------------------------------------------------------------------------------------------------------------
// per-frame mixing
// ---------------------------------------------------------------------------------------------------------------------
function updateListener() {
  const cam = listenerCam || C.camera; if (!cam) return;
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  const px = e[12], py = e[13], pz = e[14];
  let fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
  const fl = Math.hypot(fx, fy, fz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
  fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
  L.x = px; L.y = py; L.z = pz; L.fx = fx; L.fy = fy; L.fz = fz;
  const l = ctx.listener;
  if (l.positionX) {
    setP(l.positionX, px, 0.02); setP(l.positionY, py, 0.02); setP(l.positionZ, pz, 0.02);
    setP(l.forwardX, fx, 0.02); setP(l.forwardY, fy, 0.02); setP(l.forwardZ, fz, 0.02);
    setP(l.upX, ux, 0.02); setP(l.upY, uy, 0.02); setP(l.upZ, uz, 0.02);
  } else {
    l.setPosition(px, py, pz); l.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}
const setG = (l, v, tau = 0.12) => { if (l && l.gain) setP(l.gain, v, tau); };
function gustAt(t) {
  const nz = C.util && C.util.noise2D ? C.util.noise2D(t * 0.09, 3.7) : Math.sin(t * 0.31) * Math.sin(t * 0.13);
  const nz2 = C.util && C.util.noise2D ? C.util.noise2D(t * 0.23, 9.1) : Math.sin(t * 0.71);
  return clamp(0.5 + 0.45 * nz + 0.2 * nz2, 0, 1);
}
// gusts: mostly the weather's own wind (so the sound moves with the swaying trees and slanting rain), plus a local
// gust field that travels downwind (~6 m/s) so trees and panes further downwind catch it a little later
const gustAtPos = (x, z) => 0.65 * GUST.env + 0.35 * gustAt(GUST.t - (x * GUST.dx + z * GUST.dz) / 6);
function updateWeather(dt) {
  const w = C.env && C.env.wind, wx = w ? +w.x || 0 : 0.35, wz = w ? +w.z || 0 : 0.15, ws = Math.hypot(wx, wz);
  GUST.t += dt;
  if (GUST.avg < 0) GUST.avg = ws;
  GUST.avg += (ws - GUST.avg) * (1 - Math.exp(-dt / 20));
  GUST.env = clamp((ws / Math.max(0.05, GUST.avg) - 0.4) / 1.1, 0, 1);
  GUST.W += (clamp(ws / 1.1, 0, 1.8) - GUST.W) * (1 - Math.exp(-dt * 2));
  if (ws > 0.02) { GUST.dx = wx / ws; GUST.dz = wz / ws; }
  GUST.g = gustAtPos(L.x, L.z);
  // runoff: gutters and drips build up over ~15 s after the rain sets in and keep draining for a minute after it stops
  if (WET.ground < 0) WET.ground = L.rain;
  WET.ground += (L.rain - WET.ground) * (1 - Math.exp(-dt / (L.rain > WET.ground ? 15 : 45)));
  if (L.H > 0.5) WET.shoe *= Math.exp(-dt / 80);
}
function mixRain() {
  const r = L.rain, H = L.H, P = L.P, gw = Math.max(0, WET.ground), hv = smooth(0.25, 0.95, r), lv = Math.pow(r, 1.15), sr = Math.sqrt(r);
  const O = (1 - H) + H * 0.22 * L.leak;                          // how exposed the listener is to the open sky
  setG(layers.wash, LV.wash * O * lv * (0.2 + 0.8 * hv) * (1 - 0.3 * P));
  setG(layers.light, LV.light * O * sr * (1 - 0.75 * hv) * (1 - 0.3 * P));
  setG(layers.ticks, LV.ticks * O * sr * (1 - 0.35 * P));
  setG(layers.low, LV.low * (O + H * 0.2) * r * r);                 // the low roar carries through walls
  if (layers.inside) {
    setG(layers.inside, LV.inside * H * lv * (0.25 + 0.75 * hv));
    setG(layers.insideL, LV.inside * 0.8 * H * sr * (1 - 0.75 * hv));
    setP(layers.inLP.frequency, 1000 + 2500 * L.leak, 0.1);
  }
  setG(layers.leak, LV.leak * H * L.front * r);
  if (layers.windows) for (const wn of layers.windows) {
    const w = wn.w, face = -(w.n[0] * GUST.dx + w.n[1] * GUST.dz);    // > 0: the pane faces into the wind
    const exposure = (w.shelter || 1) * (0.45 + 0.55 * clamp(face * GUST.W, 0, 1.4)), g = gustAtPos(w.p[0], w.p[2]);
    setG(wn.src, LV.window * H * Math.pow(r, 0.9) * exposure * (0.55 + 0.9 * g * clamp(face + 0.3, 0, 1.3)), 0.15);
  }
  if (layers.sky) for (const s of layers.sky) setG(s, LV.sky * H * r * (0.85 + 0.3 * GUST.g));
  if (layers.roof) for (const rf of layers.roof) setG(rf, LV.roof * H * r * (0.35 + 0.65 * L.U) * (0.9 + 0.2 * GUST.g));
  setG(layers.porchRoof, LV.porch * r);
  const flow = Math.pow(smooth(0.02, 0.95, gw), 0.8);
  if (layers.gutters) for (const gu of layers.gutters) setG(gu, LV.gutter * flow, 0.3);
  if (layers.drips) for (const dp of layers.drips) setG(dp, LV.drip * Math.pow(gw, 0.9), 0.3);
  setG(layers.pond, LV.pond * Math.pow(r, 0.9));
  if (layers.trees) for (const t of layers.trees) { setG(t.leaves, LV.leaves * r); setG(t.drips, LV.canopy * Math.pow(gw, 1.2), 0.3); }
}
function mixWind() {
  const W = GUST.W, g = GUST.g, H = L.H;
  if (layers.wind) { setG(layers.wind, LV.wind * W * (0.25 + 0.75 * g * g), 0.3); setP(layers.wind.bp.frequency, 260 + 420 * g, 0.3); }
  if (layers.moan) { setG(layers.moan, LV.moan * H * W * (0.15 + 0.85 * Math.pow(g, 1.5)), 0.4); setP(layers.moan.bp.frequency, 140 + 90 * g, 0.4); }
  if (layers.whistle) { setG(layers.whistle, LV.whistle * 3 * W * Math.max(0, g - 0.55) * 2.2, 0.3); setP(layers.whistle.bp.frequency, 820 + 380 * g, 0.3); }
  if (layers.trees) for (const t of layers.trees) setG(t.rustle, LV.rustle * Math.pow(W, 1.2) * (0.12 + 0.88 * Math.pow(gustAtPos(t.t.p[0], t.t.p[2]), 1.6)), 0.25);
  if (layers.pines) setG(layers.pines, LV.pines * W * (0.2 + 0.8 * Math.pow(gustAtPos(L.x, -11.3), 1.4)), 0.3);
  // the timber frame answers strong gusts with the odd creak (heard indoors)
  const high = g > 0.8 && W > 0.5;
  if (high && !gustHigh && H > 0.6 && ctx.currentTime - houseCreakT > 14 && Math.random() < 0.45) {
    houseCreakT = ctx.currentTime;
    const a = Math.random() * TAU, pos = L.U > 0.5 ? [clamp(L.x + Math.cos(a) * 3, -6.5, 6.5), 5.8, clamp(L.z + Math.sin(a) * 1.5, -3.5, 3.5)] : nearestWallPoint();
    voice(getBuf('house_creak' + ((Math.random() * 3) | 0)), { pos, gain: SFX_GAIN.house_creak * mr(0.6, 1.1) * Math.min(1.3, W), rate: mr(0.85, 1.1), ref: 1.5, rolloff: 1, low: true });
  }
  gustHigh = high;
}
function nearestWallPoint() {
  const x = clamp(L.x, -6.6, 6.6), z = clamp(L.z, -4.6, 4.6);
  return 6.6 - Math.abs(x) < 4.6 - Math.abs(z) ? [Math.sign(x || 1) * 6.6, 2.2, z] : [x, 2.2, Math.sign(z || 1) * 4.6];
}
// fire: bed, dense crackle and a hiss that swell with a slowly wandering activity, live crackle bursts and pops, logs
// settling now and then, a flare-up when a log goes on
function mixFire(dt) {
  if (!layers.fireEm) return;
  const tgt = present.fire ? clamp(C.env && isFinite(C.env.fireLevel) ? C.env.fireLevel : fireEvt, 0, 1.5) : 0;
  if (FIRE.lvl >= 0 && tgt > FIRE.lvl + 0.15) { FIRE.act = 1; FIRE.nextSettle = GUST.t + mr(1.5, 4); }
  FIRE.lvl = tgt;
  fireS += (tgt - fireS) * (1 - Math.exp(-dt * 1.5));
  FIRE.actT -= dt;
  if (FIRE.actT <= 0) { FIRE.actT = mr(3, 9); FIRE.act = clamp(FIRE.act + mr(-0.35, 0.35), 0.1, 1); }
  const f = Math.min(1, fireS), em = layers.fireEm.input;
  setG(layers.fireBed, LV.fireBed * fireS * (0.8 + 0.3 * FIRE.act), 0.3);
  setG(layers.fireCr, LV.fireCrackle * f * (0.6 + 0.4 * fireS), 0.3);
  setG(layers.fireHiss, LV.fireHiss * f * (0.3 + 0.7 * FIRE.act * FIRE.act), 0.5);
  if (fireS < 0.05) return;
  if (Math.random() < fireS * (2.5 + 9 * FIRE.act) * dt) {
    const burst = Math.random() < 0.22 ? 2 + ((Math.random() * 3) | 0) : 1, now = ctx.currentTime;
    for (let k = 0; k < burst; k++) voice(getBuf('crk' + ((Math.random() * 12) | 0)), { out: em, gain: LV.crk * Math.pow(Math.random(), 1.4) * f, rate: mr(0.8, 1.25), when: now + (k ? mr(0.02, 0.3) : 0), low: true });
  }
  if (Math.random() < dt * 0.55 * fireS * (0.4 + FIRE.act)) {
    voice(getBuf('pop' + ((Math.random() * 8) | 0)), { out: em, gain: LV.pop * (0.3 + 0.7 * Math.pow(Math.random(), 1.5)) * Math.min(1.2, fireS), rate: mr(0.85, 1.2), low: true });
  }
  if (GUST.t > FIRE.nextSettle) {
    FIRE.nextSettle = GUST.t + mr(25, 70);
    if (fireS > 0.25) voice(getBuf('settle' + ((Math.random() * 3) | 0)), { out: em, gain: LV.settle * f * mr(0.6, 1), rate: mr(0.9, 1.1), low: true });
  }
}
function drops(dt) {
  if (!dropPans) return;
  const rate = L.rain * ((1 - L.H) * 5 + L.P * 1.5);
  if (rate > 0.01 && Math.random() < rate * dt) {
    voice(getBuf('drop' + ((Math.random() * 8) | 0)), { out: dropPans[(Math.random() * 4) | 0], gain: LV.drop * Math.pow(Math.random(), 1.5) * (0.6 + 0.4 * L.rain), rate: mr(0.85, 1.2), low: true });
  }
}
function frame(dt) {
  const t0 = performance.now();
  updateListener();
  const x = L.x, y = L.y, z = L.z;
  const inH = inHouse(x, y, z) ? 1 : 0, k = 1 - Math.exp(-dt * 5);
  L.H += (inH - L.H) * k;
  L.U += ((inH ? smooth(2.9, 4.1, y) : 0) - L.U) * k;
  const dx = x < 1 ? 1 - x : x > 7 ? x - 7 : 0, dz = z < 5 ? 5 - z : z > 7.4 ? z - 7.4 : 0;
  L.P += ((inH ? 0 : clamp(1 - Math.hypot(dx, dz) / 4, 0, 1) * (y < 4.5 ? 1 : 0.4)) - L.P) * k;
  L.front += ((frontDoorOpen() ? 1 : 0) - L.front) * (1 - Math.exp(-dt * 3));
  L.leak = L.front * clamp(1 - Math.hypot(x - DOORWAY[0], (y - DOORWAY[1]) * 0.8, z - DOORWAY[2]) / 7, 0, 1);
  const rainT = clamp(C.env && isFinite(C.env.rain) ? C.env.rain : (rainEvt === null ? 0.7 : rainEvt), 0, 1.2);
  L.rain += (rainT - L.rain) * (1 - Math.exp(-dt * 1.5));
  updateWeather(dt);
  mixRain(); mixWind(); mixFire(dt); drops(dt);
  setG(layers.clock, present.clock ? LV.clock : 0, 0.5);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i], e = ln.em; ln.fn(ln.pt);
    if (Math.abs(ln.pt[0] - e.x) + Math.abs(ln.pt[1] - e.y) + Math.abs(ln.pt[2] - e.z) > 0.01) e.setPosition(ln.pt[0], ln.pt[1], ln.pt[2]);
  }
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    if (e.follow) e.setPosition(L.x + L.fx * 0.3, L.y, L.z + L.fz * 0.3);
    const d = Math.hypot(e.x - L.x, e.y - L.y, e.z - L.z);
    applyOcc(e, occAmount(e), d);
    setP(e.send.gain, revAmount(e, d), 0.15);
  }
  const mOut = L.H * (1 - 0.7 * L.leak), mIn = (1 - L.H) * (1 - 0.7 * L.leak);
  for (const oc of occChains) { const m = oc.inside ? mIn : mOut; setP(oc.f.frequency, 20000 * Math.pow(oc.cutK, m), 0.15); setP(oc.g.gain, 1 - oc.loss * m, 0.15); }
  // room character: the tiled kitchen and the bare hall ring more than the book-lined study
  const room = L.H > 0.5 && C.world && C.world.roomAt ? C.world.roomAt(x, y - 1.5, z) : null;
  RV.roomWet += (((room && ROOM_WET[room]) || 1) - RV.roomWet) * (1 - Math.exp(-dt * 2));
  setP(RV.retIn.gain, LV.revIn * RV.roomWet, 0.2);
  setP(RV.lsIn.gain, L.H, 0.1); setP(RV.lsOut.gain, 1 - L.H, 0.1);
  trackRocker();
  if (GUST.t - present.t > 1.5) { present.t = GUST.t; checkPresence(); }
  if (recent.size > 48) recent.clear();
  musicTick();
  const ms = performance.now() - t0;
  stats.updMs += ms; stats.updN++; if (ms > stats.updMax) stats.updMax = ms;
}

// ---------------------------------------------------------------------------------------------------------------------
// debug / test helpers (C.audio._debug)
// ---------------------------------------------------------------------------------------------------------------------
function meter(ms = 1000) {
  if (!ctx) return Promise.resolve(null);
  if (!tap) { tap = ctx.createAnalyser(); tap.fftSize = 8192; shaper.connect(tap); tapBuf = new Float32Array(tap.fftSize); }
  return new Promise(res => {
    let peak = 0, sum = 0, cnt = 0, maxWin = 0; const t0 = performance.now();
    const iv = setInterval(() => {
      tap.getFloatTimeDomainData(tapBuf);
      let s = 0, p = 0;
      for (let i = 0; i < tapBuf.length; i++) { const v = tapBuf[i]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
      s /= tapBuf.length; sum += s; cnt++;
      const w = Math.sqrt(s); if (w > maxWin) maxWin = w; if (p > peak) peak = p;
      if (performance.now() - t0 >= ms) { clearInterval(iv); const rms = Math.sqrt(sum / Math.max(1, cnt)); res({ rms, peak, maxWin, rmsDb: 20 * Math.log10(rms + 1e-9), peakDb: 20 * Math.log10(peak + 1e-9), n: cnt }); }
    }, 60);
  });
}
function solo(list) {
  const set = list ? new Set([].concat(list)) : null;
  for (const k of Object.keys(G)) {
    const v = !set || set.has(k) ? 1 : 0;
    for (const nd of [G[k], GS.in[k], GS.out[k]]) if (nd) { nd.gain.cancelScheduledValues(0); nd.gain.value = v; nd.gain._v = v; }
  }
}
function debugStats() {
  return { state: ctx ? ctx.state : 'none', sampleRate: ctx ? ctx.sampleRate : 0, renderSR: SR, baseLatency: ctx ? ctx.baseLatency : 0,
    voices: stats.voices, peakVoices: stats.peakVoices, created: stats.created, loops: stats.loops, emitters: emitters.length,
    musicActive: MUS.active.size, rt: stats.rt, liveLoops: liveLoops.size, buffers: Object.keys(BUF).length, renderMs: +stats.renderMs.toFixed(1),
    updAvgMs: stats.updN ? +(stats.updMs / stats.updN).toFixed(4) : 0, updMaxMs: +stats.updMax.toFixed(3), pending: fallbackQ.length + Object.keys(waiters).length, worker: !!worker, workerRenders: stats.workerRenders, mainRenders: stats.mainRenders,
    listener: { H: +L.H.toFixed(2), U: +L.U.toFixed(2), P: +L.P.toFixed(2), leak: +L.leak.toFixed(2), rain: +L.rain.toFixed(2) },
    weather: { ground: +WET.ground.toFixed(2), shoe: +WET.shoe.toFixed(2), wind: +GUST.W.toFixed(2), gust: +GUST.g.toFixed(2) },
    present: { fire: present.fire, clock: present.clock }, roomWet: +RV.roomWet.toFixed(2) };
}

// ---------------------------------------------------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------------------------------------------------
C.register({
  name: 'audio',
  order: 50,
  init(C) {
    A = C.audio;
    Object.assign(A, {
      play, loop, setListener(cam) { listenerCam = cam || null; },
      setMuted, toggleMute, muted: !!C.state.muted,
      _debug: { stats: debugStats, meter, solo, getBuf: n => !!getBuf(n), layers, LV, STEP_GAIN, SFX_GAIN, MUS, tapPoint: () => shaper,
        resetPeak() { stats.peakVoices = stats.voices; stats.updMax = 0; stats.updMs = 0; stats.updN = 0; },
        warm: () => new Promise(r => { const chk = () => (A._warm ? r(true) : setTimeout(chk, 50)); chk(); }) },
    });
    Object.assign(A.music, { playing: !!A.music.playing, play: musicPlay, stop: musicStop, toggle() { if (MUS.want) musicStop(); else musicPlay(); },
      setPosition(x, y, z) {
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
        MUS.pos = [x, y, z];
        if (MUS.em) { MUS.em.follow = false; MUS.em.setPosition(x, y, z); }
      } });
    Object.assign(A.kettle, { start: kettleStart, stop: kettleStop });
    Object.defineProperty(A.kettle, 'on', { get: () => KET.on, configurable: true, enumerable: true });   // (Object.assign would copy a stale value)
    Object.assign(A.purr, { start: purrStart, stop: purrStop });
    C.on('start', onStart);
    C.on('resume', () => { resumeCtx(); if (ctx) { setP(duckG.gain, 1, 0.3); setP(duckLP.frequency, 20000, 0.3); } });
    C.on('pause', () => { if (ctx) { setP(duckG.gain, 0.4, 0.25); setP(duckLP.frequency, 2200, 0.25); } });
    C.on('settings', applySettings);
    C.on('footstep', onFootstep);
    C.on('jump', onJump);
    C.on('land', onLand);
    C.on('lightning', onLightning);
    C.on('door', onDoor);
    C.on('lamp', p => { if (ctx) play('switch', Object.assign({ volume: 0.8, rate: p && p.on ? 1.04 : 0.96 }, posOf(p) ? { x: p.x, y: p.y, z: p.z } : {})); });
    C.on('fire', p => { if (p && isFinite(p.level)) fireEvt = +p.level; });
    C.on('rain', p => { if (p && isFinite(p.level)) rainEvt = +p.level; });
    C.on('sit', onSit);
    C.on('stand', onStand);
    if (C.input && C.input.onKey) C.input.onKey('KeyM', toggleMute);
    // browsers may still create/leave the context suspended: resume on the next gesture; suspend while the tab is hidden
    const gesture = () => resumeCtx();
    addEventListener('pointerdown', gesture, true); addEventListener('keydown', gesture, true); addEventListener('touchend', gesture, true);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => { /* */ }); else resumeCtx();
    });
    if (C.state.started) onStart();       // (not expected: 'start' fires after boot)
  },
  lateUpdate(dt) {
    if (!ctx) return;
    frame(dt);
    if (A.muted !== !!C.state.muted) applyMute();       // someone else toggled C.state.muted (settings UI)
  },
});

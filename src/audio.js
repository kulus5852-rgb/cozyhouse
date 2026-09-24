// =====================================================================================================================
//  AUDIO (order 50) — a fully procedural WebAudio soundscape (SPEC §3.7, §9 audio). No sample files: every sound is
//  synthesized, either rendered once into AudioBuffers with small JS DSP helpers (textures, one-shots, instrument
//  samples) or built live from nodes (mix automation, kettle whistle, wind gusts, the music sequencer).
//
//  Graph:  sources → [emitter: occlusion LP → gain → Panner] → group gain → bus (music/ambience/sfx, settings volume)
//          → master (masterVolume) → pause duck → duck LP → glue compressor → limiter → soft clipper → mute → out
//          sfx + music buses also feed a small synthetic room reverb (wet level follows indoor-ness).
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

// Level table (calibrated with build/audio_test.js — see final report). All values are linear gains.
const LV = {
  wash: 0.42, ticks: 0.5, low: 0.45, inside: 0.3, roof: 0.4, porch: 0.5, leak: 0.55, glass: 0.55, gutter: 0.6,
  drop: 0.2, wind: 0.6, whistle: 0.08, fireBed: 0.35, fireCrackle: 0.5, pop: 0.2, clock: 0.38, thunder: 0.95,
  piano: 0.14, bass: 0.28, drums: 0.17, vinyl: 0.25, loop: 0.5, kettle: 0.45, whistleK: 0.022, purr: 0.3,
};
const STEP_GAIN = { wood: 0.26, stairs: 0.3, tile: 0.3, rug: 0.24, carpet: 0.22, porch: 0.27, grass: 0.3, mud: 0.26,
  gravel: 0.36, stone: 0.38, water: 0.26 };
const SFX_GAIN = { click: 0.3, switch: 0.3, creak: 0.3, door_open: 0.34, door_close: 0.3, thud: 0.28, page: 0.24, pour: 0.26,
  sip: 0.22, meow: 0.15, chime: 0.24, match: 0.3, whoosh: 0.22, drawer: 0.25, curtain: 0.24, splash: 0.34, clink: 0.22,
  gate: 0.3, cushion: 0.16, needle: 0.25, floor_creak: 0.16, chair_creak: 0.2 };
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
  if (o.bands) for (const [f, tau, amp, rate] of o.bands) {
    const imps = outs.map(() => new Float32Array(n)), cnt = Math.round(rate * o.sec);
    for (let k = 0; k < cnt; k++) {
      const i = (R() * n) | 0, a = (R() < 0.5 ? -1 : 1) * Math.pow(R(), o.pow || 2.5);
      if (nch === 2) { const p = R() * 1.5708; imps[0][i] += a * Math.cos(p); imps[1][i] += a * Math.sin(p); } else imps[0][i] += a;
    }
    for (let c = 0; c < nch; c++) D.mode(imps[c], outs[c], f * (c ? 1.03 : 1), tau, amp, true);
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
  if (o.bands || o.bubbles) D.normRms(outs, 1);
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
  // dense wash: thousands of tiny drop impacts across 8 bands + a soft pink bed (never flat white noise)
  rainWash: () => texture({ sr: 32000, sec: 8.0, stereo: true, seed: 11, pow: 2.2,
    bands: [[420, 0.0045, 0.45, 900], [700, 0.0038, 0.65, 1100], [1100, 0.0032, 0.8, 1200], [1650, 0.0027, 0.8, 1200],
      [2400, 0.0022, 0.62, 1100], [3400, 0.0018, 0.42, 900], [4800, 0.0014, 0.25, 700], [6800, 0.001, 0.12, 500]],
    bed: { color: 'pink', hp: 300, lp: 4200, amp: 0.45, am: [40, 0.7, 1.0] }, hp: 140, lp: 8000, rms: 0.16 }),
  // sparse, distinct nearby drops (leaves, wood, puddle plinks) — two loops of coprime length
  rainTicksA: () => texture({ sr: 32000, sec: 6.7, stereo: true, seed: 21, pow: 3,
    bands: [[520, 0.008, 0.6, 9], [800, 0.006, 0.6, 10], [1250, 0.0045, 0.7, 10], [1900, 0.0035, 0.6, 10], [2800, 0.0026, 0.42, 8], [3900, 0.002, 0.26, 6]],
    bubbles: { rate: 12, f: [1200, 3600], tau: [0.004, 0.012], amp: 0.6, rise: 0.35 }, hp: 200, lp: 8500, rms: 0.1 }),
  rainTicksB: () => texture({ sr: 32000, sec: 9.1, stereo: true, seed: 22, pow: 3,
    bands: [[560, 0.008, 0.6, 9], [860, 0.006, 0.6, 10], [1320, 0.0045, 0.7, 10], [2000, 0.0035, 0.6, 10], [2950, 0.0026, 0.42, 8], [4100, 0.002, 0.26, 6]],
    bubbles: { rate: 12, f: [1100, 3400], tau: [0.004, 0.012], amp: 0.6, rise: 0.35 }, hp: 200, lp: 8500, rms: 0.1 }),
  // heavy-rain low roar
  rainLow: () => texture({ sr: 8000, sec: 8.3, stereo: true, seed: 12, bed: { color: 'brown', lp: 380, amp: 1, am: [16, 0.6, 1] }, hp: 30, rms: 0.18 }),
  // roof patter heard from inside the loft: dull drumming thuds
  roof: () => texture({ sr: 16000, sec: 7.7, stereo: true, seed: 31, pow: 2.4,
    bands: [[170, 0.03, 0.7, 250], [300, 0.02, 0.8, 300], [560, 0.012, 0.7, 350], [1050, 0.007, 0.5, 300], [1900, 0.004, 0.32, 250], [3200, 0.0025, 0.18, 200]],
    bed: { color: 'pink', lp: 1200, hp: 80, amp: 0.35 }, hp: 60, lp: 3200, rms: 0.16 }),
  // drops ticking on skylight glass
  glass: () => texture({ sr: 32000, sec: 6.3, seed: 41, pow: 2.5,
    bands: [[1500, 0.004, 0.4, 60], [2900, 0.0028, 0.8, 90], [4100, 0.002, 0.65, 80], [5600, 0.0015, 0.35, 60]],
    bubbles: { rate: 6, f: [1500, 3500], tau: [0.003, 0.008], amp: 0.4 }, bed: { color: 'pink', hp: 800, lp: 4500, amp: 0.25 }, hp: 300, lp: 7500, rms: 0.12 }),
  // porch roof drumming + drip-line plops
  porch: () => texture({ sr: 24000, sec: 7.1, stereo: true, seed: 51, pow: 2.3,
    bands: [[130, 0.045, 0.8, 160], [240, 0.03, 0.8, 200], [470, 0.016, 0.7, 250], [950, 0.008, 0.55, 250], [1900, 0.0045, 0.32, 200], [3300, 0.0025, 0.18, 150]],
    bubbles: [{ rate: 9, f: [700, 1800], tau: [0.008, 0.02], amp: 0.7, rise: 0.4 }, { rate: 3, f: [280, 600], tau: [0.015, 0.035], amp: 0.7, rise: 0.3 }],
    bed: { color: 'pink', hp: 200, lp: 3000, amp: 0.35 }, hp: 60, lp: 6000, rms: 0.16 }),
  // gutter trickle + downspout gurgle
  gutter: () => texture({ sr: 24000, sec: 5.3, seed: 61,
    bubbles: [{ rate: 110, f: [380, 1500], tau: [0.004, 0.014], amp: 0.6, rise: 0.4 }, { rate: 3, burst: 7, spread: 0.12, f: [140, 420], tau: [0.015, 0.04], amp: 1, rise: 0.25 }],
    bed: { color: 'pink', bp: [900, 0.8], amp: 0.5, am: [30, 0.3, 1.0], amPow: 2 }, hp: 90, lp: 5000, rms: 0.14 }),
  drip: () => texture({ sr: 32000, sec: 7.9, seed: 71, bands: [[2600, 0.0015, 0.4, 1.1]],
    bubbles: { rate: 1.3, f: [650, 1500], tau: [0.012, 0.03], amp: 1, rise: 0.45, pow: 0.7 }, hp: 150, lp: 9000, rms: 0.05 }),
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
  // grandfather clock: escapement double-click "tick" and a lower "tock", with the wooden case resonance
  clock() {
    srand(121); const o = D.zeros(2.0);
    const click = (t0, s, a) => strike(o, t0, [[2350 * s, 0.010, 1], [3720 * s, 0.007, 0.7], [5480 * s, 0.004, 0.4], [1180 * s, 0.018, 0.5], [205 * s, 0.045, 0.35], [410 * s, 0.025, 0.25]], a, 0.0006, 0.01);
    click(0.01, 1, 1); click(0.021, 1.03, 0.35); click(1.01, 0.86, 0.9); click(1.019, 0.9, 0.3);
    D.normPeak([o], 0.9); return [o];
  },
  // cat purr: ~25 Hz laryngeal pulse train, exhale (stronger) / inhale (softer, slower), warm low-passed
  purr: () => at(8000, () => {
    srand(131); const n = D.n(4.0), o = new Float32Array(n), nz = D.white(n); D.biquad(nz, 'lowpass', 900, 0.7);
    const segs = [[0.0, 2.1, 25.5, 1.0], [2.25, 1.6, 21.5, 0.6]];
    for (const [s0, dur, f0, amp] of segs) {
      let ph = 0; const i0 = D.n(s0), len = D.n(dur);
      for (let j = 0; j < len && i0 + j < n; j++) {
        const t = j / SR, env = Math.pow(Math.sin(Math.PI * t / dur), 0.6);
        ph += f0 * (1 + 0.05 * Math.sin(TAU * 0.8 * t)) / SR;
        const fr = ph - Math.floor(ph), pulse = Math.exp(-fr / 0.14);
        o[i0 + j] += amp * env * (pulse * (0.65 + 0.8 * nz[i0 + j]) + 0.12 * nz[i0 + j]);
      }
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
  // small room impulse response (1.5 s, darkening tail, a few early reflections)
  ir() {
    srand(5); const n = D.n(1.5), chs = [];
    for (let c = 0; c < 2; c++) {
      const x = new Float32Array(n); let y = 0;
      for (let i = 0; i < n; i++) { const t = i / SR, fc = 900 + 7000 * Math.exp(-t / 0.25), a = 1 - Math.exp(-TAU * fc / SR); y += a * (rs1() - y); x[i] = y * Math.exp(-t / 0.3) * Math.min(1, t / 0.006); }
      for (const [d, a] of [[0.007, 0.5], [0.0115, 0.35], [0.017, 0.3], [0.023, 0.22], [0.031, 0.18]]) x[D.n(d * (c ? 1.13 : 1))] += a * (R() < 0.5 ? -1 : 1);
      chs.push(x);
    }
    return chs;
  },
});

// fire pops (live-scheduled on top of the crackle loop so loud pops never repeat in a pattern)
for (let k = 0; k < 8; k++) RENDER['pop' + k] = () => {
  srand(200 + k); const o = D.zeros(0.3);
  strike(o, 0.002, [[rr(450, 900), rr(0.008, 0.015), 1], [rr(1300, 2200), 0.005, 0.6], [rr(2800, 4500), 0.0025, 0.4]], 1, 0.0005);
  addNoise(o, 0, { dur: 0.03, amp: 0.5, att: 0.0003, dec: 0.004, hp: 1200 });
  if (R() < 0.4) addNoise(o, 0.01, { dur: 0.15, amp: 0.12, att: 0.01, dec: 0.05, hp: 4000 });
  return fin(o);
};
// random nearby raindrops: puddle plinks and leaf/wood ticks
for (let k = 0; k < 8; k++) RENDER['drop' + k] = () => {
  srand(300 + k); const o = D.zeros(0.12);
  if (k < 4) { strike(o, 0, [[rr(2000, 3500), 0.0015, 1]], 0.4, 0.0003); D.bubble(o, D.n(0.002), rlog(1100, 2600), rr(0.006, 0.014), 1, 0.5); }
  else strike(o, 0, [[rr(500, 900), 0.006, 0.6], [rr(1200, 2200), 0.004, 0.8], [rr(2800, 4000), 0.002, 0.5]], 1, 0.0004);
  return fin(o);
};

// ---- footsteps ----
function rStep(s, seed) {
  srand(seed);
  const out = D.zeros(0.42), toe = rr(0.065, 0.1), J = () => rr(0.92, 1.08);
  switch (s) {
    case 'wood': case 'stairs': {
      const st = s === 'stairs';
      const m = st ? [[115 * J(), 0.06, 0.8], [250 * J(), 0.04, 0.6], [520 * J(), 0.02, 0.45], [1080 * J(), 0.01, 0.3], [2100 * J(), 0.004, 0.14]]
        : [[165 * J(), 0.035, 0.6], [390 * J(), 0.022, 0.55], [820 * J(), 0.012, 0.4], [1600 * J(), 0.006, 0.24], [2900 * J(), 0.003, 0.1]];
      addThump(out, 0, 130, 85, st ? 0.05 : 0.035, 0.5);
      strike(out, 0.001, m, 1, 0.0015);
      strike(out, toe, m, rr(0.35, 0.55), 0.0012);
      addNoise(out, 0.004, { dur: 0.08, amp: 0.07, dec: 0.025, bp: [2400, 0.8] });
      break;
    }
    case 'tile': {
      const m = [[1850 * J(), 0.009, 0.6], [3300 * J(), 0.006, 0.55], [5200 * J(), 0.0035, 0.3], [7300 * J(), 0.002, 0.15]];
      strike(out, 0, m, 1, 0.0006);
      addNoise(out, 0, { dur: 0.05, amp: 0.35, dec: 0.012, lp: 350 });
      addThump(out, 0, 150, 100, 0.02, 0.25);
      strike(out, toe * 0.8, m, rr(0.5, 0.7), 0.0005);
      break;
    }
    case 'rug': case 'carpet': {
      const c = s === 'carpet';
      addNoise(out, 0, { dur: 0.15, amp: 1, att: 0.006, dec: 0.04, lp: c ? 220 : 300, color: 'pink' });
      addThump(out, 0, 100, 70, 0.03, 0.35);
      addNoise(out, 0.01, { dur: 0.15, amp: c ? 0.05 : 0.08, att: 0.015, dec: 0.05, bp: [1800, 0.7] });
      addNoise(out, toe, { dur: 0.1, amp: 0.45, att: 0.006, dec: 0.03, lp: c ? 220 : 300, color: 'pink' });
      break;
    }
    case 'porch': {
      const m = [[92 * J(), 0.09, 0.8], [205 * J(), 0.055, 0.6], [430 * J(), 0.025, 0.45], [880 * J(), 0.012, 0.3], [1800 * J(), 0.005, 0.14]];
      addThump(out, 0, 120, 75, 0.06, 0.45);
      strike(out, 0.001, m, 1, 0.0015);
      strike(out, rr(0.02, 0.035), [[m[2][0] * 1.3, 0.015, 0.4], [m[3][0] * 1.2, 0.008, 0.3]], 0.25, 0.001);
      strike(out, toe, m, rr(0.3, 0.45), 0.0012);
      for (let k = 0; k < 2; k++) D.bubble(out, D.n(rr(0.01, 0.12)), rlog(900, 2200), rr(0.004, 0.01), 0.08, 0.3);
      break;
    }
    case 'grass': {
      addNoise(out, 0, { dur: 0.2, amp: 0.55, att: 0.015, dec: 0.06, bp: [3000, 0.7] });
      addGrains(out, 0.005, 0.12, 40, [[3200, 0.0012, 0.6], [5200, 0.0008, 0.5]], 0.5);
      addNoise(out, 0.02, { dur: 0.12, amp: 0.35, att: 0.01, dec: 0.04, sweep: [450, 1100, 3] });
      addNoise(out, 0, { dur: 0.08, amp: 0.5, att: 0.005, dec: 0.025, lp: 180, color: 'pink' });
      addNoise(out, toe, { dur: 0.15, amp: 0.35, att: 0.01, dec: 0.05, bp: [3200, 0.7] });
      break;
    }
    case 'mud': {
      addNoise(out, 0, { dur: 0.08, amp: 0.6, att: 0.004, dec: 0.03, lp: 200, color: 'pink' });
      addNoise(out, 0.01, { dur: 0.2, amp: 0.6, att: 0.02, dec: 0.07, sweep: [320, 950, 4.5], am: 60 });
      addNoise(out, 0.2, { dur: 0.16, amp: 0.4, att: 0.015, dec: 0.05, sweep: [900, 380, 4] });
      for (let k = 0; k < 3; k++) D.bubble(out, D.n(rr(0.03, 0.25)), rlog(250, 700), rr(0.01, 0.03), 0.25, 0.3);
      break;
    }
    case 'gravel': {
      const gm = [[1700, 0.0015, 0.6], [2900, 0.001, 0.7], [4600, 0.0007, 0.55], [6500, 0.0005, 0.35]];
      addGrains(out, 0, 0.14, 170, gm, 1, 'decay');
      addGrains(out, toe, 0.12, 90, gm, 0.7, 'decay');
      addNoise(out, 0, { dur: 0.06, amp: 0.35, att: 0.003, dec: 0.02, lp: 220, color: 'pink' });
      break;
    }
    case 'stone': {
      const m = [[620 * J(), 0.011, 0.5], [1450 * J(), 0.006, 0.45], [2700 * J(), 0.0035, 0.3]];
      strike(out, 0, m, 1, 0.0008);
      addNoise(out, 0, { dur: 0.06, amp: 0.45, att: 0.002, dec: 0.018, lp: 250, color: 'pink' });
      addGrains(out, 0.003, 0.06, 15, [[3500, 0.0008, 0.5], [5500, 0.0006, 0.4]], 0.35, 'decay');
      addNoise(out, 0.004, { dur: 0.08, amp: 0.22, att: 0.003, dec: 0.02, bp: [1500, 1] });
      strike(out, toe * 0.85, m, rr(0.3, 0.5), 0.0008);
      break;
    }
    case 'water': {
      addNoise(out, 0, { dur: 0.12, amp: 0.7, att: 0.003, dec: 0.04, bp: [900, 0.7] });
      addNoise(out, 0.01, { dur: 0.3, amp: 0.35, att: 0.01, dec: 0.09, hp: 2500 });
      for (let k = 0; k < 8; k++) D.bubble(out, D.n(rr(0.01, 0.22)), rlog(400, 1800), rr(0.005, 0.02), 0.3, 0.4);
      addThump(out, 0, 160, 220, 0.04, 0.3);
      break;
    }
    default: return rStep('wood', seed);
  }
  return fin(out);
}
for (const s of ['wood', 'stairs', 'tile', 'rug', 'carpet', 'porch', 'grass', 'mud', 'gravel', 'stone', 'water']) {
  for (let k = 0; k < STEP_VARIANTS; k++) RENDER[`step_${s}_${k}`] = () => rStep(s, 1000 + s.length * 97 + k * 13 + s.charCodeAt(0));
}
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
    addNoise(o, 0, { dur: 0.3, amp: 0.18, shape: u => Math.pow(u, 1.5), lp: 600, color: 'pink' });
    const t = 0.25; addThump(o, t, 95, 65, 0.09, 0.8);
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
  cushion() { srand(519); const o = D.zeros(0.55);
    addNoise(o, 0, { dur: 0.5, amp: 1, att: 0.03, dec: 0.12, lp: 260, color: 'pink' });
    addNoise(o, 0.01, { dur: 0.4, amp: 0.18, att: 0.04, dec: 0.1, bp: [2200, 0.6], am: 50 }); return fin(o); },
  needle() { srand(520); const o = D.zeros(0.8); addThump(o, 0, 70, 45, 0.06, 0.7);
    addNoise(o, 0, { dur: 0.02, amp: 0.4, dec: 0.004, hp: 1500 }); addGrains(o, 0.01, 0.6, 25, [[2500, 0.0008, 0.8]], 0.3);
    addNoise(o, 0, { dur: 0.8, amp: 0.12, att: 0.02, dec: 0.3, hp: 1500, color: 'pink' }); return fin(o, 0.6); },
});

// ---- thunder (pre-rendered variants; mid/far at 24 kHz since they are band-limited anyway) ----
function rThunder(kind, seed) {
  const saveSR = SR, sr = kind === 'close' ? SR : Math.min(SR, 24000);
  SR = sr; srand(seed);
  try {
    const dur = kind === 'close' ? 7.5 : kind === 'mid' ? 8 : 9, n = D.n(dur), env = new Float32Array(n);
    const swells = kind === 'close' ? 5 : 4 + ((R() * 3) | 0);
    for (let s = 0; s < swells; s++) {
      const t0 = s === 0 ? (kind === 'close' ? 0.05 : 0) : rr(0.2, dur * 0.45), amp = s === 0 ? 1 : rr(0.35, 0.9);
      const att = kind === 'far' ? rr(0.25, 0.6) : rr(0.03, 0.2), dec = rr(0.8, 2.2) * (kind === 'far' ? 1.4 : 1);
      for (let i = D.n(t0); i < n; i++) { const t = i / SR - t0; env[i] += amp * (1 - Math.exp(-t / att)) * Math.exp(-t / dec); }
    }
    const lpF = kind === 'close' ? 700 : kind === 'mid' ? 420 : 230, chs = [];
    const mod = D.curve(n, Math.round(dur * 6), 0.55, 1);
    for (let c = 0; c < 2; c++) {
      const x = D.brown(n); D.biquad(x, 'lowpass', lpF, 0.6); D.biquad(x, 'lowpass', lpF * 1.3, 0.6); D.biquad(x, 'highpass', 28, 0.7);
      D.normRms([x], 1);
      for (let i = 0; i < n; i++) x[i] *= env[i] * mod[i];
      if (kind !== 'far') {                                           // mid-frequency rumble texture
        const m = D.white(n); D.biquad(m, 'bandpass', kind === 'close' ? 900 : 500, 0.7); D.normRms([m], 1);
        const cm = D.curve(n, Math.round(dur * 20), 0, 1);
        for (let i = 0; i < n; i++) x[i] += m[i] * env[i] * cm[i] * cm[i] * (kind === 'close' ? 0.35 : 0.18);
      }
      if (kind === 'close') {                                         // the crack: a ripping burst of short N-wave crackles
        const ck = new Float32Array(n);
        let t = 0;
        for (let k = 0; k < 45; k++) {
          t += -Math.log(1 - R()) * 0.012; if (t > 0.6) break;
          const bl = D.n(rr(0.002, 0.015)), i0 = D.n(t), a = Math.exp(-t / 0.25) * rr(0.4, 1);
          for (let j = 0; j < bl && i0 + j < n; j++) ck[i0 + j] += rs1() * a * (1 - j / bl);
        }
        D.biquad(ck, 'highpass', 700, 0.7); D.biquad(ck, 'lowpass', 6500, 0.7);
        const rip = D.white(D.n(0.4)); D.tv(rip, 'lowpass', u => 6000 * Math.pow(800 / 6000, u), 0.7);
        for (let i = 0; i < rip.length; i++) ck[i] += rip[i] * Math.exp(-i / SR / 0.1) * 0.8;
        D.normRms([ck], 1);
        for (let i = 0; i < n; i++) x[i] += ck[i] * 0.6;
      }
      chs.push(x);
    }
    D.fadeOut(chs[0], 0.3); D.fadeOut(chs[1], 0.3);
    if (kind !== 'far') {                 // gentle saturation: lowers the crest factor so the rumble body carries
      D.normPeak(chs, 1); const k = kind === 'close' ? 2.4 : 1.6, nk = Math.tanh(k);
      for (const x of chs) for (let i = 0; i < x.length; i++) x[i] = Math.tanh(k * x[i]) / nk;
    }
    D.normPeak(chs, 0.9);
    return { ch: chs, sr };
  } finally { SR = saveSR; }
}
RENDER.thunderClose = () => rThunder('close', 601);
RENDER.thunderMid = () => rThunder('mid', 602);
RENDER.thunderFar1 = () => rThunder('far', 603);
RENDER.thunderFar2 = () => rThunder('far', 604);

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
  const f = RENDER[name]; if (!f) return null;
  const save = SR;
  try { const r = f(); return Array.isArray(r) ? { ch: r, sr: SR } : r; } finally { SR = save; }
}
return { render, has: name => !!RENDER[name] };
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
const G = {};                // group gains
let master, busMusic, busAmb, busSfx, duckG, duckLP, comp, limiter, shaper, muteG, revSend, revRet, convolver;
let tap = null, tapBuf = null;
const layers = {};
const emitters = [];
const occChains = [];
const pendingLoops = new Set();
const liveLoops = new Set();
let listenerCam = null;
let stepPanL = null, stepPanR = null, stepSide = false, lastStepT = 0;
let dropPans = null;
let started = false;
let fireEvt = 1, fireS = 0, windT = 0, rainEvt = null;
const doorState = { front: false };
const DOORWAY = [3.75, 1.1, 4.95];
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
  if (!BUF[name] && res && res.ch && res.ch.length) BUF[name] = mkBuffer(res);
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
if(r)self.postMessage({name,ch:r.ch,sr:r.sr},r.ch.map(c=>c.buffer));else self.postMessage({name,error:err||'unknown'});}
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
// emitters: positional sources with a simple wall/floor occlusion model
// ---------------------------------------------------------------------------------------------------------------------
function occAmount(e) {
  let m;
  if (e.inH) {
    m = (1 - L.H) * (1 - 0.7 * L.leak);
    if (L.H > 0.01) m = Math.max(m, Math.abs((e.up ? 1 : 0) - L.U) * 0.6 * L.H);
  } else m = L.H * (1 - 0.7 * L.leak);
  return m;
}
function applyOcc(fNode, gNode, m, tau = 0.08, loss = 0.55, cutK = 0.04) {
  setP(fNode.frequency, 20000 * Math.pow(cutK, m), tau);    // default 20 kHz → 800 Hz
  setP(gNode.gain, 1 - loss * m, tau);
}
function makeEmitter(o) {
  const e = { x: o.x || 0, y: o.y || 0, z: o.z || 0, input: gainNode(1), occ: filt('lowpass', 20000, 0.5), occG: gainNode(1),
    panner: ctx.createPanner(), out: o.out || G[o.group || 'sfx'], follow: !!o.follow, persistent: o.persistent !== false };
  const p = e.panner;
  p.panningModel = o.model || 'HRTF'; p.distanceModel = 'inverse';
  p.refDistance = o.ref || 1; p.rolloffFactor = o.rolloff === undefined ? 1 : o.rolloff; p.maxDistance = o.max || 100;
  e.input.connect(e.occ); e.occ.connect(e.occG); e.occG.connect(p); p.connect(e.out);
  e.setPosition = (x, y, z) => {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    e.x = x; e.y = y; e.z = z; setPannerPos(p, x, y, z); e.inH = inHouse(x, y, z); e.up = e.inH && y > 2.9;
  };
  e.setPosition(e.x, e.y, e.z);
  const m = occAmount(e);
  e.occ.frequency.value = e.occ.frequency._v = 20000 * Math.pow(0.04, m);
  e.occG.gain.value = e.occG.gain._v = 1 - 0.55 * m;
  e.dispose = () => {
    if (e.dead) return; e.dead = true;
    for (const nd of [e.input, e.occ, e.occG, p]) { try { nd.disconnect(); } catch (err) { /* already */ } }
    const i = emitters.indexOf(e); if (i >= 0) emitters.splice(i, 1);
  };
  if (e.persistent) emitters.push(e);
  return e;
}
function makeOccChain(dest, loss = 0.55, cutK = 0.04) {
  const oc = { f: filt('lowpass', 20000, 0.5), g: gainNode(1), loss, cutK };
  oc.f.connect(oc.g); oc.g.connect(dest); oc.input = oc.f;
  occChains.push(oc);
  return oc;
}

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
    em = makeEmitter({ x: o.pos[0], y: o.pos[1], z: o.pos[2], out: o.out || G[o.group || 'sfx'], ref: o.ref || 1.2, rolloff: o.rolloff || 1, persistent: false });
    g.connect(em.input);
  } else if (typeof o.pan === 'number') {
    pan = ctx.createStereoPanner(); pan.pan.value = clamp(o.pan, -1, 1); g.connect(pan); pan.connect(o.out || G[o.group || 'sfx']);
  } else g.connect(o.out || G[o.group || 'sfx']);
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
  latch: 'click', squeak: 'creak', fwoosh: 'whoosh', cat: 'meow', water: 'splash', drop: 'drop0', pop: 'pop0' };
function play(name, opts = {}) {
  if (!ctx || !name) return null;
  let n = ALIAS[name] || name;
  if (n === 'floor_creak') n = 'floor_creak' + ((Math.random() * 3) | 0);
  if (n.startsWith('step_') && !hasSound(n)) n = `step_${SURF[n.slice(5)] || 'wood'}_${(Math.random() * STEP_VARIANTS) | 0}`;
  const buf = getBuf(n);
  if (!buf) { C.log('audio', 'unknown sound ' + name); return null; }
  const base = SFX_GAIN[name] || SFX_GAIN[n] || SFX_GAIN[n.replace(/\d+$/, '')] || 0.3;
  const vol = opts.volume === undefined ? 1 : clamp(+opts.volume || 0, 0, 4);
  const pos = posOf(opts);
  return voice(buf, { gain: base * vol * mr(0.92, 1.05), rate: (opts.rate || 1) * mr(0.97, 1.03), pos, ref: opts.ref || 1.3, rolloff: opts.rolloff || 1,
    group: opts.bus === 'ambience' ? 'loops' : 'sfx', pan: opts.pan, when: opts.delay ? ctx.currentTime + opts.delay : 0 });
}

// generic positional loop -------------------------------------------------------------------------------------------
const LOOPS = { rain: ['rainWash'], rain_glass: ['glass'], glass: ['glass'], window: ['glass'], roof: ['roof'], drip: ['drip'], drips: ['drip'],
  fire: ['fireBed', 'fireCrackle'], fireplace: ['fireBed', 'fireCrackle'], crackle: ['fireCrackle'], embers: ['fireCrackle'], gutter: ['gutter'],
  stream: ['gutter'], trickle: ['gutter'], water: ['gutter'], wind: ['wind'], boil: ['boil'], simmer: ['simmer'], purr: ['purr'], clock: ['clock'],
  tick: ['clock'], hum: ['hum'], fridge: ['hum'], steam: ['steam'], vinyl: ['vinyl'], porch: ['porch'] };
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
  if (!names) { C.log('audio', 'unknown loop ' + h.name); return; }
  if (!names.every(n => BUF[n])) { h.waiting = true; whenAll(names, () => { h.waiting = false; if (!h.stopped && !h.live) materialize(h); }); return; }
  const bus = h.opts.bus === 'sfx' ? G.loopsSfx : h.opts.bus === 'music' ? G.music : G.loops;
  const g = gainNode(0);
  let em = null;
  if (h.pos) { em = makeEmitter({ x: h.pos[0], y: h.pos[1], z: h.pos[2], out: bus, ref: h.opts.ref || 1, rolloff: h.opts.rolloff || 1.2 }); g.connect(em.input); }
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
  convolver = ctx.createConvolver(); whenBuf('ir', b => { if (b) convolver.buffer = b; }, true);
  revSend = gainNode(1); revRet = gainNode(0.15);
  busSfx.connect(revSend); busMusic.connect(revSend); revSend.connect(convolver); convolver.connect(revRet); revRet.connect(master);
  for (const [name, bus] of [['rain', busAmb], ['wind', busAmb], ['thunder', busAmb], ['fire', busAmb], ['clock', busAmb], ['loops', busAmb],
    ['music', busMusic], ['sfx', busSfx], ['steps', busSfx], ['kettle', busSfx], ['purr', busSfx], ['loopsSfx', busSfx]]) { G[name] = gainNode(1); G[name].connect(bus); }
  stepPanL = ctx.createStereoPanner(); stepPanL.pan.value = -0.12; stepPanL.connect(G.steps);
  stepPanR = ctx.createStereoPanner(); stepPanR.pan.value = 0.12; stepPanR.connect(G.steps);
  layers.dropG = gainNode(1); layers.dropG.connect(G.rain);
  dropPans = [-0.75, -0.3, 0.3, 0.75].map(p => { const s = ctx.createStereoPanner(); s.pan.value = p; s.connect(layers.dropG); return s; });
  layers.windOcc = makeOccChain(G.wind);
  layers.thunderOcc = makeOccChain(G.thunder, 0.2, 0.03);
}
function applySettings() {
  if (!ctx) return;
  const s = C.settings || {}, v = (x, d) => { const n = +x; return clamp(isFinite(n) ? n : d, 0, 1); };
  setP(master.gain, Math.pow(v(s.masterVolume, 0.8), 2), 0.05);
  setP(busMusic.gain, Math.pow(v(s.musicVolume, 0.7), 2) / 0.49, 0.05);
  setP(busAmb.gain, Math.pow(v(s.ambienceVolume, 0.9), 2) / 0.81, 0.05);
  setP(busSfx.gain, Math.pow(v(s.sfxVolume, 0.8), 2) / 0.64, 0.05);
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

// ambience layers start as soon as their buffers arrive from the render worker (rain first); everything else is
// pre-rendered in the background so later sounds never cause a hitch.
function startAmbience() {
  request(['rainWash', 'rainTicksA', 'rainTicksB', 'rainLow', 'fireBed', 'fireCrackle', 'clock', 'roof', 'porch', 'glass', 'gutter', 'wind']);
  const later = [];
  for (let k = 0; k < 8; k++) later.push('drop' + k, 'pop' + k);
  later.push('thunderMid', 'thunderFar1', 'thunderClose', 'thunderFar2');
  for (const s of ['wood', 'rug', 'stairs', 'tile', 'porch', 'grass', 'stone', 'gravel', 'mud', 'carpet', 'water']) for (let k = 0; k < STEP_VARIANTS; k++) later.push(`step_${s}_${k}`);
  later.push('floor_creak0', 'floor_creak1', 'floor_creak2', 'chair_creak', 'cushion', ...Object.keys(SFX_GAIN).filter(k => hasSound(k)));
  later.push('simmer', 'boil', 'steam', 'purr', 'drip', 'hum', ...musicSampleNames());
  request(later);
  whenAll(later, () => { A._warm = true; });
  whenBuf('rainWash', () => {        // outdoor dense wash + muffled indoor copy + open-door leak
    layers.lpA = filt('lowpass', 750, 0.7); layers.lpB = filt('lowpass', 750, 0.7);
    layers.lpA.connect(layers.lpB); layers.lpB.connect(G.rain);
    layers.wash = loopSource('rainWash', G.rain, 0, 0);
    layers.inside = loopSource('rainWash', layers.lpA, 0, 0.46);
    const em = makeEmitter({ x: DOORWAY[0], y: DOORWAY[1], z: DOORWAY[2] + 0.4, group: 'rain', model: 'equalpower', ref: 1.5, rolloff: 1 });
    const hp = filt('highpass', 250, 0.7); hp.connect(em.input);
    layers.leak = loopSource('rainWash', hp, 0, 0.71);
  });
  whenAll(['rainTicksA', 'rainTicksB'], () => {
    const g = gainNode(0); g.connect(G.rain); layers.ticks = { gain: g.gain };
    loopSource('rainTicksA', g, 1, 0); loopSource('rainTicksB', g, 1, 0.3);
  });
  whenBuf('rainLow', () => { const lp = filt('lowpass', 220, 0.6); lp.connect(G.rain); layers.low = loopSource('rainLow', lp, 0, 0); });
  whenBuf('roof', () => { layers.roof = loopSource('roof', G.rain, 0, 0); });
  whenBuf('porch', () => { layers.porch = loopSource('porch', G.rain, 0, 0); });
  whenBuf('glass', () => {           // skylights sk_1..sk_3 (glass centre on the roof underside)
    layers.glass = [[-5.45, 1.75], [-2.85, 1.75], [4.25, -1.75]].map(([x, z], i) => {
      const em = makeEmitter({ x, y: 7.5 - 0.7 * Math.abs(z), z, group: 'rain', model: 'equalpower', ref: 1.2, rolloff: 1.2 });
      return loopSource('glass', em.input, 0, i * 0.33, 1 + (i - 1) * 0.04);
    });
  });
  whenBuf('gutter', () => {          // gutter trickle + downspout gurgle at the four outlets
    layers.gutters = [[-7.1, 5.15], [7.1, 5.15], [-7.1, -5.15], [7.1, -5.15]].map(([x, z], i) => {
      const em = makeEmitter({ x, y: -0.3, z, group: 'rain', model: 'equalpower', ref: 0.9, rolloff: 1.3 });
      return loopSource('gutter', em.input, 0, i * 0.27, 0.92 + i * 0.05);
    });
  });
  whenBuf('wind', () => {            // gust-modulated band-passed noise + a faint whistle
    const bp = filt('bandpass', 400, 0.8); bp.connect(layers.windOcc.input);
    const bp2 = filt('bandpass', 900, 6); bp2.connect(layers.windOcc.input);
    const w = loopSource('wind', bp, 0, 0), wh = loopSource('wind', bp2, 0, 0.5);
    w.bp = bp; wh.bp = bp2; layers.whistle = wh; layers.wind = w;
  });
  whenAll(['fireBed', 'fireCrackle'], () => {
    const em = makeEmitter({ x: -6.25, y: 0.55, z: 2.5, group: 'fire', ref: 1.3, rolloff: 1.0 });
    layers.fireEm = em;
    layers.fireCr = loopSource('fireCrackle', em.input, 0, 0);
    layers.fireBed = loopSource('fireBed', em.input, 0, 0);
  });
  whenBuf('clock', () => {
    const em = makeEmitter({ x: 2.35, y: 1.2, z: -0.3, group: 'clock', ref: 0.9, rolloff: 1.2 });
    layers.clock = loopSource('clock', em.input, LV.clock, 0);
  });
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
  for (const h of pendingLoops) materialize(h);
  pendingLoops.clear();
  if (MUS.want) musicPlay();
}
function onFootstep(p) {
  if (!ctx || !p || p.surface === 'none') return;
  const now = ctx.currentTime;
  if (now - lastStepT < 0.07) return;
  lastStepT = now;
  const s = SURF[p.surface] || 'wood';
  const buf = getBuf(`step_${s}_${(Math.random() * STEP_VARIANTS) | 0}`);
  const g = STEP_GAIN[s] * (p.run ? 1.3 : 1) * (p.crouch ? 0.45 : 1) * mr(0.8, 1.05) * (p.volume === undefined ? 1 : p.volume);
  stepSide = !stepSide;
  voice(buf, { out: stepSide ? stepPanL : stepPanR, gain: g, rate: mr(0.95, 1.05) * (p.run ? 1.04 : 1) * (p.crouch ? 0.95 : 1) });
  const creakP = s === 'wood' ? 0.07 : s === 'stairs' ? 0.14 : s === 'porch' ? 0.06 : 0;
  if (creakP && Math.random() < creakP * (p.crouch ? 1.5 : 1)) {
    voice(getBuf('floor_creak' + ((Math.random() * 3) | 0)), { out: stepSide ? stepPanL : stepPanR, gain: SFX_GAIN.floor_creak * mr(0.6, 1.1), rate: mr(0.85, 1.15), when: now + mr(0.03, 0.09), low: true });
  }
}
function onJump(p) {
  if (!ctx) return;
  onFootstep({ surface: (p && p.surface) || C.player.surface, volume: 0.6 });
  play('whoosh', { volume: 0.25, rate: 1.4 });
}
function onLand(p) {
  if (!ctx) return;
  const sp = p && isFinite(p.speed) ? p.speed : 3.5, s = SURF[(p && p.surface) || C.player.surface] || 'wood', k = clamp(sp / 4.5, 0.4, 1.5);
  const b = () => getBuf(`step_${s}_${(Math.random() * STEP_VARIANTS) | 0}`);
  voice(b(), { out: stepPanL, gain: STEP_GAIN[s] * 1.15 * k, rate: mr(0.82, 0.9) });
  voice(b(), { out: stepPanR, gain: STEP_GAIN[s] * 0.8 * k, rate: mr(0.85, 0.95), when: ctx.currentTime + 0.035 });
  lastStepT = ctx.currentTime;
}
function onLightning(p) {
  if (!ctx) return;
  const d = clamp(p && isFinite(p.distance) ? +p.distance : 2.5, 0.05, 20), s = clamp(p && isFinite(p.strength) ? +p.strength : 0.7, 0, 1);
  const delay = Math.min(d * 3, 9);
  const kind = d < 1.2 ? 'close' : d < 3.2 ? 'mid' : 'far';
  const name = kind === 'close' ? 'thunderClose' : kind === 'mid' ? 'thunderMid' : (Math.random() < 0.5 ? 'thunderFar1' : 'thunderFar2');
  const at = ctx.currentTime + delay;
  const lvl = LV.thunder * (0.45 + 0.55 * s) * clamp(1.25 / (0.8 + d * 0.3), 0.3, 1.1);
  let pan = 0;
  if (p && isFinite(p.dirX) && isFinite(p.dirZ)) { const rx = -L.fz, rz = L.fx, rl = Math.hypot(rx, rz) || 1, dl = Math.hypot(p.dirX, p.dirZ) || 1; pan = clamp((p.dirX * rx + p.dirZ * rz) / (rl * dl), -1, 1) * 0.55; }
  whenBuf(name, buf => { if (buf && ctx.currentTime < at + 1.5) voice(buf, { out: layers.thunderOcc.input, gain: lvl, rate: mr(0.9, 1.08), when: at, pan }); }, true);
}
function onDoor(p) {
  if (!p) return;
  const id = p.id || '';
  if (id === 'door_front') doorState.front = !!p.open;
  if (!ctx) return;
  const pos = posOf(p);
  const o = pos ? { x: pos[0], y: pos[1], z: pos[2] } : {};
  if (id === 'gate') play('gate', o);
  else play(p.open ? 'door_open' : 'door_close', o);
}
function onSit(p) {
  if (!ctx) return;
  const id = (p && p.id) || '';
  if (/chair|bench|rocker|stool/.test(id) && !/arm/.test(id)) play('chair_creak', { volume: 0.9 });
  else play('cushion', { volume: 1 });
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
function mixRain() {
  const r = L.rain, H = L.H, U = L.U, P = L.P, leak = L.leak;
  const O = (1 - H) + H * 0.22 * leak;                              // how exposed the listener is to the open sky
  if (layers.wash) setP(layers.wash.gain, LV.wash * O * Math.pow(r, 1.3) * (1 - 0.25 * P), 0.12);
  if (layers.ticks) setP(layers.ticks.gain, LV.ticks * O * Math.sqrt(r) * (1 - 0.3 * P), 0.12);
  if (layers.low) setP(layers.low.gain, LV.low * (O + H * 0.25) * r * r, 0.12);
  if (layers.inside) {
    setP(layers.inside.gain, LV.inside * H * Math.pow(r, 1.1) * (1 - 0.5 * U), 0.12);
    const f = 750 + 2600 * leak; setP(layers.lpA.frequency, f, 0.1); setP(layers.lpB.frequency, f, 0.1);
  }
  if (layers.roof) setP(layers.roof.gain, LV.roof * H * r * (0.08 + 0.92 * U), 0.12);
  if (layers.porch) setP(layers.porch.gain, LV.porch * r * (P + H * leak * 0.35), 0.12);
  if (layers.leak) setP(layers.leak.gain, LV.leak * H * L.front * r, 0.12);
  if (layers.glass) for (const gl of layers.glass) if (gl) setP(gl.gain, LV.glass * H * U * r, 0.12);
  if (layers.gutters) for (const gu of layers.gutters) if (gu) setP(gu.gain, LV.gutter * Math.pow(r, 0.8), 0.2);
}
function mixWind(dt) {
  if (!layers.wind) return;
  windT += dt;
  const w = C.env && C.env.wind, ws = w ? Math.hypot(w.x || 0, w.z || 0) : 0.38, W = clamp(ws / 0.5, 0, 1.6);
  const nz = C.util && C.util.noise2D ? C.util.noise2D(windT * 0.09, 3.7) : Math.sin(windT * 0.31) * Math.sin(windT * 0.13);
  const nz2 = C.util && C.util.noise2D ? C.util.noise2D(windT * 0.23, 9.1) : Math.sin(windT * 0.71);
  const gust = clamp(0.5 + 0.45 * nz + 0.2 * nz2, 0, 1);
  setP(layers.wind.gain, LV.wind * W * (0.3 + 0.7 * gust * gust), 0.3);
  setP(layers.wind.bp.frequency, 260 + 420 * gust, 0.3);
  setP(layers.whistle.gain, LV.whistle * W * Math.max(0, gust - 0.55) * 2.2 * (1 + L.H * 0.5), 0.3);
  setP(layers.whistle.bp.frequency, 820 + 380 * gust, 0.3);
}
function mixFire(dt) {
  if (!layers.fireBed) return;
  const tgt = clamp(C.env && isFinite(C.env.fireLevel) ? C.env.fireLevel : fireEvt, 0, 1.5);
  fireS += (tgt - fireS) * (1 - Math.exp(-dt * 1.5));
  setP(layers.fireBed.gain, LV.fireBed * fireS, 0.2);
  setP(layers.fireCr.gain, LV.fireCrackle * Math.min(1, fireS) * (0.6 + 0.4 * fireS), 0.2);
  if (fireS > 0.05 && Math.random() < dt * 1.1 * fireS) {
    voice(getBuf('pop' + ((Math.random() * 8) | 0)), { out: layers.fireEm.input, gain: LV.pop * Math.pow(Math.random(), 1.5) * Math.min(1.2, fireS), rate: mr(0.85, 1.2), low: true });
  }
}
function drops(dt) {
  if (!dropPans) return;
  const rate = L.rain * ((1 - L.H) * 5 + L.P * 4);
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
  mixRain(); mixWind(dt); mixFire(dt); drops(dt);
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    if (e.follow) e.setPosition(L.x + L.fx * 0.3, L.y, L.z + L.fz * 0.3);
    applyOcc(e.occ, e.occG, occAmount(e));
  }
  const mOut = L.H * (1 - 0.7 * L.leak);
  for (const oc of occChains) applyOcc(oc.f, oc.g, mOut, 0.15, oc.loss, oc.cutK);
  setP(revRet.gain, 0.06 + 0.12 * L.H, 0.3);
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
  for (const k of Object.keys(G)) { const v = !set || set.has(k) ? 1 : 0; G[k].gain.cancelScheduledValues(0); G[k].gain.value = v; G[k].gain._v = v; }
}
function debugStats() {
  return { state: ctx ? ctx.state : 'none', sampleRate: ctx ? ctx.sampleRate : 0, renderSR: SR, baseLatency: ctx ? ctx.baseLatency : 0,
    voices: stats.voices, peakVoices: stats.peakVoices, created: stats.created, loops: stats.loops, emitters: emitters.length,
    musicActive: MUS.active.size, rt: stats.rt, liveLoops: liveLoops.size, buffers: Object.keys(BUF).length, renderMs: +stats.renderMs.toFixed(1),
    updAvgMs: stats.updN ? +(stats.updMs / stats.updN).toFixed(4) : 0, updMaxMs: +stats.updMax.toFixed(3), pending: fallbackQ.length + Object.keys(waiters).length, worker: !!worker, workerRenders: stats.workerRenders, mainRenders: stats.mainRenders,
    listener: { H: +L.H.toFixed(2), U: +L.U.toFixed(2), P: +L.P.toFixed(2), leak: +L.leak.toFixed(2), rain: +L.rain.toFixed(2) } };
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
      _debug: { stats: debugStats, meter, solo, getBuf: n => !!getBuf(n), layers, LV, STEP_GAIN, SFX_GAIN, MUS,
        resetPeak() { stats.peakVoices = stats.voices; stats.updMax = 0; stats.updMs = 0; stats.updN = 0; },
        warm: () => new Promise(r => { const chk = () => (A._warm ? r(true) : setTimeout(chk, 50)); chk(); }) },
    });
    Object.assign(A.music, { playing: !!A.music.playing, play: musicPlay, stop: musicStop, toggle() { if (MUS.want) musicStop(); else musicPlay(); },
      setPosition(x, y, z) {
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
        MUS.pos = [x, y, z];
        if (MUS.em) { MUS.em.follow = false; MUS.em.setPosition(x, y, z); }
      } });
    Object.assign(A.kettle, { start: kettleStart, stop: kettleStop, get on() { return KET.on; } });
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
    C.on('stand', () => { if (ctx) play('cushion', { volume: 0.6, rate: 1.1 }); });
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

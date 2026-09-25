// Offline render of the procedural sounds in src/audio.js (no browser): runs the self-contained DSPLIB in Node,
// checks every buffer for NaN/Inf, clipping, loop-seam clicks and render time, and can write WAVs to listen to.
//   node tools/audiorender.mjs                      -> table of all sounds
//   node tools/audiorender.mjs --only rain,thunder  -> names containing any of the tokens
//   node tools/audiorender.mjs --wav build/wav      -> also write <name>.wav files
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? true : v; };
const only = (arg('only', '') || '').toString().split(',').filter(Boolean);
const wavDir = arg('wav', null);
const SR = +arg('sr', 48000);

const src = fs.readFileSync(path.join(ROOT, 'src', 'audio.js'), 'utf8');
const m = src.match(/function DSPLIB\(SR0\) \{[\s\S]*?\r?\n\} \/\/ =+ end DSPLIB/);
if (!m) { console.error('[audiorender] DSPLIB not found in src/audio.js'); process.exit(2); }
const DSPLIB = new Function('return (' + m[0].replace(/\s*\/\/ =+ end DSPLIB$/, '') + ')')();
const lib = DSPLIB(SR);
const names = (lib.names ? lib.names() : []).filter(n => !only.length || only.some(t => n.includes(t)));
if (wavDir) fs.mkdirSync(path.resolve(ROOT, wavDir), { recursive: true });

function writeWav(file, chs, sr) {
  const n = chs[0].length, c = chs.length, data = Buffer.alloc(n * c * 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chs[k][i] * 32767))), (i * c + k) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(c, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * c * 2, 28); h.writeUInt16LE(c * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const rows = [], bad = [];
let total = 0;
for (const name of names) {
  const t0 = performance.now();
  let r = null, err = null;
  try { r = lib.render(name); } catch (e) { err = e.message; }
  const ms = performance.now() - t0; total += ms;
  if (!r || !r.ch || !r.ch.length) { bad.push(`${name}: ${err || 'no output'}`); continue; }
  let peak = 0, ss = 0, nan = 0, cnt = 0, seam = 0, dd = 0;
  for (const x of r.ch) {
    for (let i = 0; i < x.length; i++) { const v = x[i]; if (!Number.isFinite(v)) { nan++; continue; } const a = Math.abs(v); if (a > peak) peak = a; ss += v * v; cnt++; if (i) { const d = v - x[i - 1]; dd += d * d; } }
    seam = Math.max(seam, Math.abs(x[0] - x[x.length - 1]));
  }
  const rms = Math.sqrt(ss / Math.max(1, cnt)), dRms = Math.sqrt(dd / Math.max(1, cnt));
  const seamK = dRms > 0 ? seam / dRms : 0;          // wrap discontinuity vs typical sample-to-sample step
  const row = { name, ch: r.ch.length, sr: r.sr, sec: +(r.ch[0].length / r.sr).toFixed(2), ms: +ms.toFixed(1),
    peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms + 1e-12)).toFixed(1), seamK: +seamK.toFixed(1) };
  rows.push(row);
  if (nan) bad.push(`${name}: ${nan} non-finite samples`);
  // one-shots are peak-normalised (≤ 0.9); sparse loop textures are RMS-normalised float buffers and may exceed 1
  if (peak > 3) bad.push(`${name}: peak ${peak.toFixed(3)} > 3`);
  if (wavDir) writeWav(path.resolve(ROOT, wavDir, name + '.wav'), r.ch, r.sr);
}
console.table(rows);
console.log(`[audiorender] ${rows.length} sounds, ${(total / 1000).toFixed(2)} s total render time at ${SR} Hz`);
if (bad.length) { console.log('[audiorender] PROBLEMS:\n  ' + bad.join('\n  ')); process.exit(1); }

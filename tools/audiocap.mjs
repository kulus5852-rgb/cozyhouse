// Headless audio capture: loads a build in Chrome, runs a scripted listening scenario from the scratch module
// build/audio_cap.js (append it with `--extra build/audio_cap.js`) and writes the master mix (post limiter, pre mute)
// to a 16-bit WAV plus a loudness summary.
//   node tools/build.mjs --out build/audiocap.html --extra build/audio_cap.js
//   node tools/audiocap.mjs --html build/audiocap.html --scenario tour --out shots/audio/cap
// Flags: --chrome <path> (or CHROME_PATH), --params "rain=1", --w 480 --h 270, --timeout 240000
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? true : v; };

const CHROME = [arg('chrome', null), process.env.CHROME_PATH,
  path.join(os.homedir(), '.agent-browser/browsers/chrome-152.0.7977.42/chrome'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && fs.existsSync(p));
const htmlPath = path.resolve(ROOT, arg('html', 'build/audiocap.html'));
const scenario = arg('scenario', 'tour');
const outDir = path.resolve(ROOT, arg('out', 'shots/audio/cap'));
const prefix = arg('prefix', '') === true ? '' : arg('prefix', '');
const params = arg('params', '') === true ? '' : arg('params', '');
const W = +arg('w', 480), H = +arg('h', 270), timeout = +arg('timeout', 240000);
// Linux containers without a GPU: ANGLE on Mesa llvmpipe via EGL (needs libegl-mesa0); elsewhere the default GPU path.
const GL = process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
if (!CHROME) { console.error('[audiocap] no Chrome found (use --chrome or CHROME_PATH)'); process.exit(2); }
if (!fs.existsSync(htmlPath)) { console.error('[audiocap] no such file ' + htmlPath); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

function wav(file, pcm16, sr, ch) {
  const data = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const url = 'file://' + (htmlPath.startsWith('/') ? '' : '/') + htmlPath.replace(/\\/g, '/') +
  '?debug=1&autostart=1&lightning=0&seed=7&quality=low' + (params ? '&' + params.replace(/^[?&]/, '') : '');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--headless=new', '--no-first-run', '--no-sandbox', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    '--disable-dev-shm-usage', ...GL, `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const report = { url, scenario, pageErrors: [], consoleErrors: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', e => report.pageErrors.push(String(e && (e.stack || e.message) || e).slice(0, 800)));
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 400)); });
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction('(window.COZY && window.COZY.ready === true) || window.__COZY_BOOT_FAILED', { timeout, polling: 200 });
  await page.waitForFunction('window.__CAP && window.COZY.audio && window.COZY.audio.ctx', { timeout: 30000, polling: 200 });
  const t0 = Date.now();
  const res = await page.evaluate(s => window.__CAP.run(s), scenario);
  report.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
  if (!res || !res.b64) throw new Error('scenario returned no audio: ' + JSON.stringify(res && res.error));
  const pcm = new Int16Array(new Uint8Array(Buffer.from(res.b64, 'base64')).buffer);
  const file = path.join(outDir, `${prefix}${scenario}.wav`);
  wav(file, pcm, res.sr, 2);
  Object.assign(report, { file: path.relative(ROOT, file), seconds: +(pcm.length / 2 / res.sr).toFixed(2), sr: res.sr, marks: res.marks, stats: res.stats,
    debug: await page.evaluate(() => { try { const s = window.COZY.audio._debug.stats(); delete s.rt; return s; } catch (e) { return null; } }),
    moduleErrors: await page.evaluate(() => (window.COZY.debug.errors || []).map(e => `${e.module}/${e.phase}: ${e.message}`)) });
} catch (e) {
  report.error = String(e && e.message || e);
} finally {
  await browser.close();
}
console.log('REPORT_JSON:' + JSON.stringify(report));
process.exit(report.error ? 1 : 0);

// Headless screenshot + runtime report tool (uses the real GPU via Chrome headless).
// Usage examples:
//   node tools/shot.mjs --html build/living.html --views living_overview,living_fireplace --outdir shots/living
//   node tools/shot.mjs --views all --params "time=night"
//   node tools/shot.mjs --views "living_*" --prefix night_ --params "time=night&rain=1"
//   node tools/shot.mjs --view "custom:1,1.6,2,1.57,-0.1" --eval "COZY.debug.interact('lamp_living_floor')"
//   node tools/shot.mjs --noshots --perf 3          (just load, report errors + perf)
// Flags: --w 1280 --h 720 --frames 20 (frames to wait per view) --wait 800 (ms after ready)
//        --timeout 60000 --colliders (draw collider wireframes) --freecam 0 (feet position instead of eye)
// The page is opened with ?debug=1&autostart=1&lightning=0&seed=7 plus --params.
// Prints a JSON report as the last line, prefixed by REPORT_JSON:
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { ROOT, CHROME, GPU_ARGS, pageUrl } from './chrome.mjs';

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
function args(name) { const r = []; argv.forEach((a, i) => { if (a === '--' + name && argv[i + 1] !== undefined) r.push(argv[i + 1]); }); return r; }

const htmlRel = arg('html', 'cozy-house.html');
const htmlPath = path.resolve(ROOT, htmlRel);
const W = +arg('w', 1280), H = +arg('h', 720);
const outdir = path.resolve(ROOT, arg('outdir', 'shots'));
const prefix = arg('prefix', '') === true ? '' : arg('prefix', '');
const frames = +arg('frames', 20);
const waitMs = +arg('wait', 800);
const timeout = +arg('timeout', 60000);
const params = arg('params', '') === true ? '' : arg('params', '');
const noshots = !!arg('noshots', false);
const perfSec = +(arg('perf', 0) === true ? 3 : arg('perf', 0));
const freecam = arg('freecam', '1') !== '0';
const colliders = !!arg('colliders', false);
const evals = args('eval');
const evalFile = arg('evalfile', null);

const allViews = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'views.json'), 'utf8'));
let views = [];
const viewArg = arg('views', noshots ? '' : 'spawn');
if (viewArg && viewArg !== true) {
  for (const tok of viewArg.split(',').map(s => s.trim()).filter(Boolean)) {
    if (tok === 'all') { views.push(...Object.keys(allViews).map(k => ({ name: k, ...allViews[k] }))); continue; }
    if (tok.includes('*')) {
      const re = new RegExp('^' + tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      Object.keys(allViews).filter(k => re.test(k)).forEach(k => views.push({ name: k, ...allViews[k] }));
      continue;
    }
    if (!allViews[tok]) { console.error(`[shot] unknown view "${tok}". Known: ${Object.keys(allViews).join(', ')}`); continue; }
    views.push({ name: tok, ...allViews[tok] });
  }
}
for (const v of args('view')) {
  const [name, nums] = v.includes(':') ? v.split(':') : ['custom', v];
  const [x, y, z, yaw = 0, pitch = 0] = nums.split(',').map(Number);
  views.push({ name, pos: [x, y, z], yaw, pitch });
}
if (noshots) views = [];

if (!fs.existsSync(htmlPath)) { console.error(`[shot] no such file ${htmlPath}`); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });

const url = pageUrl(htmlPath, 'debug=1&autostart=1&lightning=0&seed=7' +
  (colliders ? '&colliders=1' : '') + (params ? '&' + params.replace(/^[?&]/, '') : ''));

const report = { url, views: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [], ready: false };
const errCount = new Map(), warnCount = new Map();

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--headless=new', '--no-first-run', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    ...GPU_ARGS, `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on('console', m => {
    const t = m.type(); const text = m.text().slice(0, 600);
    if (t === 'error') errCount.set(text, (errCount.get(text) || 0) + 1);
    else if (t === 'warn' || t === 'warning') warnCount.set(text, (warnCount.get(text) || 0) + 1);
  });
  page.on('pageerror', e => report.pageErrors.push(String(e && (e.stack || e.message) || e).slice(0, 1200)));
  page.on('requestfailed', r => report.requestFailures.push(`${r.url().slice(0, 200)} ${r.failure() && r.failure().errorText}`));

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout });
  try {
    await page.waitForFunction('(window.COZY && window.COZY.ready === true) || window.__COZY_BOOT_FAILED', { timeout, polling: 100 });
    report.ready = await page.evaluate(() => !!(window.COZY && window.COZY.ready));
  } catch (e) { report.ready = false; report.readyError = 'timeout waiting for COZY.ready'; }
  report.bootMs = Date.now() - t0;
  await new Promise(r => setTimeout(r, waitMs));

  const evalCode = [...evals, ...(evalFile ? [fs.readFileSync(path.resolve(ROOT, evalFile), 'utf8')] : [])];
  for (const code of evalCode) {
    try { const r = await page.evaluate(`(async () => { ${code.includes('return') ? code : 'return (' + code + ')'} })()`); report.evalResults = (report.evalResults || []).concat([r === undefined ? null : r]); }
    catch (e) { report.evalResults = (report.evalResults || []).concat(['EVAL ERROR: ' + e.message]); }
    await new Promise(r => setTimeout(r, 300));
  }

  const hasDebug = await page.evaluate(() => !!(window.COZY && window.COZY.debug && window.COZY.debug.setView));
  for (const v of views) {
    const entry = { name: v.name };
    try {
      if (hasDebug) {
        await page.evaluate((v, fc) => window.COZY.debug.setView(v.pos[0], v.pos[1], v.pos[2], v.yaw || 0, v.pitch || 0, fc), v, freecam);
        if (v.eval) await page.evaluate(v.eval);
        await page.evaluate(n => (window.COZY.debug.waitFrames ? window.COZY.debug.waitFrames(n) : new Promise(r => setTimeout(r, n * 20))), frames);
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
      const file = path.join(outdir, `${prefix}${v.name}.png`);
      await page.screenshot({ path: file });
      entry.file = path.relative(ROOT, file).replace(/\\/g, '/');
      try { entry.info = await page.evaluate(() => { const i = window.COZY.debug.info(); return { drawCalls: i.drawCalls, triangles: i.triangles, fps: i.fps }; }); } catch (e) { }
    } catch (e) { entry.error = e.message.slice(0, 400); }
    report.views.push(entry);
  }

  if (perfSec > 0) {
    report.perfFps = await page.evaluate(sec => new Promise(r => {
      let n = 0; const t0 = performance.now();
      function f() { n++; if (performance.now() - t0 < sec * 1000) requestAnimationFrame(f); else r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); }
      requestAnimationFrame(f);
    }), perfSec);
  }
  try {
    report.info = await page.evaluate(() => window.COZY && window.COZY.debug && window.COZY.debug.info ? window.COZY.debug.info() : null);
    report.moduleErrors = await page.evaluate(() => window.COZY && window.COZY.debug ? (window.COZY.debug.errors || []).map(e => (typeof e === 'string' ? e : `${e.module || ''} ${e.phase || ''}: ${e.message || e}`).slice(0, 600)) : null);
  } catch (e) { report.infoError = e.message; }
} finally {
  await browser.close();
}
report.consoleErrors = [...errCount].map(([t, n]) => n > 1 ? `(x${n}) ${t}` : t).slice(0, 40);
report.consoleWarnings = [...warnCount].map(([t, n]) => n > 1 ? `(x${n}) ${t}` : t).slice(0, 25);
fs.writeFileSync(path.join(outdir, `${prefix}report.json`), JSON.stringify(report, null, 2));
const bad = report.pageErrors.length + report.consoleErrors.length + (report.moduleErrors ? report.moduleErrors.length : 0);
console.log(`[shot] ready=${report.ready} boot=${report.bootMs}ms views=${report.views.length} errors=${bad} -> ${path.relative(ROOT, outdir)}`);
for (const v of report.views) console.log(`  ${v.name}: ${v.file || v.error}${v.info ? `  (draws ${v.info.drawCalls}, tris ${v.info.triangles})` : ''}`);
if (report.pageErrors.length) console.log('PAGE ERRORS:\n  ' + report.pageErrors.join('\n  '));
if (report.consoleErrors.length) console.log('CONSOLE ERRORS:\n  ' + report.consoleErrors.join('\n  '));
if (report.moduleErrors && report.moduleErrors.length) console.log('MODULE ERRORS:\n  ' + report.moduleErrors.join('\n  '));
if (report.requestFailures.length) console.log('REQUEST FAILURES:\n  ' + report.requestFailures.join('\n  '));
console.log('REPORT_JSON:' + JSON.stringify({ ready: report.ready, bootMs: report.bootMs, perfFps: report.perfFps, info: report.info, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, moduleErrors: report.moduleErrors ? report.moduleErrors.length : null, evalResults: report.evalResults }));

// Deterministic walk / collision tests driven through COZY.debug.simulate (implemented by the player module).
// Usage: node tools/walktest.mjs [--html cozy-house.html] [--only name1,name2] [--params "k=v"]
// Each scenario in tools/walktests.json:
//   { name, reload?, pre?: "js run in page before (e.g. open a door)", preWait?: ms,
//     from?: [x,y,z] feet (omit = continue from current state), yaw?, pitch?,
//     sequence: [ { keys: ["KeyW"], seconds, expect?: [...] }, ... ],
//     expect: ["x > 2.6", ...]  // JS expressions over: x y z maxY minY mode grounded surface r
//   }
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? true : v; }

const htmlPath = path.resolve(ROOT, arg('html', 'cozy-house.html'));
const only = arg('only', null);
const params = arg('params', '') === true ? '' : arg('params', '');
let tests = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'walktests.json'), 'utf8'));
if (only && only !== true) { const s = new Set(only.split(',')); tests = tests.filter(t => s.has(t.name)); }
const url = 'file:///' + htmlPath.replace(/\\/g, '/') + '?debug=1&autostart=1&lightning=0&seed=7' + (params ? '&' + params : '');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--headless=new', '--no-first-run', '--allow-file-access-from-files', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 960, height: 540 } });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 400)));
async function load() {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('(window.COZY && window.COZY.ready === true) || window.__COZY_BOOT_FAILED', { timeout: 60000, polling: 100 });
  await new Promise(r => setTimeout(r, 400));
}
function check(exprs, r) {
  const fails = [];
  for (const e of exprs || []) {
    let ok = false;
    try { ok = !!Function('r', 'x', 'y', 'z', 'maxY', 'minY', 'mode', 'grounded', 'surface', `return (${e});`)(r, r.x, r.y, r.z, r.maxY, r.minY, r.mode, r.grounded, r.surface); }
    catch (err) { fails.push(`${e}  [threw ${err.message}]`); continue; }
    if (!ok) fails.push(e);
  }
  return fails;
}

const results = [];
try {
  await load();
  const hasSim = await page.evaluate(() => !!(window.COZY && COZY.debug && typeof COZY.debug.simulate === 'function'));
  if (!hasSim) { console.log('FAIL: COZY.debug.simulate is not available (player module missing?)'); }
  let first = true;
  for (const t of tests) {
    if (!hasSim) { results.push({ name: t.name, pass: false, fails: ['no simulate()'] }); continue; }
    try {
      if (t.reload && !first) await load();
      first = false;
      if (t.pre) { await page.evaluate(t.pre); await new Promise(r => setTimeout(r, t.preWait || 900)); }
      let agg = null; const stepFails = [];
      for (let i = 0; i < t.sequence.length; i++) {
        const s = t.sequence[i];
        const opts = { keys: s.keys || [], seconds: s.seconds };
        if (i === 0 && t.from) { opts.from = t.from; }
        if (i === 0 && t.yaw !== undefined) opts.yaw = t.yaw;
        if (i === 0 && t.pitch !== undefined) opts.pitch = t.pitch;
        const r = await page.evaluate(o => { const res = COZY.debug.simulate(o); return JSON.parse(JSON.stringify(res)); }, opts);
        agg = agg ? { ...r, maxY: Math.max(agg.maxY, r.maxY), minY: Math.min(agg.minY, r.minY) } : r;
        stepFails.push(...check(s.expect, r).map(f => `step${i}: ${f}`));
      }
      const fails = stepFails.concat(check(t.expect, agg));
      results.push({ name: t.name, pass: fails.length === 0, fails, final: { x: +agg.x.toFixed(3), y: +agg.y.toFixed(3), z: +agg.z.toFixed(3), maxY: +(agg.maxY ?? NaN).toFixed(3), mode: agg.mode, grounded: agg.grounded, surface: agg.surface } });
    } catch (e) {
      results.push({ name: t.name, pass: false, fails: ['exception: ' + e.message.slice(0, 300)] });
    }
  }
} finally { await browser.close(); }

let passN = 0;
for (const r of results) {
  if (r.pass) passN++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.final ? JSON.stringify(r.final) : ''}${r.fails.length ? '\n      failed: ' + r.fails.join(' | ') : ''}`);
}
if (pageErrors.length) console.log('PAGE ERRORS:\n  ' + [...new Set(pageErrors)].join('\n  '));
console.log(`\n${passN}/${results.length} walk tests passed`);
console.log('REPORT_JSON:' + JSON.stringify({ passed: passN, total: results.length, failed: results.filter(r => !r.pass).map(r => ({ name: r.name, fails: r.fails, final: r.final })) }));
process.exit(passN === results.length ? 0 : 1);

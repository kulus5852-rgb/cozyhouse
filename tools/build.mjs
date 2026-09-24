// Build: inlines src/*.js modules into a single self-contained HTML file.
// Usage:
//   node tools/build.mjs                         -> cozy-house.html (all modules)
//   node tools/build.mjs --only house,living --out build/living.html
//   node tools/build.mjs --exclude cat --out build/x.html
//   node tools/build.mjs --strict                -> fail on any syntax error / missing module
// core, materials and props are always included (unless --bare).
//   --extra build/scratch_test.js[,more.js]   -> append scratch test modules (never put scratch files in src/)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const ORDER = ['core', 'materials', 'props', 'house', 'player', 'weather', 'outdoor', 'audio',
  'living', 'kitchen', 'hallstudy', 'loft', 'cat', 'post'];
const ALWAYS = ['core', 'materials', 'props'];

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}

const only = arg('only', null);
const exclude = (arg('exclude', '') || '').toString().split(',').filter(Boolean);
const bare = !!arg('bare', false);
const strict = !!arg('strict', false);
const out = path.resolve(ROOT, arg('out', 'cozy-house.html'));
const extra = (arg('extra', '') || '').toString().split(',').map(s => s.trim()).filter(Boolean); // scratch test modules (paths), appended last

let wanted = ORDER.slice();
if (only && only !== true) {
  const set = new Set(only.split(',').map(s => s.trim()).filter(Boolean));
  if (!bare) ALWAYS.forEach(a => set.add(a));
  set.add('core');
  wanted = ORDER.filter(m => set.has(m));
  for (const m of set) if (!ORDER.includes(m)) console.warn(`[build] WARNING unknown module "${m}" (not in ORDER)`);
}
wanted = wanted.filter(m => !exclude.includes(m) || m === 'core');

const templatePath = path.join(ROOT, 'src', 'template.html');
const template = fs.readFileSync(templatePath, 'utf8');
if (!template.includes('<!-- MODULES -->')) { console.error('[build] template missing <!-- MODULES --> marker'); process.exit(2); }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozybuild-'));
const included = [], skipped = [], broken = [];
let tags = '';
for (const m of wanted) {
  const file = path.join(ROOT, 'src', m + '.js');
  if (!fs.existsSync(file)) { skipped.push(m); continue; }
  let code = fs.readFileSync(file, 'utf8');
  // syntax check as an ES module
  const tmp = path.join(tmpDir, m + '.mjs');
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').split('\n').slice(0, 8).join('\n');
    broken.push({ m, msg });
    console.error(`[build] SYNTAX ERROR in src/${m}.js -> module ${strict ? 'FAILS BUILD' : 'EXCLUDED'}\n${msg}`);
    continue;
  }
  // make inline-safe
  code = code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  tags += `<script type="module" data-module="${m}">\n${code}\n</script>\n`;
  included.push(`${m}(${(code.length / 1024).toFixed(1)}k)`);
}
for (const e of extra) {
  const file = path.resolve(ROOT, e);
  if (!fs.existsSync(file)) { console.error('[build] extra not found: ' + e); continue; }
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  tags += `<script type="module" data-module="extra:${path.basename(file)}">\n${code}\n</script>\n`;
  included.push('extra:' + path.basename(file));
}
tags += `<script type="module" data-module="boot">\nif (window.COZY && typeof window.COZY.boot === 'function') { window.COZY.boot(); } else { window.__COZY_BOOT_FAILED = true; const el = document.getElementById('boot-loading'); if (el) el.querySelector('.msg').textContent = 'Engine failed to start (core module missing or broken).'; }\n</script>`;
fs.rmSync(tmpDir, { recursive: true, force: true });

if (strict && (broken.length || skipped.length)) {
  console.error(`[build] STRICT: broken=[${broken.map(b => b.m)}] missing=[${skipped}]`);
  process.exit(1);
}
const html = template.replace('<!-- MODULES -->', tags);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`[build] wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`[build] included: ${included.join(', ')}`);
if (skipped.length) console.log(`[build] not present (skipped): ${skipped.join(', ')}`);
if (broken.length) console.log(`[build] BROKEN (excluded): ${broken.map(b => b.m).join(', ')}`);
process.exit(broken.length ? 3 : 0);

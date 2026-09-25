// API conformance checks against SPEC.md. Runs whatever modules are present in the given build.
// Usage: node tools/conformance.mjs [--html build/core.html]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { ROOT, CHROME, GPU_ARGS, pageUrl } from './chrome.mjs';

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? true : v; }
const htmlPath = path.resolve(ROOT, arg('html', 'cozy-house.html'));
const url = pageUrl(htmlPath, 'debug=1&autostart=1&lightning=0&seed=7');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  args: ['--headless=new', '--no-first-run', '--allow-file-access-from-files', ...GPU_ARGS],
  defaultViewport: { width: 800, height: 450 } });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 300)));
let out;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('(window.COZY && window.COZY.ready === true) || window.__COZY_BOOT_FAILED', { timeout: 60000, polling: 100 }).catch(() => {});
  out = await page.evaluate(async () => {
    const R = [];
    const C = window.COZY;
    const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra });
    const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C);
    if (!C) return [{ name: 'window.COZY exists', pass: false }];
    ok('COZY.ready === true', C.ready === true);
    const fns = ['register', 'boot', 'start', 'pause', 'resume', 'on', 'off', 'emit', 'setSetting', 'mat', 'registerLight', 'log',
      'input.isDown', 'input.onKey', 'input.consumeMouse',
      'player.sitAt', 'player.stand',
      'physics.addBox', 'physics.addBoxFromObject', 'physics.addCylinder', 'physics.addFloor', 'physics.addRamp',
      'physics.addSurfaceTag', 'physics.groundAt', 'physics.surfaceAt', 'physics.move', 'physics.raycast', 'physics.debugDraw',
      'interact.add', 'interact.useFocused', 'interact.list', 'interact.get',
      'audio.play', 'audio.music.play', 'audio.music.stop', 'audio.music.toggle', 'audio.music.setPosition',
      'audio.kettle.start', 'audio.kettle.stop', 'audio.purr.start', 'audio.purr.stop', 'audio.loop', 'audio.setListener',
      'hud.prompt', 'hud.toast', 'hud.setCrosshair',
      'world.indoorAmount', 'world.isUnderRoof', 'world.roomAt',
      'util.box', 'util.boxAt', 'util.cyl', 'util.sphere', 'util.lathe', 'util.extrude', 'util.worldUV', 'util.stdMat',
      'util.bakeStatic', 'util.blobShadow', 'util.canvasTexture', 'util.glowSprite', 'util.rng', 'util.random',
      'util.noise2D', 'util.noise3D', 'util.fbm2D', 'util.damp', 'util.lerp', 'util.clamp', 'util.smoothstep', 'util.degToRad',
      'debug.setView', 'debug.waitFrames', 'debug.info', 'debug.interact', 'debug.listInteractables', 'debug.simulate'];
    for (const f of fns) ok(`fn ${f}`, typeof get(f) === 'function');
    const objs = ['THREE', 'renderer', 'scene', 'camera', 'clock', 'modules', 'state', 'input', 'input.keys', 'input.virtualKeys', 'input.virtual',
      'player', 'player.position', 'player.velocity', 'player.bob', 'physics', 'physics.colliders', 'interact', 'audio', 'audio.music',
      'audio.buses', 'hud', 'hud.el', 'settings', 'env', 'env.wind', 'world', 'world.spawn', 'util', 'mats', 'lights', 'debug', 'debug.errors'];
    for (const o of objs) ok(`obj ${o}`, get(o) != null && typeof get(o) === 'object' || typeof get(o) === 'function');
    ok('camera is in scene', C.camera && C.camera.parent === C.scene);
    ok('camera rotation order YXZ', C.camera && C.camera.rotation.order === 'YXZ');
    ok('player numbers', ['yaw', 'pitch', 'height', 'crouchHeight', 'eyeHeight', 'radius', 'stepUp', 'crouch'].every(k => typeof C.player[k] === 'number'));
    ok('player.mode string', typeof C.player.mode === 'string');
    ok('settings keys', ['masterVolume', 'musicVolume', 'ambienceVolume', 'sfxVolume', 'mouseSensitivity', 'invertY', 'fov', 'quality', 'headBob', 'showFps'].every(k => k in C.settings));
    ok('env keys', ['preset', 'daylight', 'rain', 'wind', 'lightningFlash', 'fireLevel', 'indoor', 'musicPlaying'].every(k => k in C.env));
    ok('state keys', ['started', 'paused', 'uiOpen'].every(k => k in C.state));
    ok('state.started (autostart)', C.state.started === true);
    ok('spawn', C.world.spawn && Math.abs(C.world.spawn.x - 0.4) < 1e-6 && Math.abs(C.world.spawn.z - 2.0) < 1e-6);
    // world helpers
    try {
      ok('indoorAmount inside=1', C.world.indoorAmount(0, 1, 0) === 1);
      ok('indoorAmount porch=0.5', C.world.indoorAmount(4, 0.5, 6) === 0.5);
      ok('indoorAmount yard=0', C.world.indoorAmount(0, 0, 12) === 0);
      ok('isUnderRoof house', C.world.isUnderRoof(0, 1, 0) === true);
      ok('isUnderRoof yard false', C.world.isUnderRoof(0, 1, 12) === false);
      ok('isUnderRoof porch', C.world.isUnderRoof(4, 1, 6) === true);
      ok('isUnderRoof above porch roof false', C.world.isUnderRoof(4, 3.5, 6.5) === false);
      ok('isUnderRoof chimney', C.world.isUnderRoof(-7.45, 8.0, 2.5) === true);
      const rooms = [[-3, 1, 2, 'living'], [-3, 1, -3, 'kitchen'], [3.5, 1, 2, 'hall'], [4, 1, -3, 'study'], [0, 4, 0, 'loft'], [4, 0.5, 6, 'porch'], [0, 0, 12, 'yard'], [0, 0, 21, 'lane']];
      for (const [x, y, z, n] of rooms) ok(`roomAt(${x},${y},${z})=${n}`, C.world.roomAt(x, y, z) === n, C.world.roomAt(x, y, z));
    } catch (e) { ok('world helpers threw', false, e.message); }
    // physics behaviour in a sandbox far away
    try {
      const f = C.physics.addFloor(100, 100, 102, 102, 50, { surface: 'tile' });
      const g = C.physics.groundAt(101, 101, 50.1);
      ok('addFloor/groundAt', g && Math.abs(g.y - 50) < 1e-6 && g.surface === 'tile', g);
      const rmp = C.physics.addRamp(110, 100, 112, 104, 'z', 50, 52);
      const g2 = C.physics.groundAt(111, 102, 51.2);
      ok('addRamp interpolates', g2 && Math.abs(g2.y - 51) < 1e-3, g2);
      const b = C.physics.addBox([101, 49, 101], [102, 60, 102], { tag: 'test' });
      const p = new C.THREE.Vector3(100.5, 50, 101.5);
      C.physics.move(p, 1.0, 0, 0.28, 1.75, 0.35);
      ok('move blocked by box', p.x <= 101 - 0.28 + 0.02, p.x);
      const hit = C.physics.raycast(new C.THREE.Vector3(100, 51, 101.5), new C.THREE.Vector3(1, 0, 0), 5);
      ok('raycast hits box', hit && Math.abs(hit.dist - 1) < 0.05, hit && hit.dist);
      b.remove(); f.remove(); rmp.remove();
      ok('remove() works', C.physics.groundAt(101, 101, 50.1) === null);
      const cyl = C.physics.addCylinder(120, 120, 0.5, 49, 60);
      C.physics.addFloor(118, 118, 122, 122, 50).remove;
      const q = new C.THREE.Vector3(118.5, 50, 120);
      C.physics.move(q, 2.0, 0, 0.28, 1.75, 0.35);
      ok('cylinder blocks', q.x <= 120 - 0.5 - 0.28 + 0.02, q.x);
      cyl.remove();
    } catch (e) { ok('physics sandbox threw', false, e.message); }
    try {
      const r1 = C.util.rng(42), r2 = C.util.rng(42);
      ok('rng deterministic', r1() === r2() && r1() === r2());
      const m = C.mat('woodFloor');
      ok('mat() returns material', m && m.isMaterial);
      ok('mat(unknown) fallback', C.mat('definitely_not_a_material') && C.mat('definitely_not_a_material').isMaterial);
      const i = C.debug.info();
      ok('debug.info', i && typeof i.drawCalls === 'number' && Array.isArray(i.modules), i && Object.keys(i));
      const o = new C.THREE.Mesh(new C.THREE.BoxGeometry(0.1, 0.1, 0.1), C.util.stdMat(0xffffff));
      o.position.set(200, 200, 200); C.scene.add(o);
      const h = C.interact.add({ id: '__conf_test', object: o, label: 'x', onUse() { window.__confUsed = true; } });
      C.debug.interact('__conf_test');
      ok('interact.add + debug.interact', window.__confUsed === true);
      ok('listInteractables', C.debug.listInteractables().some(e => e.id === '__conf_test'));
      h.remove(); C.scene.remove(o);
      ok('interact remove', !C.debug.listInteractables().some(e => e.id === '__conf_test'));
    } catch (e) { ok('util/interact threw', false, e.message); }

    const mods = C.modules.map(m => m.name);
    R.push({ name: 'modules loaded: ' + mods.join(','), pass: true });
    if (mods.includes('materials')) {
      const names = ['woodFloor', 'woodDark', 'woodMedium', 'woodLight', 'woodPainted', 'woodPaintedSage', 'woodPaintedGreen', 'woodWeathered', 'woodPorch', 'bark', 'logEnd',
        'plaster', 'wallpaper', 'wallpaperBlue', 'ceilingBoards', 'tileKitchen', 'tileFloor', 'brick', 'stone', 'siding', 'shingles', 'concrete',
        'fabricSofa', 'fabricChair', 'fabricCream', 'fabricBlue', 'fabricGreen', 'fabricRose', 'knit', 'quilt', 'rugPersian', 'rugBraided', 'rugRunner', 'sheepskin', 'leather',
        'brass', 'copper', 'ironBlack', 'chrome', 'ceramic', 'ceramicBlue', 'ceramicTerracotta', 'glassClear', 'paper', 'lampshade', 'bulb', 'candleWax', 'soil', 'wickerBasket',
        'grass', 'dirt', 'mud', 'gravel', 'flagstone', 'leaves', 'pineNeedles', 'hedge', 'moss', 'water', 'glass'];
      const missing = names.filter(n => !(C.mats[n] && C.mats[n].isMaterial));
      ok('materials: all names present', missing.length === 0, missing);
      ok('materials: get/list', typeof C.mats.get === 'function' && typeof C.mats.list === 'function');
    }
    if (mods.includes('props')) {
      const f = ['lamp', 'candle', 'books', 'bookStack', 'painting', 'plant', 'pillow', 'blanket', 'throwBlanket', 'rug', 'mug', 'teapot', 'vase', 'frame', 'clock', 'jar', 'bottle', 'basket', 'steam', 'glow'];
      const missing = f.filter(n => typeof (C.props && C.props[n]) !== 'function');
      ok('props: all factories present', missing.length === 0, missing);
    }
    const ids = new Set(C.debug.listInteractables().map(e => e.id));
    const req = {
      house: ['door_front', 'door_kitchen_study', 'door_hall_study'],
      living: ['fireplace', 'sofa', 'armchair', 'window_seat', 'record_player', 'lamp_living_floor', 'lamp_living_table'],
      kitchen: ['kettle', 'lamp_dining_pendant', 'lamp_kitchen', 'dining_chair'],
      hallstudy: ['lamp_hall', 'lamp_study_desk', 'clock', 'desk_chair'],
      loft: ['bed', 'lamp_loft_bedside', 'lights_loft_string', 'lamp_loft_nook', 'loft_chair'],
      outdoor: ['gate', 'porch_rocker', 'bench', 'lamp_porch'],
      cat: ['cat'],
    };
    for (const [m, list] of Object.entries(req)) if (mods.includes(m)) {
      const missing = list.filter(id => !ids.has(id));
      ok(`${m}: required interactables`, missing.length === 0, missing);
    }
    if (mods.includes('house')) {
      ok('house: C.house.doors', C.house && C.house.doors && C.house.doors.front && typeof C.house.doors.front.toggle === 'function');
      ok('house: glassPanes', C.house && Array.isArray(C.house.glassPanes) && C.house.glassPanes.length >= 10, C.house && C.house.glassPanes && C.house.glassPanes.length);
      const g = C.physics.groundAt(6.13, 1.5, 1.6);
      ok('house: stair ramp height at z=1.5', g && Math.abs(g.y - 1.5556) < 0.06, g);
      const up = C.physics.groundAt(0, 0, 3.1);
      ok('house: upper floor at y=3', up && Math.abs(up.y - 3.0) < 0.01, up);
      const gf = C.physics.groundAt(-3, 2, 0.1);
      ok('house: ground floor y=0', gf && Math.abs(gf.y) < 0.01, gf);
      const porch = C.physics.groundAt(4, 6, 0.1);
      ok('house: porch deck y=0', porch && Math.abs(porch.y) < 0.01, porch);
    }
    if (mods.includes('player')) ok('player: cameraOwner set', C.player.cameraOwner === 'player');
    if (mods.includes('post')) ok('post: renderOverride set', typeof C.renderOverride === 'function');
    ok('no module errors', (C.debug.errors || []).length === 0, (C.debug.errors || []).slice(0, 5).map(e => `${e.module} ${e.phase}: ${e.message}`));
    return R;
  });
} catch (e) {
  out = [{ name: 'harness exception', pass: false, extra: e.message }];
} finally { await browser.close(); }
let pass = 0;
for (const r of out) { if (r.pass) pass++; else console.log(`FAIL  ${r.name}${r.extra !== undefined ? '  -> ' + JSON.stringify(r.extra) : ''}`); }
if (pageErrors.length) console.log('PAGE ERRORS:\n  ' + [...new Set(pageErrors)].join('\n  '));
console.log(`\n${pass}/${out.length} conformance checks passed`);
console.log('REPORT_JSON:' + JSON.stringify({ passed: pass, total: out.length, failed: out.filter(r => !r.pass).map(r => r.name + (r.extra !== undefined ? ' -> ' + JSON.stringify(r.extra) : '')), pageErrors }));
process.exit(pass === out.length ? 0 : 1);

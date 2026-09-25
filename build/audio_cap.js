// Scratch module for tools/audiocap.mjs (append with --extra build/audio_cap.js; never put this in src/).
// window.__CAP.run(name) plays a scripted listening scenario while recording the master mix (tap after the soft
// clipper, before mute) and returns { b64 (interleaved int16 stereo), sr, marks, stats }.
const C = window.COZY;
const wait = ms => new Promise(r => setTimeout(r, ms));

// AudioWorklet tap (runs on the audio thread, so a busy main thread cannot drop blocks); chunks are batched to the page
const WORKLET = `class CapTap extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.l = []; this.r = []; this.n = 0; this.port.onmessage = e => { this.on = !!e.data.on; if (!this.on) this.flush(); }; }
  flush() { if (!this.n) return; const L = new Float32Array(this.n), R = new Float32Array(this.n); let k = 0;
    for (let i = 0; i < this.l.length; i++) { L.set(this.l[i], k); R.set(this.r[i], k); k += this.l[i].length; }
    this.port.postMessage({ L, R }, [L.buffer, R.buffer]); this.l = []; this.r = []; this.n = 0; }
  process(ins) { const i = ins[0]; if (this.on && i && i.length) { const a = i[0], b = i[1] || i[0]; this.l.push(new Float32Array(a)); this.r.push(new Float32Array(b)); this.n += a.length; if (this.n >= 16384) this.flush(); } return true; }
}
registerProcessor('cap-tap', CapTap);`;
async function recorder() {
  const A = C.audio, ctx = A.ctx;
  // A.master (pre-dynamics) exists in every build, so before/after captures are directly comparable
  const tapNode = window.__CAP_POST && A._debug && A._debug.tapPoint ? A._debug.tapPoint() : A.master;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'cap-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
  const sink = ctx.createGain(); sink.gain.value = 0;
  const chunks = []; let done = null;
  node.port.onmessage = e => { chunks.push([e.data.L, e.data.R]); if (done) done(); };
  tapNode.connect(node); node.connect(sink); sink.connect(ctx.destination);
  return {
    start() { node.port.postMessage({ on: true }); },
    async stop() {
      await new Promise(r => { done = r; node.port.postMessage({ on: false }); setTimeout(r, 1500); });
      try { tapNode.disconnect(node); } catch (e) { /* */ }
      let n = 0; for (const c of chunks) n += c[0].length;
      const out = new Int16Array(n * 2); let k = 0, peak = 0, ss = 0;
      for (const [l, r] of chunks) for (let i = 0; i < l.length; i++) {
        const a = l[i], b = r[i]; peak = Math.max(peak, Math.abs(a), Math.abs(b)); ss += a * a + b * b;
        out[k++] = Math.max(-32767, Math.min(32767, Math.round(a * 32767))); out[k++] = Math.max(-32767, Math.min(32767, Math.round(b * 32767)));
      }
      const u8 = new Uint8Array(out.buffer); let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return { b64: btoa(s), sr: ctx.sampleRate, stats: { peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(ss / Math.max(1, 2 * n) + 1e-12)).toFixed(1) } };
    },
  };
}

// walk the EYE along a polyline at `speed` m/s, emitting footsteps with the physics surface under the feet
async function walk(pts, speed = 1.35, opts = {}) {
  const eye = 1.62, stride = opts.stride || 0.62;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(x1 - x0), -(z1 - z0));
    const steps = Math.max(1, Math.ceil(len / (speed * 0.05)));
    for (let s = 1; s <= steps; s++) {
      const u = s / steps, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      const prevY = C.player.position.y;
      const g = C.physics.groundAt(x, z, (opts.feetY !== undefined ? opts.feetY : prevY) + 0.5, 0.9);
      const fy = g ? g.y : prevY;
      C.debug.setView(x, fy + eye, z, yaw, 0, true);
      C.player.position.set(x, fy + eye, z);
      acc += len / steps;
      if (acc >= stride) {
        acc -= stride;
        const surf = C.physics.surfaceAt ? C.physics.surfaceAt(x, fy, z, g && g.surface) : (g && g.surface) || 'wood';
        C.emit('footstep', { surface: surf || 'wood', run: speed > 2.5, crouch: false, x, y: fy, z });
      }
      await wait(50);
    }
  }
}
const look = (x, y, z, yaw, pitch = 0) => C.debug.setView(x, y, z, yaw, pitch, true);
// weather.js owns C.env.rain in the full build (it rewrites it every frame)
const setRain = v => (C.weather && C.weather.setRain ? C.weather.setRain(v, { silent: true }) : (C.env.rain = v));
async function meterDb(ms) { const m = await C.audio._debug.meter(ms); return m ? +m.rmsDb.toFixed(1) : null; }

const SCEN = {
  // RMS of the whole mix and of the rain / wind groups at the calibration spots (rain 0.7); results go into marks
  async levels(mark) {
    setRain(0.7); await wait(4000);
    const D = C.audio._debug, spots = [['living', 0.4, 1.62, 2.0], ['living_by_window', -3.9, 1.62, 3.7], ['kitchen', -3, 1.62, -3], ['hall_door_closed', 3.75, 1.62, 3.6],
      ['hall_door_open', 3.75, 1.62, 3.6, 'open'], ['loft_centre', 0, 4.62, 0], ['loft_eave', -3, 4.62, 3.3], ['loft_skylight', -5.45, 4.62, 1.75],
      ['porch', 4, 1.62, 6.2, 'close'], ['yard', 3.75, 1.17, 12], ['pond', -7, 1.2, 9.5], ['oak', -6.0, 1.2, 13]];
    const door = o => { if (C.house && C.house.doors && C.house.doors.front) C.house.doors.front.setOpen(o); };
    for (const [name, x, y, z, act] of spots) {
      if (act === 'open') door(true); if (act === 'close') door(false);
      look(x, y, z, 0); await wait(2200);
      D.solo(null); const all = await meterDb(1500);
      D.solo(['rain']); const rain = await meterDb(1500);
      D.solo(['wind']); const wind = await meterDb(1500);
      D.solo(null);
      mark(`${name} all ${all} rain ${rain} wind ${wind}`);
    }
  },
  // a tour through every acoustic space: living room → hall → front door → porch → yard → pond → back inside
  async tour(mark) {
    setRain(0.7);
    look(0.4, 1.62, 2.0, Math.PI / 2); await wait(5000); mark('living idle');
    await walk([[0.4, 2.0], [-3.0, 3.2], [-4.6, 2.5]]); mark('near fireplace'); await wait(3000);
    await walk([[-4.6, 2.5], [0.5, 2.0], [3.6, 2.0], [3.75, 3.9]]); mark('hall at front door'); await wait(2000);
    if (C.house && C.house.doors && C.house.doors.front) C.house.doors.front.setOpen(true); else C.emit('door', { id: 'door_front', open: true, x: 3.75, y: 1.05, z: 4.85 });
    mark('front door opened'); await wait(2500);
    await walk([[3.75, 3.9], [3.75, 6.2]]); mark('porch'); await wait(5000);
    await walk([[3.75, 6.2], [3.75, 7.9], [3.75, 12.0]]); mark('path in the yard'); await wait(4000);
    await walk([[3.75, 12.0], [-2.0, 11.0], [-6.2, 9.8]]); mark('pond'); await wait(4000);
    await walk([[-6.2, 9.8], [-6.0, 13.0]]); mark('under the oak'); await wait(3000);
    await walk([[-6.0, 13.0], [3.75, 9.0], [3.75, 6.2], [3.75, 3.5]]); mark('back inside');
    if (C.house && C.house.doors && C.house.doors.front) C.house.doors.front.setOpen(false); else C.emit('door', { id: 'door_front', open: false, x: 3.75, y: 1.05, z: 4.85 });
    mark('front door closed'); await wait(4000);
  },
  // up the stairs into the loft, under the roof slopes and skylights
  async loft(mark) {
    setRain(0.7);
    look(4.4, 1.62, 3.2, -Math.PI / 2); await wait(3000); mark('hall');
    await walk([[4.4, 3.2], [6.1, 4.2], [6.1, 3.5]]);
    await walk([[6.1, 3.5], [6.1, -0.6]], 1.1); mark('top of stairs');
    await walk([[6.1, -0.6], [4.5, -1.2], [0, 0], [-3.0, 0.4]], 1.35, { feetY: 3.0 }); mark('loft centre (ridge)'); await wait(4000);
    await walk([[-3.0, 0.4], [-3.0, 3.3]], 1.35, { feetY: 3.0 }); mark('loft by the south eave'); await wait(4000);
    await walk([[-3.0, 3.3], [-5.4, 1.8]], 1.35, { feetY: 3.0 }); mark('under skylight'); await wait(4000);
  },
  // lightning at several distances, heard outside and inside
  async thunder(mark) {
    setRain(1.0);
    const strike = o => (C.weather && C.weather.lightning ? C.weather.lightning(o) : C.emit('lightning', o));
    look(3.75, 1.17, 12, 0); await wait(2500);
    mark('close strike, outside'); strike({ strength: 1, distance: 0.5, dirX: 1, dirZ: 0.2, bolt: true }); await wait(10000);
    mark('far strike, outside'); strike({ strength: 0.5, distance: 4.5, dirX: -1, dirZ: -0.3, bolt: false }); await wait(17000);
    look(0.4, 1.62, 2.0, Math.PI / 2); await wait(1500);
    mark('mid strike, inside'); strike({ strength: 0.8, distance: 2.0, dirX: 0.3, dirZ: 1, bolt: false }); await wait(13000);
  },
  // rain intensity sweep on the porch, then the rain stops (runoff and drips should linger)
  async rain(mark) {
    look(3.75, 1.17, 9.0, 0); setRain(0.35); await wait(8000); mark('drizzle');
    setRain(0.7); await wait(7000); mark('rain');
    setRain(1.0); await wait(7000); mark('storm');
    setRain(0.0); await wait(14000); mark('stopped');
  },
  // quick one-shot catalogue in the living room
  async sfx(mark) {
    look(0.4, 1.62, 2.0, Math.PI / 2); await wait(2500);
    const names = ['door_open', 'door_close', 'switch', 'click', 'creak', 'thud', 'page', 'chime', 'match', 'gate', 'meow', 'clink'];
    for (const n of names) { mark(n); C.audio.play(n, { x: 1.2, y: 1.1, z: 2.4 }); await wait(n === 'chime' ? 5200 : 1600); }
  },
  // footsteps across surfaces (no world needed): 6 steps each
  async steps(mark) {
    look(0.4, 1.62, 2.0, Math.PI / 2); await wait(2000);
    for (const s of ['wood', 'rug', 'tile', 'stairs', 'porch', 'stone', 'grass', 'gravel', 'mud', 'water']) {
      mark(s);
      for (let i = 0; i < 6; i++) { C.emit('footstep', { surface: s, run: false, crouch: false, x: 0.4, y: 0, z: 2.0 + i * 0.6 }); await wait(460); }
      await wait(500);
    }
  },
  // public API smoke test: generic loops (incl. unknown names), music, kettle, purr, doors, a lamp reported twice,
  // sitting in a rocking seat; problems are reported in marks
  async api(mark) {
    const A = C.audio, errs = [];
    const tryit = (label, fn) => { try { fn(); } catch (e) { errs.push(label + ': ' + e.message); } };
    look(0.4, 1.62, 2.0, Math.PI / 2); await wait(1500);
    const loops = [];
    for (const n of ['glass', 'window', 'drip', 'fire', 'pond', 'not_a_sound']) tryit('loop ' + n, () => loops.push(A.loop(n, { x: 1, y: 1, z: 2, volume: 0.6 })));
    await wait(2500); mark('loops started ' + A._debug.stats().liveLoops);
    loops.forEach(h => tryit('stop', () => h.stop()));
    tryit('music', () => { A.music.setPosition(-1, 0.9, 4.3); A.music.play(); }); await wait(4000); mark('music playing ' + A.music.playing);
    tryit('music stop', () => A.music.stop());
    tryit('kettle', () => A.kettle.start(-4.6, 1.0, -4.3)); await wait(7500); mark('kettle whistling ' + A.kettle.on); tryit('kettle stop', () => A.kettle.stop());
    tryit('purr', () => A.purr.start(-3, 0.6, 4.45)); await wait(2000); tryit('purr stop', () => A.purr.stop());
    C.emit('door', { id: 'door_kitchen_study', open: true, x: 2.0, y: 1.0, z: -2.65 }); await wait(900);
    C.emit('door', { id: 'gate', open: false, x: 3.75, y: 0.15, z: 19 }); await wait(900);
    const before = A._debug.stats().created;
    C.emit('lamp', { id: 'lamp_x', on: true, x: 1.4, y: 1.2, z: 2 }); A.play('switch', { x: 1.4, y: 1.2, z: 2 });
    mark('lamp double-report voices ' + (A._debug.stats().created - before));
    C.player.seat = { id: 'porch_rocker', position: [2.05, 1.1, 6.05], yaw: 0.3, rock: 0.04 }; C.player.mode = 'sit'; C.emit('sit', { id: 'porch_rocker' });
    for (let i = 0; i < 90; i++) { const w = Math.sin(i * 0.05 * Math.PI * 2 / 2.8); look(2.05 - Math.sin(0.3) * w * 0.05, 1.1, 6.05 - Math.cos(0.3) * w * 0.05, 0.3); await wait(50); }
    C.player.mode = 'noclip'; C.player.seat = null; C.emit('stand', { id: 'porch_rocker' });
    mark('errors ' + (errs.length ? errs.join(' | ') : 'none'));
  },
};

window.__CAP = {
  async run(name) {
    const A = C.audio;
    if (A._debug && A._debug.warm) await Promise.race([A._debug.warm(), wait(60000)]);
    await wait(800);
    const rec = await recorder(), marks = [], ctx = A.ctx;
    rec.start();
    const t0 = ctx.currentTime, mark = label => marks.push([+(ctx.currentTime - t0).toFixed(2), label]);    // audio-clock marks
    try { await SCEN[name](mark); } catch (e) { marks.push([-1, 'ERROR ' + e.message]); }
    const r = await rec.stop(); r.marks = marks; return r;
  },
  scenarios: Object.keys(SCEN),
};

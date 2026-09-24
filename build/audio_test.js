// Scratch test harness for src/audio.js (appended via --extra). Exposes window.__AT.* async test phases that tap the
// master bus (post compressor/limiter/clipper, pre-mute) and report RMS / peak levels.
const C = window.COZY;
const wait = ms => new Promise(r => setTimeout(r, ms));
const AD = () => C.audio._debug;
const db = v => +(20 * Math.log10(v + 1e-9)).toFixed(1);
const view = (x, y, z, yaw = 0) => C.debug.setView(x, y, z, yaw, 0, true);
async function meas(ms) { const m = await AD().meter(ms); return { rms: +m.rmsDb.toFixed(1), win: db(m.maxWin), peak: +m.peak.toFixed(3) }; }
async function ready() { await AD().warm(); await wait(300); }
async function at(label, x, y, z, settle, ms, out) { view(x, y, z); await wait(settle); out[label] = await meas(ms); }

window.__AT = {
  async ambience() {
    await ready();
    const out = {};
    C.env.rain = 0.7; C.env.fireLevel = 1;
    AD().solo(['rain']);
    await at('rain_out_yard', 0, 1.17, 12, 2500, 2000, out);
    await at('rain_out_nearDownspout', 7.6, 1.2, 5.9, 1500, 2000, out);
    await at('rain_porch', 4, 1.62, 6.2, 2000, 2000, out);
    await at('rain_in_living', 0.4, 1.62, 2.0, 2500, 2000, out);
    await at('rain_in_kitchen', -3, 1.62, -3, 1500, 2000, out);
    await at('rain_up_centre', 0, 4.62, 0, 2500, 2000, out);
    await at('rain_up_skylight', -5.45, 4.62, 1.75, 1500, 2000, out);
    await at('rain_hall_doorClosed', 3.75, 1.62, 3.6, 2000, 2000, out);
    C.emit('door', { id: 'door_front', open: true, x: 3.75, y: 1.0, z: 4.85 });
    await wait(2000); out.rain_hall_doorOpen = await meas(2000);
    C.emit('door', { id: 'door_front', open: false, x: 3.75, y: 1.0, z: 4.85 });
    C.env.rain = 0.35; await at('rain_out_drizzle035', 0, 1.17, 12, 3500, 2000, out);
    C.env.rain = 1.0; await at('rain_out_storm100', 0, 1.17, 12, 3500, 2000, out);
    await at('rain_in_storm100', 0.4, 1.62, 2.0, 2500, 2000, out);
    C.env.rain = 0.7;
    AD().solo(['wind']);
    await at('wind_out', 0, 1.17, 12, 1500, 3000, out);
    await at('wind_in', 0.4, 1.62, 2.0, 1500, 2000, out);
    AD().solo(['fire']);
    await at('fire_2m', -4.25, 1.2, 2.5, 2500, 3000, out);
    await at('fire_from_kitchen', -2.5, 1.62, -3, 1000, 2000, out);
    C.env.fireLevel = 0; await wait(3500); out.fire_out_level0 = await meas(1500); C.env.fireLevel = 1;
    AD().solo(['clock']);
    await at('clock_1p5m', 2.35, 1.62, 1.2, 1000, 3000, out);
    await at('clock_living', -2, 1.62, 2.5, 1000, 2000, out);
    AD().solo(null);
    await at('ALL_living', 0.4, 1.62, 2.0, 2000, 3000, out);
    await at('ALL_yard', 0, 1.17, 12, 2000, 3000, out);
    await at('ALL_loft', -4, 4.62, 1.0, 2000, 3000, out);
    return out;
  },
  async thunder() {
    await ready();
    const out = {};
    AD().solo(['thunder']);
    view(0, 1.17, 12); await wait(1500);
    C.emit('lightning', { strength: 1, distance: 0.4, dirX: 1, dirZ: 0 }); out.close_out = await meas(8500);
    C.emit('lightning', { strength: 0.7, distance: 2.2, dirX: -1, dirZ: 0 }); out.mid_out = await meas(13000);
    view(0.4, 1.62, 2.0); await wait(1500);
    C.emit('lightning', { strength: 1, distance: 0.4, dirX: 1, dirZ: 0 }); out.close_indoor = await meas(8500);
    C.emit('lightning', { strength: 0.5, distance: 4.0, dirX: 0, dirZ: 1 }); out.far_indoor = await meas(18000);
    AD().solo(null);
    return out;
  },
  async steps() {
    await ready();
    const out = {};
    AD().solo(['steps']);
    view(0.4, 1.62, 2.0); await wait(1200);
    const surfaces = ['wood', 'stairs', 'tile', 'rug', 'carpet', 'porch', 'grass', 'mud', 'gravel', 'stone', 'water'];
    const run = async (label, ev) => {
      const m = meas(2300);
      for (let i = 0; i < 4; i++) { C.emit('footstep', Object.assign({ x: 0, y: 0, z: 0 }, ev)); await wait(550); }
      out[label] = await m; await wait(300);
    };
    for (const s of surfaces) await run(s, { surface: s, run: false, crouch: false });
    await run('wood_run', { surface: 'wood', run: true, crouch: false });
    await run('wood_crouch', { surface: 'wood', run: false, crouch: true });
    let m = meas(1500); C.emit('jump', { surface: 'wood', speed: 2 }); await wait(500); C.emit('land', { surface: 'wood', speed: 4 }); out.jump_land_wood = await m;
    m = meas(1500); C.emit('land', { surface: 'grass', speed: 6 }); out.land_grass_hard = await m;
    AD().solo(null);
    return out;
  },
  async oneshots() {
    await ready();
    const out = {};
    AD().solo(['sfx']);
    view(0.4, 1.62, 2.0); await wait(1000);
    const names = ['click', 'switch', 'creak', 'door_open', 'door_close', 'thud', 'page', 'pour', 'sip', 'meow', 'chime', 'match', 'whoosh', 'drawer', 'curtain', 'splash', 'clink', 'gate'];
    const len = { chime: 5200, pour: 2800, creak: 1700, gate: 1700, door_open: 1500, match: 1500 };
    for (const n of names) { const m = meas(len[n] || 1100); C.audio.play(n); out[n] = await m; await wait(250); }
    // positional: door creak 3 m to the right vs same at 8 m
    let m = meas(1500); C.audio.play('door_open', { x: 3.4, y: 1.0, z: 2.0 }); out.door_open_pos3m = await m;
    m = meas(1500); C.audio.play('door_open', { x: 0.4, y: 1.0, z: -6 }); out.door_open_pos8m_throughWall = await m;
    m = meas(1000); C.emit('lamp', { id: 'lamp_x', on: true, x: 1.4, y: 1.2, z: 2 }); out.lamp_event = await m;
    m = meas(1200); C.emit('sit', { id: 'sofa' }); out.sit_sofa = await m;
    AD().solo(null);
    return out;
  },
  async music() {
    await ready();
    const out = {};
    AD().solo(['music']);
    C.audio.music.setPosition(-1.0, 0.9, 4.3);
    view(-1.0, 1.62, 1.8); await wait(600);
    let evt = null; const h = p => { evt = p; }; C.on('music', h);
    C.audio.music.play();
    await wait(1500);
    out.flags = { playing: C.audio.music.playing, env: C.env.musicPlaying, event: evt };
    out.music_2p5m = await meas(9000);
    const ch = AD().MUS.chain, lv = [ch.piano.gain.value, ch.bass.gain.value, ch.drums.gain.value, ch.crackle.gain.value];
    const only = (a, b, c, d) => { ch.piano.gain.value = a; ch.bass.gain.value = b; ch.drums.gain.value = c; ch.crackle.gain.value = d; };
    only(lv[0], 0, 0, 0); out.inst_piano = await meas(6500);
    only(0, lv[1], 0, 0); out.inst_bass = await meas(6500);
    only(0, 0, lv[2], 0); out.inst_drums = await meas(6500);
    only(0, 0, 0, lv[3]); out.inst_vinyl = await meas(3000);
    only(lv[0], lv[1], lv[2], lv[3]);
    await at('music_kitchen', -3, 1.62, -3.5, 800, 3000, out);
    await at('music_loft', -1, 4.62, 2.0, 1500, 3000, out);
    await at('music_yard', 0, 1.17, 12, 1500, 3000, out);
    view(-1.0, 1.62, 1.8); await wait(1500);
    out.voicesWhilePlaying = AD().stats().voices;
    C.audio.music.toggle();
    await wait(1500);
    out.after_stop = await meas(1000);
    out.flagsAfterStop = { playing: C.audio.music.playing, env: C.env.musicPlaying, event: evt };
    out.voicesAfterStop = AD().stats().voices; out.musicActiveAfterStop = AD().stats().musicActive;
    C.off('music', h);
    AD().solo(null);
    return out;
  },
  async kettlePurr() {
    await ready();
    const out = {};
    AD().solo(['kettle']);
    view(-4.6, 1.62, -2.9); await wait(500);
    C.audio.kettle.start(-4.6, 1.0, -4.3);
    out.kettle_0_3s = await meas(3000);
    out.kettle_3_6s = await meas(3000);
    await wait(1200);
    out.kettle_whistle = await meas(4000);
    C.audio.kettle.stop();
    await wait(3200);
    out.kettle_after_stop = await meas(800);
    AD().solo(['purr']);
    view(-3.0, 1.2, 3.7); await wait(300);
    C.audio.purr.start(-3.0, 0.55, 4.45);
    await wait(1000);
    out.purr_0p9m = await meas(4000);
    C.audio.purr.stop();
    await wait(1800);
    out.purr_after_stop = await meas(800);
    AD().solo(['loops']);
    const lp = C.audio.loop('drip', { x: 3.0, y: 0.3, z: 1.0, volume: 1 });
    view(3.0, 1.62, 2.0); await wait(1500);
    out.loop_drip_1p6m = await meas(4000);
    lp.setVolume(0.3); await wait(500); out.loop_drip_vol03 = await meas(3000);
    lp.stop(); await wait(1000); out.loop_after_stop = await meas(600);
    out.stats = AD().stats(); delete out.stats.rt;
    AD().solo(null);
    return out;
  },
  async leak() {
    await ready();
    const s0 = AD().stats();
    AD().resetPeak();
    view(0.4, 1.62, 2.0);
    C.audio.music.setPosition(-1.0, 0.9, 4.3);
    C.audio.music.play();
    await wait(1500);
    const samples = [];
    const surfaces = ['wood', 'rug', 'tile', 'gravel', 'grass', 'stairs'];
    const t0 = performance.now(); let k = 0, nextSample = 0;
    while (performance.now() - t0 < 20000) {
      C.emit('footstep', { surface: surfaces[k % surfaces.length], run: k % 5 === 0, crouch: false, x: 0, y: 0, z: 0 });
      if (k % 7 === 0) C.audio.play(['click', 'page', 'clink', 'switch'][k % 4]);
      if (k % 20 === 0) view(k % 40 === 0 ? 0 : 0.4, k % 40 === 0 ? 1.17 : 1.62, k % 40 === 0 ? 12 : 2.0);
      k++;
      await wait(300);
      const el = performance.now() - t0;
      if (el >= nextSample) { const st = AD().stats(); samples.push([Math.round(el / 1000), st.voices, st.musicActive, st.emitters]); nextSample += 2000; }
    }
    C.audio.music.stop();
    await wait(2500);
    const s1 = AD().stats();
    return { steps: k, samples: samples.map(s => s.join('/')).join(' '), peakVoices: s1.peakVoices, voicesStart: s0.voices, voicesEnd: s1.voices,
      emittersStart: s0.emitters, emittersEnd: s1.emitters, loopsStart: s0.loops, loopsEnd: s1.loops, created: s1.created,
      musicActiveEnd: s1.musicActive, updAvgMs: s1.updAvgMs, updMaxMs: s1.updMaxMs, fps: C.debug.info().fps };
  },
};

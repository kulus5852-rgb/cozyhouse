// =====================================================================================================================
//  PLAYER — first-person controller on top of core physics (SPEC §3.4, §3.5, §9 player).
//
//  Walk 2.0 m/s · run 3.8 (Shift) · crouch 1.1 (hold C / Ctrl) · jump (Space) · F flashlight.
//  Grounded players snap up ramps/steps (≤ stepUp) and down (≤ 0.4 m); airborne players fall with gravity 12 m/s².
//  Ceilings: the underside of any floor slab above the head (floor.y − 0.2) and the loft roof (7.5 − 0.7·|z|).
//
//  Seats: C.player.sitAt(seat) (core) → this module eases the camera to seat.position (EYE) and limits the look to
//    seat.yaw ± seat.yawRange (1.4), pitch ∈ [seat.pitchMin (−1.0), seat.pitchMax (1.2)]. Extras understood here:
//    seat.pitch (initial pitch), seat.rock (amplitude, e.g. 0.04 → gentle rocking-chair sway), seat.lie (bed).
//    Any movement key (pressed after sitting), Space or E (core) stands up → core teleports FEET to seat.exit.
//  Touch: C.input.virtual.moveX (+right) / moveY (+forward) from the left joystick; right-side drag feeds
//    C.input.mouse; on-screen Use / Jump / Crouch / pause buttons.
//  Debug: C.debug.simulate({ from, yaw, pitch, keys, seconds, dt }) steps the physics synchronously (walk tests).
//  Noclip ('noclip' mode, e.g. ?cam= / ?freecam=1): position is the EYE; WASD fly, Space up, C down, Shift fast.
//  Events emitted: 'footstep' {surface, run, crouch, x,y,z} every ~0.62 m, 'jump' / 'land' {surface, speed},
//    'flashlight' {on}.  Consumed: 'sit', 'stand', 'teleport', 'start', 'pause', 'resume', 'settings'.
// =====================================================================================================================
import * as THREE from 'three';
const C = window.COZY;

const WALK = 2.0, RUN = 3.8, CROUCH = 1.1;
const GRAVITY = 12, JUMP_V = 3.6;
const STEP_DOWN = 0.4, STEP_LEN = 0.62;
const MOUSE_SENS = 0.0022;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

C.register({
  name: 'player',
  order: 10,

  init(C) {
    const p = C.player, U = C.util, input = C.input, physics = C.physics;
    p.cameraOwner = 'player';
    const cam = C.camera;

    // ------------------------------------------------------------------ state
    const st = this.st = {
      airborne: false, prevJump: false, prevCrouchBtn: false,
      stepPhase: 0,          // steps taken (fractional) — drives bob + footsteps
      bobAmp: 0,             // 0..1 blend of head bob
      dip: 0, dipV: 0,       // landing spring
      fallSpeed: 0,
      sitTimer: 0, sitBlock: false,
      trans: 0,              // camera ease timer (sit / stand transitions)
      camPos: new THREE.Vector3(), camYaw: p.yaw, camPitch: p.pitch,
      touchCrouch: false,
      flashlightOn: false,
    };
    const tmpV = new THREE.Vector3(), eye = new THREE.Vector3();
    const ceilingFloors = physics._lists ? physics._lists.floors : [];

    // ------------------------------------------------------------------ helpers
    const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    const anyMoveDown = () => MOVE_KEYS.some(k => input.isDown(k)) ||
      Math.abs(input.virtual.moveX) > 0.25 || Math.abs(input.virtual.moveY) > 0.25;
    const inputOn = () => C.state.started && !C.state.paused && !C.state.uiOpen;
    const standingHeight = () => U.lerp(p.height, p.crouchHeight, p.crouch);

    // lowest ceiling above the player's head at (x, z) given feet y (floor slabs are 0.2 thick; loft roof slope)
    function ceilingAt(x, z, feetY) {
      let c = Infinity;
      for (let i = 0; i < ceilingFloors.length; i++) {
        const f = ceilingFloors[i];
        if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
        if (f.y - 0.2 > feetY + 0.5 && f.y - 0.2 < c) c = f.y - 0.2;
      }
      if (feetY > 2.6 && Math.abs(x) <= 6.75 && Math.abs(z) <= 4.75) {
        const roof = 7.5 - 0.7 * Math.abs(z) - 0.08;
        if (roof < c) c = roof;
      }
      return c;
    }

    function startTransition() {
      st.trans = 0.7;
    }

    // ------------------------------------------------------------------ physics step (shared by the loop and simulate)
    const wish = new THREE.Vector3();
    function step(dt, sim) {
      const pos = p.position, vel = p.velocity;
      const allowInput = sim || inputOn();

      // ----- sitting / lying
      if (p.mode === 'sit') {
        st.sitTimer += dt;
        const moving = allowInput && anyMoveDown();
        if (!moving) st.sitBlock = false;
        const jump = allowInput && input.isDown('Space');
        if (((moving && !st.sitBlock) || (jump && !st.prevJump)) && st.sitTimer > 0.25) p.stand();
        st.prevJump = jump;
        return;
      }

      // ----- noclip fly (position = EYE)
      if (p.mode === 'noclip') {
        if (!allowInput) return;
        const sp = (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) ? 9 : 3;
        let f = 0, r = 0, u = 0;
        if (input.isDown('KeyW') || input.isDown('ArrowUp')) f += 1;
        if (input.isDown('KeyS') || input.isDown('ArrowDown')) f -= 1;
        if (input.isDown('KeyD') || input.isDown('ArrowRight')) r += 1;
        if (input.isDown('KeyA') || input.isDown('ArrowLeft')) r -= 1;
        if (input.isDown('Space')) u += 1;
        if (input.isDown('KeyC') || input.isDown('ControlLeft')) u -= 1;
        f += input.virtual.moveY; r += input.virtual.moveX;
        const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), spch = Math.sin(p.pitch);
        pos.x += (-sy * cp * f + cy * r) * sp * dt;
        pos.y += (spch * f + u) * sp * dt;
        pos.z += (-cy * cp * f - sy * r) * sp * dt;
        return;
      }

      // ----- walk mode
      let f = 0, r = 0;
      let run = false, crouchWanted = st.touchCrouch;
      if (allowInput) {
        if (input.isDown('KeyW') || input.isDown('ArrowUp')) f += 1;
        if (input.isDown('KeyS') || input.isDown('ArrowDown')) f -= 1;
        if (input.isDown('KeyD') || input.isDown('ArrowRight')) r += 1;
        if (input.isDown('KeyA') || input.isDown('ArrowLeft')) r -= 1;
        f += input.virtual.moveY; r += input.virtual.moveX;
        run = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ||
          Math.hypot(input.virtual.moveX, input.virtual.moveY) > 0.95;
        crouchWanted = crouchWanted || input.isDown('KeyC') || input.isDown('ControlLeft') || input.isDown('ControlRight');
      }
      const len = Math.hypot(f, r);
      if (len > 1) { f /= len; r /= len; }

      // crouch (can't stand up under something)
      const crouchTarget = crouchWanted ? 1 : 0;
      if (crouchTarget < p.crouch) {
        tmpV.copy(pos);
        physics.resolve(tmpV, p.radius, p.height, p.stepUp);
        const blocked = tmpV.distanceToSquared(pos) > 1e-4 || pos.y + p.height > ceilingAt(pos.x, pos.z, pos.y);
        if (!blocked) p.crouch = Math.max(0, p.crouch - dt * 6);
      } else p.crouch = Math.min(1, p.crouch + dt * 6);
      const height = standingHeight();

      const speed = p.crouch > 0.5 ? CROUCH : run ? RUN : WALK;
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      wish.set(-sy * f + cy * r, 0, -cy * f - sy * r).multiplyScalar(speed);
      const lambda = p.grounded ? 11 : 1.5;
      vel.x = U.damp(vel.x, wish.x, lambda, dt);
      vel.z = U.damp(vel.z, wish.z, lambda, dt);

      // horizontal move with collision
      const px = pos.x, pz = pos.z;
      const hit = physics.move(pos, vel.x * dt, vel.z * dt, p.radius, height, p.stepUp).hit;
      const mdx = pos.x - px, mdz = pos.z - pz;
      if (hit && dt > 0) { vel.x = mdx / dt; vel.z = mdz / dt; }
      const moved = Math.hypot(mdx, mdz);

      // jump
      const jump = allowInput && input.isDown('Space');
      if (jump && !st.prevJump && p.grounded) {
        vel.y = JUMP_V; p.grounded = false; st.airborne = true;
        C.emit('jump', { surface: p.surface, speed: Math.hypot(vel.x, vel.z) });
      }
      st.prevJump = jump;

      // vertical
      if (p.grounded) {
        const g = physics.groundAt(pos.x, pos.z, pos.y, p.stepUp);
        if (g && g.y >= pos.y - STEP_DOWN) { pos.y = g.y; vel.y = 0; p.surface = g.surface; }
        else { p.grounded = false; vel.y = 0; }
      }
      if (!p.grounded) {
        vel.y -= GRAVITY * dt;
        pos.y += vel.y * dt;
        const g = physics.groundAt(pos.x, pos.z, pos.y, Math.max(p.stepUp, 0.6));
        if (g && pos.y <= g.y) {
          pos.y = g.y;
          if (vel.y <= 0) {
            const impact = -vel.y;
            p.grounded = true; vel.y = 0; p.surface = g.surface;
            if (impact > 1.2) {
              C.emit('land', { surface: g.surface, speed: impact });
              st.dipV -= Math.min(1.6, impact * 0.28);
            }
          }
        }
        const ceil = ceilingAt(pos.x, pos.z, pos.y);
        if (pos.y + height > ceil) { pos.y = Math.max(pos.y - 0.5, ceil - height); if (vel.y > 0) vel.y = 0; }
        if (pos.y < -30) {                           // fell out of the world
          const s = C.world.spawn;
          pos.set(s.x, s.y, s.z); vel.set(0, 0, 0); p.grounded = true;
        }
      }

      // footsteps + bob phase
      if (p.grounded && moved > 1e-5) {
        const stride = STEP_LEN * (run && p.crouch < 0.5 ? 1.25 : 1);
        const before = Math.floor(st.stepPhase);
        st.stepPhase += moved / stride;
        if (Math.floor(st.stepPhase) !== before) {
          C.emit('footstep', { surface: p.surface, run: run && p.crouch < 0.5, crouch: p.crouch > 0.5, x: pos.x, y: pos.y, z: pos.z });
        }
      }
      const hs = Math.hypot(vel.x, vel.z);
      st.bobAmp = U.damp(st.bobAmp, p.grounded ? Math.min(1, hs / WALK) : 0, 8, dt);
      st.running = run && hs > WALK + 0.3;
    }

    // ------------------------------------------------------------------ camera placement
    const rockT = { t: 0 };
    function placeCamera(dt, t) {
      let tx, ty, tz, yaw = p.yaw, pitch = p.pitch;
      if (p.mode === 'sit' && p.seat) {
        const s = p.seat, sp = s.position;
        tx = sp[0]; ty = sp[1]; tz = sp[2];
        if (s.rock) {
          rockT.t += dt;
          const w = Math.sin(rockT.t * Math.PI * 2 / 2.8);
          pitch += w * s.rock;
          tx += -Math.sin(s.yaw) * w * s.rock * 1.2; tz += -Math.cos(s.yaw) * w * s.rock * 1.2;
          ty += Math.abs(w) * s.rock * -0.4;
        }
        p.bob.set(0, 0, 0);
      } else if (p.mode === 'noclip') {
        tx = p.position.x; ty = p.position.y; tz = p.position.z;
        p.bob.set(0, 0, 0);
      } else {
        const eyeH = U.lerp(p.eyeHeight, p.crouchHeight - 0.1, p.crouch);
        // landing spring
        const k = 140, c = 2 * Math.sqrt(k) * 0.8;
        st.dipV += (-k * st.dip - c * st.dipV) * dt;
        st.dip += st.dipV * dt;
        let bx = 0, by = 0;
        if (C.settings.headBob !== false) {
          const a = st.bobAmp * (st.running ? 1.35 : 1);
          by = -Math.cos(st.stepPhase * Math.PI * 2) * 0.026 * a + Math.sin(t * 1.3) * 0.004;
          bx = Math.sin(st.stepPhase * Math.PI) * 0.018 * a;
        }
        p.bob.set(bx, by + st.dip, 0);
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        tx = p.position.x + cy * bx; ty = p.position.y + eyeH + by + st.dip; tz = p.position.z - sy * bx;
      }
      eye.set(tx, ty, tz);
      if (st.trans > 0) {
        st.trans -= dt;
        const k = 1 - Math.exp(-9 * dt);
        st.camPos.lerp(eye, k);
        st.camYaw += wrap(yaw - st.camYaw) * k;
        st.camPitch += (pitch - st.camPitch) * k;
        if (st.trans <= 0) { st.camPos.copy(eye); st.camYaw = yaw; st.camPitch = pitch; }
      } else {
        st.camPos.copy(eye); st.camYaw = yaw; st.camPitch = pitch;
      }
      cam.position.copy(st.camPos);
      cam.rotation.set(st.camPitch, st.camYaw, 0, 'YXZ');
    }

    // ------------------------------------------------------------------ look
    function look(dt) {
      const m = input.consumeMouse();
      if (!inputOn()) return;
      const sens = MOUSE_SENS * (C.settings.mouseSensitivity || 1);
      const inv = C.settings.invertY ? -1 : 1;
      p.yaw -= m.dx * sens + input.virtual.lookX * 2.4 * dt;
      p.pitch -= (m.dy * sens + input.virtual.lookY * 1.8 * dt) * inv;
      p.yaw = wrap(p.yaw);
      if (p.mode === 'sit' && p.seat) {
        const s = p.seat, range = s.yawRange ?? 1.4;
        const d = U.clamp(wrap(p.yaw - s.yaw), -range, range);
        p.yaw = wrap(s.yaw + d);
        p.pitch = U.clamp(p.pitch, s.pitchMin ?? -1.0, s.pitchMax ?? 1.2);
      } else p.pitch = U.clamp(p.pitch, -1.52, 1.52);
    }

    // ------------------------------------------------------------------ events
    C.on('sit', () => {
      const s = p.seat;
      if (!s) return;
      if (typeof s.yaw === 'number') p.yaw = s.yaw;
      p.pitch = typeof s.pitch === 'number' ? s.pitch : 0;
      st.sitTimer = 0; st.sitBlock = anyMoveDown(); rockT.t = 0;
      p.velocity.set(0, 0, 0); p.crouch = 0;
      startTransition();
    });
    C.on('stand', () => {
      p.grounded = true; st.airborne = false; p.velocity.set(0, 0, 0);
      const g = physics.groundAt(p.position.x, p.position.z, p.position.y + 0.1, 0.5);
      if (g) p.position.y = g.y;
      startTransition();
    });
    C.on('teleport', (e) => {
      st.trans = 0; p.velocity.set(0, 0, 0); st.dip = 0; st.dipV = 0;
      if (!e || !e.freecam) {
        const g = physics.groundAt(p.position.x, p.position.z, p.position.y + 0.05, 0.5);
        p.grounded = !!g && Math.abs(g.y - p.position.y) < 0.5;
        if (p.grounded) p.position.y = g.y;
      }
      placeCamera(0, C.time);
    });
    C.on('pause', () => { input.virtual.moveX = input.virtual.moveY = 0; });

    // ------------------------------------------------------------------ flashlight
    const flash = new THREE.SpotLight(0xfff2dd, 0, 28, 0.46, 0.55, 2);
    flash.name = 'player.flashlight';
    flash.position.set(0.18, -0.16, 0.05);
    flash.target.position.set(0.05, -0.1, -1);
    cam.add(flash); cam.add(flash.target);
    C.registerLight(flash, { id: 'flashlight', room: 'player', kind: 'spot' });
    // core only adds its fallback lights when the scene has none — the flashlight counts, so replicate them for
    // partial builds without the weather module (keeps test builds from rendering black)
    if (!C.modules.some(m => m.name === 'weather')) {
      const h = new THREE.HemisphereLight(0xdde6ff, 0x554433, 1.2); h.name = 'player.fallbackLight'; C.scene.add(h);
      const d = new THREE.DirectionalLight(0xffffff, 1.2); d.position.set(5, 10, 4); d.name = 'player.fallbackLight'; C.scene.add(d);
    }
    let flashLevel = 0;
    const setFlash = (on) => {
      st.flashlightOn = on;
      C.audio.play?.('switch', { volume: 0.5 });
      C.emit('flashlight', { on });
    };
    input.onKey('KeyF', () => setFlash(!st.flashlightOn));
    this.flash = flash;
    this.updateFlash = (dt) => {
      flashLevel = U.damp(flashLevel, st.flashlightOn ? 1 : 0, 18, dt);
      flash.intensity = flashLevel * 60;          // never toggle .visible (light count change = shader recompile)
    };

    // ------------------------------------------------------------------ spawn
    if (p.mode !== 'noclip') {
      const s = C.world.spawn;
      p.position.set(s.x, s.y, s.z); p.yaw = s.yaw; p.pitch = -0.05;
      const g = physics.groundAt(s.x, s.z, s.y + 0.1, 0.5);
      if (g) p.position.y = g.y;
    }
    p.grounded = true;
    st.camPos.set(p.position.x, p.position.y + p.eyeHeight, p.position.z);

    // ------------------------------------------------------------------ debug simulate
    C.debug.simulate = (opts = {}) => {
      const { from, yaw, pitch, keys = [], seconds = 1, dt = 1 / 60 } = opts;
      if (from) {
        if (p.mode === 'sit') p.seat = null;
        p.mode = 'walk';
        p.position.set(from[0], from[1], from[2]);
        p.velocity.set(0, 0, 0);
        const g = physics.groundAt(from[0], from[2], from[1] + 0.05, 0.5);
        p.grounded = !!g && Math.abs(g.y - from[1]) < 0.5;
        if (p.grounded) p.position.y = g.y;
        p.crouch = 0; st.dip = 0; st.dipV = 0;
      }
      if (typeof yaw === 'number') p.yaw = yaw;
      if (typeof pitch === 'number') p.pitch = pitch;
      const added = [];
      for (const k of keys) if (!input.virtualKeys.has(k)) { input.virtualKeys.add(k); added.push(k); }
      let maxY = p.position.y, minY = p.position.y;
      const n = Math.max(1, Math.round(seconds / dt));
      try {
        for (let i = 0; i < n; i++) {
          step(dt, true);
          if (p.position.y > maxY) maxY = p.position.y;
          if (p.position.y < minY) minY = p.position.y;
        }
      } finally {
        for (const k of added) input.virtualKeys.delete(k);
      }
      st.trans = 0;
      placeCamera(0, C.time);
      return { x: p.position.x, y: p.position.y, z: p.position.z, maxY, minY, grounded: p.grounded, mode: p.mode, surface: p.surface };
    };

    this.step = step;
    this.look = look;
    this.placeCamera = placeCamera;
    placeCamera(0, 0);

    // ------------------------------------------------------------------ touch controls
    if (input.isTouch) buildTouchUI(C, st);
  },

  update(dt, t) {
    this.look(dt);
    this.step(dt, false);
    this.updateFlash(dt);
    this.placeCamera(dt, t);
  },
});

// =====================================================================================================================
//  Touch UI: left dynamic joystick (move), right-side drag (look), Use / Jump / Crouch buttons, pause button.
// =====================================================================================================================
function buildTouchUI(C, st) {
  const input = C.input;
  const css = document.createElement('style');
  css.textContent = `
#cozy-touch{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;font-family:Georgia,serif;color:#fbf1e1}
#cozy-touch.on{display:block}
#cozy-touch .zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
#cozy-touch .zl{left:0;width:42%}
#cozy-touch .zr{right:0;width:58%}
#cozy-touch .stick{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid rgba(255,236,205,.35);background:rgba(40,28,20,.18);display:none}
#cozy-touch .knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(255,236,205,.35);box-shadow:0 0 12px rgba(0,0,0,.35)}
#cozy-touch .btn{position:absolute;pointer-events:auto;touch-action:none;width:66px;height:66px;border-radius:50%;border:2px solid rgba(255,236,205,.5);background:rgba(40,28,20,.35);display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.5px;text-shadow:0 1px 2px rgba(0,0,0,.7);user-select:none;-webkit-user-select:none}
#cozy-touch .btn.act{background:rgba(255,200,140,.35)}
#cozy-touch .use{right:28px;bottom:120px;width:78px;height:78px;font-size:16px}
#cozy-touch .jump{right:120px;bottom:40px}
#cozy-touch .crouch{right:28px;bottom:32px;width:58px;height:58px;font-size:12px}
#cozy-touch .pause{right:14px;top:14px;width:44px;height:44px;font-size:15px}
`;
  document.head.appendChild(css);
  const root = document.createElement('div');
  root.id = 'cozy-touch';
  root.innerHTML = '<div class="zone zl"></div><div class="zone zr"></div><div class="stick"><div class="knob"></div></div>' +
    '<div class="btn use">Use</div><div class="btn jump">Jump</div><div class="btn crouch">Crouch</div><div class="btn pause">❚❚</div>';
  document.body.appendChild(root);
  const zl = root.querySelector('.zl'), zr = root.querySelector('.zr'), stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
  const R = 52;
  let moveId = null, ox = 0, oy = 0, lookId = null, lx = 0, ly = 0;

  zl.addEventListener('touchstart', e => {
    e.preventDefault();
    const tt = e.changedTouches[0];
    moveId = tt.identifier; ox = tt.clientX; oy = tt.clientY;
    stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; stick.style.display = 'block';
    knob.style.transform = 'translate(0,0)';
  }, { passive: false });
  const moveTouch = e => {
    for (const tt of e.changedTouches) {
      if (tt.identifier === moveId) {
        let dx = tt.clientX - ox, dy = tt.clientY - oy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        input.virtual.moveX = dx / R; input.virtual.moveY = -dy / R;
      } else if (tt.identifier === lookId) {
        input.mouse.dx += (tt.clientX - lx) * 2.2; input.mouse.dy += (tt.clientY - ly) * 2.2;
        lx = tt.clientX; ly = tt.clientY;
      }
    }
  };
  const endTouch = e => {
    for (const tt of e.changedTouches) {
      if (tt.identifier === moveId) { moveId = null; stick.style.display = 'none'; input.virtual.moveX = 0; input.virtual.moveY = 0; }
      if (tt.identifier === lookId) lookId = null;
    }
  };
  zr.addEventListener('touchstart', e => {
    e.preventDefault();
    const tt = e.changedTouches[0];
    lookId = tt.identifier; lx = tt.clientX; ly = tt.clientY;
  }, { passive: false });
  for (const el of [zl, zr]) {
    el.addEventListener('touchmove', e => { e.preventDefault(); moveTouch(e); }, { passive: false });
    el.addEventListener('touchend', endTouch); el.addEventListener('touchcancel', endTouch);
  }
  // consumeMouse only reports while pointer-locked on desktop; on touch we feed input.mouse directly (core reads it)
  const btn = (sel, down, up) => {
    const el = root.querySelector(sel);
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('act'); down(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); el.classList.remove('act'); if (up) up(); }, { passive: false });
    return el;
  };
  btn('.use', () => {
    if (!C.state.started || C.state.paused) return;
    if (C.interact.focused) C.interact.useFocused();
    else if (C.player.mode === 'sit') C.player.stand();
  });
  btn('.jump', () => input.virtualKeys.add('Space'), () => input.virtualKeys.delete('Space'));
  const cb = btn('.crouch', () => { st.touchCrouch = !st.touchCrouch; });
  btn('.pause', () => C.pause());
  const sync = () => {
    root.classList.toggle('on', C.state.started && !C.state.paused);
    cb.classList.toggle('act', st.touchCrouch);
  };
  ['start', 'pause', 'resume'].forEach(ev => C.on(ev, sync));
  sync();
}

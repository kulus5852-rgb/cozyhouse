# Rainy Day Cottage — Build Spec (THE CONTRACT)

A first‑person, walkable, 3D **cozy cottage on a rainy day**, delivered as ONE self‑contained HTML file
(`D:/cozyses/cozy-house.html`). Built from modules in `D:/cozyses/src/*.js` that `tools/build.mjs` inlines.

Quality bar: this should feel like a small indie "cozy game" vertical slice — warm lamp‑lit interior, fire crackling,
rain streaking down the windows, dripping eaves, puddles rippling, thunder rolling, procedural rain audio that is
muffled indoors and loud outside, lots of hand‑placed lived‑in detail, smooth walking with solid collisions, stairs to a
loft bedroom under the roof with skylights, a porch to stand on and watch the rain. Everything is procedural
(no external assets besides three.js from the CDN).

Everyone reads this whole document. If this spec and `src/core.js` ever disagree about an API, **core.js wins** — read it.

---------------------------------------------------------------------------------------------------------------------
## 1. Files, build, tools

```
D:/cozyses/
  SPEC.md                 this file
  src/template.html       HTML shell (importmap, loading screen). Owned by orchestrator — do not edit.
  src/<module>.js         one ES module per feature (see §9 for owners)
  tools/build.mjs         node tools/build.mjs [--only a,b] [--out build/x.html] [--exclude a] [--strict]
  tools/shot.mjs          headless Chrome (real GPU) screenshots + runtime error report
  tools/walktest.mjs      deterministic walking/collision tests (tools/walktests.json)
  tools/conformance.mjs   checks the core API surface against this spec
  tools/views.json        named camera viewpoints for screenshots
  build/                  scratch builds (use your own file name, e.g. build/living.html)
  shots/                  screenshots (use your own sub folder, e.g. shots/living/)
```

* Module order in the final HTML (script tags, registration order): `core, materials, props, house, player, weather,
  outdoor, audio, living, kitchen, hallstudy, loft, cat, post`. **Init/update order is by each module's `order`
  number**, not file order.
* Each module is its own `<script type="module">` tag → a syntax/runtime error in one module does not kill the others.
  Core wraps every `init`/`update` in try/catch and records errors in `COZY.debug.errors`.
* `--only house,living` builds core + materials + props + the listed modules. Always use `--out build/<you>.html`
  for your own tests (never overwrite `cozy-house.html` during development; the orchestrator builds that).
* Screenshots: `node tools/shot.mjs --html build/living.html --views living_overview,living_fireplace --outdir shots/living`
  then LOOK at the PNGs with the Read tool. Custom view: `--view "name:x,y,z,yaw,pitch"` (eye position, radians).
  Night: `--params "time=night"`. Run JS first: `--eval "COZY.debug.interact('lamp_living_floor')"`.
  Collider wireframes: `--colliders`. The report lists page errors, console errors, module errors, draw calls.
* Paths: use `D:/cozyses/...` or `/d/cozyses/...` (Git Bash on Windows). Node 22 is installed.
* Other OSes: `tools/chrome.mjs` locates the browser (`CHROME_PATH`, the Windows installs, or Chrome for Testing in
  `~/.cache/cozy-chrome`). Without a GPU it runs WebGL on SwiftShader; keep shots small (`--w 640 --h 360`) and pass
  `--timeout` to `walktest.mjs` / `shot.mjs` when boot is slow.

### Imports
Only three.js r170 via the importmap:
```js
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// allowed: anything under three/addons/ that exists in r170 (postprocessing/*, lights/RectAreaLightUniformsLib.js,
// math/SimplexNoise.js, environments/RoomEnvironment.js, objects/*, geometries/*, utils/*, shaders/*)
```
No other URLs, no fetch, no images/audio files, no fonts from the web. Textures = canvas‑generated. Audio = WebAudio synthesis.
r170 notes: lights are physically based (intensity in candela for Point/Spot, decay 2); `ColorManagement` enabled;
use `texture.colorSpace = THREE.SRGBColorSpace` for color maps; no `useLegacyLights`.

---------------------------------------------------------------------------------------------------------------------
## 2. Module contract

```js
import * as THREE from 'three';
const C = window.COZY;                 // created by core.js (first script tag)
C.register({
  name: 'living',                      // unique
  order: 60,                           // init + update order (lower first)
  init(C) { /* build everything; may be async (return a Promise) */ },
  update(dt, t, C) { /* per frame; dt seconds (clamped ≤ 0.05), t = elapsed seconds */ },
  lateUpdate(dt, t, C) { /* optional, after all updates, before camera apply + render */ },
});
```
Rules:
* No side effects at module top level except `C.register(...)` (and constant definitions).
* Everything you add goes under one root group named after the module (`root.name = 'living'`) added to `C.scene`.
* Name meshes meaningfully (`mesh.name = 'living.sofa'`).
* **Never allocate per frame** in update (reuse vectors/colors); never create materials in loops — use `C.mats` or
  `C.util.stdMat()` (cached). Per‑instance materials that change (lamp shades that glow) must be `.clone()`d.
* Keep the console clean. No `console.log` spam; use `C.log('living', 'msg')` (prints only in debug mode).
* Use `C.util.rng()` (seeded by `?seed=`) instead of `Math.random()` for placement so screenshots are reproducible.
  (Math.random is fine for runtime particle jitter.)
* Only touch your own file. Need something from another module? Use the events/APIs in this spec; if it truly
  does not exist, implement a graceful fallback (`C.audio.play?.(...)`) and mention it in your final report.

Standard `order` numbers: core internals 0, materials 5, props 6, player 10, house 20, weather 30, outdoor 40,
audio 50, living/kitchen/hallstudy/loft 60, cat 70, post 90.

---------------------------------------------------------------------------------------------------------------------
## 3. Core API (`window.COZY`, written in src/core.js)

### 3.1 Engine
* `C.THREE` (the THREE namespace), `C.version`.
* `C.renderer` — WebGLRenderer({antialias:true, powerPreference:'high-performance'}), `outputColorSpace = SRGB`,
  `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.0`, `shadowMap.enabled = true`,
  `shadowMap.type = PCFSoftShadowMap`, pixel ratio `min(devicePixelRatio, quality cap)`.
* `C.scene` (THREE.Scene), `C.camera` (PerspectiveCamera fov from settings (default 70), near 0.05, far 500;
  **the camera is added to the scene** so things can be parented to it, e.g. a held mug or the flashlight).
* `C.clock`, `C.time` (elapsed seconds), `C.frame` (frame counter).
* `C.register(def)`, `C.modules` (array), `C.boot()` (called by the last script tag: inits all modules sorted by
  `order`, awaiting async inits, shows progress in `#boot-loading .msg`, then `renderer.compile(scene,camera)`,
  hides `#boot-loading`, sets `C.ready = true`, emits `'ready'`, starts the loop).
* `C.renderOverride` — if set to a function `(dt) => void`, core calls it instead of `renderer.render(scene, camera)`
  (post module uses it for the EffectComposer).
* Loop: `dt = min(clock delta, 0.05)`; call `update` of every module (sorted by order), then `lateUpdate`s, then
  core's interaction focus update, then camera fallback (see 3.4), then render. Modules are updated even while
  paused (ambience keeps animating); gameplay input is ignored while `C.state.paused`.
* `C.state` = `{ started: false, paused: false, uiOpen: false }`.
* `C.start()` — user clicked "enter": sets started, requests pointer lock (desktop), emits `'start'` **synchronously
  inside the user gesture** (audio relies on it). `C.pause()`, `C.resume()` (re‑requests pointer lock; emits
  `'pause'`/`'resume'`). Losing pointer lock while started & not already paused → `C.pause()`.
  With `?autostart=1` core calls `C.start()` automatically after boot (no pointer lock; used by tests).

### 3.2 Events
`C.on(name, fn)`, `C.off(name, fn)`, `C.emit(name, payload)`. Standard events:

| event | payload | emitted by |
|---|---|---|
| `ready` | – | core |
| `start` / `pause` / `resume` | – | core |
| `resize` | `{w,h}` | core |
| `settings` | full settings object | core (`C.setSetting`) |
| `footstep` | `{surface, run, crouch, x,y,z}` | player |
| `jump` / `land` | `{surface, speed}` | player |
| `sit` / `stand` | `{id}` | player |
| `door` | `{id, open, x,y,z}` | house / outdoor(gate) |
| `lamp` | `{id, on, x,y,z}` | props.lamp |
| `lightning` | `{strength 0..1, distance km, dirX, dirZ}` | weather |
| `timeofday` | `{preset, daylight}` | weather |
| `rain` | `{level}` | weather |
| `fire` | `{level}` | living |
| `music` | `{playing}` | living (record player) / audio |
| `interact` | `{id}` | core (after any onUse) |
| `toast` | `{text}` | anyone (core shows it) |

### 3.3 Input
`C.input.keys` (Set of `KeyboardEvent.code` currently held), `C.input.isDown(code)` (true if held physically OR in
`C.input.virtualKeys`), `C.input.onKey(code, fn)` (keydown, no auto‑repeat, ignored while `C.state.uiOpen`),
`C.input.consumeMouse()` → `{dx, dy}` accumulated mouse movement since last call (only while pointer‑locked or on
touch-look), `C.input.virtualKeys` (Set — used by tests/touch), `C.input.virtual = {moveX, moveY, lookX, lookY}`
(analog −1..1 from touch joystick; player adds these), `C.input.pointerLocked`, `C.input.isTouch`.
Left mouse click while locked = interact (core handles). **Key map** (documented in the help screen):
WASD/arrows move · Shift run · C or Ctrl crouch · Space jump · E / left‑click interact · F flashlight ·
T time of day · R rain intensity · M mute · H help · Esc pause/menu.

### 3.4 Player state (`C.player`, owned by core, driven by the player module)
```
C.player = {
  position: Vector3 (FEET position), velocity: Vector3, yaw: 0, pitch: 0,     // yaw 0 looks toward −Z (north)
  height: 1.75, crouchHeight: 1.2, eyeHeight: 1.62, radius: 0.28, stepUp: 0.35,
  crouch: 0 (0..1), grounded: true, surface: 'wood', mode: 'walk',            // 'walk' | 'sit' | 'noclip'
  seat: null, bob: Vector3 (camera offset for head bob), cameraOwner: null,   // player module sets cameraOwner='player'
  sitAt(seat), stand(),                                                         // see below
}
```
* Camera convention: `camera.rotation.order = 'YXZ'`, `rotation.y = yaw`, `rotation.x = pitch` (+ looks up).
  Direction of yaw: forward = (−sin yaw, 0, −cos yaw). yaw 0 → north (−Z), π/2 → west (−X), π → south (+Z),
  −π/2 → east (+X).
* If `C.player.cameraOwner` is null, core places the camera itself each frame at
  `position + (0, eyeHeight, 0)` with yaw/pitch (noclip: `position` is treated as the EYE position).
  The player module sets `cameraOwner = 'player'` and positions the camera itself (bob, crouch, sitting).
* `C.player.sitAt(seat)` — `seat = { id, position:[x,y,z] (EYE position when seated), yaw, pitch?:0,
  yawRange?: 1.4, pitchMin?: -1.0, pitchMax?: 1.2, exit:[x,y,z] (FEET position to stand up at), lie?: false,
  label?: 'Stand up' }`. Sets `mode='sit'`, emits `'sit'`. The player module eases the camera there; any movement key,
  E, or Space stands up (`C.player.stand()` → teleport feet to `exit`, mode `'walk'`, emit `'stand'`).
  Core provides working default implementations of sitAt/stand (state change + events); player module handles motion.
* Spawn: `C.world.spawn = { x: 0.4, y: 0, z: 2.0, yaw: Math.PI / 2 }` (living room, looking west at the fireplace).

### 3.5 Physics (`C.physics`) — simple, deterministic, AABB/cylinder world
* `addBox(min, max, opts?)` → handle `{ id, min:Vector3, max:Vector3, enabled, tag, set(min,max), remove() }`.
  `min/max` accept `[x,y,z]` or `{x,y,z}`. opts `{ tag: 'wall'|'door'|'furniture'|'fence'|'bound'|..., blocksInteract:
  bool (default true for tag 'wall'/'door'), name }`.
* `addBoxFromObject(object3D, opts?)` → world AABB of the object (after `updateMatrixWorld(true)`), optional
  `opts.pad` (shrink/grow in XZ, e.g. −0.02) and `opts.minY/maxY` overrides.
* `addCylinder(x, z, radius, yMin, yMax, opts?)` → handle.
* `addFloor(minX, minZ, maxX, maxZ, y, opts?)` → walkable horizontal rectangle; `opts.surface` for footsteps.
* `addRamp(minX, minZ, maxX, maxZ, axis 'x'|'z', y0, y1, opts?)` → walkable slope; height `y0` at the min edge of
  `axis`, `y1` at the max edge (linear). Used for stairs and steps.
* `addSurfaceTag(minX, minZ, maxX, maxZ, yMin, yMax, surface)` → overrides footstep surface (rugs, path stones).
* `groundAt(x, z, feetY, stepUp = 0.35)` → `{ y, surface }` of the highest floor/ramp whose height ≤ feetY + stepUp,
  or `null`. `surfaceAt(x, y, z)` → surface string (tags take priority over floors).
* `move(pos, dx, dz, radius, height, stepUp)` → moves the FEET position `pos` (Vector3, mutated) horizontally with
  sub‑stepping (≤ 0.1 m) and circle‑vs‑AABB/cylinder push‑out sliding. A collider blocks if its Y‑range overlaps
  `[pos.y + stepUp + 0.01, pos.y + height]`. Returns `{ hit: bool }`.
* `raycast(origin, dir, maxDist, filter?)` → `{ dist, collider } | null` (ray vs enabled boxes/cylinders).
* `colliders` (array of handles), `debugDraw(bool)` (wireframes; also `?colliders=1`).
* Surfaces: `'wood' 'tile' 'rug' 'stone' 'grass' 'gravel' 'porch' 'mud' 'stairs' 'water' 'carpet'`.
* Player collision size: radius 0.28, height 1.75 (1.2 crouched), stepUp 0.35. Gravity 12 m/s², jump v = 3.6 m/s.

### 3.6 Interaction (`C.interact`)
* `add({ id, object, label, onUse, enabled?, range? = 2.3 })` → handle `{ remove() }`.
  `object` is an Object3D (raycast recursively). `label` string or function → string (e.g. `'Turn off the floor lamp'`).
  `enabled()` optional predicate. `id` must be unique (see required IDs in §8).
* Every frame core raycasts from the camera centre; nearest enabled interactable within range, not occluded by a
  collider with `blocksInteract`, becomes `C.interact.focused`. HUD shows `E  <label>`; E key or left click (locked)
  calls `onUse()` and emits `'interact'`.
* `C.interact.useFocused()`, `C.interact.list()` → `[{id, label, position}]`, `C.interact.get(id)`.
* Interactable objects must NOT be baked (set `userData.dynamic = true` on them or keep them outside baked groups).

### 3.7 Audio base (`C.audio`) — core creates the object with safe no‑op stubs; the audio module fills it in
```
C.audio = {
  ctx: null, started: false, master: null, buses: {},            // audio module fills on 'start'
  play(name, opts) {},            // one-shot sfx: 'click','creak','door_open','door_close','thud','page','pour','sip',
                                  // 'meow','chime','match','whoosh','drawer','curtain','splash','clink','gate','switch'
                                  // opts {x,y,z, volume, rate}
  music: { playing: false, play() {}, stop() {}, toggle() {}, setPosition(x,y,z) {} },   // record player
  kettle: { start(x,y,z) {}, stop() {} },                                                  // boil → whistle
  purr: { start(x,y,z) {}, stop() {} },                                                    // cat
  loop(name, opts) → { stop(), setVolume(v), setPosition(x,y,z) },                         // generic positional loop
  setListener(camera) {},
}
```
Modules call these freely (they are stubs until the audio module is present). The audio module must replace the
functions **on the same objects** (`Object.assign(C.audio.music, {...})`), never replace `C.audio` itself.

### 3.8 HUD
`C.hud.prompt(text | null)`, `C.hud.toast(text, seconds = 3)`, `C.hud.setCrosshair('dot'|'ring'|'hidden')`,
`C.hud.el` (root div). Core injects its own CSS (`<style>` from JS). Debug overlay (fps, draw calls, triangles,
position, room) when `?debug=1` or F3. Warm, minimal, serif typography, soft shadows.

### 3.9 Settings
`C.settings = { masterVolume: 0.8, musicVolume: 0.7, ambienceVolume: 0.9, sfxVolume: 0.8, mouseSensitivity: 1.0,
invertY: false, fov: 70, quality: 'high' ('low'|'medium'|'high'), headBob: false, showFps: false }`,
persisted in localStorage `cozy-settings-v1`. `C.setSetting(key, value)` → emits `'settings'`.
URL overrides `?quality=low`, `?mute=1`.
Quality meaning: low = pixelRatio ≤ 1, no shadows, no bloom, rain 40%; medium = pixelRatio ≤ 1.25, no shadows,
bloom; high = pixelRatio ≤ 2, fire shadows, bloom, full rain.

### 3.10 Environment state (`C.env`) — shared, mostly written by weather/living
```
C.env = { preset: 'dusk', daylight: 0.45, rain: 0.7, wind: {x: 0.35, z: 0.15}, lightningFlash: 0,
          fireLevel: 1, indoor: 1 (smoothed indoor amount at the camera), musicPlaying: false }
```
### 3.11 World helpers (`C.world`, in core — pure functions from the layout in §4)
* `indoorAmount(x, y, z)` → 1 inside the house footprint (x∈[−6.75,6.75], z∈[−4.75,4.75]), 0.5 on the covered porch
  (x∈[1.2,6.8], z∈[4.75,7.2]), 0 elsewhere. (Doorway openness is handled by audio.)
* `isUnderRoof(x, y, z)` → true if rain cannot reach the point (see §4.8 occluders).
* `roomAt(x, y, z)` → `'living'|'kitchen'|'hall'|'study'|'stairs'|'loft'|'porch'|'yard'|'lane'|'outside'`.
* `spawn` (see 3.4). `C.house` is filled by the house module (see §9 house).

### 3.12 Utilities (`C.util`)
Geometry builders (all return the Mesh, already added to `parent`, `castShadow=false`, `receiveShadow=true`,
world‑scale UVs applied unless `opts.uv === false`):
* `box(parent, w, h, d, material, x, y, z, opts?)` — centred box. opts `{rx, ry, rz, round: radius (RoundedBox),
  segments, cast, receive, name, uvScale}`.
* `boxAt(parent, minX, minY, minZ, maxX, maxY, maxZ, material, opts?)` — box from corners (architecture).
* `cyl(parent, rTop, rBottom, h, material, x, y, z, opts?)` — centred cylinder; opts `{radial: 16, open, rx, ry, rz,
  thetaStart, thetaLength, name}`.
* `sphere(parent, r, material, x, y, z, opts?)` (opts `{w: 16, h: 12, sx, sy, sz}` scale).
* `lathe(parent, points /* [[r, y], ...] */, material, x, y, z, opts?)` (opts `{segments: 24}`).
* `extrude(parent, shape, depth, material, opts?)` → ExtrudeGeometry mesh (bevel off unless requested).
* `worldUV(geometry, scale = 1)` — box‑project UVs by face normal so 1 UV unit = `1/scale` metres (textures in
  `C.mats` are authored for **1 UV unit = 1 metre**). Call after scaling the geometry.
* `stdMat(color, roughness = 0.8, metalness = 0, opts?)` — cached `MeshStandardMaterial` keyed by params
  (opts: `emissive, emissiveIntensity, transparent, opacity, side, flatShading`).
* `bakeStatic(group, opts?)` — merges all static meshes under `group` by (material, castShadow, receiveShadow) into a
  few big meshes (converting to non‑indexed, normalising attributes to position/normal/uv, applying transforms).
  Skips: objects with `userData.dynamic === true` (and their children), InstancedMesh, SkinnedMesh, Points, Lines,
  Sprites, transparent materials. **Every module must bake its static decoration** — draw calls matter.
* `blobShadow(parent, x, y, z, w, d, opacity = 0.35)` — soft dark contact‑shadow decal (shared radial texture,
  depthWrite false, polygonOffset) lying on the surface at height y (+2 mm). Put one under every furniture piece.
* `canvasTexture(w, h, draw(ctx, w, h), opts?)` → CanvasTexture (sRGB, RepeatWrapping, anisotropy 8, mipmaps).
* `glowSprite(color, size, opacity = 1)` → additive Sprite with a shared soft radial texture (lamp halos, flames).
* `rng(seed?)` → seeded PRNG function `() => [0,1)`; `C.util.random` = the global seeded one.
* `noise2D(x, y)`, `noise3D(x, y, z)` (simplex, −1..1), `fbm2D(x, y, octaves)`.
* `damp(a, b, lambda, dt)`, `lerp`, `clamp`, `smoothstep(e0, e1, x)`, `degToRad`.
* `C.mat(name)` → `C.mats[name]` if it exists, else a cached fallback `MeshStandardMaterial` using the fallback color
  table in core (so modules never crash if materials.js is missing).
* `C.registerLight(light, { id, room, kind })` → bookkeeping for the light budget/QA (`C.lights` array).
* `C.log(tag, ...args)` → console.debug only in debug mode.

### 3.13 Debug API (`C.debug`, always present; extras active with `?debug=1`)
URL params: `debug=1`, `autostart=1`, `cam=x,y,z,yaw,pitch` (initial view, freecam), `freecam=1`, `time=afternoon|dusk|night`,
`rain=0..1`, `quality=`, `mute=1`, `seed=N`, `lightning=0` (disable random lightning), `colliders=1`.
* `setView(x, y, z, yaw, pitch, freecam = true)` — freecam: `mode='noclip'`, (x,y,z) is the EYE; else FEET in walk mode.
* `waitFrames(n)` → Promise resolved after n rendered frames. `frames` (count).
* `info()` → `{ fps, drawCalls, triangles, geometries, textures, programs, lights, meshes, colliders,
  interactables, modules: [{name, order, initMs, error}] }`.
* `errors` → array of `{ module, phase: 'init'|'update', message, stack }` (also console.error'd once per message).
* `interact(id)` → calls that interactable's `onUse()` directly (tests). `listInteractables()`.
* `simulate({ from?:[x,y,z], yaw?, pitch?, keys:[codes], seconds, dt = 1/60 })` → **implemented by the player module**
  (core has a stub that throws 'player module missing'): teleports FEET to `from` (mode walk, velocity 0) if given,
  holds `keys` virtually, steps the player physics synchronously `seconds/dt` times (no rendering), releases keys,
  returns `{ x, y, z, maxY, minY, grounded, mode, surface }`.

---------------------------------------------------------------------------------------------------------------------
## 4. World layout (1 unit = 1 m, +Y up, +X east, +Z south; the house front faces +Z)

### 4.1 Levels
* Ground floor finished floor **y = 0**. Ground‑floor ceiling **y = 2.8** (exposed dark beams below it, bottoms at
  y ≈ 2.62, running north–south every ~1.45 m).
* Upper floor slab y 2.8–3.0; **upper floor y = 3.0**.
* Long (north/south) exterior walls top out at the eave, **y = 4.0**. Gable (east/west) walls rise to the roof.
* **Roof**: gable, ridge along X at z = 0. Underside `yu(z) = 7.5 − 0.7·|z|` (35°). Outer surface ≈ yu + 0.27.
  Eaves overhang to |z| = 5.6 (yu = 3.58); gables overhang to |x| = 7.4. Dark wet slate/shingles, some moss.
* Outdoor ground around the house is **y = −0.45** (flat inside the fence; gentle hills beyond the fence).
  House sits on a fieldstone plinth (visible from −0.45 to ≈ +0.35 on the outside).

### 4.2 Exterior walls (thickness 0.25)
Outer faces x = ±7.0, z = ±5.0 → interior faces **x = ±6.75, z = ±4.75**. Wall colliders must span y ∈ [−0.45, 4.1]
(they block from outside at ground level −0.45 too); gable walls also block upstairs. The ground‑floor physics floor is
`addFloor(−7, −5, 7, 5, 0, …)` (covers door thresholds; walls are colliders anyway). Exterior: cream‑white clapboard siding,
white trim, sage‑green shutters on ground‑floor windows, stone plinth, gutters + 4 downspouts at the corners
(outlets at (±7.1, −0.3, ±5.15)) with splash blocks.

### 4.3 Ground floor plan
```
 z=-4.75 ┌──────────────────────────────────┬──────────────────────┐   north wall (windows: kitchen, study)
         │ KITCHEN (tile floor z<-2.6)      │ STUDY                │
         │ counters N + W walls, sink under │ desk under north win │
         │ north window, stove, fridge,     │                      │
         │ hutch                            D2 door                │
         │ DINING table ~(-3.4,-1.5)        │                      │
 z=-0.7  │                                  ├───D3 door──────┬─────┤ P2 wall z=-0.7 (x 2.075→6.75)
 z= 0.3  │ ········· open plan ············ │ HALL           │STAIR│ (stairs x 5.52→6.75, rise to north)
         │ LIVING ROOM                      D1 opening        │ ↑   │
fireplace│ sofa, armchair, rug, bookshelf,  │ clock, coats,  │ ↑   │
(west    │ record player, lamps             │ bench          │ ↑   │  bottom riser z=3.6
 wall)   │    window seat (south window)    │    front door  │     │
 z=4.75  └──────────────────────────────────┴──────[door]─────┴─────┘   south wall → porch
       x=-6.75                          x=1.925/2.075 (P1)        x=6.75
```
Partitions (height 0→2.8, thickness 0.15):
* **P1**: x ∈ [1.925, 2.075], z ∈ [−4.75, 4.75]. Openings: **D1** z ∈ [1.4, 2.6], height 2.25, open cased
  archway (living ↔ hall). **D2** z ∈ [−3.1, −2.2], height 2.05, hinged door `door_kitchen_study`, hinge at z=−3.1,
  swings into the study (+X) ~95°.
* **P2**: z ∈ [−0.775, −0.625], x ∈ [2.075, 6.75]. Opening **D3** x ∈ [2.6, 3.5], height 2.05, hinged door
  `door_hall_study`, hinge at x=2.6, swings into the study (−Z).
* Living (x −6.75→1.925, z 0.3→4.75) and kitchen/dining (z −4.75→0.3) are one open space; a dark ceiling beam
  marks z = 0.3; floor: wood everywhere except kitchen tile x ∈ [−6.75, 1.925], z ∈ [−4.75, −2.6].

### 4.4 Stairs (house module)
* x ∈ [5.52, 6.75] (1.23 wide) along the east wall, rising **northwards**: 15 risers × 0.2 m, tread 0.27 m.
  Step i (1..15) top at y = 0.2·i over z ∈ [3.6 − 0.27·i, 3.6 − 0.27·(i−1)]. Bottom riser at z = 3.6, top at z = −0.45.
* Physics: `addRamp(5.52, −0.45, 6.75, 3.6, 'z', 3.0, 0.0, {surface:'stairs'})` (y=3.0 at z=−0.45, y=0 at z=3.6).
* Banister/railing collider: box x ∈ [5.42, 5.52], z ∈ [−0.45, 3.6], y ∈ [0, 4.05] (also serves as the upstairs
  stairwell railing). Upstairs south railing of the stairwell: x ∈ [5.52, 6.75], z ∈ [2.35, 2.45], y ∈ [3, 4].
* Stairwell opening in the upper slab: x ∈ [5.52, 6.75], z ∈ [−0.45, 2.4].
* Approach area in front of the bottom step (x ∈ [5.52, 6.75], z ∈ [3.6, 4.75]) must stay clear.
* The triangle under the stairs is closed with panelling (small cupboard door, decorative).

### 4.5 Upper floor (loft)
* Floors (y = 3.0): UA x ∈ [−6.75, 5.52], z ∈ [−4.75, 4.75]; UB (landing) x ∈ [5.52, 6.75], z ∈ [−4.75, −0.45];
  UC x ∈ [5.52, 6.75], z ∈ [2.4, 4.75].
* Headroom: walkable only where |z| ≤ 3.7. House adds invisible "eave" colliders x ∈ [−6.75, 6.75],
  z ∈ [3.7, 4.75] and z ∈ [−4.75, −3.7], y ∈ [3.0, 7.5] (tag 'eave', blocksInteract false). Knee walls y 3.0→4.0 at
  z = ±4.75; sloped whitewashed board ceiling following the roof underside, exposed rafters, a ridge beam, and a few
  collar ties at y ≈ 6.3.
* The loft is one open room: bedroom at the west end, reading nook at the east end by the landing.

### 4.6 Windows & doors (house builds openings, frames, sills, glass; IDs used by other modules)
Glass panes: registered in `C.house.glassPanes` (each mesh `userData = {windowId, normal:[x,y,z], w, h, skylight}`).
Divided lites (muntins) in cottage style. Interior sills deep wooden (room modules may put plants/candles on them).
| id | wall | span | y (sill→head) |
|---|---|---|---|
| `w_living_s` | south | x ∈ [−5.2, −2.6] | 0.55 → 2.3 (window seat below, living module) |
| `w_living_w1` | west | z ∈ [0.75, 1.35] | 1.0 → 2.2 |
| `w_living_w2` | west | z ∈ [3.65, 4.25] | 1.0 → 2.2 |
| `w_kitchen_n` | north | x ∈ [−4.3, −2.9] | 1.1 → 2.2 (over the sink) |
| `w_dining_w` | west | z ∈ [−2.2, −1.0] | 0.9 → 2.2 |
| `w_study_n` | north | x ∈ [3.2, 5.4] | 0.85 → 2.25 (desk below) |
| `w_study_e` | east | z ∈ [−3.6, −2.4] | 0.9 → 2.2 |
| `w_hall_s` | south | x ∈ [2.35, 2.95] | 0.9 → 2.1 |
| `w_loft_w_round` | west gable | circle centre (y 5.1, z 0), r 0.55 | above the bed headboard |
| `w_loft_e` | east gable | z ∈ [−2.5, −1.3] | 3.6 → 5.3 (at the landing) |
| `w_loft_e_round` | east gable | circle centre (y 6.2, z 0), r 0.35 | |
| `sk_1` | south roof slope | plan x ∈ [−5.9, −5.0], z ∈ [1.1, 2.4] | skylight above/near the bed |
| `sk_2` | south roof slope | plan x ∈ [−3.3, −2.4], z ∈ [1.1, 2.4] | skylight |
| `sk_3` | north roof slope | plan x ∈ [3.8, 4.7], z ∈ [−2.4, −1.1] | skylight over the nook |

Doors (house module; interactables; animated; colliders switch **immediately** on toggle — closed: box filling the
opening; open: thin box along the open leaf):
* `door_front` — south wall x ∈ [3.25, 4.25], height 2.15, forest‑green (#2e4a3b) plank door with a 4‑lite window in
  the upper part, brass knob + knocker; hinge at x = 3.3, swings inward (−Z) ~100°.
* `door_kitchen_study` (D2) and `door_hall_study` (D3) as above — cream painted ledged‑and‑braced cottage doors.
* Emit `C.emit('door', {id, open, x, y, z})` on toggle (audio plays creaks).

### 4.7 Porch (structure = house module; furniture/lantern = outdoor module)
* Deck x ∈ [1.2, 6.8], z ∈ [5.0, 7.2], top **y = 0.0** (fascia + lattice skirt down to −0.45); surface `'porch'`.
* Shed roof x ∈ [1.0, 7.0] from y = 3.2 at the wall (z = 5.0) down to y = 2.6 at z = 7.4 (underside); beam at z = 7.1.
* Posts (0.14²) at (1.3, 7.1), (2.85, 7.1), (4.65, 7.1), (6.7, 7.1).
* Railings h 0.9 (colliders y 0→1.0): z = 7.1 for x 1.3→2.85 and 4.65→6.7; x = 1.25 and x = 6.75 for z 5.0→7.1.
* Steps x ∈ [3.0, 4.5]: treads y −0.15 (z 7.2→7.5), −0.30 (z 7.5→7.8), ground −0.45 after z 7.8.
  Physics: `addRamp(3.0, 7.2, 4.5, 7.8, 'z', 0.0, −0.45, {surface:'porch'})`.
* Keep clear: front door swing, the line x = 3.75 from the door to the steps.

### 4.8 Rain occluders (used by `C.world.isUnderRoof`, rain shader, splashes)
* Main roof: |x| ≤ 7.4 and |z| ≤ 5.6 and y < 7.77 − 0.7·|z|.
* Chimney stack: x ∈ [−7.9, −7.0], z ∈ [1.8, 3.2], y < 8.4.
* Porch roof: x ∈ [1.0, 7.0], z ∈ [5.0, 7.4], y < 3.27 − 0.25·(z − 5.0).
* Drip lines (water falling off roof edges): main eaves at z = ±5.6, y ≈ 3.58, x ∈ [−7.4, 7.4];
  porch roof front edge z = 7.42, y ≈ 2.58, x ∈ [1.0, 7.0]. Downspout outlets at (±7.1, −0.3, ±5.15).

### 4.9 Fireplace & chimney
* Inside (living module): stone chimney breast x ∈ [−6.75, −6.2], z ∈ [1.6, 3.4], y 0→2.8; firebox opening centred
  z = 2.5, width 1.0, height 0.85 (y 0.15→1.0), recessed to x ≈ −6.7; hearth slab x ∈ [−6.2, −5.7], z ∈ [1.7, 3.3],
  y 0→0.08; mantel shelf at y ≈ 1.35. Collider x ∈ [−6.75, −5.75], z ∈ [1.6, 3.4], y ∈ [0, 2.8].
  Fire light position ≈ (−6.25, 0.55, 2.5).
* Outside (house module): fieldstone stack x ∈ [−7.9, −7.0], z ∈ [1.8, 3.2], from y = −0.45 up to y = 8.4 with a cap
  and a chimney pot. Smoke (weather module) rises from (−7.45, 8.5, 2.5) when `C.env.fireLevel > 0`.

### 4.10 Yard & surroundings (outdoor module)
* Walkable ground: `addFloor(−15, −12, 15, 19, −0.45, {surface:'grass'})` inside the fence and the lane
  `addFloor(−16, 19, 16, 23.5, −0.45, {surface:'gravel'})`.
* Picket fence (h ~1.0, white/weathered) along x = ±15 (z −12→19), z = −12, z = 19 with a **gate**
  `gate` at x ∈ [3.0, 4.5] (hinge x = 3.0, interactable, emits `'door'` with id `gate`). Fence colliders.
* Lane (gravel, puddles) z ∈ [19.6, 23.0]; hedge row at z ≈ 24; invisible bounds at z = 23.5 and x = ±16 for the lane.
* Flagstone path from the porch steps (x ≈ 3.75, z = 7.8) to the gate (z = 19); surface tag 'stone'.
* Streetlamp (antique lantern post) at (6.2, −0.45, 20.2), ~3.8 m; mailbox at (2.2, z 19.8).
* Pond centre (−9, 9.5) r ≈ 2.4 with stones, reeds, lily pads, rain ripples; bench `bench` at (−9, 13.2) facing north.
* Big oak at (−6.5, 14), maple at (11, 12), pines along the back fence, birches, hydrangea/flower beds along the south
  facade (z 5.1→5.9, x −6.8→1.0 — low, no colliders), raised vegetable beds north (x 2→9, z −10→−7),
  garden shed at (−11.5, −8) ~3×2.4, woodpile against the west wall north of the chimney (x −8.1→−7.0, z −1.5→1.2)
  with a little lean‑to roof, puddles everywhere, distant hills + 2–3 far neighbour houses with warm lit windows in the fog.
* Test lines that must stay free of colliders (±0.6 m): z = 16.5 for x ∈ [−14.8, 14.8]; x = 3.75 for z ∈ [7.8, 23]
  (except the gate itself); x = 12.5 for z ∈ [−11.8, 18.8].

### 4.11 Keep‑clear zones (no colliders; small rugs fine)
* Living: z ∈ [1.3, 2.7] for x ∈ [−1.2, 1.925] (entrance walkway from D1); x ∈ [−1.2, 1.9], z ∈ [−1.0, 1.4]
  (living ↔ dining walkway); the spawn point (0.4, 2.0).
* Kitchen: x ∈ [0.6, 1.925], z ∈ [−3.3, −2.0] (D2 approach).
* Hall: front door swing x ∈ [3.2, 4.3], z ∈ [3.6, 4.75]; the line from the door to D1 (z ∈ [1.4, 2.6], x 2.075→3.8);
  stair approach x ∈ [5.52, 6.75], z ∈ [3.6, 4.75]; D3 approach x ∈ [2.6, 3.5], z ∈ [−0.625, 0.6]; x = 3.75 corridor.
* Study: D2 swing x ∈ [2.075, 3.0], z ∈ [−3.1, −2.2]; D3 swing x ∈ [2.6, 3.5], z ∈ [−1.7, −0.775].
* Loft: landing x ∈ [4.4, 6.75], z ∈ [−1.8, −0.45]; strip along the stairwell railing x ∈ [4.2, 5.42], z ∈ [0, 1.6];
  a clear north–south strip x ∈ [−0.6, 0.6] for all z; a walkway along the ridge x ∈ [−3.3, 4.4], z ∈ [−0.9, 0.9].

---------------------------------------------------------------------------------------------------------------------
## 5. Lighting plan & budget
Physically based units. Point/spot light **total ≤ 15** (all created at init; toggling = intensity change, never
add/remove lights at runtime → no shader recompiles). Only the fire light casts shadows (quality high, 512²).
| id | owner | light | notes |
|---|---|---|---|
| `fire` | living | Point #ff8a3d, ~25–45 cd flicker, at (−6.25, 0.55, 2.5) | castShadow on high; follows `C.env.fireLevel` |
| `lamp_living_floor` | living | Point #ffb46b ~15–25 cd | via `C.props.lamp` |
| `lamp_living_table` | living | Point #ffb46b ~10–15 cd | |
| `lamp_dining_pendant` | kitchen | Point #ffc27a ~20–30 cd | pendant over the table |
| `lamp_kitchen` | kitchen | Point #ffd29a ~15 cd | ceiling/under‑cabinet |
| `lamp_hall` | hallstudy | Point #ffb46b ~12 cd | |
| `lamp_study_desk` | hallstudy | Point #ffc27a ~12 cd | |
| `lamp_loft_bedside` | loft | Point #ffb46b ~10 cd | |
| `lights_loft_string` | loft | 1–2 Points #ffcf8a ~6–10 cd | fairy lights along the ridge beam (emissive bulbs) |
| `lamp_loft_nook` | loft | Point #ffb46b ~10 cd | |
| `lamp_porch` | outdoor | Point #ffb060 ~8–12 cd | wall lantern by the front door |
| `lamp_street` | outdoor | Spot #ffc070 ~100–200 cd | down‑cone, rain visible in it |
| `flashlight` | player | Spot #fff2dd ~40–80 cd | parented to camera, off by default (F) |
| sky/ambient | weather | HemisphereLight + DirectionalLight (overcast key / lightning flashes) | + optional ≤ 2 RectAreaLights as soft window light |
These intensities are starting points; tune them by screenshots so interiors read **warm and lamp‑lit but not blown
out**, corners fall off into soft darkness, and the outside reads **cool blue‑grey**. Emissive lamp shades / bulbs +
`C.util.glowSprite` halos sell the glow (bloom picks them up).
Tuned after playtesting ("too bright"): fire 9, living floor 3.6 / table 2.4, dining pendant 5.2 (down-facing spot:
dome pendants no longer light the ceiling), kitchen 3.2, hall 2.6, study desk 3.5, bedside 2.0, loft nook 3.2, string
lights 2 × 1.8 cd; hall, desk and bedside lamps use decay 1.5 (they sit right next to walls / papers); indoor sky fill
`INDOOR_HEMI` 0.08 (weather.js).
Item glow is tuned separately: `GLOW` in props.js scales lamp emissives/halos; shade interiors are unlit colours;
bloom strength 0.3, threshold 1.2 (post.js).

## 6. Art direction & palette
Mood: hygge, late‑afternoon/dusk rain, warm pools of lamp light, dark wood, soft textiles, clutter that tells a story.
* Interior: plaster #efe4d0, sage wallpaper #9caf88 (cream motif), honey‑oak floor #a0673a, dark walnut beams #4a3122,
  cream trim #f3ecdd, kitchen cabinets sage #8fa487, fabrics rust #a4492f, mustard #d09a3a, cream #efe6d4,
  navy #2f3d5a, forest #3d5a45, dusty rose #c98f8a; brass accents. Lamp light #ffb46b; fire #ff7a2a.
* Exterior: siding #e6e0d2 (darker when wet), trim #f4f1ea, shutters #5f7a63, door #2e4a3b, slate roof #3c434b,
  stone #7c776f, wet grass #2f4a2c, dusk sky #4b5566, fog blue‑grey.
* Scale sanity: door 0.9–1.0 × 2.05–2.15, seat height 0.45, table 0.75, counter 0.9, bed top 0.55, sofa back 0.85,
  book 0.2–0.28 tall, mug 0.1.
* Avoid: floating objects, interpenetration, z‑fighting (offset coplanar layers ≥ 2 mm, rugs at +6 mm), flat untextured
  giant surfaces, pure black, over‑saturated colours, everything the same brightness.

## 7. Performance rules
* Target ≥ 60 fps at 1920×1080 on a mid GPU (quality high), ≤ 400 draw calls in any interior view, ≤ 700 outside.
* Bake statics (`C.util.bakeStatic`), instance repeats (books, pickets, grass, leaves, rain), share materials.
* Canvas textures ≤ 1024² (most 512²). No per‑frame allocations. Particles in one draw call per system.
* Transparent objects: few, `depthWrite: false`. Heavy shaders only where they matter (glass, water, rain, fire).

---------------------------------------------------------------------------------------------------------------------
## 8. Required interactable IDs (tests and cross‑module features depend on these)
* house: `door_front`, `door_kitchen_study`, `door_hall_study`
* living: `fireplace` (light/extinguish/add log → `C.env.fireLevel`, emit `'fire'`), `sofa` (sit), `armchair` (sit),
  `window_seat` (sit, looking out at the rain), `record_player` (toggles `C.audio.music`, spins the record),
  `lamp_living_floor`, `lamp_living_table`
* kitchen: `kettle` (boil → whistle → "Make a cup of tea" → a steaming mug appears in the player's hand; Q or click
  to sip; E again to put it down), `lamp_dining_pendant`, `lamp_kitchen`, `dining_chair` (sit)
* hallstudy: `lamp_hall`, `lamp_study_desk`, `clock` (grandfather clock: toast the time / chime), `desk_chair` (sit)
* loft: `bed` (lie down: camera looking up at the skylight), `lamp_loft_bedside`, `lights_loft_string`,
  `lamp_loft_nook`, `loft_chair` (sit)
* outdoor: `gate`, `porch_rocker` (sit, rocking), `bench` (sit), `lamp_porch`
* cat: `cat` (pet → purr)

## 9. Module assignments (one owner per file)
Each module's final report must list: what was built, interactable IDs, lights (ids + intensities), colliders added,
events emitted/consumed, known issues.

* **core** (`src/core.js`): everything in §3 + HUD + input + pointer lock + physics + interaction + debug API +
  util + fallback materials + boot/loop. No visuals of its own except HUD.
* **materials** (`src/materials.js`, order 5): `C.mats` library of procedural canvas‑textured PBR materials (see §10).
* **props** (`src/props.js`, order 6): `C.props` factories (see §11) + their animation updates.
* **house** (`src/house.js`, order 20): all architecture: foundation, floors (+ physics floors/surfaces), walls with
  openings (use Shape+holes → ExtrudeGeometry or box segments), interior plaster/wallpaper (living & loft walls:
  wallpaper on one feature wall, plaster elsewhere), wainscoting in the hall, skirting boards, ceilings + beams,
  window frames/muntins/sills/glass panes (glass: `C.mats.glass` placeholder; weather replaces with a rain shader),
  shutters, window boxes, the 3 doors (+ interactions + colliders), stairs + banister + railing + under‑stair
  panelling, loft knee walls + sloped ceiling + rafters + ridge beam, roof (with skylight holes) + gutters + downspouts,
  chimney stack, porch structure (deck, posts, roof, railings, steps), all wall/eave colliders.
  Fills `C.house = { doors: {front, kitchenStudy, hallStudy} (each {open, toggle(), object}), windows: [...],
  glassPanes: [...], roofY(x, z) }`. **Write a first functional version fast** (floors, walls, colliders, stairs) so
  other modules can test in context, then refine.
* **player** (`src/player.js`, order 10): FPS controller on top of core physics: smoothed accel, walk 2.0 m/s, run 3.8,
  crouch 1.1, jump, gravity, ground snapping on stairs/ramps (step down ≤ 0.4 when grounded), optional subtle vertical
  head bob (setting, off by default; no idle sway),
  footstep events every ~0.62 m (surface from physics), land events, sitting/lying transitions (camera ease, look
  limits), flashlight (F, SpotLight parented to camera), touch controls (left virtual joystick, right‑side drag to
  look, on‑screen Use/Jump buttons) when `C.input.isTouch`, `C.debug.simulate`, noclip for freecam/debug (fly with
  WASD + Space/C), spawn at `C.world.spawn`.
* **weather** (`src/weather.js`, order 30): sky dome (overcast animated clouds, time‑of‑day tints, lightning glow),
  fog (FogExp2, denser outside, thin indoors via `C.env.indoor`), Hemisphere + Directional light, optional soft
  window RectAreaLights, time of day presets (T: afternoon → dusk → night; default dusk; `?time=`), rain intensity
  presets (R: drizzle 0.35 → rain 0.7 → storm 1.0; `?rain=`), wind, rain streak particles around the camera with
  roof occlusion (never visible inside the house or under the porch roof), ground splashes, eave/porch‑roof drip lines
  with drip splashes, downspout gushes, lightning (flash + occasional distant bolt; emits `'lightning'`; disabled by
  `?lightning=0` except via `C.debug.lightning()`), chimney smoke, **rain‑on‑glass shader** for every pane in
  `C.house.glassPanes` (droplets + running streaks, slight blur/distortion feel, transparent, fog aware; skylights get
  splatting drops), writes `C.env.{preset, daylight, rain, wind, lightningFlash, indoor}`.
* **outdoor** (`src/outdoor.js`, order 40): terrain (flat yard + hills beyond), wet grass (instanced tufts near house),
  path, fence + gate, lane, hedges, trees (swaying with `C.env.wind`), bushes, flower beds, pond + puddles with rain
  ripple shaders (intensity from `C.env.rain`), shed, woodpile, bench, wheelbarrow/watering can etc., streetlamp +
  light cone, mailbox, porch furniture (rocker, small table, plants, doormat, boots, umbrella), porch lantern
  (`lamp_porch`, auto on at dusk/night + interactable), distant hills/neighbour windows, world bounds.
* **audio** (`src/audio.js`, order 50): fills `C.audio` (see 3.7). All synthesized: rain (outdoor broadband + heavy
  low layer + random drop ticks; indoor muffled layer; roof patter louder upstairs; porch‑roof drumming on the porch;
  gutter trickle near downspouts), wind gusts, thunder on `'lightning'` (delayed by distance), fire crackle positional
  at the fireplace scaled by `C.env.fireLevel`, grandfather clock tick positional at (2.35, 1.2, −0.3), footsteps per
  surface (wood creak, stairs, tile click, rug soft, porch hollow, grass/mud squelch, gravel crunch, stone), door
  creaks, lamp clicks, record‑player music (procedural lo‑fi jazz: Rhodes‑ish chords, soft brush drums, upright bass,
  vinyl crackle, wow/flutter; positional at the record player), kettle boil + whistle, cat purr, one‑shot sfx list.
  Mix by `C.env.rain`, `C.world.indoorAmount`, height (upstairs), open doors; master/music/ambience/sfx volumes from
  settings; M mutes. Resume/pause context appropriately. AudioContext created on `'start'` only.
* **living** (`src/living.js`, order 60): fireplace (breast, firebox, mantel + mantel decor, hearth, logs, animated
  fire (shader/sprites), embers, fire light, interaction), sofa w/ cushions + throw, armchair, coffee table (tea tray,
  books, candle), big rug, bookshelf (props.books), floor & table lamps, window seat (cushions, pillows, blanket,
  books; the cat's favourite spot at about (−3.0, 0.48, 4.45)), curtains on the living windows, record player on a
  cabinet + vinyl crate, plants, paintings, side table, knitting basket, log basket, sconce‑free walls otherwise.
* **kitchen** (`src/kitchen.js`, order 60): L counters with cabinets (sage), butcher‑block tops, tile backsplash,
  farmhouse sink under `w_kitchen_n`, vintage cream range/stove with kettle (tea interaction, steam), retro fridge,
  hutch/dresser with plates and cups, open shelves with jars, hanging copper pots, herbs on the sill, bread & fruit,
  dining table + 4 chairs + table runner + candles + pendant lamp, kitchen light, rug under the table.
* **hallstudy** (`src/hallstudy.js`, order 60): hall: grandfather clock at (2.35, 0, −0.3) (pendulum swings;
  interaction), coat rack with coats & scarves, bench with boots, umbrella stand with a wet umbrella dripping into a
  small puddle on a tray, console table + lamp + key bowl, mirror, runner rug (x 2.3→5.2, z 0→3.4 — not in the stair
  approach), plant, pictures. Study: desk under `w_study_n` with typewriter/open journal/ink/papers, desk lamp, desk
  chair (sit), floor‑to‑ceiling bookshelves, reading armchair, globe, rug, plants, framed maps, a cat bed.
* **loft** (`src/loft.js`, order 60): bed (headboard against the west gable, bed x ∈ [−6.75, −4.6], z ∈ [−0.85, 0.85],
  patchwork quilt, lots of pillows, lie‑down interaction looking at the skylight), nightstands + bedside lamp,
  wardrobe, dresser + mirror, rugs, reading chair + lamp, string lights along the ridge beam (twinkle), east reading
  nook by `w_loft_e` (floor cushions/beanbag, blankets, low bookshelf, telescope), low storage chests/bookshelves in
  the eave zones (behind the invisible eave colliders), plants, a clothes rail, a record/radio? (no audio needed).
* **cat** (`src/cat.js`, order 70): a cute procedural cat curled asleep on the window seat (≈(−3.0, 0.48, 4.45)),
  breathing, ear twitches, tail flicks, occasionally lifts its head; `cat` interaction → purr (C.audio.purr), eyes
  squint, toast "The cat purrs contentedly."; every few minutes it relocates between spots (window seat, rug in front
  of the fire at ≈(−5.2, 0.01, 2.5)… check the living layout, the loft bed) while the player isn't looking.
* **post** (`src/post.js`, order 90): EffectComposer (MSAA render target on medium/high, HalfFloat), RenderPass,
  UnrealBloomPass (subtle), a custom grade pass (warm/cool split tone, gentle vignette, film grain, lightning flash),
  OutputPass; sets `C.renderOverride`; handles resize/quality. UI: start screen overlay (title, subtitle, "Click to
  step inside", controls summary, the live rainy scene visible behind), pause/settings menu (Esc: volumes, mouse
  sensitivity, invert Y, FOV, quality, head bob, show FPS, resume), help overlay (H), gentle fade‑in on start.
  In `?autostart=1` mode no overlay is shown.

## 10. Materials library (`C.mats`, materials.js) — 1 UV unit = 1 m, all `MeshStandardMaterial` unless noted
Wood: `woodFloor` (honey oak planks 0.14 m wide, staggered butt joints, varnish sheen, roughness map),
`woodDark` (dark walnut, beams/furniture), `woodMedium` (warm oak furniture), `woodLight` (pine/birch),
`woodPainted` (cream painted wood, faint grain — trim, frames), `woodPaintedSage` (kitchen cabinets),
`woodPaintedGreen` (front door/shutters), `woodWeathered` (grey outdoor boards/fence), `woodPorch` (deck boards),
`bark`, `logEnd`.
Walls: `plaster` (warm cream, trowel noise), `wallpaper` (sage + cream floral), `wallpaperBlue` (dusty blue stripes
with tiny flowers, loft/bedroom), `ceilingBoards` (whitewashed tongue & groove), `tileKitchen` (white subway tiles),
`tileFloor` (terracotta/cream checker or hex), `brick` (red brick), `stone` (fieldstone), `siding` (cream
clapboard, horizontal boards 0.18 m), `shingles` (dark slate, wet, some moss), `concrete`.
Fabric: `fabricSofa` (rust velvet weave), `fabricChair` (mustard tweed), `fabricCream` (linen), `fabricBlue` (navy),
`fabricGreen` (sage), `fabricRose` (dusty rose), `knit` (chunky cable knit), `quilt` (patchwork), `rugPersian`,
`rugBraided`, `rugRunner` (kilim stripes), `sheepskin`, `leather` (brown).
Metal & misc: `brass`, `copper`, `ironBlack`, `chrome`, `ceramic` (glossy white), `ceramicBlue`, `ceramicTerracotta`
(pots), `glassClear` (transparent bottles/vases), `paper`, `lampshade` (warm fabric, meant to be cloned per lamp;
emissive‑capable), `bulb` (emissive warm), `candleWax`, `soil`, `wickerBasket`.
Outdoor: `grass` (wet, dark), `dirt`, `mud` (wet, glossy), `gravel`, `flagstone`, `leaves` (alpha‑tested leaf cluster),
`pineNeedles` (alpha‑tested), `hedge`, `moss`, `water` (placeholder; outdoor has its own shader).
Special: `glass` (window glass placeholder: transparent, depthWrite false, slight tint — weather swaps it).
Helpers: `C.mats.get(name)` (= `C.mat`), `C.mats.list()`. Wet exterior materials: lower roughness, darker albedo.

## 11. Props library (`C.props`, props.js) — every factory returns an Object3D (Group) added to `opts.parent`
(default `C.scene`); front faces local **+Z**; `rotationY` rotates it (facing +X → π/2, −X → −π/2, −Z → π).
* `lamp({ id, type: 'floor'|'table'|'desk'|'pendant'|'wall'|'lantern'|'ceiling', position:[x,y,z], rotationY, on = true,
  color = 0xffb46b, intensity, distance = 0, decay = 2, shadeColor, metal: 'brass'|'iron'|'copper', height, label,
  castShadow = false, parent, room })` → `{ group, light, get on(), setOn(bool), toggle(), id }`.
  Floor/table/desk: position = base bottom centre on the surface; pendant/ceiling: attachment point on the ceiling;
  wall/lantern: mount point on the wall (lamp sticks out along +Z). Builds a nice lamp mesh, a per‑instance glowing
  shade/bulb material, a PointLight (SpotLight for desk), a glow sprite; registers the interactable
  (`Turn on/off the <label>`), smooth 0.15 s fade, emits `'lamp'`, registers the light via `C.registerLight`.
* `candle({ position, height = 0.14, radius = 0.025, color, lit = true, id?, parent })` — animated flame + halo, no light.
* `books({ length, depth = 0.2, minH = 0.17, maxH = 0.27, position, rotationY, parent, seed, lean = true,
  palette })` → a row of books standing on a shelf: position = centre of the row at the shelf surface (books span
  local X, spines face +Z). Instanced or merged; varied colours/heights, gaps, the odd leaning/stacked book.
* `bookStack({ count, position, rotationY, parent, seed })` — books lying flat.
* `painting({ width, height, style: 'landscape'|'seascape'|'botanical'|'portrait'|'abstract'|'cottage'|'map',
  frame: 'gold'|'wood'|'black'|'white', position, rotationY, parent, seed })` → hung picture; position = centre of the
  back of the frame on the wall surface; faces +Z.
* `plant({ type: 'fern'|'monstera'|'snake'|'succulent'|'ivy'|'herb'|'fiddle'|'pothos', scale = 1, potColor,
  position, parent, seed })` — position = pot bottom centre.
* `pillow({ w = 0.45, h = 0.45, t = 0.14, material|color, position, rotation:[x,y,z], parent })` — puffy cushion.
* `blanket({ w, d, t = 0.03, material, position, rotationY, folds = 3, parent })` — folded blanket (stack);
  `throwBlanket({ w, d, material, position, rotationY, parent, drapeOver })` — softly wavy draped throw.
* `rug({ w, d, style: 'persian'|'braided'|'runner'|'sheepskin'|'kilim', round = false, position, rotationY, parent,
  tag = true })` — flat rug with softened edges at position.y + 0.006; registers the footstep surface tag `'rug'`.
* `mug({ position, color, steam = false, parent })`, `teapot({...})`, `vase({ position, flowers: bool, color })`,
  `frame({ w, h, position, rotationY, parent, seed })` (standing photo frame), `clock({...})` (small mantel clock),
  `jar({...})`, `bottle({...})`, `basket({...})`, `steam(parent, position, opts)` (rising wisps),
  `glow(parent, position, color, size)`.
* props.js `update` animates candle flames, steam, lamp fades.

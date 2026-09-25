// =====================================================================================================================
//  POST — post-processing pipeline (EffectComposer: MSAA HDR render → bloom → grade → output) + all UI overlays
//  (start screen, pause/settings menu, help overlay, fade-in, hints, fps counter).  SPEC §9 post, §3.1/§3.3/§3.9
// =====================================================================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const C = window.COZY;

// ---------------------------------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------------------------------
const BLOOM = { strength: 0.3, radius: 0.5, threshold: 1.2 };      // softened after playtesting (lamps glared)
const BLOOM_MAX_PIXELS = 1920 * 1080;        // bloom input is capped to this (mip0 = half of it) for hi-dpi screens
const GRADE = { split: 0.55, vignette: 0.26, grain: 0.010 };

// Colour grade — runs on the linear HDR image (before tone mapping in the OutputPass).
const GradeShader = {
  name: 'CozyGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uSplit: { value: GRADE.split },
    uVignette: { value: GRADE.vignette },
    uGrain: { value: GRADE.grain },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uFlash, uSplit, uVignette, uGrain, uAspect;
    varying vec2 vUv;
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 col = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));
      float lum = dot(col, LW);

      // split toning: cool shadows, warm highlights (luminance preserving)
      float tl = lum / (lum + 0.22);
      vec3 tint = mix(vec3(0.955, 0.99, 1.07), vec3(1.05, 1.0, 0.925), smoothstep(0.18, 0.72, tl));
      vec3 g = col * mix(vec3(1.0), tint, uSplit);
      col = g * (lum / max(dot(g, LW), 1e-6));

      // lightning: brief global lift with a cool tint
      col = col * (1.0 + 0.55 * uFlash) + uFlash * vec3(0.006, 0.009, 0.016);
      col *= mix(vec3(1.0), vec3(0.9, 0.97, 1.14), clamp(uFlash, 0.0, 1.0) * 0.7);

      // gentle vignette (slightly elliptical, softer on wide screens)
      vec2 d = (vUv - 0.5) * vec2(mix(1.0, uAspect, 0.55), 1.0);
      float r = length(d) * 1.35;
      col *= 1.0 - uVignette * smoothstep(0.38, 1.05, r);

      // film grain (monochrome, ~24 fps, perceptually even: scaled like a display-space delta), doubles as dither
      float fr = floor(uTime * 24.0);
      vec2 p = gl_FragCoord.xy + vec2(fr * 37.0, fr * 71.0);
      float n = hash12(p) + hash12(p + 17.31) - 1.0;
      lum = dot(col, LW);
      col += n * (uGrain * 2.2 * pow(max(lum, 0.0) + 1e-4, 0.55) + 0.0006) * (col + 0.02) / (lum + 0.02);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

// Bloom bright-pass replacement: only the energy ABOVE the threshold blooms (soft knee), 4-tap box downsample
// (stable tiny highlights like fairy-light bulbs), firefly clamp. Uses UnrealBloomPass' own uniform object.
const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 bright(vec2 uv) {
    vec3 c = texture2D(tDiffuse, uv).rgb;
    float l = max(max(c.r, c.g), c.b);
    if (!(l >= 0.0) || l > 60000.0) return vec3(0.0);   // NaN / Inf guard: one bad pixel blooms into a square blob
    c = max(c, vec3(0.0));
    float t = luminosityThreshold, knee = t * 0.5;
    float s = clamp(l - t + knee, 0.0, 2.0 * knee);
    s = s * s / (4.0 * knee + 1e-4);
    return min(c * (max(s, l - t) / max(l, 1e-4)), vec3(16.0));
  }
  void main() {
    vec2 o = uTexel;
    vec3 c = bright(vUv + vec2(-o.x, -o.y)) + bright(vUv + vec2(o.x, -o.y)) + bright(vUv + vec2(-o.x, o.y)) + bright(vUv + vec2(o.x, o.y));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;
const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ---------------------------------------------------------------------------------------------------------------------
// UI content
// ---------------------------------------------------------------------------------------------------------------------
const KEYMAP = [
  [['W', 'A', 'S', 'D'], 'Walk <i>(or arrow keys)</i>'],
  [['Mouse'], 'Look around'],
  [['Shift'], 'Run'],
  [['C'], 'Crouch <i>(or Ctrl)</i>'],
  [['Space'], 'Jump'],
  [['E'], 'Interact <i>(or left-click)</i>'],
  [['Q'], 'Sip your tea <i>(when holding a mug)</i>'],
  [['F'], 'Flashlight'],
  [['T'], 'Time of day'],
  [['R'], 'Rain intensity'],
  [['M'], 'Mute'],
  [['H'], 'Help'],
  [['Esc'], 'Pause &amp; settings'],
];
const TOUCHMAP = [
  [['Left thumb'], 'Walk (virtual joystick)'],
  [['Right drag'], 'Look around'],
  [['Use'], 'Interact with what you are looking at'],
  [['Jump'], 'Jump'],
  [['❚❚'], 'Pause &amp; settings'],
];
const keyCaps = keys => keys.map(k => `<kbd>${k}</kbd>`).join('');
const keyRows = list => list.map(([k, d]) => `<div class="cz-krow"><span class="cz-kk">${keyCaps(k)}</span><span class="cz-kd">${d}</span></div>`).join('');

const HOUSE_SVG = `<svg class="cz-house" viewBox="0 0 64 52" width="72" height="58" fill="none" stroke="#f1dcbc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <g opacity=".45" stroke-width="1.1"><path d="M9 3 l-2 5"/><path d="M17 1 l-2 5"/><path d="M25 5 l-1.6 4"/><path d="M52 2 l-2 5"/><path d="M59 9 l-2 5"/><path d="M5 14 l-2 5"/></g>
  <path d="M42 15.5 V8.5 H47 V19.25"/>
  <path d="M44.5 6 c-2.2 -1.4 1.8 -2.6 0 -4.4" opacity=".55" stroke-width="1.1"/>
  <path d="M7 26.5 L32 8 L57 26.5"/>
  <path d="M12.5 23 V46 H51.5 V23"/>
  <rect x="17.5" y="29" width="11" height="8.5" rx=".8" fill="#ffb567" stroke="#f1dcbc"/>
  <path d="M23 29 V37.5 M17.5 33.25 H28.5" stroke="#8a5a2e" stroke-width="1"/>
  <path d="M35.5 46 V32.5 Q40 29.5 44.5 32.5 V46"/>
  <circle cx="42.6" cy="39.5" r=".7" fill="#f1dcbc" stroke="none"/>
  <path d="M3 46 H61"/>
</svg>`;

const CSS = `
#cozy-ui{position:fixed;inset:0;pointer-events:none;z-index:900;font-family:'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif;color:#f4e7d2;-webkit-font-smoothing:antialiased}
#cozy-ui *{box-sizing:border-box}
#cozy-ui .cz-layer{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .45s ease,visibility 0s linear .45s}
#cozy-ui .cz-layer.show{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .45s ease,visibility 0s}
#cozy-ui kbd{display:inline-block;min-width:24px;height:24px;padding:0 6px;margin:0 2px;line-height:22px;text-align:center;border:1px solid rgba(255,232,200,.55);border-bottom-width:2px;border-radius:6px;background:rgba(44,32,24,.55);font:12px/22px Verdana,'Segoe UI',sans-serif;color:#fbefdc;box-shadow:0 1px 3px rgba(0,0,0,.35);white-space:nowrap}
#cozy-ui i{font-style:italic;color:#c7b497}

/* ---- start screen ---- */
#cozy-ui .cz-start{cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse 75% 70% at 50% 46%,rgba(16,11,8,.30) 0%,rgba(14,10,8,.55) 55%,rgba(7,5,4,.90) 100%)}
#cozy-ui .cz-start::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,24,32,.25),rgba(0,0,0,0) 40%,rgba(10,6,4,.35));pointer-events:none}
#cozy-ui .cz-start-inner{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 24px;margin-top:-4vh}
#cozy-ui .cz-house{filter:drop-shadow(0 0 10px rgba(255,170,90,.45));margin-bottom:10px;opacity:.95}
#cozy-ui .cz-title{margin:0;font-weight:normal;font-size:clamp(40px,7.2vw,92px);line-height:1.02;letter-spacing:.02em;color:#fbead0;
  text-shadow:0 2px 3px rgba(0,0,0,.55),0 0 34px rgba(255,160,80,.30),0 0 90px rgba(255,140,60,.18)}
#cozy-ui .cz-rule{display:flex;align-items:center;gap:14px;margin:18px 0 14px;color:#e2b274;font-size:13px;opacity:.9}
#cozy-ui .cz-rule span{display:block;width:clamp(50px,9vw,120px);height:1px;background:linear-gradient(90deg,rgba(226,178,116,0),rgba(226,178,116,.8))}
#cozy-ui .cz-rule span:last-child{transform:scaleX(-1)}
#cozy-ui .cz-sub{margin:0;max-width:640px;font-style:italic;font-size:clamp(16px,1.9vw,22px);line-height:1.45;color:#e8d6ba;text-shadow:0 1px 3px rgba(0,0,0,.7)}
#cozy-ui .cz-cta{margin-top:38px;padding:13px 38px 14px;border:1px solid rgba(255,222,178,.55);border-radius:40px;background:rgba(58,38,24,.35);
  font-size:clamp(17px,1.8vw,21px);letter-spacing:.14em;font-variant:small-caps;color:#fff2de;text-shadow:0 1px 3px rgba(0,0,0,.6);
  animation:czPulse 2.8s ease-in-out infinite;transition:background .25s,border-color .25s}
#cozy-ui .cz-start:hover .cz-cta{background:rgba(92,58,32,.5);border-color:rgba(255,222,178,.85)}
@keyframes czPulse{0%,100%{opacity:.78;box-shadow:0 0 0 0 rgba(255,170,90,0),inset 0 0 0 rgba(255,190,120,0)}50%{opacity:1;box-shadow:0 0 30px 2px rgba(255,165,85,.28),inset 0 0 14px rgba(255,190,120,.12)}}
#cozy-ui .cz-controls{position:absolute;left:0;right:0;bottom:5.5vh;display:flex;flex-wrap:wrap;justify-content:center;gap:10px 22px;padding:0 24px;font-size:14px;color:#dccab0;text-shadow:0 1px 2px rgba(0,0,0,.8)}
#cozy-ui .cz-controls span{white-space:nowrap}
#cozy-ui .cz-start-foot{position:absolute;right:22px;top:18px;display:flex;gap:10px}
#cozy-ui .cz-link{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,225,190,.28);background:rgba(30,22,17,.4);color:#e9d7bb;font:inherit;font-size:14px;letter-spacing:.06em;padding:6px 14px;border-radius:18px;transition:all .2s}
#cozy-ui .cz-link:hover{border-color:rgba(255,225,190,.7);color:#fff3e0;background:rgba(70,48,32,.55)}

/* ---- pause / settings ---- */
#cozy-ui .cz-pause{display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(14,10,8,.45),rgba(6,4,3,.78));backdrop-filter:blur(3px) saturate(.9);-webkit-backdrop-filter:blur(3px) saturate(.9)}
#cozy-ui .cz-panel{position:relative;width:min(900px,94vw);max-height:92vh;overflow:auto;padding:26px 34px 24px;border-radius:18px;
  background:linear-gradient(180deg,rgba(48,35,27,.93),rgba(30,22,18,.95));border:1px solid rgba(255,220,180,.16);
  box-shadow:0 24px 70px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,235,210,.08);transform:translateY(8px) scale(.985);transition:transform .45s cubic-bezier(.2,.7,.2,1)}
#cozy-ui .cz-pause.show .cz-panel{transform:none}
#cozy-ui .cz-panel::-webkit-scrollbar{width:8px}#cozy-ui .cz-panel::-webkit-scrollbar-thumb{background:rgba(255,220,180,.2);border-radius:4px}
#cozy-ui .cz-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;padding-bottom:16px;margin-bottom:6px;border-bottom:1px solid rgba(255,220,180,.12)}
#cozy-ui .cz-head h2{margin:0;font-weight:normal;font-size:34px;letter-spacing:.02em;color:#fbead0;text-shadow:0 0 22px rgba(255,160,80,.25)}
#cozy-ui .cz-head p{margin:4px 0 0;font-style:italic;color:#cdb898;font-size:16px}
#cozy-ui .cz-btn{pointer-events:auto;cursor:pointer;font:inherit;font-size:19px;letter-spacing:.1em;font-variant:small-caps;color:#2a1c12;padding:10px 34px 11px;border:none;border-radius:30px;
  background:linear-gradient(180deg,#f7d9a8,#e6b474);box-shadow:0 4px 18px rgba(230,160,80,.28),inset 0 1px 0 rgba(255,255,255,.5);transition:transform .15s,box-shadow .2s,filter .2s}
#cozy-ui .cz-btn:hover{transform:translateY(-1px);filter:brightness(1.05);box-shadow:0 6px 24px rgba(240,170,90,.4),inset 0 1px 0 rgba(255,255,255,.5)}
#cozy-ui .cz-btn:active{transform:translateY(1px)}
#cozy-ui .cz-cols{display:grid;grid-template-columns:1.25fr 1fr;gap:10px 40px}
#cozy-ui h3{margin:18px 0 8px;font-weight:normal;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#d9a86a}
#cozy-ui .cz-row{display:grid;grid-template-columns:128px 1fr 54px;align-items:center;gap:12px;min-height:32px;font-size:16px;color:#eadbc4}
#cozy-ui .cz-row .cz-val{text-align:right;font-size:14px;color:#c9b393;font-variant-numeric:tabular-nums}
#cozy-ui .cz-row.cz-tog{grid-template-columns:1fr auto}
#cozy-ui input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:20px;margin:0;background:transparent;cursor:pointer;--p:50%}
#cozy-ui input[type=range]:focus{outline:none}
#cozy-ui input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(90deg,#e2a864 0,#e9b979 var(--p),rgba(255,232,205,.16) var(--p))}
#cozy-ui input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-6px;border-radius:50%;background:#f8ead3;box-shadow:0 1px 4px rgba(0,0,0,.55),0 0 0 4px rgba(226,168,100,.18);transition:box-shadow .2s}
#cozy-ui input[type=range]:hover::-webkit-slider-thumb{box-shadow:0 1px 4px rgba(0,0,0,.55),0 0 0 6px rgba(226,168,100,.28)}
#cozy-ui input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:rgba(255,232,205,.16)}
#cozy-ui input[type=range]::-moz-range-progress{height:4px;border-radius:2px;background:#e2a864}
#cozy-ui input[type=range]::-moz-range-thumb{width:16px;height:16px;border:none;border-radius:50%;background:#f8ead3;box-shadow:0 1px 4px rgba(0,0,0,.55)}
#cozy-ui .cz-switch{position:relative;display:inline-block;width:42px;height:22px;cursor:pointer}
#cozy-ui .cz-switch input{position:absolute;opacity:0;width:0;height:0}
#cozy-ui .cz-switch span{position:absolute;inset:0;border-radius:11px;background:rgba(255,232,205,.16);transition:background .2s}
#cozy-ui .cz-switch span::after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#e9dcc7;box-shadow:0 1px 3px rgba(0,0,0,.5);transition:transform .2s}
#cozy-ui .cz-switch input:checked+span{background:#d99d5c}
#cozy-ui .cz-switch input:checked+span::after{transform:translateX(20px);background:#fff3e2}
#cozy-ui .cz-seg{display:inline-flex;border:1px solid rgba(255,220,180,.22);border-radius:16px;overflow:hidden}
#cozy-ui .cz-seg button{pointer-events:auto;cursor:pointer;font:inherit;font-size:14px;color:#dccab0;background:transparent;border:none;padding:5px 13px;transition:background .2s,color .2s}
#cozy-ui .cz-seg button+button{border-left:1px solid rgba(255,220,180,.16)}
#cozy-ui .cz-seg button.on{background:#dca265;color:#2a1c12}
#cozy-ui .cz-seg button:not(.on):hover{background:rgba(255,220,180,.1)}
#cozy-ui .cz-krow{display:flex;align-items:center;gap:12px;min-height:29px;font-size:15px;color:#e6d6bd}
#cozy-ui .cz-kk{flex:0 0 132px;text-align:right}
#cozy-ui .cz-note{margin-top:14px;font-size:14px;font-style:italic;color:#bba585;line-height:1.5}
@media (max-width:760px){#cozy-ui .cz-cols{grid-template-columns:1fr}#cozy-ui .cz-panel{padding:20px 18px}#cozy-ui .cz-row{grid-template-columns:104px 1fr 48px}}

/* ---- help overlay ---- */
#cozy-ui .cz-help{left:auto;right:3.2vw;top:50%;bottom:auto;transform:translateY(-50%) translateX(12px);width:min(410px,92vw);padding:20px 24px 18px;border-radius:16px;
  background:linear-gradient(180deg,rgba(42,31,24,.86),rgba(28,21,17,.9));border:1px solid rgba(255,220,180,.15);box-shadow:0 18px 50px rgba(0,0,0,.5);transition:opacity .35s,transform .35s,visibility 0s linear .35s}
#cozy-ui .cz-help.show{pointer-events:none;transform:translateY(-50%);transition:opacity .35s,transform .35s,visibility 0s}
#cozy-ui .cz-help h2{margin:0 0 6px;font-weight:normal;font-size:24px;color:#fbead0}
#cozy-ui .cz-help .cz-kk{flex-basis:118px}
#cozy-ui .cz-help .cz-foot{margin-top:12px;text-align:center;font-size:13px;color:#b9a383;letter-spacing:.05em}

/* ---- small overlays ---- */
#cozy-ui .cz-fade{background:#060504;pointer-events:none!important;transition:opacity 2.4s cubic-bezier(.4,0,.2,1),visibility 0s linear 2.4s}
#cozy-ui .cz-fade.show{transition:none}
#cozy-ui .cz-hint{top:auto;bottom:5vh;left:50%;right:auto;transform:translateX(-50%);padding:9px 20px;border-radius:22px;background:rgba(26,19,15,.5);box-shadow:0 2px 16px rgba(0,0,0,.35);
  font-size:15px;white-space:nowrap;color:#f3e3c9;text-shadow:0 1px 2px rgba(0,0,0,.6);transition:opacity 1.4s ease,visibility 0s linear 1.4s}
#cozy-ui .cz-hint.show{pointer-events:none;transition:opacity 1.4s ease,visibility 0s}
#cozy-ui .cz-hint kbd{min-width:20px;height:20px;line-height:18px;font-size:11px;margin:0 1px}
#cozy-ui .cz-hint .sep{margin:0 10px;opacity:.55}
#cozy-ui .cz-look{top:calc(50% + 58px);bottom:auto;left:50%;right:auto;transform:translateX(-50%);font-size:15px;font-style:italic;color:#f3e3c9;text-shadow:0 1px 3px rgba(0,0,0,.85);white-space:nowrap;transition:opacity .4s,visibility 0s linear .4s}
#cozy-ui .cz-look.show{pointer-events:none;transition:opacity .4s,visibility 0s}
#cozy-ui .cz-fps{top:10px;right:14px;left:auto;bottom:auto;font:12px/1 Consolas,'Courier New',monospace;color:rgba(255,240,215,.75);text-shadow:0 1px 2px rgba(0,0,0,.8);transition:none}
#cozy-ui .cz-fps.show{pointer-events:none}
#cozy-ui .cz-tpause{top:14px;right:14px;left:auto;bottom:auto;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,225,190,.4);background:rgba(30,22,17,.45);color:#f3e3c9;font:16px/42px Verdana,sans-serif;text-align:center}
`;

// ---------------------------------------------------------------------------------------------------------------------
C.register({
  name: 'post',
  order: 90,

  init(C) {
    const S = this._s = {};
    // core checks C.ui at the end of boot to decide whether to install its own click-to-start fallback
    C.ui = C.ui || {};
    const AUTOSTART = C.params ? C.params.get('autostart') === '1' : /[?&]autostart=1/.test(location.search);
    S.autostart = AUTOSTART;

    try { buildUI(C, S); }
    catch (e) {
      recordError(C, 'init(ui)', e);
      // make sure the user can still get in
      const go = () => { C.renderer.domElement.removeEventListener('click', go); C.start(); };
      C.renderer.domElement.addEventListener('click', go);
    }
    try { buildPost(C, S); }
    catch (e) { recordError(C, 'init(post)', e); C.renderOverride = null; }
  },

  update(dt, t, C) {
    const S = this._s;
    if (!S) return;
    // fps counter (independent of core's F3 debug overlay)
    if (S.fpsEl) {
      const now = performance.now();
      S.fpsN++;
      if (now - S.fpsT >= 500) {
        const fps = S.fpsN * 1000 / (now - S.fpsT);
        S.fpsN = 0; S.fpsT = now;
        const dbg = C.hud && C.hud.el && C.hud.el.querySelector('.dbg');
        const coreShowing = dbg && dbg.style.display !== 'none';
        const want = !!C.settings.showFps && !coreShowing;
        if (want) S.fpsEl.textContent = fps.toFixed(0) + ' fps';
        setShown(S.fpsEl, want);
      }
    }
    // "click to look around" when playing without pointer lock (e.g. the browser refused an immediate re-lock)
    if (S.lookEl) {
      const st = C.state;
      const need = !S.autostart && !C.input.isTouch && st.started && !st.paused && !st.uiOpen && !C.input.pointerLocked;
      S.lookT = need ? (S.lookT || 0) + dt : 0;
      setShown(S.lookEl, S.lookT > 0.7);
    }
    if (S.tpauseEl) setShown(S.tpauseEl, C.input.isTouch && C.state.started && !C.state.paused && !C.state.uiOpen);
  },
});

function recordError(C, phase, e) {
  const entry = { module: 'post', phase, message: (e && e.message) || String(e), stack: e && e.stack ? String(e.stack).slice(0, 1500) : '' };
  if (C.debug && C.debug.errors) C.debug.errors.push(entry);
  console.error(`[COZY] post ${phase} error: ${entry.message}\n${entry.stack}`);
}

function setShown(el, on) {
  if (!el) return;
  if (on) { if (!el.classList.contains('show')) el.classList.add('show'); }
  else if (el.classList.contains('show')) el.classList.remove('show');
}

// =====================================================================================================================
//  Post-processing
// =====================================================================================================================
function buildPost(C, S) {
  const renderer = C.renderer;
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const quality = () => C.settings.quality || 'high';

  // Main HDR target: half float, MSAA on medium/high (the canvas' antialias does not apply to render targets)
  const rtMain = new THREE.WebGLRenderTarget(Math.max(1, Math.round(size.x * pr)), Math.max(1, Math.round(size.y * pr)), {
    type: THREE.HalfFloatType, samples: quality() === 'low' ? 0 : 4,
  });
  rtMain.texture.name = 'post.main';
  const composer = new EffectComposer(renderer, rtMain);
  // second ping-pong target only receives the full-screen grade → no MSAA, no depth
  composer.renderTarget2.samples = 0;
  composer.renderTarget2.depthBuffer = false;
  composer.renderTarget2.texture.name = 'post.grade';

  const renderPass = new RenderPass(C.scene, C.camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  // cap bloom resolution on hi-dpi screens (it starts at half res and blurs heavily anyway)
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => {
    const s = Math.min(1, Math.sqrt(BLOOM_MAX_PIXELS / Math.max(1, w * h)));
    bloomSetSize(Math.max(4, Math.round(w * s)), Math.max(4, Math.round(h * s)));
    bloom.highPassUniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
  };
  bloom.highPassUniforms.uTexel = { value: new THREE.Vector2(1 / 1920, 1 / 1080) };
  bloom.materialHighPassFilter.dispose();
  bloom.materialHighPassFilter = new THREE.ShaderMaterial({
    name: 'post.bloomBright', uniforms: bloom.highPassUniforms, vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG,
    depthTest: false, depthWrite: false,
  });
  const grade = new ShaderPass(GradeShader);
  grade.material.name = 'post.grade';
  const output = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(output);

  const gu = grade.uniforms;
  const _sz = new THREE.Vector2();
  let curW = -1, curH = -1, curPR = -1;
  function syncSize() {
    renderer.getSize(_sz);
    const p = renderer.getPixelRatio();
    if (_sz.x === curW && _sz.y === curH && p === curPR) return;
    curW = _sz.x; curH = _sz.y; curPR = p;
    composer._pixelRatio = p;                 // setPixelRatio() would resize twice
    composer.setSize(Math.max(1, curW), Math.max(1, curH));
    gu.uAspect.value = curW / Math.max(1, curH);
  }
  function applyQuality() {
    const q = quality();
    bloom.enabled = q !== 'low';
    const samples = q === 'low' ? 0 : 4;
    if (rtMain.samples !== samples) { rtMain.samples = samples; rtMain.dispose(); }
    syncSize();
  }

  let enabled = true;
  function render(dt) {
    syncSize();
    // the RenderPass draws into readBuffer — keep that the MSAA target (grade + output swap twice per frame)
    if (composer.readBuffer !== rtMain) composer.swapBuffers();
    gu.uTime.value = C.time % 1000;
    gu.uFlash.value = Math.min(1.5, Math.max(0, +C.env.lightningFlash || 0));
    composer.render(dt);
  }

  C.on('resize', syncSize);
  C.on('settings', applyQuality);
  applyQuality();

  // Compile the render-target program variants (no tone mapping, linear output) during core's boot compile instead of
  // on the first frame: we are the last module to init, and core calls renderer.compile() right after the inits.
  renderer.setRenderTarget(rtMain);
  C.on('ready', () => { if (renderer.getRenderTarget() === rtMain) renderer.setRenderTarget(null); });

  C.renderOverride = render;
  C.post = {
    composer, renderPass, bloom, grade, output, rtMain,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; C.renderOverride = enabled ? render : null; },
    settings: { BLOOM, GRADE },
  };
  S.composer = composer;
}

// =====================================================================================================================
//  UI
// =====================================================================================================================
function buildUI(C, S) {
  const isTouch = !!(C.input && C.input.isTouch);
  const style = document.createElement('style');
  style.id = 'cozy-ui-css';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cozy-ui';
  document.body.appendChild(root);
  const mk = (cls, html = '', tag = 'div') => { const el = document.createElement(tag); el.className = 'cz-layer ' + cls; el.innerHTML = html; root.appendChild(el); return el; };

  // ---------------------------------------------------------------- start screen
  const verb = isTouch ? 'Tap' : 'Click';
  const startControls = isTouch
    ? `<span>Left thumb to walk</span><span>Drag to look</span><span>Tap <b>Use</b> to interact</span>`
    : `<span>${keyCaps(['W', 'A', 'S', 'D'])} walk</span><span><kbd>Mouse</kbd> look</span><span><kbd>Shift</kbd> run</span>` +
      `<span><kbd>E</kbd> interact</span><span><kbd>F</kbd> flashlight</span><span><kbd>H</kbd> help</span><span><kbd>Esc</kbd> menu</span>`;
  const start = mk('cz-start', `
    <div class="cz-start-inner">
      ${HOUSE_SVG}
      <h1 class="cz-title">Rainy Day Cottage</h1>
      <div class="cz-rule"><span></span>✦<span></span></div>
      <p class="cz-sub">Put the kettle on. The fire is lit, the cat is asleep,<br>and the rain isn't going anywhere.</p>
      <div class="cz-cta">${verb} to step inside</div>
    </div>
    <div class="cz-start-foot"><button class="cz-link cz-open-settings" type="button">Settings</button></div>
    <div class="cz-controls">${startControls}</div>`);

  // ---------------------------------------------------------------- pause / settings
  const slider = (key, label, min, max, step) =>
    `<div class="cz-row"><label for="cz-${key}">${label}</label><input id="cz-${key}" type="range" min="${min}" max="${max}" step="${step}" data-key="${key}"><span class="cz-val" data-val="${key}"></span></div>`;
  const toggle = (key, label) =>
    `<div class="cz-row cz-tog"><span>${label}</span><label class="cz-switch"><input type="checkbox" data-key="${key}"><span></span></label></div>`;
  const pause = mk('cz-pause', `
    <div class="cz-panel" role="dialog" aria-label="Paused">
      <div class="cz-head">
        <div><h2 class="cz-ptitle">Paused</h2><p class="cz-psub">Take your time — the rain will wait.</p></div>
        <button class="cz-btn cz-resume" type="button">Resume</button>
      </div>
      <div class="cz-cols">
        <section>
          <h3>Sound</h3>
          ${slider('masterVolume', 'Master', 0, 1, 0.01)}
          ${slider('musicVolume', 'Music', 0, 1, 0.01)}
          ${slider('ambienceVolume', 'Ambience', 0, 1, 0.01)}
          ${slider('sfxVolume', 'Effects', 0, 1, 0.01)}
          <h3>Controls</h3>
          ${slider('mouseSensitivity', 'Mouse speed', 0.2, 3, 0.05)}
          ${toggle('invertY', 'Invert vertical look')}
          <h3>Display</h3>
          ${slider('fov', 'Field of view', 55, 100, 1)}
          <div class="cz-row cz-tog"><span>Quality</span><span class="cz-seg" data-seg="quality"><button type="button" data-v="low">Low</button><button type="button" data-v="medium">Medium</button><button type="button" data-v="high">High</button></span></div>
          ${toggle('headBob', 'Head bob')}
          ${toggle('showFps', 'Show FPS')}
        </section>
        <section>
          <h3>${isTouch ? 'Touch controls' : 'Keys'}</h3>
          ${keyRows(isTouch ? TOUCHMAP : KEYMAP)}
          <div class="cz-note">Things to try: light the fire, put the kettle on, play a record, curl up on the window seat, and find the cat.</div>
        </section>
      </div>
    </div>`);

  // ---------------------------------------------------------------- help overlay (never takes pointer events)
  const help = mk('cz-help', `<h2>Around the cottage</h2>${keyRows(isTouch ? TOUCHMAP : KEYMAP)}
    <div class="cz-foot">Press <kbd>H</kbd> to close</div>`);

  // ---------------------------------------------------------------- small overlays
  const fade = mk('cz-fade');
  const hint = mk('cz-hint', isTouch
    ? 'Left thumb to walk<span class="sep">·</span>drag to look<span class="sep">·</span>tap Use to interact'
    : `${keyCaps(['W', 'A', 'S', 'D'])} to walk<span class="sep">·</span><kbd>E</kbd> to interact<span class="sep">·</span><kbd>H</kbd> for help`);
  const look = mk('cz-look', 'Click to look around');
  const fps = mk('cz-fps');
  const tpause = mk('cz-tpause', '❚❚', 'button');
  S.fpsEl = fps; S.fpsN = 0; S.fpsT = performance.now();
  S.lookEl = look; S.tpauseEl = tpause;

  // ---------------------------------------------------------------- state
  let pauseMode = 'pause';      // 'pause' (in game) | 'settings' (opened from the start screen)
  let pauseOpenedAt = 0;
  let hintTimer = 0, hintShown = false;
  const isShown = el => el.classList.contains('show');

  function refreshSettings() {
    const s = C.settings;
    pause.querySelectorAll('input[type=range]').forEach(inp => {
      const k = inp.dataset.key;
      if (document.activeElement !== inp || +inp.value !== +s[k]) inp.value = s[k];
      updateSliderLook(inp);
    });
    pause.querySelectorAll('input[type=checkbox]').forEach(inp => { inp.checked = !!s[inp.dataset.key]; });
    pause.querySelectorAll('.cz-seg[data-seg=quality] button').forEach(b => b.classList.toggle('on', b.dataset.v === s.quality));
  }
  function fmt(k, v) {
    if (k === 'fov') return Math.round(v) + '°';
    if (k === 'mouseSensitivity') return (+v).toFixed(2) + '×';
    return Math.round(v * 100) + '%';
  }
  function updateSliderLook(inp) {
    const min = +inp.min, max = +inp.max, v = +inp.value;
    inp.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(1) + '%');
    const lab = pause.querySelector(`[data-val="${inp.dataset.key}"]`);
    if (lab) lab.textContent = fmt(inp.dataset.key, v);
  }
  pause.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => { updateSliderLook(inp); C.setSetting(inp.dataset.key, +inp.value); });
    inp.addEventListener('keydown', e => { if (e.code !== 'Escape') e.stopPropagation(); });
  });
  pause.querySelectorAll('input[type=checkbox]').forEach(inp => {
    inp.addEventListener('change', () => C.setSetting(inp.dataset.key, !!inp.checked));
  });
  pause.querySelectorAll('.cz-seg[data-seg=quality] button').forEach(b => {
    b.addEventListener('click', () => { C.setSetting('quality', b.dataset.v); refreshSettings(); });
  });

  // ---------------------------------------------------------------- show / hide
  function showStart() {
    setShown(pause, false); setShown(help, false);
    setShown(start, true);
  }
  function showPause(mode = 'pause') {
    pauseMode = mode;
    pause.querySelector('.cz-ptitle').textContent = mode === 'settings' ? 'Settings' : 'Paused';
    pause.querySelector('.cz-psub').textContent = mode === 'settings' ? 'Make yourself comfortable.' : 'Take your time — the rain will wait.';
    pause.querySelector('.cz-resume').textContent = mode === 'settings' ? 'Back' : 'Resume';
    refreshSettings();
    setShown(help, false); setShown(start, false);
    setShown(pause, true);
    pauseOpenedAt = performance.now();
    C.state.uiOpen = true;
  }
  function hidePause() {
    if (isShown(pause)) setShown(pause, false);
    C.state.uiOpen = false;
  }
  function showHelp() { setShown(help, true); }
  function hideHelp() { setShown(help, false); }
  function toggleHelp() { setShown(help, !isShown(help)); }
  function hideAll() {
    setShown(start, false); setShown(help, false);
    hidePause();
  }

  // ---------------------------------------------------------------- actions (all inside the user gesture)
  const blurActive = () => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); };
  function doStart() {
    if (!isShown(start)) return;
    blurActive();
    setShown(start, false);
    if (C.state.started) C.resume(); else C.start();
  }
  function doResume() {
    blurActive();
    if (pauseMode === 'settings') { hidePause(); showStart(); return; }
    hidePause();
    C.resume();
  }
  start.addEventListener('click', doStart);
  start.querySelector('.cz-open-settings').addEventListener('click', e => { e.stopPropagation(); showPause('settings'); });
  pause.querySelector('.cz-resume').addEventListener('click', doResume);
  tpause.addEventListener('click', () => { if (C.state.started && !C.state.paused) C.pause(); });
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (isShown(pause) && e.code === 'Escape') {
      if (performance.now() - pauseOpenedAt < 350) return;   // same Esc that just released the pointer lock
      e.preventDefault(); doResume();
    } else if (isShown(start) && !isShown(pause) && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) {
      e.preventDefault(); doStart();
    }
  });

  // ---------------------------------------------------------------- events
  C.input.onKey('KeyH', () => toggleHelp());
  C.on('start', () => {
    hideAll();
    if (S.autostart) return;
    // gentle fade in from black
    fade.classList.add('show');
    void fade.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(fade, false)));
    if (!hintShown) {
      hintShown = true;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        setShown(hint, true);
        hintTimer = setTimeout(() => setShown(hint, false), 6500);
      }, 1400);
    }
  });
  C.on('pause', () => { hideHelp(); setShown(hint, false); showPause('pause'); });
  C.on('resume', () => hideAll());
  C.on('settings', () => { if (isShown(pause)) refreshSettings(); });

  Object.assign(C.ui, {
    el: root,
    showStart, showPause: () => showPause('pause'), showSettings: () => showPause('settings'),
    showHelp, hideHelp, toggleHelp, hideAll,
    isOpen: () => isShown(start) || isShown(pause),
  });

  if (!S.autostart) showStart();
}

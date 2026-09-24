// =====================================================================================================================
//  MATERIALS — procedural canvas-textured PBR materials (C.mats). 1 UV unit = 1 metre unless noted. (SPEC §10)
// =====================================================================================================================
import * as THREE from 'three';
const C = window.COZY;

C.register({
  name: 'materials',
  order: 5,
  init(C) {
    const maxAniso = Math.min(8, C.renderer.capabilities.getMaxAnisotropy());
    const U = C.util;

    // ---------------------------------------------------------------- helpers
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const hex = (h) => { const n = typeof h === 'number' ? h : parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
    function toTex(canvas, { srgb = true, repeat = [1, 1] } = {}) {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = maxAniso;
      t.needsUpdate = true;
      return t;
    }
    // tileable value noise (periods px, py = lattice cells across the texture), normalised 0..1
    const noiseCache = new Map();
    function vnoise(w, h, px, py, seed, oct = 4, pers = 0.5) {
      const key = `${w},${h},${px},${py},${seed},${oct},${pers}`;
      if (noiseCache.has(key)) return noiseCache.get(key);
      const out = new Float32Array(w * h);
      let amp = 1;
      for (let o = 0; o < oct; o++) {
        const cx = Math.max(1, Math.round(px * (1 << o))), cy = Math.max(1, Math.round(py * (1 << o)));
        const rnd = U.rng(seed * 131 + o * 7919 + 17);
        const grid = new Float32Array(cx * cy);
        for (let i = 0; i < grid.length; i++) grid[i] = rnd();
        const xs0 = new Int32Array(w), xs1 = new Int32Array(w), txs = new Float32Array(w);
        for (let x = 0; x < w; x++) { const fx = x / w * cx; const ix = Math.floor(fx); let t = fx - ix; txs[x] = t * t * (3 - 2 * t); xs0[x] = ix % cx; xs1[x] = (ix + 1) % cx; }
        for (let y = 0; y < h; y++) {
          const fy = y / h * cy, iy = Math.floor(fy); let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
          const r0 = (iy % cy) * cx, r1 = ((iy + 1) % cy) * cx;
          const row = y * w;
          for (let x = 0; x < w; x++) {
            const a = grid[r0 + xs0[x]], b = grid[r0 + xs1[x]], c = grid[r1 + xs0[x]], d = grid[r1 + xs1[x]];
            const tx = txs[x];
            const top = a + (b - a) * tx, bot = c + (d - c) * tx;
            out[row + x] += amp * (top + (bot - top) * ty);
          }
        }
        amp *= pers;
      }
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const s = 1 / ((mx - mn) || 1);
      for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * s;
      noiseCache.set(key, out);
      return out;
    }
    // jittered-grid voronoi (tileable): returns {d1, d2, id} arrays
    function voronoi(w, h, gx, gy, seed, jitter = 0.85) {
      const rnd = U.rng(seed);
      const pts = new Float32Array(gx * gy * 2);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        pts[(j * gx + i) * 2] = (i + 0.5 + (rnd() - 0.5) * jitter) / gx;
        pts[(j * gx + i) * 2 + 1] = (j + 0.5 + (rnd() - 0.5) * jitter) / gy;
      }
      const d1 = new Float32Array(w * h), d2 = new Float32Array(w * h), id = new Int32Array(w * h);
      const sx = gx, sy = gy; // scale to cell units
      for (let y = 0; y < h; y++) {
        const v = y / h, cj = Math.floor(v * gy);
        for (let x = 0; x < w; x++) {
          const u = x / w, ci = Math.floor(u * gx);
          let b1 = 1e9, b2 = 1e9, bid = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            let ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
            if (ii < 0) { ii += gx; ox = -1; } else if (ii >= gx) { ii -= gx; ox = 1; }
            if (jj < 0) { jj += gy; oy = -1; } else if (jj >= gy) { jj -= gy; oy = 1; }
            const k = jj * gx + ii;
            const px = pts[k * 2] + ox, py = pts[k * 2 + 1] + oy;
            const dx = (u - px) * sx, dy = (v - py) * sy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < b1) { b2 = b1; b1 = d; bid = k; } else if (d < b2) b2 = d;
          }
          const i = y * w + x;
          d1[i] = b1; d2[i] = b2; id[i] = bid;
        }
      }
      return { d1, d2, id };
    }
    function normalFromHeight(hgt, w, h, strength = 2) {
      const c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) {
        const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w, row = y * w;
        for (let x = 0; x < w; x++) {
          const l = hgt[row + (x - 1 + w) % w], r = hgt[row + (x + 1) % w], up = hgt[yu + x], dn = hgt[yd + x];
          let nx = (l - r) * strength, ny = (dn - up) * strength, nz = 1;
          const len = Math.hypot(nx, ny, nz);
          const i = (row + x) * 4;
          d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (nz / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c;
    }
    function grayCanvas(vals, w, h) {
      const c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
      for (let i = 0; i < w * h; i++) { const v = clamp255(vals[i] * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      return c;
    }
    // Build a material from per-pixel generator: gen(x, y, i) -> sets col[3], returns {h, r}
    function pixelMaterial({ w, h, repeat = [1, 1], gen, normal = 1.5, normalScale = 0.8, type = 'std', params = {}, rough = true }) {
      const color = mkCanvas(w, h), cctx = color.getContext('2d'), img = cctx.createImageData(w, h), d = img.data;
      const hgt = new Float32Array(w * h), rgh = new Float32Array(w * h);
      const out = { c: [0, 0, 0], h: 0.5, r: 0.8 };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        gen(x, y, i, out);
        d[i * 4] = clamp255(out.c[0]); d[i * 4 + 1] = clamp255(out.c[1]); d[i * 4 + 2] = clamp255(out.c[2]); d[i * 4 + 3] = 255;
        hgt[i] = out.h; rgh[i] = out.r;
      }
      cctx.putImageData(img, 0, 0);
      const map = toTex(color, { repeat });
      const opts = Object.assign({ map, roughness: 1, metalness: 0 }, params);
      if (rough) opts.roughnessMap = toTex(grayCanvas(rgh, w, h), { srgb: false, repeat });
      if (normal > 0) { opts.normalMap = toTex(normalFromHeight(hgt, w, h, normal), { srgb: false, repeat }); opts.normalScale = new THREE.Vector2(normalScale, normalScale); }
      const m = type === 'phys' ? new THREE.MeshPhysicalMaterial(opts) : new THREE.MeshStandardMaterial(opts);
      m.userData.canvas = color;
      return m;
    }
    const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

    // ---------------------------------------------------------------- woods
    function plankWood({ w = 1024, h = 512, rows = 8, meters = [2.4, 1.12], palette, seed = 1, seam = 2, joints = 2, grainAmp = 0.28, gap = [40, 28, 20], baseRough = 0.5, wet = 0 }) {
      const pal = palette.map(hex);
      const rnd = U.rng(seed);
      const rh = h / rows;
      const rowInfo = [];
      for (let r = 0; r < rows; r++) {
        const js = [];
        let x = rnd() * w;
        for (let j = 0; j < joints; j++) { js.push(Math.floor(x) % w); x += w / joints * (0.6 + rnd() * 0.8); }
        js.sort((a, b) => a - b);
        const cols = [];
        for (let k = 0; k <= js.length; k++) cols.push({ c: pick(pal, rnd()), b: 0.9 + rnd() * 0.2, off: Math.floor(rnd() * w), oy: Math.floor(rnd() * h) });
        rowInfo.push({ js, cols });
      }
      const grain = vnoise(w, h, 2, 40, seed + 1, 4, 0.55);
      const fine = vnoise(w, h, 48, 96, seed + 2, 2, 0.5);
      const rings = vnoise(w, h, 3, 6, seed + 3, 3, 0.5);
      const gapC = gap;
      return { w, h, repeat: [1 / meters[0], 1 / meters[1]], normal: 2.2, normalScale: 0.55, gen(x, y, i, o) {
        const r = Math.floor(y / rh), ry = y - r * rh;
        const info = rowInfo[r];
        let seg = 0; for (let k = 0; k < info.js.length; k++) if (x >= info.js[k]) seg = k + 1;
        if (seg === info.js.length) seg = 0; // wrap: last segment continues into first plank
        const pc = info.cols[seg];
        const isSeam = ry < seam;
        let isJoint = false; for (let k = 0; k < info.js.length; k++) if (Math.abs(x - info.js[k]) < 1.5) isJoint = true;
        if (isSeam || isJoint) { o.c[0] = gapC[0]; o.c[1] = gapC[1]; o.c[2] = gapC[2]; o.h = 0; o.r = 0.95; return; }
        const gx = (x + pc.off) % w, gy = (y + pc.oy) % h;
        const g = grain[gy * w + gx];
        const fig = 0.5 + 0.5 * Math.sin((gy * 0.9 + rings[gy * w + gx] * 60) * 0.35);
        const f = fine[i];
        const t = (g - 0.5) * grainAmp * 2 + (fig - 0.5) * 0.12 + (f - 0.5) * 0.06;
        const b = pc.b * (1 + t);
        const edge = Math.min(1, (ry - seam) / 4, (rh - ry) / 4); // slight bevel darkening
        const eb = 0.8 + 0.2 * edge;
        o.c[0] = pc.c[0] * b * eb; o.c[1] = pc.c[1] * b * eb; o.c[2] = pc.c[2] * b * eb;
        o.h = 0.55 + 0.45 * edge - (1 - g) * 0.08;
        o.r = baseRough + (1 - g) * 0.12 + f * 0.05 - wet;
      } };
    }
    function solidWood({ base, dark, light, seed = 5, meters = 1, grainPx = 2, grainPy = 36, rough = 0.55, figure = 0.18, w = 512, h = 512 }) {
      const B = hex(base), D = hex(dark), L = hex(light);
      const grain = vnoise(w, h, grainPx, grainPy, seed, 4, 0.55);
      const warp = vnoise(w, h, 2, 3, seed + 9, 3, 0.5);
      const fine = vnoise(w, h, 64, 128, seed + 4, 2, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 1.4, normalScale: 0.4, gen(x, y, i, o) {
        const g = grain[i];
        const ring = 0.5 + 0.5 * Math.sin((y + warp[i] * 90) * 0.22 + g * 3);
        const t = g * (1 - figure) + ring * figure;
        const c = t < 0.5 ? mixC(D, B, t * 2) : mixC(B, L, (t - 0.5) * 2);
        const f = 0.94 + fine[i] * 0.1;
        o.c[0] = c[0] * f; o.c[1] = c[1] * f; o.c[2] = c[2] * f;
        o.h = t * 0.6 + fine[i] * 0.2; o.r = rough + (0.5 - t) * 0.1;
      } };
    }
    function paintedWood({ base, seed = 7, meters = 1, rough = 0.5, grainAmp = 0.035, w = 256, h = 256 }) {
      const B = hex(base);
      const grain = vnoise(w, h, 2, 30, seed, 4, 0.55);
      const brush = vnoise(w, h, 1, 60, seed + 1, 2, 0.5);
      const blot = vnoise(w, h, 3, 3, seed + 2, 3, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 1.2, normalScale: 0.35, gen(x, y, i, o) {
        const v = 1 + (grain[i] - 0.5) * grainAmp * 2 + (brush[i] - 0.5) * 0.02 + (blot[i] - 0.5) * 0.04;
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v;
        o.h = grain[i] * 0.5 + brush[i] * 0.3; o.r = rough + (blot[i] - 0.5) * 0.12;
      } };
    }

    // ---------------------------------------------------------------- walls
    function plaster({ base = '#efe4d0', seed = 21, meters = 2, rough = 0.92 }) {
      const B = hex(base), w = 512, h = 512;
      const cloud = vnoise(w, h, 4, 4, seed, 4, 0.55), fine = vnoise(w, h, 64, 64, seed + 1, 2, 0.5), trowel = vnoise(w, h, 6, 12, seed + 2, 3, 0.6);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 1.2, normalScale: 0.5, gen(x, y, i, o) {
        const v = 1 + (cloud[i] - 0.5) * 0.08 + (fine[i] - 0.5) * 0.035;
        o.c[0] = B[0] * v; o.c[1] = B[1] * v * 0.998; o.c[2] = B[2] * v * 0.99;
        o.h = trowel[i] * 0.6 + fine[i] * 0.25; o.r = rough - trowel[i] * 0.08;
      } };
    }
    function wallpaperFloral() {
      const w = 512, h = 512, meters = 0.64;
      const c = mkCanvas(w, h), ctx = c.getContext('2d');
      ctx.fillStyle = '#98ab85'; ctx.fillRect(0, 0, w, h);
      // faint vertical paper striation
      for (let x = 0; x < w; x += 4) { ctx.fillStyle = `rgba(255,255,240,${0.015 + (x % 16 === 0 ? 0.02 : 0)})`; ctx.fillRect(x, 0, 2, h); }
      const rnd = U.rng(33);
      const drawFlower = (cx, cy, s, rot) => {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
        // stem + leaves
        ctx.strokeStyle = '#6f8661'; ctx.lineWidth = 2.2 * s; ctx.beginPath(); ctx.moveTo(0, 6 * s); ctx.quadraticCurveTo(4 * s, 20 * s, -2 * s, 34 * s); ctx.stroke();
        ctx.fillStyle = '#6f8661';
        for (const sgn of [-1, 1]) { ctx.save(); ctx.translate(1 * s, 20 * s); ctx.rotate(sgn * 0.9); ctx.beginPath(); ctx.ellipse(sgn * 7 * s, 0, 8 * s, 3.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        // petals
        ctx.fillStyle = '#f1e7d0';
        for (let k = 0; k < 5; k++) { ctx.save(); ctx.rotate(k / 5 * Math.PI * 2); ctx.beginPath(); ctx.ellipse(0, -6.5 * s, 4.2 * s, 6.8 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        ctx.fillStyle = '#d4a24a'; ctx.beginPath(); ctx.arc(0, 0, 3.2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      const cells = 4, cw = w / cells, ch = h / cells;
      for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
        const ox = (j % 2) * cw / 2;
        const cx = i * cw + cw / 2 + ox, cy = j * ch + ch / 2, rot = (rnd() - 0.5) * 0.5;
        for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) drawFlower(cx + dx, cy + dy, 1.25, rot);
        // tiny dots
        ctx.fillStyle = 'rgba(241,231,208,0.8)';
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc((i * cw + ox + cw * 0.1 + k * 7) % w, j * ch + ch * 0.95, 1.6, 0, Math.PI * 2); ctx.fill(); }
      }
      // paper grain
      const n = vnoise(w, h, 64, 64, 34, 2, 0.5), img = ctx.getImageData(0, 0, w, h), d = img.data;
      const hgt = new Float32Array(w * h), rg = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) { const v = 0.97 + n[i] * 0.06; d[i * 4] *= v; d[i * 4 + 1] *= v; d[i * 4 + 2] *= v; hgt[i] = n[i] * 0.4 + (d[i * 4] > 200 ? 0.3 : 0); rg[i] = 0.82 + n[i] * 0.1; }
      ctx.putImageData(img, 0, 0);
      const repeat = [1 / meters, 1 / meters];
      return new THREE.MeshStandardMaterial({ map: toTex(c, { repeat }), roughnessMap: toTex(grayCanvas(rg, w, h), { srgb: false, repeat }), roughness: 1,
        normalMap: toTex(normalFromHeight(hgt, w, h, 1.2), { srgb: false, repeat }), normalScale: new THREE.Vector2(0.4, 0.4) });
    }
    function wallpaperStripes() {
      const w = 512, h = 512, meters = 0.64;
      const c = mkCanvas(w, h), ctx = c.getContext('2d');
      ctx.fillStyle = '#8d9fb2'; ctx.fillRect(0, 0, w, h);
      const sw = w / 8;
      for (let k = 0; k < 8; k += 2) { ctx.fillStyle = '#9aabbd'; ctx.fillRect(k * sw, 0, sw, h); ctx.fillStyle = 'rgba(242,236,222,0.55)'; ctx.fillRect(k * sw - 1.5, 0, 3, h); ctx.fillRect(k * sw + sw - 1.5, 0, 3, h); }
      const rnd = U.rng(45);
      for (let k = 1; k < 8; k += 2) for (let j = 0; j < 6; j++) {
        const cx = k * sw + sw / 2, cy = (j + (k % 4 === 1 ? 0.5 : 0)) * h / 6 + 20;
        ctx.save(); ctx.translate(cx, cy % h); ctx.rotate((rnd() - 0.5) * 0.6);
        ctx.fillStyle = '#6f7f73'; ctx.fillRect(-1, 0, 2, 14);
        ctx.fillStyle = '#e8d6cf';
        for (let p = 0; p < 4; p++) { ctx.save(); ctx.rotate(p * Math.PI / 2 + 0.4); ctx.beginPath(); ctx.ellipse(0, -4, 2.6, 4.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        ctx.fillStyle = '#c99a6a'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      const n = vnoise(w, h, 64, 64, 46, 2, 0.5), img = ctx.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < w * h; i++) { const v = 0.97 + n[i] * 0.06; d[i * 4] *= v; d[i * 4 + 1] *= v; d[i * 4 + 2] *= v; }
      ctx.putImageData(img, 0, 0);
      return new THREE.MeshStandardMaterial({ map: toTex(c, { repeat: [1 / meters, 1 / meters] }), roughness: 0.85 });
    }
    function boards({ base, groove = 0.55, boardsPer = 10, meters = 1, seed = 61, rough = 0.75, grainAmp = 0.05, w = 512, h = 512, vertical = false }) {
      const B = hex(base), rows = boardsPer, rh = h / rows;
      const grain = vnoise(w, h, 2, 40, seed, 4, 0.55), fine = vnoise(w, h, 48, 48, seed + 1, 2, 0.5);
      const rnd = U.rng(seed + 3), tint = []; for (let r = 0; r < rows; r++) tint.push(0.94 + rnd() * 0.1);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 2, normalScale: 0.6, gen(x, y, i, o) {
        const yy = vertical ? x : y, xx = vertical ? y : x;
        const r = Math.floor(yy / rh), ry = yy - r * rh;
        const gi = (yy % h) * w + (xx % w);
        if (ry < 2) { o.c[0] = B[0] * groove; o.c[1] = B[1] * groove; o.c[2] = B[2] * groove; o.h = 0; o.r = 0.95; return; }
        const v = tint[r] * (1 + (grain[gi] - 0.5) * grainAmp * 2 + (fine[i] - 0.5) * 0.03);
        const edge = Math.min(1, (ry - 2) / 3, (rh - ry) / 3);
        o.c[0] = B[0] * v * (0.9 + 0.1 * edge); o.c[1] = B[1] * v * (0.9 + 0.1 * edge); o.c[2] = B[2] * v * (0.9 + 0.1 * edge);
        o.h = 0.5 + 0.5 * edge; o.r = rough + (grain[gi] - 0.5) * 0.1;
      } };
    }
    function tiles({ cols, rows, meters, bond = 0.5, grout = 3, palette, groutC = '#c9c3b8', seed = 71, rough = 0.2, groutRough = 0.85, bevel = 5, speck = 0.04, w = 512, h = 512, craze = 0 }) {
      const pal = palette.map(hex), G = hex(groutC);
      const tw = w / cols, th = h / rows, rnd = U.rng(seed);
      const tcol = []; for (let k = 0; k < (cols + 1) * rows; k++) tcol.push({ c: pick(pal, rnd()), v: 0.95 + rnd() * 0.1 });
      const n = vnoise(w, h, 32, 32, seed + 1, 3, 0.5), cl = vnoise(w, h, 4, 4, seed + 2, 3, 0.5);
      return { w, h, repeat: [1 / meters[0], 1 / meters[1]], normal: 3, normalScale: 0.7, gen(x, y, i, o) {
        const r = Math.floor(y / th), off = (r % 2) * bond * tw;
        const xx = (x + off) % w, c = Math.floor(xx / tw);
        const lx = xx - c * tw, ly = y - r * th;
        const dEdge = Math.min(lx, tw - lx, ly, th - ly);
        if (dEdge < grout / 2) { const gv = 0.9 + n[i] * 0.15; o.c[0] = G[0] * gv; o.c[1] = G[1] * gv; o.c[2] = G[2] * gv; o.h = 0; o.r = groutRough; return; }
        const t = tcol[r * (cols + 1) + c];
        const b = Math.min(1, (dEdge - grout / 2) / bevel);
        const v = t.v * (1 + (n[i] - 0.5) * speck + (cl[i] - 0.5) * 0.05) * (0.93 + 0.07 * b);
        o.c[0] = t.c[0] * v; o.c[1] = t.c[1] * v; o.c[2] = t.c[2] * v;
        o.h = 0.35 + 0.65 * Math.sqrt(b); o.r = rough + (1 - b) * 0.1 + n[i] * 0.05;
      } };
    }
    function bricks() {
      return tiles({ cols: 4, rows: 12, meters: [0.9, 0.9], bond: 0.5, grout: 5, groutC: '#b3a898', seed: 81, rough: 0.88, groutRough: 0.95, bevel: 3, speck: 0.35,
        palette: ['#8e4a36', '#7d3f2e', '#9b5540', '#6f3a2b', '#a35a44', '#874534', '#94503a'] });
    }
    function stoneWall({ meters = 1.5, g = 5, seed = 91, palette = ['#7c776f', '#8a8378', '#6e6a63', '#948b7e', '#756c62', '#9a938a', '#85796b'], mortar = '#5e5850', mortarW = 0.13, rough = 0.85, wet = 0 }) {
      const w = 512, h = 512;
      const vor = voronoi(w, h, g, g, seed, 0.9);
      const pal = palette.map(hex), M = hex(mortar), rnd = U.rng(seed + 1);
      const cc = []; for (let k = 0; k < g * g; k++) cc.push({ c: pick(pal, rnd()), v: 0.85 + rnd() * 0.25 });
      const n = vnoise(w, h, 24, 24, seed + 2, 4, 0.55), lich = vnoise(w, h, 6, 6, seed + 3, 3, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 3.5, normalScale: 0.9, gen(x, y, i, o) {
        const e = vor.d2[i] - vor.d1[i];
        if (e < mortarW) { const v = 0.8 + n[i] * 0.3; o.c[0] = M[0] * v; o.c[1] = M[1] * v; o.c[2] = M[2] * v; o.h = 0.05 * n[i]; o.r = 0.95 - wet; return; }
        const s = cc[vor.id[i]];
        const dome = Math.min(1, (e - mortarW) * 3.2);
        const v = s.v * (0.8 + n[i] * 0.35) * (0.85 + 0.15 * dome);
        let c = [s.c[0] * v, s.c[1] * v, s.c[2] * v];
        if (lich[i] > 0.72) c = mixC(c, [120, 132, 90], (lich[i] - 0.72) * 1.4);
        o.c[0] = c[0]; o.c[1] = c[1]; o.c[2] = c[2];
        o.h = 0.25 + 0.75 * Math.sqrt(dome) + n[i] * 0.15; o.r = rough - dome * 0.1 - wet;
      } };
    }
    function siding() {
      const B = hex('#e3ddcf'), w = 512, h = 512, boardsN = 8, rh = h / boardsN;
      const grain = vnoise(w, h, 2, 40, 101, 4, 0.55), streak = vnoise(w, h, 24, 2, 102, 3, 0.5), cl = vnoise(w, h, 3, 3, 103, 3, 0.5);
      return { w, h, repeat: [1 / 1.44, 1 / 1.44], normal: 4, normalScale: 0.9, gen(x, y, i, o) {
        const r = Math.floor(y / rh), ry = (y - r * rh) / rh; // 0 at top of board (canvas top = higher v)
        const lap = ry > 0.9 ? (1 - (ry - 0.9) / 0.1) : 1;
        const shade = 0.86 + 0.14 * (1 - ry) ;
        const dirt = 1 - Math.max(0, streak[i] - 0.55) * 0.35 - (cl[i] - 0.5) * 0.06;
        const v = shade * dirt * (1 + (grain[i] - 0.5) * 0.06) * (ry > 0.93 ? 0.55 : 1);
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v * 0.99;
        o.h = (1 - ry) * 0.2 + ry * 1.0 * lap; o.r = 0.55 + grain[i] * 0.1;
      } };
    }
    function shingles() {
      const w = 512, h = 512, rows = 8, cols = 6, rh = h / rows, cw = w / cols;
      const pal = ['#3c434b', '#353b42', '#444b52', '#30363c', '#4a5058', '#3a4046', '#2d3339'].map(hex), rnd = U.rng(111);
      const sc = []; for (let k = 0; k < rows * (cols + 1); k++) sc.push({ c: pick(pal, rnd()), v: 0.85 + rnd() * 0.3, moss: rnd() });
      const n = vnoise(w, h, 32, 32, 112, 3, 0.5), moss = vnoise(w, h, 5, 5, 113, 4, 0.55), wetN = vnoise(w, h, 6, 2, 114, 3, 0.5);
      return { w, h, repeat: [1 / 1.5, 1 / 1.6], normal: 4, normalScale: 1.0, gen(x, y, i, o) {
        const r = Math.floor(y / rh), off = (r % 2) * cw / 2, xx = (x + off) % w, c = Math.floor(xx / cw);
        const lx = xx - c * cw, ly = (y - r * rh) / rh;
        const s = sc[r * (cols + 1) + c];
        if (lx < 2 || lx > cw - 2) { o.c[0] = 22; o.c[1] = 25; o.c[2] = 29; o.h = 0.1; o.r = 0.6; return; }
        const v = s.v * (0.85 + n[i] * 0.3) * (0.75 + 0.25 * ly);
        let col = [s.c[0] * v, s.c[1] * v, s.c[2] * v];
        const m = moss[i] * (0.6 + 0.6 * ly) * (s.moss > 0.6 ? 1.3 : 0.8);
        if (m > 0.78) col = mixC(col, [78, 96, 52], Math.min(1, (m - 0.78) * 3));
        o.c[0] = col[0]; o.c[1] = col[1]; o.c[2] = col[2];
        o.h = ly * 0.9 + n[i] * 0.1 - (ly > 0.97 ? 0.8 : 0);
        o.r = 0.32 + wetN[i] * 0.25 + (m > 0.78 ? 0.3 : 0);
      } };
    }

    // ---------------------------------------------------------------- fabrics
    function weave({ base, meters = 0.15, seed = 121, cell = 4, contrast = 0.12, flecks = null, rough = 0.95, w = 256, h = 256, noiseAmp = 0.08 }) {
      const B = hex(base), n = vnoise(w, h, 4, 4, seed, 3, 0.5), fn = vnoise(w, h, 64, 64, seed + 1, 2, 0.5), rnd = U.rng(seed + 2);
      const fl = flecks ? flecks.map(hex) : null;
      const fleck = new Uint8Array(w * h);
      if (fl) for (let k = 0; k < w * h * 0.02; k++) fleck[Math.floor(rnd() * w * h)] = 1 + Math.floor(rnd() * fl.length);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 1.6, normalScale: 0.6, gen(x, y, i, o) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const over = (cx + cy) % 2 === 0;
        const lx = (x % cell) / cell, ly = (y % cell) / cell;
        const thread = over ? Math.sin(ly * Math.PI) : Math.sin(lx * Math.PI);
        let v = 1 + (thread - 0.6) * contrast + (n[i] - 0.5) * noiseAmp + (fn[i] - 0.5) * 0.05;
        let c = B;
        if (fl && fleck[i]) c = fl[fleck[i] - 1];
        o.c[0] = c[0] * v; o.c[1] = c[1] * v; o.c[2] = c[2] * v;
        o.h = thread * 0.8 + fn[i] * 0.2; o.r = rough;
      } };
    }
    function knit() {
      const B = hex('#ece0c8'), w = 256, h = 256, sw = 16, sh = 16, n = vnoise(w, h, 8, 8, 131, 3, 0.5);
      return { w, h, repeat: [1 / 0.18, 1 / 0.18], normal: 3, normalScale: 1.0, gen(x, y, i, o) {
        const col = Math.floor(x / sw), lx = (x % sw) / sw - 0.5, ly = ((y + (col % 2) * 0) % sh) / sh;
        // two slanted legs making a V
        const side = lx < 0 ? -1 : 1;
        const ax = lx - side * 0.25 + (ly - 0.5) * 0.35 * side;
        const d = Math.sqrt((ax / 0.2) ** 2 + ((ly - 0.5) / 0.62) ** 2);
        const hgt = Math.max(0, 1 - d);
        const ridge = Math.abs(lx) > 0.46 ? 0 : 1;
        const v = (0.72 + hgt * 0.4) * (0.95 + n[i] * 0.1) * (ridge ? 1 : 0.8);
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v;
        o.h = hgt; o.r = 1;
      } };
    }
    function quilt() {
      const w = 512, h = 512, N = 8, pw = w / N, c = mkCanvas(w, h), ctx = c.getContext('2d'), rnd = U.rng(141);
      const cols = ['#b5563b', '#efe3c8', '#8fa487', '#2f3d5a', '#d09a3a', '#c98f8a', '#7c9cb0', '#a4492f', '#e8d8b8'];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = i * pw, y = j * pw, a = pick(cols, rnd()), b = pick(cols, rnd()), kind = Math.floor(rnd() * 5);
        ctx.fillStyle = a; ctx.fillRect(x, y, pw, pw);
        ctx.fillStyle = b === a ? '#f4ead6' : b;
        if (kind === 0) { for (let k = 0; k < 6; k++) for (let l = 0; l < 6; l++) { ctx.beginPath(); ctx.arc(x + 6 + k * 10.5, y + 6 + l * 10.5 + (k % 2) * 5, 2.2, 0, Math.PI * 2); ctx.fill(); } }
        else if (kind === 1) { for (let k = 0; k < pw; k += 8) ctx.fillRect(x + k, y, 3.5, pw); }
        else if (kind === 2) { ctx.globalAlpha = 0.45; for (let k = 0; k < pw; k += 12) { ctx.fillRect(x + k, y, 6, pw); ctx.fillRect(x, y + k, pw, 6); } ctx.globalAlpha = 1; }
        else if (kind === 3) { for (let k = 0; k < 5; k++) { const fx = x + 8 + rnd() * (pw - 16), fy = y + 8 + rnd() * (pw - 16); for (let p = 0; p < 5; p++) { ctx.beginPath(); ctx.ellipse(fx + Math.cos(p * 1.26) * 3.5, fy + Math.sin(p * 1.26) * 3.5, 2.6, 2.6, 0, 0, Math.PI * 2); ctx.fill(); } } }
        else { ctx.beginPath(); ctx.moveTo(x, y + pw); ctx.lineTo(x + pw, y); ctx.lineTo(x + pw, y + pw); ctx.fill(); }
      }
      ctx.strokeStyle = 'rgba(255,248,230,0.55)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
      for (let k = 0; k <= N; k++) { ctx.beginPath(); ctx.moveTo(k * pw + 3, 0); ctx.lineTo(k * pw + 3, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, k * pw + 3); ctx.lineTo(w, k * pw + 3); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k <= N; k++) { ctx.fillRect(k * pw - 1, 0, 2, h); ctx.fillRect(0, k * pw - 1, w, 2); }
      const n = vnoise(w, h, 32, 32, 142, 3, 0.5), img = ctx.getImageData(0, 0, w, h), d = img.data, hg = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const x = i % w, y = Math.floor(i / w);
        const puff = Math.sin((x % pw) / pw * Math.PI) * Math.sin((y % pw) / pw * Math.PI);
        const v = 0.86 + puff * 0.14 + (n[i] - 0.5) * 0.06; d[i * 4] *= v; d[i * 4 + 1] *= v; d[i * 4 + 2] *= v; hg[i] = puff;
      }
      ctx.putImageData(img, 0, 0);
      const repeat = [1 / 0.96, 1 / 0.96];
      return new THREE.MeshPhysicalMaterial({ map: toTex(c, { repeat }), normalMap: toTex(normalFromHeight(hg, w, h, 3), { srgb: false, repeat }), normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 0.92, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xfff2e0) });
    }
    // whole-object rug textures (UV 0..1 over the rug)
    function rugPersian() {
      const w = 512, h = 768, c = mkCanvas(w, h), ctx = c.getContext('2d');
      const red = '#8c2f2a', navy = '#23304a', cream = '#e9dcc0', gold = '#c8943e', teal = '#3f6a68';
      ctx.fillStyle = navy; ctx.fillRect(0, 0, w, h);
      const inset = (k, col) => { ctx.fillStyle = col; ctx.fillRect(k, k, w - 2 * k, h - 2 * k); };
      inset(10, cream); inset(16, red); inset(22, navy);
      // main border motifs
      ctx.fillStyle = gold;
      for (let y = 40; y < h - 30; y += 28) for (const x of [36, w - 36]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore(); ctx.fillStyle = cream; ctx.beginPath(); ctx.arc(x, y + 14, 2.5, 0, 6.3); ctx.fill(); ctx.fillStyle = gold; }
      for (let x = 40; x < w - 30; x += 28) for (const y of [36, h - 36]) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-6, -6, 12, 12); ctx.restore(); }
      inset(54, cream); inset(58, red);
      // field lattice
      ctx.strokeStyle = 'rgba(35,48,74,0.55)'; ctx.lineWidth = 3;
      for (let k = -h; k < w + h; k += 46) { ctx.beginPath(); ctx.moveTo(58 + k, 58); ctx.lineTo(58 + k + (h - 116), h - 58); ctx.stroke(); ctx.beginPath(); ctx.moveTo(58 + k, h - 58); ctx.lineTo(58 + k + (h - 116), 58); ctx.stroke(); }
      ctx.fillStyle = gold;
      for (let y = 80; y < h - 70; y += 46) for (let x = 81; x < w - 70; x += 46) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.3); ctx.fill(); }
      // medallion
      const cx = w / 2, cy = h / 2;
      const star = (r, n, col, rot = 0) => { ctx.fillStyle = col; ctx.beginPath(); for (let k = 0; k < n * 2; k++) { const a = rot + k / (n * 2) * Math.PI * 2, rr = k % 2 ? r * 0.62 : r; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.25); } ctx.fill(); };
      star(120, 8, navy); star(100, 8, cream, 0.2); star(84, 8, teal); star(62, 8, red, 0.2); star(40, 6, gold); star(20, 6, navy);
      for (const [px, py] of [[90, 110], [w - 90, 110], [90, h - 110], [w - 90, h - 110]]) { ctx.fillStyle = navy; ctx.beginPath(); ctx.ellipse(px, py, 30, 20, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = gold; ctx.beginPath(); ctx.ellipse(px, py, 16, 10, 0, 0, 6.3); ctx.fill(); }
      wear(ctx, w, h, 151, 0.16);
      return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.97 });
    }
    function rugBraided() {
      const w = 512, h = 512, c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
      const bands = ['#a4492f', '#e6d6b6', '#6f8a64', '#2f3d5a', '#c8943e', '#e6d6b6', '#8c5a3a', '#c98f8a'].map(hex);
      const N = 16, n = vnoise(w, h, 16, 16, 161, 2, 0.5);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), r = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
        const i = y * w + x;
        if (r > 1) { d[i * 4 + 3] = 0; continue; }
        const bf = r * N, band = Math.floor(bf), lb = bf - band;
        const col = bands[(band * 3 + (band > 8 ? 1 : 0)) % bands.length];
        const braid = 0.5 + 0.5 * Math.sin(a * (40 + band * 18) + (lb - 0.5) * 5 * (band % 2 ? 1 : -1));
        const v = (0.7 + 0.3 * Math.sin(lb * Math.PI)) * (0.85 + braid * 0.2) * (0.95 + n[i] * 0.1);
        d[i * 4] = col[0] * v; d[i * 4 + 1] = col[1] * v; d[i * 4 + 2] = col[2] * v; d[i * 4 + 3] = r > 0.985 ? 0 : 255;
      }
      ctx.putImageData(img, 0, 0);
      return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.98, transparent: false, alphaTest: 0.5 });
    }
    function rugRunner() {
      const w = 256, h = 1024, c = mkCanvas(w, h), ctx = c.getContext('2d');
      const cols = ['#7a2e26', '#2f3d5a', '#e6d6b6', '#c8943e', '#3f6a68', '#a4492f'];
      ctx.fillStyle = '#7a2e26'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f3d5a'; ctx.fillRect(0, 0, 18, h); ctx.fillRect(w - 18, 0, 18, h);
      ctx.fillStyle = '#e6d6b6'; ctx.fillRect(18, 0, 6, h); ctx.fillRect(w - 24, 0, 6, h);
      let y = 0, k = 0;
      while (y < h) {
        const bh = 40 + (k % 3) * 22;
        ctx.fillStyle = cols[k % cols.length]; ctx.fillRect(24, y, w - 48, bh);
        ctx.fillStyle = cols[(k + 2) % cols.length];
        for (let x = 40; x < w - 40; x += 34) { ctx.beginPath(); ctx.moveTo(x, y + bh / 2); ctx.lineTo(x + 12, y + 6); ctx.lineTo(x + 24, y + bh / 2); ctx.lineTo(x + 12, y + bh - 6); ctx.fill(); }
        ctx.fillStyle = '#e6d6b6'; ctx.fillRect(24, y + bh - 3, w - 48, 3);
        y += bh; k++;
      }
      wear(ctx, w, h, 171, 0.12);
      return new THREE.MeshStandardMaterial({ map: toTex(c), roughness: 0.97 });
    }
    function wear(ctx, w, h, seed, amt) {
      const n = vnoise(w, h, 8, 8, seed, 4, 0.55), f = vnoise(w, h, 128, 128, seed + 1, 1, 0.5), img = ctx.getImageData(0, 0, w, h), d = img.data;
      for (let i = 0; i < w * h; i++) { const v = 1 - amt * 0.5 + (n[i] - 0.5) * amt + (f[i] - 0.5) * 0.12; d[i * 4] *= v; d[i * 4 + 1] *= v; d[i * 4 + 2] *= v; }
      ctx.putImageData(img, 0, 0);
    }

    // ---------------------------------------------------------------- outdoor
    function grass() {
      const w = 512, h = 512, pal = ['#2c4a2a', '#34532e', '#3d5a32', '#27402a', '#46613a', '#4b5a33'].map(hex);
      const cl = vnoise(w, h, 5, 5, 181, 4, 0.55), md = vnoise(w, h, 20, 20, 182, 3, 0.5), fn = vnoise(w, h, 128, 128, 183, 1, 0.5), dry = vnoise(w, h, 3, 3, 184, 3, 0.5);
      return { w, h, repeat: [1 / 3, 1 / 3], normal: 2.5, normalScale: 0.8, gen(x, y, i, o) {
        const t = cl[i] * 0.6 + md[i] * 0.4;
        const a = pal[Math.floor(t * 5.99)], b = pal[Math.floor(md[i] * 5.99)];
        let c = mixC(a, b, fn[i]);
        if (dry[i] > 0.7) c = mixC(c, [98, 96, 60], (dry[i] - 0.7) * 1.2);
        const v = 0.8 + fn[i] * 0.35;
        o.c[0] = c[0] * v; o.c[1] = c[1] * v; o.c[2] = c[2] * v;
        o.h = fn[i] * 0.7 + md[i] * 0.3; o.r = 0.5 + fn[i] * 0.25 + (1 - cl[i]) * 0.1;
      } };
    }
    function earth({ base, seed, meters = 1.5, rough = 0.9, puddles = false }) {
      const B = hex(base), w = 256, h = 256, n = vnoise(w, h, 6, 6, seed, 4, 0.55), f = vnoise(w, h, 64, 64, seed + 1, 2, 0.5), p = vnoise(w, h, 3, 3, seed + 2, 3, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 2.5, normalScale: 0.7, gen(x, y, i, o) {
        const wetSpot = puddles && p[i] > 0.62;
        const v = (0.75 + n[i] * 0.4 + (f[i] - 0.5) * 0.2) * (wetSpot ? 0.7 : 1);
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v;
        o.h = wetSpot ? 0.2 : n[i] * 0.6 + f[i] * 0.4; o.r = wetSpot ? 0.08 : rough - n[i] * 0.2;
      } };
    }
    function pebbles({ meters, g, seed, palette, gap = '#3a3530', gapW = 0.12, rough = 0.6 }) {
      const w = 512, h = 512, vor = voronoi(w, h, g, g, seed, 0.95), pal = palette.map(hex), G = hex(gap), rnd = U.rng(seed + 1);
      const cc = []; for (let k = 0; k < g * g; k++) cc.push({ c: pick(pal, rnd()), v: 0.8 + rnd() * 0.35 });
      const n = vnoise(w, h, 32, 32, seed + 2, 3, 0.5), moss = vnoise(w, h, 6, 6, seed + 3, 3, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 3.5, normalScale: 1.0, gen(x, y, i, o) {
        const e = vor.d2[i] - vor.d1[i];
        if (e < gapW) {
          let c = mixC(G, [52, 70, 40], moss[i] > 0.5 ? 0.7 : 0.1);
          o.c[0] = c[0]; o.c[1] = c[1]; o.c[2] = c[2]; o.h = 0; o.r = 0.9; return;
        }
        const s = cc[vor.id[i]], dome = Math.min(1, (e - gapW) * 2.5);
        const v = s.v * (0.85 + n[i] * 0.3) * (0.8 + 0.2 * dome);
        o.c[0] = s.c[0] * v; o.c[1] = s.c[1] * v; o.c[2] = s.c[2] * v;
        o.h = Math.sqrt(dome) * 0.9 + n[i] * 0.1; o.r = rough - dome * 0.15;
      } };
    }
    function foliageCard({ palette, seed, count = 520, kind = 'leaf', w = 512, h = 512 }) {
      const c = mkCanvas(w, h), ctx = c.getContext('2d'), rnd = U.rng(seed), pal = palette;
      for (let k = 0; k < count; k++) {
        // denser toward the centre, forming a rounded cluster
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.65) * (w * 0.47);
        const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.92;
        const s = (kind === 'leaf' ? 7 : 12) * (0.7 + rnd() * 0.6) * (1.1 - r / w * 0.6);
        ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI * 2);
        const col = pal[Math.floor(rnd() * pal.length)];
        const shade = 0.75 + (1 - r / (w * 0.5)) * 0.35 + (y < h / 2 ? 0.08 : -0.05);
        const cc = hex(col).map(v => clamp255(v * shade));
        ctx.fillStyle = `rgb(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0})`;
        if (kind === 'leaf') {
          ctx.beginPath(); ctx.ellipse(0, 0, s * 1.5, s * 0.75, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(20,30,15,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-s * 1.4, 0); ctx.lineTo(s * 1.4, 0); ctx.stroke();
        } else {
          ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.6;
          for (let q = -4; q <= 4; q++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(q * 0.22) * s * 2, Math.sin(q * 0.22) * s * 2); ctx.stroke(); }
        }
        ctx.restore();
      }
      const t = toTex(c, { srgb: true });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
    }
    function woodEnd() {
      const w = 256, h = 256, c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data, n = vnoise(w, h, 8, 8, 191, 3, 0.5);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), r = Math.sqrt(dx * dx + dy * dy) + (n[y * w + x] - 0.5) * 0.08;
        const ring = 0.5 + 0.5 * Math.sin(r * 60);
        const bark = r > 0.9;
        const col = bark ? [70, 52, 38] : mixC([176, 132, 86], [196, 156, 108], ring);
        const v = bark ? 1 : (0.85 + 0.15 * (1 - r));
        const i = (y * w + x) * 4; d[i] = col[0] * v; d[i + 1] = col[1] * v; d[i + 2] = col[2] * v; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
    }
    function bark() {
      const B = hex('#4d3d2f'), w = 256, h = 512, ridges = vnoise(w, h, 14, 3, 201, 4, 0.55), n = vnoise(w, h, 32, 32, 202, 2, 0.5), lich = vnoise(w, h, 5, 5, 203, 3, 0.5);
      return { w, h, repeat: [1, 1], normal: 5, normalScale: 1.2, gen(x, y, i, o) {
        const r = ridges[i];
        const crack = r < 0.32;
        let c = crack ? [B[0] * 0.45, B[1] * 0.45, B[2] * 0.45] : [B[0] * (0.8 + r * 0.5), B[1] * (0.8 + r * 0.5), B[2] * (0.8 + r * 0.45)];
        if (lich[i] > 0.7) c = mixC(c, [96, 112, 76], (lich[i] - 0.7) * 1.8);
        o.c[0] = c[0] * (0.9 + n[i] * 0.2); o.c[1] = c[1] * (0.9 + n[i] * 0.2); o.c[2] = c[2] * (0.9 + n[i] * 0.2);
        o.h = crack ? 0 : r; o.r = 0.9;
      } };
    }
    function leather() {
      const B = hex('#6b3f24'), w = 256, h = 256, n = vnoise(w, h, 24, 24, 211, 3, 0.6), cl = vnoise(w, h, 3, 3, 212, 3, 0.5);
      return { w, h, repeat: [2, 2], normal: 2.5, normalScale: 0.6, gen(x, y, i, o) {
        const crease = Math.abs(n[i] - 0.5) < 0.04 ? 0.8 : 1;
        const v = (0.8 + cl[i] * 0.35) * crease;
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v;
        o.h = n[i]; o.r = 0.38 + (1 - cl[i]) * 0.25;
      } };
    }
    function wicker() {
      const B = hex('#a57c4b'), w = 256, h = 256, cell = 32, n = vnoise(w, h, 16, 16, 221, 2, 0.5);
      return { w, h, repeat: [1 / 0.3, 1 / 0.3], normal: 3, normalScale: 1, gen(x, y, i, o) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), hor = (cx + cy) % 2 === 0;
        const lx = (x % cell) / cell, ly = (y % cell) / cell;
        const strands = 4, s = hor ? ly * strands : lx * strands, ls = s - Math.floor(s);
        const hh = Math.sin(ls * Math.PI) * (0.6 + 0.4 * Math.sin((hor ? lx : ly) * Math.PI));
        const v = 0.6 + hh * 0.5 + (n[i] - 0.5) * 0.1;
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v; o.h = hh; o.r = 0.85;
      } };
    }
    function speckled({ base, seed, meters = 1, rough = 0.9, amp = 0.2, w = 256, h = 256 }) {
      const B = hex(base), n = vnoise(w, h, 6, 6, seed, 4, 0.55), f = vnoise(w, h, 96, 96, seed + 1, 1, 0.5);
      return { w, h, repeat: [1 / meters, 1 / meters], normal: 1.5, normalScale: 0.5, gen(x, y, i, o) {
        const v = 1 + (n[i] - 0.5) * amp + (f[i] - 0.5) * amp * 0.6;
        o.c[0] = B[0] * v; o.c[1] = B[1] * v; o.c[2] = B[2] * v; o.h = n[i] * 0.5 + f[i] * 0.5; o.r = rough + (f[i] - 0.5) * 0.1;
      } };
    }
    function metal({ color, rough = 0.35, seed = 231, amp = 0.15 }) {
      const w = 128, h = 128, n = vnoise(w, h, 8, 8, seed, 3, 0.5), c = hex(color);
      const m = pixelMaterial({ w, h, repeat: [2, 2], normal: 0, rough: true, params: { metalness: 1 }, gen(x, y, i, o) {
        const v = 0.92 + n[i] * 0.16; o.c[0] = c[0] * v; o.c[1] = c[1] * v; o.c[2] = c[2] * v; o.h = 0; o.r = rough + (n[i] - 0.5) * amp;
      } });
      return m;
    }

    // ---------------------------------------------------------------- registry
    const P = (def, extra = {}, type) => () => { const m = pixelMaterial(Object.assign({}, def, { params: Object.assign({}, def.params || {}, extra), type })); return m; };
    const builders = {
      woodFloor: P(plankWood({ palette: ['#a0673a', '#9a6034', '#aa7244', '#93592f', '#a86b3c', '#9d6538'], seed: 3 })),
      woodDark: P(solidWood({ base: '#4a3122', dark: '#2e1d13', light: '#6a4630', seed: 11, rough: 0.55 })),
      woodMedium: P(solidWood({ base: '#8a5a36', dark: '#5e3a20', light: '#a8744a', seed: 12, rough: 0.55 })),
      woodLight: P(solidWood({ base: '#c49a6c', dark: '#9c7448', light: '#d9b688', seed: 13, rough: 0.6 })),
      woodPainted: P(paintedWood({ base: '#efe7d6', seed: 14, rough: 0.5 })),
      woodPaintedSage: P(paintedWood({ base: '#8fa487', seed: 15, rough: 0.5 })),
      woodPaintedGreen: P(paintedWood({ base: '#2e4a3b', seed: 16, rough: 0.45, grainAmp: 0.06 })),
      woodWeathered: P(solidWood({ base: '#8d8a82', dark: '#5f5b55', light: '#a8a49b', seed: 17, rough: 0.75, figure: 0.1 })),
      woodPorch: P(plankWood({ palette: ['#6d5540', '#654e3b', '#735a44', '#5f4935'], seed: 18, rows: 8, meters: [2.0, 0.96], joints: 1, seam: 3, gap: [18, 14, 11], baseRough: 0.5, wet: 0.12 })),
      bark: P(bark()),
      logEnd: woodEnd,
      plaster: P(plaster({})),
      wallpaper: wallpaperFloral,
      wallpaperBlue: wallpaperStripes,
      ceilingBoards: P(boards({ base: '#e9e2d4', groove: 0.72, boardsPer: 10, meters: 1, seed: 62, rough: 0.8 })),
      tileKitchen: P(tiles({ cols: 4, rows: 8, meters: [0.6, 0.6], palette: ['#f3f0e9', '#efebe2', '#f6f3ec', '#ebe6dc'], groutC: '#cfc9bd', seed: 72, rough: 0.14, bevel: 6, speck: 0.03 })),
      tileFloor: P(tiles({ cols: 4, rows: 4, meters: [1.2, 1.2], bond: 0, grout: 5, palette: ['#b5654a', '#a95c43', '#bf7155', '#9e553d', '#b86a4d', '#c27a5c'], groutC: '#8e8272', seed: 73, rough: 0.55, groutRough: 0.9, bevel: 5, speck: 0.12 })),
      brick: P(bricks()),
      stone: P(stoneWall({})),
      siding: P(siding()),
      shingles: P(shingles()),
      concrete: P(speckled({ base: '#8a8884', seed: 241, meters: 1, rough: 0.9, amp: 0.25 })),
      fabricSofa: P(weave({ base: '#a4492f', meters: 0.12, seed: 122, cell: 3, contrast: 0.14 }), { sheen: 0.8, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffc9a8) }, 'phys'),
      fabricChair: P(weave({ base: '#c9923a', meters: 0.2, seed: 123, cell: 4, contrast: 0.12, flecks: ['#f1e2c0', '#7a4a20', '#a4492f', '#4a3a2a'] }), { sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffe0b0) }, 'phys'),
      fabricCream: P(weave({ base: '#ece2cf', meters: 0.12, seed: 124, cell: 3, contrast: 0.1 }), { sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff) }, 'phys'),
      fabricBlue: P(weave({ base: '#34425f', meters: 0.12, seed: 125, cell: 3 }), { sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x9fb0d0) }, 'phys'),
      fabricGreen: P(weave({ base: '#6f8a64', meters: 0.12, seed: 126, cell: 3 }), { sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xd8e8c8) }, 'phys'),
      fabricRose: P(weave({ base: '#c98f8a', meters: 0.12, seed: 127, cell: 3 }), { sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe0dc) }, 'phys'),
      knit: P(knit(), { sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff) }, 'phys'),
      quilt,
      rugPersian, rugBraided, rugRunner,
      sheepskin: P(speckled({ base: '#efe8da', seed: 251, meters: 0.3, rough: 1, amp: 0.35 }), { sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) }, 'phys'),
      leather: P(leather()),
      brass: () => metal({ color: '#c9a15a', rough: 0.32, seed: 232 }),
      copper: () => metal({ color: '#c07a50', rough: 0.35, seed: 233 }),
      ironBlack: () => { const m = metal({ color: '#2a2826', rough: 0.55, seed: 234, amp: 0.25 }); m.metalness = 0.75; return m; },
      chrome: () => metal({ color: '#e0e0e0', rough: 0.12, seed: 235, amp: 0.05 }),
      ceramic: () => new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.16, metalness: 0 }),
      ceramicBlue: () => new THREE.MeshStandardMaterial({ color: 0x4f6d9a, roughness: 0.2, metalness: 0 }),
      ceramicTerracotta: P(speckled({ base: '#b86b45', seed: 261, meters: 0.5, rough: 0.85, amp: 0.22 })),
      glassClear: () => new THREE.MeshStandardMaterial({ color: 0xe6f0f0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false }),
      paper: () => new THREE.MeshStandardMaterial({ color: 0xf1e9d4, roughness: 0.9 }),
      lampshade: P(weave({ base: '#efe0c0', meters: 0.1, seed: 128, cell: 3, contrast: 0.08 }), { emissive: new THREE.Color(0xffb46b), emissiveIntensity: 0, side: THREE.DoubleSide }),
      bulb: () => new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffc27a, emissiveIntensity: 3, roughness: 0.3 }),
      candleWax: () => new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.55, emissive: 0x2a1a08, emissiveIntensity: 0.2 }),
      soil: P(earth({ base: '#3b2a1e', seed: 271, meters: 0.4, rough: 0.95 })),
      wickerBasket: P(wicker()),
      grass: P(grass()),
      dirt: P(earth({ base: '#5a4634', seed: 281, meters: 1.5, rough: 0.8 })),
      mud: P(earth({ base: '#3e3024', seed: 282, meters: 1.5, rough: 0.35, puddles: true })),
      gravel: P(pebbles({ meters: 1, g: 22, seed: 291, palette: ['#8a847b', '#77726b', '#9a9185', '#6b655e', '#a39a8c', '#81776a'], gap: '#3d3832', gapW: 0.18, rough: 0.55 })),
      flagstone: P(pebbles({ meters: 2, g: 3, seed: 292, palette: ['#77736d', '#6c6862', '#827c73', '#6a6560', '#7d766c'], gap: '#2e2a24', gapW: 0.07, rough: 0.42 })),
      leaves: () => foliageCard({ palette: ['#3f5a32', '#4d6b3a', '#2f4a2a', '#5a7a40', '#667a3a', '#44602f'], seed: 301 }),
      pineNeedles: () => foliageCard({ palette: ['#2c4430', '#263b2a', '#34503a', '#2f4a36'], seed: 302, kind: 'needle', count: 300 }),
      hedge: P(pebbles({ meters: 0.6, g: 14, seed: 311, palette: ['#2f4a2a', '#36552f', '#294226', '#3d5c33', '#2b4a2c'], gap: '#172414', gapW: 0.25, rough: 0.8 })),
      moss: P(speckled({ base: '#4f6a36', seed: 321, meters: 0.5, rough: 0.95, amp: 0.4 })),
      water: () => new THREE.MeshStandardMaterial({ color: 0x1f2c34, roughness: 0.05, metalness: 0.1 }),
      glass: () => new THREE.MeshStandardMaterial({ color: 0xcfe0e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
    };
    const cache = {};
    for (const name of Object.keys(builders)) {
      Object.defineProperty(C.mats, name, {
        enumerable: true, configurable: true,
        get() {
          if (!cache[name]) { const m = builders[name](); m.name = name; cache[name] = m; }
          return cache[name];
        },
      });
    }
    Object.defineProperty(C.mats, 'get', { value: (name) => C.mat(name), enumerable: false });
    Object.defineProperty(C.mats, 'list', { value: () => Object.keys(builders), enumerable: false });
    Object.defineProperty(C.mats, 'built', { value: () => Object.keys(cache), enumerable: false });
    // expose a couple of generator helpers for other modules (paintings, custom textures)
    C.matgen = { vnoise, voronoi, normalFromHeight, toTex, pixelMaterial, mkCanvas, hex };
  },
});

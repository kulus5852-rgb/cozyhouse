// Scratch test module for outdoor development: dusk lighting/fog/sky + placeholder house when those modules are absent.
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'outdoor_testlight', order: 31,
  init(C) {
    const has = n => C.modules.some(m => m.name === n);
    if (!has('weather')) {
      const preset = C.params.get('time') || 'dusk';
      const P = {
        afternoon: { sky: 0x7d8896, hemi: [0xaab6c6, 0x3a3a30, 1.4], dir: 1.0, day: 0.85, fog: 0.016 },
        dusk: { sky: 0x4b5566, hemi: [0x7a879c, 0x2a2822, 0.75], dir: 0.3, day: 0.45, fog: 0.02 },
        night: { sky: 0x141923, hemi: [0x33405a, 0x141210, 0.3], dir: 0.06, day: 0.08, fog: 0.024 },
      }[preset] || null;
      C.scene.background = new THREE.Color(P.sky);
      C.scene.fog = new THREE.FogExp2(P.sky, P.fog);
      const h = new THREE.HemisphereLight(P.hemi[0], P.hemi[1], P.hemi[2]); C.scene.add(h);
      const d = new THREE.DirectionalLight(0xb8c4d8, P.dir); d.position.set(-20, 30, 10); C.scene.add(d);
      C.env.preset = preset; C.env.daylight = P.day;
    }
    if (!has('house')) {
      const g = new THREE.Group(); g.name = 'placeholderHouse'; C.scene.add(g);
      const U = C.util, M = C.mat;
      U.boxAt(g, -7, -0.45, -5, 7, 4, 5, M('siding'));
      const roof = new THREE.Shape(); roof.moveTo(-5.6, 3.58); roof.lineTo(0, 7.5 + 0.27); roof.lineTo(5.6, 3.58); roof.lineTo(-5.6, 3.58);
      const rg = new THREE.ExtrudeGeometry(roof, { depth: 14.8, bevelEnabled: false }); rg.rotateY(Math.PI / 2); rg.translate(-7.4, 0, 0);
      g.add(new THREE.Mesh(rg, M('shingles')));
      U.boxAt(g, -7.9, -0.45, 1.8, -7.0, 8.4, 3.2, M('stone'));
      U.boxAt(g, 1.2, -0.45, 5, 6.8, 0, 7.2, M('woodPorch'));
      U.boxAt(g, 3.0, -0.45, 7.2, 4.5, -0.15, 7.5, M('woodPorch'));
      U.boxAt(g, 3.0, -0.45, 7.5, 4.5, -0.30, 7.8, M('woodPorch'));
      U.boxAt(g, 1.0, 2.6, 5.0, 7.0, 2.75, 7.4, M('shingles'));
      for (const x of [1.3, 2.85, 4.65, 6.7]) U.boxAt(g, x - 0.07, 0, 7.03, x + 0.07, 2.6, 7.17, M('woodPainted'));
      const win = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.6) });
      U.boxAt(g, -5.2, 0.55, 5.0, -2.6, 2.3, 5.02, win);
      U.boxAt(g, 2.35, 0.9, 5.0, 2.95, 2.1, 5.02, win);
      U.boxAt(g, 3.25, 0, 5.0, 4.25, 2.15, 5.03, M('woodPaintedGreen'));
      const P = C.physics;
      P.addFloor(-7, -5, 7, 5, 0, { surface: 'wood' });
      P.addFloor(1.2, 5, 6.8, 7.2, 0, { surface: 'porch' });
      P.addRamp(3.0, 7.2, 4.5, 7.8, 'z', 0.0, -0.45, { surface: 'porch' });
      P.addBox([-7, -0.45, 4.75], [7, 4.1, 5], { tag: 'wall' });
      P.addBox([-7, -0.45, -5], [7, 4.1, -4.75], { tag: 'wall' });
      P.addBox([-7, -0.45, -5], [-6.75, 4.1, 5], { tag: 'wall' });
      P.addBox([6.75, -0.45, -5], [7, 4.1, 5], { tag: 'wall' });
      P.addBox([1.3, 0, 7.05], [2.85, 1.0, 7.15], { tag: 'railing' });
      P.addBox([4.65, 0, 7.05], [6.7, 1.0, 7.15], { tag: 'railing' });
      P.addBox([1.2, 0, 5.0], [1.3, 1.0, 7.1], { tag: 'railing' });
      P.addBox([6.7, 0, 5.0], [6.8, 1.0, 7.1], { tag: 'railing' });
    }
  },
});

// scratch test scene for weather development (only active when the real house module is absent)
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'wtest', order: 19,
  init(C) {
    const hasHouse = C.modules.some(m => m.name === 'house');
    const hasOutdoor = C.modules.some(m => m.name === 'outdoor');
    const root = new THREE.Group(); root.name = 'wtest'; C.scene.add(root);
    const U = C.util;
    if (!hasOutdoor) {
      const g = new THREE.PlaneGeometry(120, 120); g.rotateX(-Math.PI / 2); U.worldUV(g, 1);
      const m = new THREE.Mesh(g, C.mat('grass')); m.position.y = -0.45; root.add(m);
      C.physics.addFloor(-60, -60, 60, 60, -0.45, { surface: 'grass' });
    }
    if (hasHouse) return;
    const wall = C.mat('siding'), inner = C.mat('plaster'), floor = C.mat('woodFloor'), roof = C.mat('shingles');
    C.physics.addFloor(-7, -5, 7, 5, 0, { surface: 'wood' });
    U.boxAt(root, -7, -0.45, -5, 7, 0, 5, C.mat('stone'));
    U.boxAt(root, -6.75, -0.01, -4.75, 6.75, 0, 4.75, floor);
    // south wall with the living window hole x -5.2..-2.6, y .55..2.3 and hall window
    const S = (x0, y0, x1, y1) => U.boxAt(root, x0, y0, 4.75, x1, y1, 5.0, wall);
    S(-7, 0, -5.2, 4); S(-2.6, 0, 7, 4); S(-5.2, 0, -2.6, 0.55); S(-5.2, 2.3, -2.6, 4);
    U.boxAt(root, -7, 0, -5, 7, 4, -4.75, wall);
    U.boxAt(root, -7, 0, -5, -6.75, 4, 5, wall);
    U.boxAt(root, 6.75, 0, -5, 7, 4, 5, wall);
    U.boxAt(root, -6.75, 2.8, -4.75, 6.75, 3.0, 4.75, inner);
    // gable roof
    for (const s of [-1, 1]) {
      const len = Math.hypot(5.6, 3.92);
      const m = U.box(root, 14.8, 0.2, len, roof, 0, 7.77 - 0.1 - 3.92 / 2, s * 2.8, { rx: s * Math.atan2(3.92, 5.6) });
      m.name = 'roof';
    }
    U.boxAt(root, -7.9, -0.45, 1.8, -7.0, 8.4, 3.2, C.mat('stone'));
    // porch deck + roof
    U.boxAt(root, 1.2, -0.45, 5.0, 6.8, 0, 7.2, C.mat('woodPorch'));
    const pr = U.box(root, 6, 0.1, 2.45, roof, 4, 3.27 - 0.3 - 0.05, 6.2, { rx: Math.atan2(0.6, 2.4) });
    pr.name = 'porchRoof';
    for (const x of [1.3, 2.85, 4.65, 6.7]) U.box(root, 0.14, 2.7, 0.14, C.mat('woodPainted'), x, 1.35, 7.1);
    // interior lamp
    const l = new THREE.PointLight(0xffb46b, 25, 0, 2); l.position.set(-3.9, 1.6, 2.5); root.add(l);
    const l2 = new THREE.PointLight(0xff8a3d, 30, 0, 2); l2.position.set(-6.2, 0.6, 2.5); root.add(l2);
    const sofa = U.box(root, 2.2, 0.8, 0.9, C.mat('fabricSofa'), -3.9, 0.4, 1.0);
    U.box(root, 1.0, 1.8, 0.4, C.mat('woodDark'), -1.5, 0.9, 4.4);
    // glass panes
    const panes = [];
    const pane = (w, h, x, y, z, ry, id, normal, skylight = false, rx = 0) => {
      const g = new THREE.PlaneGeometry(w, h);
      const m = new THREE.Mesh(g, C.mat('glass'));
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ');
      m.userData = { windowId: id, normal, w, h, skylight };
      m.name = 'glass.' + id;
      root.add(m); panes.push(m);
    };
    pane(2.6, 1.75, -3.9, 1.425, 4.87, 0, 'w_living_s', [0, 0, 1]);
    // skylight in the south slope over the loft
    const ang = Math.atan2(3.92, 5.6);
    pane(0.9, 1.3 / Math.cos(ang), -5.45, 7.77 - 0.7 * 1.75 + 0.02, 1.75, 0, 'sk_1', [0, Math.cos(ang), Math.sin(ang)], true, -Math.PI / 2 + ang);
    C.house = C.house || {};
    C.house.glassPanes = panes;
  },
});

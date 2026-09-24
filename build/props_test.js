// Scratch showroom for props.js (not part of the game)
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'props_test', order: 99,
  init(C) {
    const P = C.props, U = C.util;
    const root = new THREE.Group(); root.name = 'props_test'; C.scene.add(root);
    C.scene.background = new THREE.Color(0x1a1c20);
    // room shell
    U.boxAt(root, -15, -0.1, -3, 15, 0, 5, C.mat('woodFloor'));
    U.boxAt(root, -15, 0, -2.75, 15, 3, -2.5, C.mat('plaster'));
    U.boxAt(root, -15, 0, -2.5, 15, 0.12, -2.48, C.mat('woodPainted'));
    const LI = +(C.params.get('li') || 1), FI = +(C.params.get('fi') || 1);
    const hemi = new THREE.HemisphereLight(0x8090a8, 0x3a2e24, 0.25 * FI); root.add(hemi);
    const night = C.params.get('time') === 'night';
    const _lamp = P.lamp; P.lamp = (o) => _lamp(Object.assign({}, o, { intensity: (o.intensity || ({floor:18,table:11,desk:28,pendant:24,ceiling:14,wall:9,lantern:10})[o.type]) * LI }));
    if (!night) {
      const d = new THREE.DirectionalLight(0xb8c4d8, 0.5 * FI); d.position.set(3, 6, 6); root.add(d);
    }
    const fill = new THREE.PointLight(0xffc890, (night ? 1 : 3) * FI, 0, 2); fill.position.set(0, 2.6, 2.5); root.add(fill);
    const fill2 = new THREE.PointLight(0xffc890, (night ? 1 : 3) * FI, 0, 2); fill2.position.set(-9, 2.6, 2.5); root.add(fill2);
    const fill3 = new THREE.PointLight(0xffc890, (night ? 1 : 3) * FI, 0, 2); fill3.position.set(9, 2.6, 2.5); root.add(fill3);

    const table = (x, z, w, d, h, parent = root) => {
      U.boxAt(parent, x - w / 2, h - 0.04, z - d / 2, x + w / 2, h, z + d / 2, C.mat('woodMedium'));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) U.boxAt(parent, x + sx * (w / 2 - 0.05) - 0.025, 0, z + sz * (d / 2 - 0.05) - 0.025, x + sx * (w / 2 - 0.05) + 0.025, h - 0.04, z + sz * (d / 2 - 0.05) + 0.025, C.mat('woodMedium'));
      return h;
    };
    // ---- lamps (x -13..-7)
    P.lamp({ id: 'lamp_test_floor', type: 'floor', position: [-12.6, 0, -2.0], parent: root, room: 'test' });
    table(-11.3, -2.1, 0.5, 0.45, 0.6);
    P.lamp({ id: 'lamp_test_table', type: 'table', position: [-11.3, 0.6, -2.15], parent: root });
    table(-10.0, -2.1, 1.0, 0.55, 0.75);
    P.lamp({ id: 'lamp_test_desk', type: 'desk', position: [-10.1, 0.75, -2.2], parent: root });
    P.lamp({ id: 'lamp_test_wall', type: 'wall', position: [-8.9, 1.7, -2.5], parent: root });
    P.lamp({ id: 'lamp_test_lantern', type: 'lantern', position: [-8.1, 1.7, -2.5], parent: root });
    table(-11.5, -0.8, 0.9, 0.7, 0.75);
    P.lamp({ id: 'lamp_test_pendant', type: 'pendant', position: [-11.5, 2.4, -0.8], height: 0.75, parent: root });
    P.lamp({ id: 'lamp_test_pendant2', type: 'pendant', style: 'drum', position: [-9.6, 2.6, -0.8], height: 0.8, shadeColor: 0x9caf88, parent: root });
    P.lamp({ id: 'lamp_test_pendant3', type: 'pendant', style: 'glass', position: [-8.4, 2.6, -0.8], height: 0.8, parent: root });
    P.lamp({ id: 'lamp_test_ceiling', type: 'ceiling', position: [-13.2, 2.8, -0.8], parent: root });
    P.lamp({ id: 'lamp_test_lantern2', type: 'lantern', mount: 'stand', position: [-11.3, 0.75, -0.8], parent: root, on: false });
    P.lamp({ id: 'lamp_test_floor2', type: 'floor', position: [-7.3, 0, -2.0], parent: root, on: false, shadeColor: 0xa4492f, metal: 'iron' });

    // ---- paintings (x -6..1)
    const styles = ['landscape', 'seascape', 'botanical', 'portrait', 'abstract', 'cottage', 'map'];
    const frames = ['gold', 'wood', 'white', 'gold', 'black', 'wood', 'black'];
    const sizes = [[0.7, 0.5], [0.6, 0.45], [0.35, 0.5], [0.45, 0.58], [0.5, 0.5], [0.55, 0.42], [0.7, 0.5]];
    styles.forEach((s, i) => P.painting({ style: s, frame: frames[i], width: sizes[i][0], height: sizes[i][1], position: [-5.6 + i * 0.95, 1.6, -2.5], parent: root, seed: i + 3 }));
    styles.forEach((s, i) => P.painting({ style: s, frame: frames[(i + 3) % 7], width: 0.32, height: 0.26, position: [-5.6 + i * 0.95, 0.95, -2.5], parent: root, seed: i + 11 }));

    // ---- bookshelf (x 2..4.4)
    const sx0 = 2.0, sx1 = 4.4, sd = 0.3, zb = -2.5;
    U.boxAt(root, sx0 - 0.03, 0, zb, sx0, 2.0, zb + sd, C.mat('woodDark'));
    U.boxAt(root, sx1, 0, zb, sx1 + 0.03, 2.0, zb + sd, C.mat('woodDark'));
    [0.08, 0.45, 0.82, 1.19, 1.56, 1.94].forEach((y, i) => {
      U.boxAt(root, sx0, y - 0.025, zb, sx1, y, zb + sd, C.mat('woodDark'));
      if (i < 5) P.books({ length: sx1 - sx0 - 0.02, depth: 0.22, position: [(sx0 + sx1) / 2, y, zb + sd - 0.12], parent: root, seed: i + 1, fill: i === 2 ? 0.55 : 1 });
    });
    P.bookStack({ count: 4, position: [4.0, 0.82, zb + 0.15], parent: root, seed: 3 });

    // ---- plants (x 6..13)
    const types = ['fern', 'monstera', 'snake', 'succulent', 'ivy', 'herb', 'fiddle', 'pothos'];
    types.forEach((t, i) => P.plant({ type: t, position: [6.3 + i * 0.85, 0, -1.9], parent: root, seed: i + 1 }));
    table(9.2, -0.7, 1.6, 0.5, 0.7);
    ['succulent', 'herb', 'ivy', 'pothos', 'fern'].forEach((t, i) => P.plant({ type: t, position: [8.6 + i * 0.3, 0.7, -0.7], parent: root, seed: i + 20, scale: t === 'fern' ? 0.7 : 1 }));

    // ---- rugs (x -13..-5, z 0.5..4)
    P.rug({ style: 'persian', w: 2.0, d: 1.4, position: [-12, 0, 1.3], parent: root });
    P.rug({ style: 'braided', w: 1.4, d: 1.4, round: true, position: [-9.8, 0, 1.3], parent: root });
    P.rug({ style: 'runner', w: 0.7, d: 2.2, position: [-8.2, 0, 1.6], parent: root });
    P.rug({ style: 'sheepskin', w: 1.0, d: 0.7, position: [-6.8, 0, 1.0], parent: root });
    P.rug({ style: 'kilim', w: 1.6, d: 1.0, position: [-12, 0, 3.3], parent: root });
    P.rug({ style: 'braided', w: 1.6, d: 1.0, position: [-9.8, 0, 3.3], parent: root });

    // ---- textiles (x -4..1, z 0.5..2)
    U.boxAt(root, -4, 0, 0.4, -2.2, 0.42, 1.0, C.mat('woodDark'));      // bench
    P.pillow({ position: [-3.6, 0.63, 0.62], rotation: [-0.25, 0.1, 0.05], color: 0xa4492f, parent: root });
    P.pillow({ position: [-3.05, 0.61, 0.62], rotation: [-0.22, -0.05, -0.04], material: 'fabricBlue', parent: root, button: true });
    P.pillow({ w: 0.5, h: 0.32, t: 0.13, position: [-2.55, 0.57, 0.63], rotation: [-0.2, -0.1, 0], color: 0xd09a3a, parent: root });
    P.pillow({ shape: 'round', w: 0.4, h: 0.4, t: 0.12, position: [-3.3, 0.49, 0.85], rotation: [-Math.PI / 2, 0, 0], material: 'fabricRose', parent: root });
    P.pillow({ shape: 'bolster', w: 0.5, h: 0.18, position: [-2.5, 0.51, 0.88], material: 'fabricGreen', parent: root });
    P.blanket({ w: 0.5, d: 0.36, folds: 3, position: [-1.6, 0, 0.7], parent: root });
    P.blanket({ w: 0.5, d: 0.36, t: 0.025, folds: 4, material: 'quilt', position: [-1.6, 0.085, 0.7], parent: root, rotationY: 0.12 });
    U.boxAt(root, -0.9, 0, 0.4, 0.4, 0.62, 1.0, C.mat('fabricSofa'));   // sofa-arm mock
    P.throwBlanket({ w: 1.0, d: 0.9, position: [-0.25, 0.62, 0.7 - 0.6], parent: root, drapeOver: { drop: 0.55, radius: 0.04 }, material: 'knit' });
    P.throwBlanket({ w: 1.2, d: 0.9, position: [-2.6, 0.001, 2.0], parent: root, material: 'quilt', rotationY: 0.3 });

    // ---- tabletop (x 2..5, z 0.2)
    table(3.5, 0.3, 1.8, 0.8, 0.75);
    const ty = 0.75;
    P.mug({ position: [2.85, ty, 0.1], parent: root, steam: true, color: 0xe9dcc6 });
    P.mug({ position: [3.0, ty, 0.45], parent: root, color: 0x3d5a45, rotationY: 1 });
    P.teapot({ position: [3.3, ty, 0.2], parent: root, steam: true });
    P.vase({ position: [3.75, ty, 0.1], parent: root, flowers: 'tulip', seed: 2 });
    P.vase({ position: [4.05, ty, 0.35], parent: root, flowers: 'daisy', shape: 'round', color: 0xefe6d4, height: 0.16, seed: 4 });
    P.vase({ position: [4.3, ty, 0.05], parent: root, flowers: 'lavender', shape: 'bottle', color: 0x4f6d9a, seed: 5 });
    P.jar({ position: [2.75, ty, 0.5], parent: root, contents: 'beans', lid: 'wood' });
    P.jar({ position: [2.62, ty, 0.35], parent: root, contents: 'flour', radius: 0.045, height: 0.12 });
    P.bottle({ position: [4.2, ty, 0.55], parent: root, kind: 'wine' });
    P.bottle({ position: [4.35, ty, 0.5], parent: root, kind: 'milk' });
    P.candle({ position: [3.55, ty, 0.5], parent: root, id: 'candle_test' });
    P.candle({ position: [3.7, ty, 0.55], parent: root, height: 0.22, radius: 0.011, holder: 'brass' });
    P.candle({ position: [3.4, ty, 0.55], parent: root, height: 0.08, radius: 0.035, holder: 'saucer' });
    P.clock({ position: [3.35, ty, -0.02], parent: root });
    P.frame({ position: [2.6, ty, 0.08], parent: root, seed: 1, rotationY: 0.3 });
    P.frame({ position: [4.55, ty, 0.2], parent: root, seed: 2, rotationY: -0.4, w: 0.18, h: 0.13 });
    P.bookStack({ count: 3, position: [3.9, ty, 0.62], parent: root, seed: 7, rotationY: 0.2 });
    P.basket({ position: [5.4, 0, 0.3], parent: root, contents: 'yarn' });
    P.basket({ position: [5.4, 0, 1.0], parent: root, contents: 'logs', radius: 0.22, oval: 0.7, handle: true });
    P.basket({ position: [2.1, 0, 1.2], parent: root, contents: 'apples', radius: 0.15, height: 0.12 });
    P.glow(root, [5.0, 1.2, 0.3], 0xffc080, 0.3);
    U.bakeStatic(root);
    P.lamp = _lamp;
  },
});

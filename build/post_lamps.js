// Scratch (NOT product): stand-in living-room lighting for tuning post.js in the real house.
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'post_lamps', order: 61,
  init(C) {
    if (!C.props || !C.props.lamp) return;
    const root = new THREE.Group(); root.name = 'post_lamps'; C.scene.add(root);
    const U = C.util;
    C.props.lamp({ id: 't_floor', type: 'floor', position: [-5.9, 0, 4.2], parent: root, room: 'living' });
    U.box(root, 0.5, 0.6, 0.5, C.mat('woodMedium'), -1.0, 0.3, 4.3);
    C.props.lamp({ id: 't_table', type: 'table', position: [-1.0, 0.6, 4.3], parent: root, room: 'living' });
    U.box(root, 1.2, 0.45, 0.6, C.mat('woodDark'), -3.2, 0.225, 2.5);
    if (C.props.candle) { C.props.candle({ position: [-3.4, 0.45, 2.4], parent: root }); C.props.candle({ position: [-3.0, 0.45, 2.6], parent: root, height: 0.1 }); }
    C.props.lamp({ id: 't_pend', type: 'pendant', position: [-3.4, 2.8, -1.5], parent: root, room: 'kitchen' });
    // fake fire
    const fire = U.stdMat(0x000000, 1, 0, { emissive: 0xff7a2a, emissiveIntensity: 3 });
    U.sphere(root, 0.16, fire, -6.45, 0.3, 2.5, { sy: 1.5 });
    const fl = new THREE.PointLight(0xff8a3d, 35, 0, 2); fl.position.set(-6.25, 0.55, 2.5); root.add(fl);
    const fg = U.glowSprite(0xff8a3d, 1.0, 0.35); fg.position.set(-6.3, 0.45, 2.5); root.add(fg);
  },
});

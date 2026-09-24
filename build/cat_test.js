// Scratch scaffold for cat.js development (not part of the game): stand-in window-seat cushion, fire rug, lights.
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'cat_test', order: 65,
  init(C) {
    if (C.living) return; // real living room present
    const U = C.util;
    const root = new THREE.Group(); root.name = 'cat_test'; C.scene.add(root);
    // window seat box + cushion (top at 0.48)
    U.boxAt(root, -5.15, 0, 4.1, -2.65, 0.4, 4.75, C.mat('woodPainted'));
    U.box(root, 2.46, 0.08, 0.6, C.mat('fabricCream'), -3.9, 0.44, 4.44, { round: 0.03, segments: 3 });
    U.box(root, 0.5, 0.4, 0.14, C.mat('fabricRose'), -4.7, 0.68, 4.62, { round: 0.06, segments: 3, rx: -0.2 });
    // rug by the fire
    U.boxAt(root, -5.9, 0, 1.6, -4.3, 0.01, 3.4, C.mat('rugBraided'));
    // warm fill lights (stand-ins for the living room lamps / fire)
    const l1 = new THREE.PointLight(0xffb46b, 7, 0, 2); l1.position.set(-2.2, 1.5, 3.2); root.add(l1);
    const l2 = new THREE.PointLight(0xff8a3d, 12, 0, 2); l2.position.set(-6.25, 0.55, 2.5); root.add(l2);
    C.living = { catSpots: [
      { name: 'window', position: [-3.0, 0.48, 4.45], rotationY: Math.PI },
      { name: 'fire', position: [-5.2, 0.01, 2.5], rotationY: Math.PI / 2 },
    ] };
    C.living._fake = true;
  },
});

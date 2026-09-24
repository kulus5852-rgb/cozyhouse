// Scratch test scene for post.js tuning (NOT part of the product). Dark room + warm lamp + emissives + glow sprites + cool window.
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'post_test', order: 50,
  init(C) {
    const U = C.util, root = new THREE.Group(); root.name = 'post_test'; C.scene.add(root);
    C.scene.background = new THREE.Color(0x1a1f28);
    // room x -6.75..2, z -1..4.75, y 0..2.8
    U.boxAt(root, -6.75, -0.1, -1, 2, 0, 4.75, C.mat('woodFloor'));
    U.boxAt(root, -6.75, 2.8, -1, 2, 2.9, 4.75, C.mat('ceilingBoards'));
    U.boxAt(root, -6.95, 0, -1, -6.75, 2.8, 4.75, C.mat('wallpaper'));
    U.boxAt(root, -6.75, 0, 4.75, 2, 2.8, 4.95, C.mat('plaster'));
    U.boxAt(root, -6.75, 0, -1.2, 2, 2.8, -1, C.mat('plaster'));
    // window on west wall: cool dusk outside
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.22, 0.3) }));
    win.position.set(-6.74, 1.6, 0.6); win.rotation.y = Math.PI / 2; root.add(win);
    // sofa-ish block + white vase near the lamp
    U.box(root, 2.0, 0.8, 0.9, C.mat('fabricSofa'), -4.2, 0.4, 3.9, { round: 0.08 });
    U.box(root, 0.25, 0.5, 0.25, C.mat('ceramic'), -5.3, 0.75, 1.3);
    U.box(root, 0.6, 0.5, 0.6, C.mat('woodMedium'), -5.3, 0.25, 1.3);
    // floor lamp at (-5.6, 0, 3.9): shade emissive, bulb, point light, glow sprite
    const shadeMat = C.mat('lampshade').clone(); shadeMat.emissiveIntensity = 0.9;
    U.cyl(root, 0.18, 0.26, 0.3, shadeMat, -5.6, 1.5, 3.9, { open: true, radial: 24 });
    U.cyl(root, 0.015, 0.015, 1.4, C.mat('brass'), -5.6, 0.7, 3.9);
    U.sphere(root, 0.04, C.mat('bulb'), -5.6, 1.45, 3.9);
    const pl = new THREE.PointLight(0xffb46b, 12, 0, 2); pl.position.set(-5.6, 1.45, 3.9); root.add(pl);
    const gs = U.glowSprite(0xffb46b, 0.9, 0.5); gs.position.set(-5.6, 1.5, 3.9); root.add(gs);
    // fire-ish emissive in the "firebox"
    U.box(root, 0.3, 1.0, 1.2, C.mat('stone'), -6.6, 0.5, 2.5);
    const fire = U.stdMat(0x000000, 1, 0, { emissive: 0xff7a2a, emissiveIntensity: 4 });
    U.sphere(root, 0.18, fire, -6.4, 0.35, 2.5, { sy: 1.6 });
    const fl = new THREE.PointLight(0xff8a3d, 30, 0, 2); fl.position.set(-6.25, 0.55, 2.5); root.add(fl);
    const fg = U.glowSprite(0xff8a3d, 1.2, 0.4); fg.position.set(-6.3, 0.5, 2.5); root.add(fg);
    // string of small bulbs along the ceiling
    for (let i = 0; i < 12; i++) U.sphere(root, 0.02, C.mat('bulb'), -6 + i * 0.5, 2.6 - Math.sin(i * 0.9) * 0.05, 0.2);
    // candle
    U.cyl(root, 0.025, 0.025, 0.14, C.mat('candleWax'), -4.9, 0.57, 1.3);
    const cg = U.glowSprite(0xffc080, 0.15, 0.9); cg.position.set(-4.9, 0.68, 1.3); root.add(cg);
    root.add(new THREE.HemisphereLight(0x8090b0, 0x302018, 0.08));
  },
});

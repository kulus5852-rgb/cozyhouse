// Scratch test: material swatch board (not part of the game)
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'swatches', order: 99,
  init(C) {
    const names = C.mats.list();
    const g = new THREE.Group(); C.scene.add(g);
    C.scene.background = new THREE.Color(0x202428);
    const cols = 10;
    names.forEach((n, i) => {
      const x = (i % cols) * 1.4 - 6.3, z = Math.floor(i / cols) * 1.6 - 4;
      const m = C.mat(n);
      const box = C.util.box(g, 1.0, 1.0, 0.12, m, x, 0.6, z);
      const lbl = C.util.canvasTexture(256, 48, (ctx, w, h) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.fillText(n, 8, 34); }, { wrap: false });
      const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.19), new THREE.MeshBasicMaterial({ map: lbl }));
      sp.position.set(x, -0.05, z + 0.07); g.add(sp);
    });
    const hemi = new THREE.HemisphereLight(0xcfd8e8, 0x3a3028, 0.9); C.scene.add(hemi);
    const d = new THREE.DirectionalLight(0xfff0dd, 2.0); d.position.set(3, 6, 8); C.scene.add(d);
    const p = new THREE.PointLight(0xffb46b, 30); p.position.set(0, 2, 2); C.scene.add(p);
    // simple env for metals
    const pm = new THREE.PMREMGenerator(C.renderer);
    const envScene = new THREE.Scene(); envScene.background = new THREE.Color(0x888070);
    C.scene.environment = pm.fromScene(envScene).texture;
    C.scene.environmentIntensity = 0.4;
  },
});

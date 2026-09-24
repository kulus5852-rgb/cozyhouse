// Scratch test lighting for the house module (NOT part of the product). Adds dim dusk ambience, fog, a few warm
// room lights, a fire light with shadows, and a temporary yard floor at y = -0.45 (outdoor provides the real one).
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'house_testlight',
  order: 29,
  init(C) {
    const has = n => C.modules.some(m => m.name === n);
    const night = C.params.get('time') === 'night';
    const g = new THREE.Group(); g.name = 'house_testlight'; C.scene.add(g);
    if (!has('weather')) {
      C.scene.background = new THREE.Color(night ? 0x0b0f18 : 0x4b5566);
      C.scene.fog = new THREE.FogExp2(night ? 0x0b0f18 : 0x4b5566, night ? 0.03 : 0.022);
      const hemi = new THREE.HemisphereLight(night ? 0x2a3550 : 0x8a9ab5, 0x2a2622, night ? 0.25 : 0.9);
      g.add(hemi);
      const dir = new THREE.DirectionalLight(0x9aa8c0, night ? 0.1 : 0.5); dir.position.set(-8, 14, 10); g.add(dir);
    }
    if (!has('outdoor')) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), C.mat('grass'));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.45; ground.receiveShadow = true;
      C.util.worldUV(ground.geometry); g.add(ground);
      C.physics.addFloor(-15, -12, 15, 19, -0.45, { surface: 'grass' });
    }
    if (!has('living')) {
      const fire = new THREE.PointLight(0xff8a3d, 35, 0, 2); fire.position.set(-6.25, 0.55, 2.5);
      fire.castShadow = C.settings.quality === 'high'; fire.shadow.mapSize.set(512, 512); fire.shadow.bias = -0.004; fire.shadow.camera.near = 0.1;
      g.add(fire);
      const l1 = new THREE.PointLight(0xffb46b, 20, 0, 2); l1.position.set(-1.5, 1.5, 3.2); g.add(l1);
    }
    if (!has('kitchen')) { const l = new THREE.PointLight(0xffc27a, 22, 0, 2); l.position.set(-3.4, 2.1, -1.5); g.add(l); }
    if (!has('hallstudy')) {
      const l = new THREE.PointLight(0xffb46b, 12, 0, 2); l.position.set(3.2, 1.8, 2.5); g.add(l);
      const s = new THREE.PointLight(0xffc27a, 12, 0, 2); s.position.set(4.2, 1.5, -3.5); g.add(s);
    }
    if (!has('loft')) {
      const a = new THREE.PointLight(0xffb46b, 12, 0, 2); a.position.set(-4.5, 4.2, 0.5); g.add(a);
      const b = new THREE.PointLight(0xffcf8a, 10, 0, 2); b.position.set(2.5, 5.0, 0); g.add(b);
    }
    if (!has('outdoor')) { const p = new THREE.PointLight(0xffb060, 8, 0, 2); p.position.set(4.6, 2.0, 5.3); g.add(p); }
  },
});

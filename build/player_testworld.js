// Scratch test module (orchestrator): physics-only mock of the SPEC §4 layout, to validate player.js in isolation.
import * as THREE from 'three';
const C = window.COZY;
C.register({
  name: 'player_testworld', order: 19,
  init(C) {
    if (C.modules.some(m => m.name === 'house')) return;
    const P = C.physics;
    const g = new THREE.Group(); g.name = 'testworld'; C.scene.add(g);
    const mat = C.util.stdMat(0x887766), wallM = C.util.stdMat(0xccbbaa);
    C.util.boxAt(g, -7, -0.1, -5, 7, 0, 5, mat);
    C.util.boxAt(g, -15, -0.55, -12, 15, -0.45, 19, C.util.stdMat(0x335533));
    P.addFloor(-7, -5, 7, 5, 0, { surface: 'wood' });
    P.addFloor(-15, -12, 15, 19, -0.45, { surface: 'grass' });
    P.addFloor(-16, 19, 16, 23.5, -0.45, { surface: 'gravel' });
    const wall = (a, b, tag = 'wall') => { P.addBox(a, b, { tag }); C.util.boxAt(g, a[0], Math.max(a[1], -0.45), a[2], b[0], Math.min(b[1], 4), b[2], wallM); };
    // south wall with front door + living window, others solid
    wall([-7, -0.45, 4.75], [3.25, 4.1, 5]); wall([4.25, -0.45, 4.75], [7, 4.1, 5]);
    const door = P.addBox([3.25, -0.45, 4.75], [4.25, 2.15, 5], { tag: 'door' });
    wall([-7, -0.45, -5], [7, 4.1, -4.75]);
    wall([-7, -0.45, -5], [-6.75, 8, 5]); wall([6.75, -0.45, -5], [7, 8, 5]);
    // P1 with D1 (z 1.4..2.6) and D2 (z -3.1..-2.2)
    wall([1.925, 0, -4.75], [2.075, 2.8, -3.1]); wall([1.925, 0, -2.2], [2.075, 2.8, 1.4]); wall([1.925, 0, 2.6], [2.075, 2.8, 4.75]);
    const d2 = P.addBox([1.925, 0, -3.1], [2.075, 2.05, -2.2], { tag: 'door' });
    // P2 with D3 (x 2.6..3.5)
    wall([2.075, 0, -0.775], [2.6, 2.8, -0.625]); wall([3.5, 0, -0.775], [5.52, 2.8, -0.625]);
    P.addBox([3.5, 0, -0.775], [6.75, 2.8, -0.625], { tag: 'wall' });
    P.addBox([2.6, 0, -0.775], [3.5, 2.05, -0.625], { tag: 'door' });
    // stairs + railings + upper floors + eaves
    P.addRamp(5.52, -0.45, 6.75, 3.6, 'z', 3.0, 0.0, { surface: 'stairs' });
    P.addBox([5.42, 0, -0.45], [5.52, 4.05, 3.6], { tag: 'railing' });
    P.addBox([5.52, 3, 2.35], [6.75, 4, 2.45], { tag: 'railing' });
    P.addFloor(-6.75, -4.75, 5.52, 4.75, 3.0, { surface: 'wood' });
    P.addFloor(5.52, -4.75, 6.75, -0.45, 3.0, { surface: 'wood' });
    P.addFloor(5.52, 2.4, 6.75, 4.75, 3.0, { surface: 'wood' });
    P.addBox([-6.75, 3.0, 3.7], [6.75, 7.5, 4.75], { tag: 'eave', blocksInteract: false });
    P.addBox([-6.75, 3.0, -4.75], [6.75, 7.5, -3.7], { tag: 'eave', blocksInteract: false });
    // porch
    P.addFloor(1.2, 5.0, 6.8, 7.2, 0.0, { surface: 'porch' });
    P.addRamp(3.0, 7.2, 4.5, 7.8, 'z', 0.0, -0.45, { surface: 'porch' });
    P.addBox([1.2, -0.45, 7.1], [3.0, 0, 7.2]); P.addBox([4.5, -0.45, 7.1], [6.8, 0, 7.2]);
    // fence + lane bounds (gate closed)
    P.addBox([-15.05, -0.45, -12], [-14.95, 0.6, 19]); P.addBox([14.95, -0.45, -12], [15.05, 0.6, 19]);
    P.addBox([-15, -0.45, 18.95], [3.0, 0.6, 19.05]); P.addBox([4.5, -0.45, 18.95], [15, 0.6, 19.05]);
    const gate = P.addBox([3.0, -0.45, 18.95], [4.5, 0.6, 19.05], { tag: 'door' });
    P.addBox([-16, -0.45, 23.5], [16, 3, 23.7]);
    const mk = (id, h, open) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat); o.position.set(0, -50, 0); g.add(o);
      C.interact.add({ id, object: o, label: id, onUse: open });
    };
    mk('door_front', door, () => { door.enabled = !door.enabled; });
    mk('door_kitchen_study', d2, () => { d2.enabled = !d2.enabled; });
    mk('gate', gate, () => { gate.enabled = !gate.enabled; });
    mk('sofa', null, () => C.player.sitAt({ id: 'sofa', position: [-1.9, 1.05, 2.9], yaw: Math.PI / 2, exit: [-1.2, 0, 2.2] }));
    g.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
  },
});

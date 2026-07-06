import * as THREE from "three";

// Mob NPCs: simple wandering creatures that can be attacked and defeated.
// Deliberately built from the same primitive-shape philosophy as player.js —
// a low-poly "boar" so mobs read as clearly non-player at a glance.

export function createMobMesh() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 0.9 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4f3420, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.3), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), bodyMat);
  head.position.set(0, 0.55, 0.85);
  head.castShadow = true;
  group.add(head);

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), legMat);
  snout.position.set(0, 0.42, 1.15);
  group.add(snout);

  const tuskGeo = new THREE.ConeGeometry(0.05, 0.22, 5);
  const tuskMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8 });
  for (const side of [-1, 1]) {
    const tusk = new THREE.Mesh(tuskGeo, tuskMat);
    tusk.rotation.x = Math.PI / 2.3;
    tusk.position.set(side * 0.16, 0.32, 1.22);
    group.add(tusk);
  }

  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
  const legOffsets = [
    [-0.32, -0.55],
    [0.32, -0.55],
    [-0.32, 0.45],
    [0.32, 0.45],
  ];
  for (const [x, z] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, 0.25, z);
    leg.castShadow = true;
    group.add(leg);
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 5), legMat);
  tail.rotation.x = Math.PI / 2.5;
  tail.position.set(0, 0.6, -0.75);
  group.add(tail);

  group.userData.hitFlash = { active: false, t: 0, materials: [bodyMat] };

  return group;
}

const HIT_FLASH_DURATION = 0.2;

/** Briefly tints a mob red to give hit feedback when it takes damage. */
export function triggerHitFlash(mesh) {
  const state = mesh?.userData?.hitFlash;
  if (!state) return;
  state.active = true;
  state.t = 0;
}

function updateHitFlash(mesh, dt) {
  const state = mesh?.userData?.hitFlash;
  if (!state || !state.active) return;
  state.t += dt;
  const progress = Math.min(state.t / HIT_FLASH_DURATION, 1);
  const flash = 1 - progress;
  for (const mat of state.materials) {
    mat.emissive = mat.emissive || new THREE.Color(0);
    mat.emissive.setRGB(flash * 0.9, 0, 0);
  }
  if (progress >= 1) state.active = false;
}

/** Wraps a mob mesh + interpolation/lifecycle state, mirroring RemotePlayer. */
export class Mob {
  constructor(scene, data) {
    this.id = data.id;
    this.name = data.name;
    this.hp = data.hp;
    this.maxHp = data.maxHp;
    this.alive = data.alive;
    this.mesh = createMobMesh();
    this.mesh.position.set(data.x, data.y, data.z);
    this.mesh.rotation.y = data.rotY || 0;
    this.target = { x: data.x, y: data.y, z: data.z, rotY: data.rotY || 0 };
    scene.add(this.mesh);
  }

  setTarget(x, y, z, rotY) {
    this.target = { x, y, z, rotY };
  }

  applyDamage(hp) {
    this.hp = hp;
    triggerHitFlash(this.mesh);
  }

  update(dt) {
    const lerpAmt = Math.min(1, dt * 6);
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * lerpAmt;
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * lerpAmt;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * lerpAmt;

    let dr = this.target.rotY - this.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    this.mesh.rotation.y += dr * lerpAmt;

    updateHitFlash(this.mesh, dt);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  headWorldPosition(out, extra = 0) {
    out.copy(this.mesh.position);
    out.y += 1.5 + extra;
    return out;
  }
}

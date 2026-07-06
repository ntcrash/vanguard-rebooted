import * as THREE from "three";

// A simple stylized humanoid: capsule body + sphere head + a facing wedge so you
// can tell which way someone is looking. Deliberately low-poly / low-effort —
// this is a prototype, not a character artist's portfolio piece.

// Melee swing timing, shared by every character mesh's attack animation.
const ATTACK_DURATION = 0.35; // seconds, resting -> full swing -> resting
const ARM_REST_ROTATION_X = -0.2;
const ARM_SWING_ROTATION_X = 1.8;

export function createCharacterMesh(color) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.45, 1.0, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf1c27d })
  );
  head.position.y = 1.95;
  head.castShadow = true;
  group.add(head);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.22, 6),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.95, 0.35);
  group.add(nose);

  // Weapon arm: a pivot at the shoulder holding a forearm + a simple blade,
  // rotated forward/back to animate a melee swing (see triggerAttack/updateAttack).
  const armPivot = new THREE.Group();
  armPivot.position.set(0.42, 1.55, 0.05);
  armPivot.rotation.x = ARM_REST_ROTATION_X;

  const forearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.11, 0.45, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf1c27d })
  );
  forearm.position.y = -0.28;
  forearm.castShadow = true;
  armPivot.add(forearm);

  const weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.85, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xcfd4d8, metalness: 0.5, roughness: 0.35 })
  );
  weapon.position.y = -0.75;
  weapon.castShadow = true;
  armPivot.add(weapon);

  group.add(armPivot);

  // Per-mesh attack animation state, driven by triggerAttack()/updateAttack().
  group.userData.armPivot = armPivot;
  group.userData.attack = { active: false, t: 0 };

  return group;
}

/** Starts (or restarts) the melee swing animation on a character mesh. */
export function triggerAttack(mesh) {
  const state = mesh?.userData?.attack;
  if (!state) return;
  state.active = true;
  state.t = 0;
}

/** Advances a character mesh's attack animation. Safe to call every frame. */
export function updateAttack(mesh, dt) {
  const state = mesh?.userData?.attack;
  const armPivot = mesh?.userData?.armPivot;
  if (!state || !armPivot || !state.active) return;

  state.t += dt;
  const progress = Math.min(state.t / ATTACK_DURATION, 1);
  const swing = Math.sin(progress * Math.PI); // 0 -> 1 -> 0, forward slash and back

  armPivot.rotation.x = ARM_REST_ROTATION_X - swing * ARM_SWING_ROTATION_X;

  if (progress >= 1) {
    state.active = false;
    armPivot.rotation.x = ARM_REST_ROTATION_X;
  }
}

/** Wraps a mesh + the metadata needed to smoothly interpolate remote players. */
export class RemotePlayer {
  constructor(scene, data) {
    this.id = data.id;
    this.name = data.name;
    this.mesh = createCharacterMesh(data.color);
    this.mesh.position.set(data.x, data.y, data.z);
    this.mesh.rotation.y = data.rotY;
    this.target = { x: data.x, y: data.y, z: data.z, rotY: data.rotY };
    scene.add(this.mesh);
  }

  setTarget(x, y, z, rotY) {
    this.target = { x, y, z, rotY };
  }

  /** Plays the melee swing animation, triggered by a "playerAttacked" event. */
  triggerAttack() {
    triggerAttack(this.mesh);
  }

  update(dt) {
    const lerpAmt = Math.min(1, dt * 10);
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * lerpAmt;
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * lerpAmt;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * lerpAmt;

    let dr = this.target.rotY - this.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr)); // shortest-path angle interpolation
    this.mesh.rotation.y += dr * lerpAmt;

    updateAttack(this.mesh, dt);
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  headWorldPosition(out) {
    out.copy(this.mesh.position);
    out.y += 2.3;
    return out;
  }
}

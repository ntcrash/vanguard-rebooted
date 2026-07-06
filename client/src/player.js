import * as THREE from "three";

// A simple stylized humanoid: capsule torso + sphere head + a facing wedge so
// you can tell which way someone is looking, plus hinged leg/arm pivots so it
// actually walks and runs instead of sliding around as a static blob.
// Deliberately low-poly / low-effort — this is a prototype, not a character
// artist's portfolio piece.
//
// Equippable gear (see "Equipment appearance" below) is layered on top of this
// base mesh as extra child meshes / material swaps, keyed by slot
// ("weapon" | "head" | "body") so a character visibly changes in the world the
// moment gear is equipped/unequipped — no separate character model per gear
// combo needed.

// Melee swing timing, shared by every character mesh's attack animation.
const ATTACK_DURATION = 0.35; // seconds, resting -> full swing -> resting
const ARM_REST_ROTATION_X = -0.2;
const ARM_SWING_ROTATION_X = 1.8;

// ---- Walk/run locomotion -----------------------------------------------------
// Legs and the non-weapon arm swing in a simple alternating gait, driven purely
// by how fast a character is currently moving (see updateLocomotion below) —
// there's no separate "run" trigger to wire up over the network: a player
// holding Shift (see input.js's keys.sprint) simply moves faster, and every
// client (including remote ones, whose speed is inferred from position deltas
// in RemotePlayer.update) animates the gait faster/wider to match.
const LEG_SWING_MAX = 0.85; // radians, full-stride hip rotation
const ARM_WALK_SWING_MAX = 0.6; // radians, counter-swing on top of ARM_REST_ROTATION_X
const STEP_RATE_MIN = 4; // rad/sec phase advance at a bare-minimum walking pace
const STEP_RATE_MAX = 10; // rad/sec phase advance at/above STRIDE_SPEED_REF
const STRIDE_SPEED_REF = 12; // units/sec at which the gait reaches full frequency/amplitude
const LOCOMOTION_MOVING_EPS = 0.05; // units/sec below which a character is considered stopped
const GAIT_BLEND_RATE = 8; // how quickly amplitude eases in/out of a standing pose

// ---- Equipment appearance ---------------------------------------------------
// Purely cosmetic per-item look-up: what a given equipped item id changes
// about the base mesh. Kept here (client-only) rather than duplicating the
// server's gameplay-facing ITEM_DEFS — the server only needs to know an
// item's slot to validate an equip, not how it's supposed to look.
const WEAPON_APPEARANCE = {
  "steel-sword": { color: 0xe8f4ff, metalness: 0.85, roughness: 0.15, length: 1.15 },
};
const DEFAULT_WEAPON_APPEARANCE = { color: 0xcfd4d8, metalness: 0.5, roughness: 0.35, length: 0.85 };

function weaponAppearanceFor(equipment) {
  return WEAPON_APPEARANCE[equipment?.weapon] || DEFAULT_WEAPON_APPEARANCE;
}

export function createCharacterMesh(color, equipment = {}) {
  const group = new THREE.Group();

  // Torso: shortened/raised from the old single floor-to-head capsule so the
  // new legs below have room to actually be visible and swing.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.75, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 1.15;
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

  // Legs: hinge pivots at the hip, each holding a short capsule "leg" that
  // hangs straight down. Rotating the pivot forward/back is all that's
  // needed for a walk/run gait (see updateLocomotion below) — no separate
  // upper/lower leg joints for a prototype this low-poly.
  const legGeometry = new THREE.CapsuleGeometry(0.15, 0.36, 4, 8);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3742 });
  const legPivots = {};
  for (const side of ["left", "right"]) {
    const pivot = new THREE.Group();
    pivot.position.set(side === "left" ? -0.18 : 0.18, 0.62, 0);
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.y = -0.33;
    leg.castShadow = true;
    pivot.add(leg);
    group.add(pivot);
    legPivots[side] = pivot;
  }

  // Arms: a pivot at each shoulder holding a forearm, rotated forward/back
  // both to animate a melee swing (right/weapon arm — see
  // triggerAttack/updateAttack) and to counter-swing opposite the legs while
  // walking/running (see updateLocomotion). The right arm's blade is
  // (re)built by applyEquipment() below — including on initial creation — so
  // its geometry/material can be swapped live when the equipped weapon
  // changes, without rebuilding the whole arm. The left arm is unarmed and
  // purely cosmetic (gait counter-balance).
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

  group.add(armPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.42, 1.55, 0.05);
  leftArmPivot.rotation.x = ARM_REST_ROTATION_X;

  const leftForearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.11, 0.45, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf1c27d })
  );
  leftForearm.position.y = -0.28;
  leftForearm.castShadow = true;
  leftArmPivot.add(leftForearm);

  group.add(leftArmPivot);

  // Per-mesh attack animation state, driven by triggerAttack()/updateAttack().
  group.userData.armPivot = armPivot;
  group.userData.attack = { active: false, t: 0 };
  group.userData.weapon = null; // set by applyEquipment() below
  group.userData.helmet = null; // head-slot gear mesh, added by applyEquipment()
  group.userData.chestplate = null; // body-slot gear mesh, added by applyEquipment()

  // Per-mesh walk/run animation state, driven by updateLocomotion() below.
  group.userData.legs = legPivots;
  group.userData.arms = { left: leftArmPivot, right: armPivot };
  group.userData.locomotion = { phase: 0, amplitude: 0 };

  applyEquipment(group, equipment);

  return group;
}

/** (Re)builds the visible gear on a character mesh to match `equipment`
 * ({ weapon, head, body } item ids, any of which may be null/undefined).
 * Safe to call repeatedly — e.g. every time a "playerEquipmentChanged" event
 * arrives — since it only disposes/replaces the gear meshes it owns. */
export function applyEquipment(mesh, equipment = {}) {
  if (!mesh?.userData) return;
  mesh.userData.equipment = equipment;
  const armPivot = mesh.userData.armPivot;

  // Weapon: swap geometry/material on the blade rather than the whole arm.
  if (armPivot) {
    if (mesh.userData.weapon) {
      armPivot.remove(mesh.userData.weapon);
      mesh.userData.weapon.geometry.dispose();
      mesh.userData.weapon.material.dispose();
    }
    const appearance = weaponAppearanceFor(equipment);
    const weapon = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, appearance.length, 0.07),
      new THREE.MeshStandardMaterial({
        color: appearance.color,
        metalness: appearance.metalness,
        roughness: appearance.roughness,
      })
    );
    weapon.position.y = -0.32 - appearance.length / 2;
    weapon.castShadow = true;
    armPivot.add(weapon);
    mesh.userData.weapon = weapon;
  }

  // Head gear: a simple metallic dome sitting over the head sphere.
  if (mesh.userData.helmet) {
    mesh.remove(mesh.userData.helmet);
    mesh.userData.helmet.geometry.dispose();
    mesh.userData.helmet.material.dispose();
    mesh.userData.helmet = null;
  }
  if (equipment.head === "iron-helm") {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.37, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.7, roughness: 0.35 })
    );
    helmet.position.y = 1.98;
    helmet.castShadow = true;
    mesh.add(helmet);
    mesh.userData.helmet = helmet;
  }

  // Body armor: an overlay cylinder roughly matching the torso capsule, plus
  // shoulder pads, so it visibly reads as "wearing armor" over the base body.
  if (mesh.userData.chestplate) {
    mesh.remove(mesh.userData.chestplate);
    mesh.userData.chestplate.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    mesh.userData.chestplate = null;
  }
  if (equipment.body === "leather-armor") {
    const chest = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.4, 0.75, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 })
    );
    plate.position.y = 1.15;
    plate.castShadow = true;
    chest.add(plate);

    const shoulderGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const leftShoulder = new THREE.Mesh(
      shoulderGeo,
      new THREE.MeshStandardMaterial({ color: 0x6e451f, roughness: 0.8 })
    );
    leftShoulder.position.set(-0.4, 1.55, 0);
    leftShoulder.castShadow = true;
    chest.add(leftShoulder);
    const rightShoulder = new THREE.Mesh(
      shoulderGeo,
      new THREE.MeshStandardMaterial({ color: 0x6e451f, roughness: 0.8 })
    );
    rightShoulder.position.set(0.4, 1.55, 0);
    rightShoulder.castShadow = true;
    chest.add(rightShoulder);

    mesh.add(chest);
    mesh.userData.chestplate = chest;
  }
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

/** Advances a character mesh's walk/run gait — leg swing + counter-swung
 * off-hand arm — to match `speed` (current horizontal movement, units/sec).
 * Purely visual: both frequency and stride amplitude scale with speed, so a
 * sprinting player (see input.js's keys.sprint) automatically reads as
 * "running" rather than needing a separate animation state to track. Safe to
 * call every frame, including with speed 0 (eases back to a standing pose). */
export function updateLocomotion(mesh, dt, speed) {
  const state = mesh?.userData?.locomotion;
  const legs = mesh?.userData?.legs;
  const arms = mesh?.userData?.arms;
  if (!state || !legs || !arms) return;

  const movingRatio = THREE.MathUtils.clamp(speed / STRIDE_SPEED_REF, 0, 1);
  const moving = speed > LOCOMOTION_MOVING_EPS;

  if (moving) {
    const stepRate = THREE.MathUtils.lerp(STEP_RATE_MIN, STEP_RATE_MAX, movingRatio);
    state.phase += dt * stepRate;
  }

  const targetAmplitude = moving ? THREE.MathUtils.lerp(0.35, 1, movingRatio) : 0;
  state.amplitude += (targetAmplitude - state.amplitude) * Math.min(1, dt * GAIT_BLEND_RATE);

  const legSwing = Math.sin(state.phase) * LEG_SWING_MAX * state.amplitude;
  legs.left.rotation.x = legSwing;
  legs.right.rotation.x = -legSwing;

  // Natural gait: each arm counter-swings opposite its same-side leg (left
  // arm forward with right leg forward, and vice versa).
  const armSwing = Math.sin(state.phase) * ARM_WALK_SWING_MAX * state.amplitude;
  arms.left.rotation.x = ARM_REST_ROTATION_X - armSwing;
  // The right/weapon arm's rotation is owned by updateAttack() while a swing
  // is in progress — don't fight it, the attack animation takes priority and
  // resets to ARM_REST_ROTATION_X on its own when it finishes.
  if (!mesh.userData.attack.active) {
    arms.right.rotation.x = ARM_REST_ROTATION_X + armSwing;
  }
}

/** Wraps a mesh + the metadata needed to smoothly interpolate remote players. */
export class RemotePlayer {
  constructor(scene, data) {
    this.id = data.id;
    this.name = data.name;
    this.hp = data.hp ?? 100;
    this.maxHp = data.maxHp ?? 100;
    this.equipment = data.equipment || {};
    this.mesh = createCharacterMesh(data.color, this.equipment);
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

  /** Re-skins this player's mesh to match a new equipment loadout, triggered
   * by a "playerEquipmentChanged" event. */
  setEquipment(equipment) {
    this.equipment = equipment || {};
    applyEquipment(this.mesh, this.equipment);
  }

  update(dt) {
    const prevX = this.mesh.position.x;
    const prevZ = this.mesh.position.z;

    const lerpAmt = Math.min(1, dt * 10);
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * lerpAmt;
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * lerpAmt;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * lerpAmt;

    let dr = this.target.rotY - this.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr)); // shortest-path angle interpolation
    this.mesh.rotation.y += dr * lerpAmt;

    // There's no explicit "moving"/"sprinting" flag over the network — the
    // walk/run gait is driven entirely by how fast this remote player's mesh
    // is actually (smoothed-)moving right now, inferred from the position
    // delta this frame produced above.
    const speed = dt > 0 ? Math.hypot(this.mesh.position.x - prevX, this.mesh.position.z - prevZ) / dt : 0;
    updateLocomotion(this.mesh, dt, speed);

    updateAttack(this.mesh, dt);
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
    out.y += 2.3 + extra;
    return out;
  }
}

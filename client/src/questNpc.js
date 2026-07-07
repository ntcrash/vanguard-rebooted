import * as THREE from "three";

// Quest NPC: a stationary "Elder Maren" (server/questNpc.js) players can
// walk up to and open the quest board against (see main.js's
// updateQuestNpcToggle/quest-board panel, server/questNpc.js's
// QUEST_NPC_INTERACT_RANGE). Deliberately built from the same
// cheap-primitives philosophy as storeNpc.js/mob.js/player.js -- a robed
// elder plus a standing wooden signboard beside them, in a cooler
// blue/green "sage" palette distinct from both the merchant's warm gold/
// brown and the player/mob palettes, so it reads as a second, different
// NPC to talk to at a glance. Never moves (no setTarget/lerp like
// Mob/RemotePlayer have) since the server's QUEST_NPC_POSITION is fixed --
// only a slow idle bob, same treatment as StoreNpc.

const ELDER_COLORS = { robe: 0x3a5a52, trim: 0xd9c98a, skin: 0xc99a72, board: 0x5a4632, parchment: 0xe8dcb8 };

export function createQuestNpcMesh() {
  const group = new THREE.Group();

  const robeMat = new THREE.MeshStandardMaterial({ color: ELDER_COLORS.robe, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: ELDER_COLORS.trim, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: ELDER_COLORS.skin, roughness: 0.7 });
  const boardMat = new THREE.MeshStandardMaterial({ color: ELDER_COLORS.board, roughness: 0.9 });
  const parchmentMat = new THREE.MeshStandardMaterial({ color: ELDER_COLORS.parchment, roughness: 0.8 });

  // Body: a tapered cone stands in for a long elder's robe, same trick as
  // the merchant's cone body -- cheaper and more visually distinct from the
  // boxy player/mob silhouettes than a capsule would be.
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.5, 8), robeMat);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.055, 6, 12), trimMat);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = 1.15;
  group.add(sash);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skinMat);
  head.position.y = 1.83;
  head.castShadow = true;
  group.add(head);

  // A pointed sage hood instead of the merchant's wide-brim hat -- same two-
  // piece "brim + cone" silhouette trick, just narrower and taller so it
  // reads differently from a distance.
  const hoodBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 12), trimMat);
  hoodBrim.position.y = 2.0;
  group.add(hoodBrim);
  const hoodTop = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.46, 10), robeMat);
  hoodTop.position.y = 2.24;
  group.add(hoodTop);

  // A gnarled walking staff, held upright beside the body -- gives the
  // silhouette a vertical accent distinct from the merchant's cart, without
  // needing a held-item attachment system.
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 6), boardMat);
  staff.position.set(0.5, 0.95, 0);
  staff.rotation.z = -0.06;
  group.add(staff);
  const staffCap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), trimMat);
  staffCap.position.set(0.56, 1.88, 0);
  group.add(staffCap);

  // Quest board beside the elder: a wooden signboard on a post with a
  // parchment panel, reading as "this NPC hands out quests" without needing
  // an actual readable-text texture.
  const boardPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6), boardMat);
  boardPost.position.set(-0.85, 0.55, 0);
  group.add(boardPost);
  const boardPanel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 0.06), boardMat);
  boardPanel.position.set(-0.85, 1.15, 0);
  boardPanel.castShadow = true;
  group.add(boardPanel);
  const parchment = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.65), parchmentMat);
  parchment.position.set(-0.85, 1.15, 0.04);
  group.add(parchment);

  group.userData.bob = { t: Math.random() * Math.PI * 2 };
  group.userData.bobAnchor = body;
  group.userData.baseBodyY = body.position.y;
  group.userData.baseHeadY = head.position.y;
  group.userData.head = head;

  return group;
}

/** Wraps the elder mesh + a subtle idle bob (no movement/AI, unlike
 * Mob/RemotePlayer -- server/questNpc.js's QUEST_NPC_POSITION never
 * changes), mirroring StoreNpc's update()/dispose()/headWorldPosition()
 * shape exactly so it can share main.js's generic `npcs` map without any
 * special-casing. */
export class QuestNpc {
  constructor(scene, position, name) {
    this.name = name;
    this.mesh = createQuestNpcMesh();
    this.mesh.position.set(position.x, 0, position.z);
    scene.add(this.mesh);
  }

  update(dt) {
    const bob = this.mesh.userData.bob;
    bob.t += dt;
    const offset = Math.sin(bob.t * 1.5) * 0.04;
    this.mesh.userData.bobAnchor.position.y = this.mesh.userData.baseBodyY + offset;
    this.mesh.userData.head.position.y = this.mesh.userData.baseHeadY + offset;
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

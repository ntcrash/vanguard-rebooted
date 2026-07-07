import * as THREE from "three";

// Store NPC: a stationary "Wandering Merchant" players can walk up to and
// open a buy panel against (see main.js's updateStoreToggle/store panel,
// server/store.js's STORE_INTERACT_RANGE). Deliberately built from the same
// cheap-primitives philosophy as mob.js/player.js -- a robed figure plus a
// small goods cart beside them, distinct in color (warm gold/brown) from
// both the player palette and the mob palette so it reads as "NPC to talk
// to", not "thing to fight", at a glance. Never moves (no setTarget/lerp
// like Mob/RemotePlayer have) since the server's STORE_NPC_POSITION is fixed
// -- only a slow idle bob to avoid looking like a static prop.

const MERCHANT_COLORS = { robe: 0x8a5a2b, trim: 0xd9b35c, skin: 0xe0b48c, cart: 0x6b4a30 };

export function createStoreNpcMesh() {
  const group = new THREE.Group();

  const robeMat = new THREE.MeshStandardMaterial({ color: MERCHANT_COLORS.robe, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: MERCHANT_COLORS.trim, roughness: 0.6 });
  const skinMat = new THREE.MeshStandardMaterial({ color: MERCHANT_COLORS.skin, roughness: 0.7 });
  const cartMat = new THREE.MeshStandardMaterial({ color: MERCHANT_COLORS.cart, roughness: 0.9 });

  // Body: a tapered cone stands in for a long merchant's robe -- cheaper and
  // more visually distinct from the boxy player/mob silhouettes than a
  // capsule would be.
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 8), robeMat);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const trimRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 12), trimMat);
  trimRing.rotation.x = Math.PI / 2;
  trimRing.position.y = 0.3;
  group.add(trimRing);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), skinMat);
  head.position.y = 1.85;
  head.castShadow = true;
  group.add(head);

  // Wide-brim hat: a flat disc plus a short cone, the classic "traveling
  // merchant" silhouette read from a distance.
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12), trimMat);
  hatBrim.position.y = 2.06;
  group.add(hatBrim);
  const hatTop = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 10), robeMat);
  hatTop.position.y = 2.25;
  group.add(hatTop);

  // Goods cart beside the merchant: a simple crate + two wheels, just enough
  // to read as "this NPC sells things" without a shopfront model.
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), cartMat);
  crate.position.set(0.85, 0.4, 0);
  crate.castShadow = true;
  group.add(crate);

  const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 10);
  for (const z of [-0.28, 0.28]) {
    const wheel = new THREE.Mesh(wheelGeo, trimMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0.85, 0.18, z);
    group.add(wheel);
  }

  group.userData.bob = { t: Math.random() * Math.PI * 2 };
  group.userData.bobAnchor = body;
  group.userData.baseBodyY = body.position.y;
  group.userData.baseHeadY = head.position.y;
  group.userData.head = head;

  return group;
}

/** Wraps the merchant mesh + a subtle idle bob (no movement/AI, unlike
 * Mob/RemotePlayer -- server/store.js's STORE_NPC_POSITION never changes),
 * mirroring Pickup's minimal update()/dispose() shape. */
export class StoreNpc {
  constructor(scene, position, name) {
    this.name = name;
    this.mesh = createStoreNpcMesh();
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

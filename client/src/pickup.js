import * as THREE from "three";

// World item pickups: simple rotating/bobbing gems, color-coded per item
// type. Looted automatically when a player walks within range (see the
// server's checkPickupCollection) — no separate interact key is needed.

const PICKUP_COLORS = {
  "health-draught": 0xff4d4d,
  "gold-coin": 0xffd23f,
};
const DEFAULT_COLOR = 0xbfd8ff;

export function createPickupMesh(itemId) {
  const color = PICKUP_COLORS[itemId] ?? DEFAULT_COLOR;
  const group = new THREE.Group();

  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.35, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.3 })
  );
  gem.position.y = 0.9;
  gem.castShadow = true;
  group.add(gem);

  const glow = new THREE.PointLight(color, 0.6, 4);
  glow.position.y = 0.9;
  group.add(glow);

  group.userData.spin = { t: Math.random() * Math.PI * 2 };
  group.userData.gem = gem;

  return group;
}

/** Wraps a pickup mesh + idle bob/spin animation, mirroring Mob's shape. */
export class Pickup {
  constructor(scene, data) {
    this.id = data.id;
    this.itemId = data.itemId;
    this.name = data.name;
    this.icon = data.icon;
    this.qty = data.qty;
    this.mesh = createPickupMesh(data.itemId);
    this.mesh.position.set(data.x, data.y, data.z);
    scene.add(this.mesh);
  }

  update(dt) {
    const spin = this.mesh.userData.spin;
    spin.t += dt;
    const gem = this.mesh.userData.gem;
    gem.rotation.y = spin.t * 1.2;
    gem.position.y = 0.9 + Math.sin(spin.t * 2.4) * 0.12;
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
    out.y += 1.6 + extra;
    return out;
  }
}

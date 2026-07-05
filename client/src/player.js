import * as THREE from "three";

// A simple stylized humanoid: capsule body + sphere head + a facing wedge so you
// can tell which way someone is looking. Deliberately low-poly / low-effort —
// this is a prototype, not a character artist's portfolio piece.

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

  return group;
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

  update(dt) {
    const lerpAmt = Math.min(1, dt * 10);
    this.mesh.position.x += (this.target.x - this.mesh.position.x) * lerpAmt;
    this.mesh.position.y += (this.target.y - this.mesh.position.y) * lerpAmt;
    this.mesh.position.z += (this.target.z - this.mesh.position.z) * lerpAmt;

    let dr = this.target.rotY - this.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr)); // shortest-path angle interpolation
    this.mesh.rotation.y += dr * lerpAmt;
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

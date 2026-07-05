import * as THREE from "three";

// Builds the static parts of the world: sky, ground, lighting, and a scattering
// of simple props (rocks/trees) so it doesn't feel like an empty grey box.

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x8fd0ff);
  scene.fog = new THREE.Fog(0x8fd0ff, 60, 220);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a5c3a, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
  sun.position.set(60, 90, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.camera.far = 300;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0x4a8a3d, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(400, 80, 0x225522, 0x2f6b2f);
  grid.material.opacity = 0.15;
  grid.material.transparent = true;
  scene.add(grid);

  scatterProps(scene);

  return { ground };
}

function scatterProps(scene) {
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 });

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  const leavesGeo = new THREE.ConeGeometry(1.6, 3, 8);
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3a });

  const rng = mulberry32(1337); // deterministic layout so the world looks the same every load

  for (let i = 0; i < 40; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 15 + rng() * 150;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (rng() > 0.45) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.y = 2.8;
      leaves.castShadow = true;
      tree.add(trunk, leaves);
      tree.position.set(x, 0, z);
      tree.scale.setScalar(0.8 + rng() * 0.7);
      scene.add(tree);
    } else {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(x, 0.5, z);
      rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      rock.scale.setScalar(0.5 + rng() * 1.3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      scene.add(rock);
    }
  }
}

// Small seeded PRNG so decorative prop placement is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

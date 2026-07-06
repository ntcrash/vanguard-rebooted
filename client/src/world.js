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
  scatterForest(scene);
  buildForestGateway(scene);

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

// The "Whispering Forest" — a second outdoor area north of the meadow
// (z > 90ish), reached on foot rather than via a teleport/instance. A denser
// cluster of taller, darker pines plus a tinted ground patch make it read as
// a distinct zone even though it's part of the same continuous plane as the
// meadow (see FOREST_ZONE_Z in client/src/main.js and server/index.js).
function scatterForest(scene) {
  // A translucent dark-green overlay over the forest footprint, sitting just
  // above the base ground so it reads as shadowed woodland floor without
  // needing a second physical ground mesh or per-zone fog changes.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 100),
    new THREE.MeshStandardMaterial({ color: 0x1c3a22, roughness: 1, transparent: true, opacity: 0.55 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.02, 130);
  floor.receiveShadow = true;
  scene.add(floor);

  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 3.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3c2a1a });
  const leavesGeo = new THREE.ConeGeometry(1.4, 4.6, 8);
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x18401f });

  const rng = mulberry32(9001); // different seed than the meadow's props, but still deterministic

  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * 180;
    const z = 95 + rng() * 75;

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.6;
    trunk.castShadow = true;
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.y = 4.3;
    leaves.castShadow = true;
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    tree.scale.setScalar(0.8 + rng() * 0.6);
    scene.add(tree);
  }
}

// A pair of simple stone pillars flanking the meadow/forest boundary so
// players can see where one zone ends and the other begins.
function buildForestGateway(scene) {
  const postGeo = new THREE.CylinderGeometry(0.7, 0.85, 4.5, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.85 });

  for (const x of [-9, 9]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 2.25, 90);
    post.castShadow = true;
    post.receiveShadow = true;
    scene.add(post);
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

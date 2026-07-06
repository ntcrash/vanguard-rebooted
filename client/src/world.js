import * as THREE from "three";

// Builds the static parts of the world: sky, ground, lighting, and a scattering
// of simple props (rocks/trees) so it doesn't feel like an empty grey box.

export function buildWorld(scene) {
  // scene.background is no longer a flat color — buildSky() below adds a
  // gradient-dome mesh that reads as sky instead. Fog color is kept matched
  // to the sky's horizon color (not its zenith) so distant fog blends into
  // the dome rather than showing a visible seam where the dome's lower edge
  // meets the fogged-out ground.
  scene.fog = new THREE.Fog(0xdff6ff, 60, 220);

  buildSky(scene);

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
  scatterGrass(scene);
  const torches = buildForestGateway(scene);

  return { ground, torches };
}

// A large inward-facing sphere with a vertical gradient shader standing in
// for a real sky. Cheaper and seamless-at-the-horizon compared to a
// canvas-texture skybox, and (unlike scene.background = Color) it lets the
// zenith and horizon be different colors, which is what actually makes an
// outdoor scene read as "sky" instead of "flat colored void." BackSide so
// the camera (always inside the sphere) sees its inner surface; renders
// first with no depth-buffer contribution so it never occludes real geometry
// or costs meaningful fill-rate.
function buildSky(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x3f8cd8) },
    bottomColor: { value: new THREE.Color(0xdff6ff) },
    offset: { value: 20 },
    exponent: { value: 0.7 },
  };
  const skyGeo = new THREE.SphereGeometry(450, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

// Pure function behind buildSky()'s fragment shader, re-implemented in JS so
// it can be unit-tested without a GL context. Mirrors the GLSL exactly:
// h = normalize(worldPos + vec3(0, offset, 0)).y, factor = pow(max(h, 0), exponent).
// Takes the raw world-space (x, y, z) of a point on the sky dome (same as
// vWorldPosition in the shader) rather than a pre-computed height, so a test
// can hand it real sphere-surface coordinates. Kept in exact sync with the
// GLSL above — if one changes, change the other.
export function skyGradientMixFactor(x, y, z, offset, exponent) {
  const oy = y + offset;
  const len = Math.hypot(x, oy, z);
  const h = len === 0 ? 0 : oy / len;
  return Math.max(Math.pow(Math.max(h, 0), exponent), 0);
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
// players can see where one zone ends and the other begins. Each pillar now
// also carries a brazier bowl + a warm flickering PointLight, both to make
// the boundary read better at dusk/in the forest's darker fog and as a
// visible "this spot got graphics love" landmark. Returns the two torch
// records ({ light, seed }) so main.js's render loop can animate their
// flicker via torchFlicker() below — updating light.intensity is the only
// per-frame cost, no new geometry/material work happens after setup.
function buildForestGateway(scene) {
  const postGeo = new THREE.CylinderGeometry(0.7, 0.85, 4.5, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.85 });
  const bowlGeo = new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.4 });

  const torches = [];
  for (const x of [-9, 9]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 2.25, 90);
    post.castShadow = true;
    post.receiveShadow = true;
    scene.add(post);

    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.set(x, 4.55, 90);
    bowl.rotation.x = Math.PI; // flip the hemisphere so it cups upward like a brazier bowl
    scene.add(bowl);

    // distance=14/decay=2: falls off well before reaching the meadow ground
    // grid or the next torch, so the two don't visibly double-light the gap
    // between pillars. castShadow stays off — two extra shadow-casting
    // lights at this scale cost real frame time for a boundary prop that's
    // rarely the visual focus.
    const light = new THREE.PointLight(0xff8a3d, 1.6, 14, 2);
    light.position.set(x, 4.9, 90);
    scene.add(light);

    torches.push({ light, seed: x < 0 ? 11.3 : 47.9 });
  }
  return torches;
}

// Deterministic per-torch flicker used by main.js's render loop. Combines
// two sine waves at different frequencies (plus a per-torch `seed` phase
// offset so the two gateway torches don't pulse in lockstep) instead of
// Math.random(), so it's a pure function of elapsed time — same `time`
// always produces the same intensity, which makes it unit-testable and
// keeps flicker speed independent of frame rate. Clamped at the low end so a
// torch never reads as fully extinguished.
export function torchFlicker(time, seed, baseIntensity = 1.6) {
  const t = time + seed;
  const wobble = Math.sin(t * 9.1) * 0.35 + Math.sin(t * 17.3 + 1.7) * 0.18;
  return Math.max(0.4, baseIntensity + wobble);
}

// Sparse tufts of grass across the meadow (the forest already reads as
// distinct via its own dark floor overlay in scatterForest(), so grass is
// meadow-only) using InstancedMesh — hundreds of small blade-cones as one
// draw call instead of one Mesh each, enough ground detail to break up the
// flat plane without a real grass texture/blade-shader system.
function scatterGrass(scene) {
  const count = 600;
  const bladeGeo = new THREE.ConeGeometry(0.06, 0.5, 3);
  bladeGeo.translate(0, 0.25, 0); // pivot at the base so instances plant into the ground, not float at their center
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a34, roughness: 1 });
  const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, count);
  grass.receiveShadow = true; // no castShadow: shadows from hundreds of blade instances aren't worth the cost at this scale

  const positions = generateGrassPositions(count, 4242);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const { x, z, scale, rotY } = positions[i];
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  scene.add(grass);
  return grass;
}

// Pure placement generator behind scatterGrass(), split out so it's
// unit-testable without touching THREE/InstancedMesh at all: deterministic
// (mulberry32-seeded) meadow-only tuft positions, clamped short of the
// z=90 forest boundary/gateway so blades don't poke up through the forest's
// darker floor overlay or overlap the torch pillars.
const MEADOW_GRASS_Z_LIMIT = 85;
export function generateGrassPositions(count, seed) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 80;
    const x = Math.cos(angle) * radius;
    const z = Math.min(Math.sin(angle) * radius, MEADOW_GRASS_Z_LIMIT);
    out.push({ x, z, scale: 0.7 + rng() * 0.8, rotY: rng() * Math.PI * 2 });
  }
  return out;
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

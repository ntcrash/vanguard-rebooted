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

  const sky = buildSky(scene);

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

  const rain = buildRain(scene);

  const groundGeo = new THREE.PlaneGeometry(400, 400, 64, 64);
  applyGroundVertexColors(groundGeo);
  const ground = new THREE.Mesh(
    groundGeo,
    // vertexColors reads the per-vertex patchwork applyGroundVertexColors()
    // just baked in, instead of one flat solid color — the base color arg is
    // dropped since vertexColors modulates from white, not from a tint.
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
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
  const pond = buildPond(scene);
  const fireflies = buildFireflies(scene);

  return { ground, torches, sky, sun, hemi, rain, pond, fireflies };
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

// ---- Day/night cycle --------------------------------------------------------------
//
// A full day/night loop is driven purely by clock.elapsedTime (see
// updateDayNight() below, called every frame from main.js's animate()) — no
// server time sync needed since it's a cosmetic client-side cycle, same
// philosophy as the meadow/forest prop placement being deterministic rather
// than server-authoritative. Five keyframes (midnight/dawn/noon/dusk/midnight)
// are linearly interpolated between; the math is split into pure functions
// (dayNightPhase, dayNightState) that take/return plain numbers so they're
// unit-testable without a GL context or even `three` loaded, mirroring the
// skyGradientMixFactor/torchFlicker pattern above.

export const DAY_CYCLE_SECONDS = 300; // one full day/night loop = 5 real-time minutes

// t: position in the loop (0 = midnight, 1 = midnight again). Colors are
// 0xRRGGBB hex ints for readability; sunIntensity/hemiIntensity mirror the
// original static values buildWorld() used at noon (1.4 / 1.1) so noon looks
// identical to the pre-day/night-cycle scene. nightFactor is a convenience
// 0..1 value (0 = full day, 1 = full night) other systems (e.g. torches) can
// use without re-deriving it from hemiIntensity.
const DAY_NIGHT_KEYFRAMES = [
  { t: 0.0, top: 0x03050f, bottom: 0x0a1020, sun: 0x1a2740, sunIntensity: 0.05, hemiIntensity: 0.18, nightFactor: 1.0 },
  { t: 0.25, top: 0x6a86c9, bottom: 0xffb37a, sun: 0xffb37a, sunIntensity: 0.75, hemiIntensity: 0.55, nightFactor: 0.35 },
  { t: 0.5, top: 0x3f8cd8, bottom: 0xdff6ff, sun: 0xfff2d6, sunIntensity: 1.4, hemiIntensity: 1.1, nightFactor: 0.0 },
  { t: 0.75, top: 0x6a4a86, bottom: 0xff8a5c, sun: 0xff8a5c, sunIntensity: 0.75, hemiIntensity: 0.55, nightFactor: 0.35 },
  { t: 1.0, top: 0x03050f, bottom: 0x0a1020, sun: 0x1a2740, sunIntensity: 0.05, hemiIntensity: 0.18, nightFactor: 1.0 },
];

function hexToRgb01(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb01(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Maps elapsed seconds onto [0, 1) representing where in the day/night loop
// we currently are. Pure modulo — always returns a non-negative value even
// if `elapsed` were ever negative, since JS's `%` can return negatives.
export function dayNightPhase(elapsed, cycleSeconds = DAY_CYCLE_SECONDS) {
  const m = elapsed % cycleSeconds;
  return (m < 0 ? m + cycleSeconds : m) / cycleSeconds;
}

// Interpolates DAY_NIGHT_KEYFRAMES at a given phase (0..1), returning plain
// arrays/numbers ([r,g,b] in 0..1, plus the two light intensities and
// nightFactor) rather than THREE.Color objects, so this stays testable
// without `three` loaded. applyDayNightState() below is the thin THREE-aware
// wrapper that actually pushes these into scene objects.
export function dayNightState(phase) {
  const p = Math.min(Math.max(phase, 0), 1);
  let i = 0;
  while (i < DAY_NIGHT_KEYFRAMES.length - 2 && DAY_NIGHT_KEYFRAMES[i + 1].t <= p) i++;
  const a = DAY_NIGHT_KEYFRAMES[i];
  const b = DAY_NIGHT_KEYFRAMES[i + 1];
  const span = b.t - a.t;
  const localT = span === 0 ? 0 : (p - a.t) / span;

  return {
    topColor: lerpRgb01(hexToRgb01(a.top), hexToRgb01(b.top), localT),
    bottomColor: lerpRgb01(hexToRgb01(a.bottom), hexToRgb01(b.bottom), localT),
    sunColor: lerpRgb01(hexToRgb01(a.sun), hexToRgb01(b.sun), localT),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, localT),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, localT),
    nightFactor: lerp(a.nightFactor, b.nightFactor, localT),
  };
}

// Plain-English label for the HUD time-of-day indicator, derived from the
// same phase value dayNightState() uses — kept as its own pure function
// (rather than inlined string logic in main.js) so the phase->label bucketing
// is unit-testable on its own.
export function dayPeriodLabel(phase) {
  const p = Math.min(Math.max(phase, 0), 1);
  if (p < 0.15 || p >= 0.85) return "Night";
  if (p < 0.35) return "Dawn";
  if (p < 0.65) return "Day";
  return "Dusk";
}

// THREE-aware wrapper, called every frame from main.js. Pushes a
// dayNightState() result into the sky dome's shader uniforms, the sun/hemi
// lights, and the scene fog (kept matched to the horizon/bottom color, same
// convention buildSky()'s doc comment already established for the static
// case). Returns the state in case a caller (main.js, for torch brightness)
// wants nightFactor without recomputing it.
export function updateDayNight(scene, sky, sun, hemi, elapsedSeconds, cycleSeconds = DAY_CYCLE_SECONDS) {
  const state = dayNightState(dayNightPhase(elapsedSeconds, cycleSeconds));

  sky.material.uniforms.topColor.value.setRGB(...state.topColor);
  sky.material.uniforms.bottomColor.value.setRGB(...state.bottomColor);

  sun.color.setRGB(...state.sunColor);
  sun.intensity = state.sunIntensity;
  hemi.intensity = state.hemiIntensity;

  if (scene.fog) scene.fog.color.setRGB(...state.bottomColor);

  return state;
}

// ---- Weather (rain) ---------------------------------------------------------------
//
// A simple deterministic rain cycle, same "pure function of elapsed time"
// approach as the day/night cycle and torchFlicker: isRaining()/
// advanceRainDrop() take/return plain numbers so the on/off timing and fall
// motion are unit-testable without a GL context.

export const WEATHER_CYCLE_SECONDS = 600; // repeats every 10 real-time minutes
export const RAIN_DURATION_SECONDS = 90; // rains for the first 90s of each cycle

const RAIN_COUNT = 700;
const RAIN_AREA = 55; // half-width (x/z) of the box of raindrops around the follow target
const RAIN_HEIGHT = 40; // drops fall from y=RAIN_HEIGHT down to y=0, then wrap back to the top
const RAIN_FALL_SPEED = 24; // units/sec

// True if it should be raining at `elapsed` seconds — rains for the first
// RAIN_DURATION_SECONDS of every WEATHER_CYCLE_SECONDS-long cycle, clear the
// rest of the time. Same non-negative-modulo handling as dayNightPhase().
export function isRaining(elapsed, cycleSeconds = WEATHER_CYCLE_SECONDS, rainDuration = RAIN_DURATION_SECONDS) {
  const m = elapsed % cycleSeconds;
  return (m < 0 ? m + cycleSeconds : m) < rainDuration;
}

// Moves one raindrop's y position down by fallSpeed*dt, wrapping back up to
// `height` once it passes 0 — an endless falling-rain loop with no per-frame
// randomness needed (the initial scatter in buildRain() is randomized once at
// setup so drops don't all wrap in lockstep).
export function advanceRainDrop(y, dt, fallSpeed = RAIN_FALL_SPEED, height = RAIN_HEIGHT) {
  const next = y - fallSpeed * dt;
  return next < 0 ? next + height : next;
}

// Builds the rain particle system (a THREE.Points cloud) and adds it to the
// scene, hidden by default — main.js's animate() loop toggles `.visible` via
// isRaining() and repositions it to follow the local player (see updateRain()
// below) so the drop volume always surrounds wherever the player currently is
// rather than covering the whole (much larger) world at once.
function buildRain(scene) {
  const positions = new Float32Array(RAIN_COUNT * 3);
  for (let i = 0; i < RAIN_COUNT; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * RAIN_AREA;
    positions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_AREA;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xaac9ff,
    size: 0.14,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    fog: false,
  });

  const rain = new THREE.Points(geometry, material);
  rain.visible = false;
  rain.frustumCulled = false; // it follows the camera/player every frame, so bounding-box culling would just cause flicker
  scene.add(rain);
  return rain;
}

// Called every frame from main.js. Toggles visibility via isRaining(), and
// while visible, advances every drop's y via advanceRainDrop() and
// recenters the whole cloud on `followX`/`followZ` (typically the local
// player's position) so rain is always falling around wherever the player
// currently stands.
export function updateRain(rain, dt, elapsedSeconds, followX = 0, followZ = 0) {
  const raining = isRaining(elapsedSeconds);
  rain.visible = raining;
  rain.position.x = followX;
  rain.position.z = followZ;
  if (!raining) return;

  const positions = rain.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    positions.setY(i, advanceRainDrop(y, dt));
  }
  positions.needsUpdate = true;
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

// ---- Ground patchwork -------------------------------------------------------------
//
// The meadow ground used to be one flat MeshStandardMaterial color, which
// reads as a plain colored void up close despite the grid overlay. Rather
// than a texture/image (none is bundled with this project, and adding a new
// binary asset is more machinery than this needs), the ground plane's own
// PlaneGeometry(400, 400, 64, 64) already has plenty of vertices, so a
// per-vertex color bake gives it broad, gentle color drift for free. A hash
// of (x, z) — not Math.random() — keeps it deterministic across reloads,
// same "pure function of position/time" testing philosophy as
// skyGradientMixFactor/torchFlicker/generateGrassPositions above.

// Classic GLSL-style hash-to-[0,1) noise, reimplemented in plain JS. Coarse
// on purpose (see groundPatchColor's /6 downsample) so it reads as broad
// patches of color, not per-vertex speckle.
export function groundNoise(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const GROUND_DARK = [0x39 / 255, 0x70 / 255, 0x2f / 255];
const GROUND_LIGHT = [0x5c / 255, 0x9e / 255, 0x46 / 255];

// Blends between a darker and a lighter grass-green based on groundNoise(),
// sampled on a coarse (divide-by-6) grid so neighboring vertices drift
// smoothly rather than flickering vertex-to-vertex. Returns a plain [r,g,b]
// in 0..1 (not a THREE.Color) so this stays testable without `three` loaded.
export function groundPatchColor(x, z) {
  const n = groundNoise(Math.floor(x / 6), Math.floor(z / 6));
  return [
    lerp(GROUND_DARK[0], GROUND_LIGHT[0], n),
    lerp(GROUND_DARK[1], GROUND_LIGHT[1], n),
    lerp(GROUND_DARK[2], GROUND_LIGHT[2], n),
  ];
}

// THREE-aware wrapper: bakes a `color` vertex attribute onto the ground's
// PlaneGeometry from groundPatchColor(), read by the ground's
// `vertexColors: true` material. PlaneGeometry is authored in its own local
// XY plane before buildWorld() rotates the mesh flat, so local (x, y) here
// is what ends up as world (x, z) — only relative spacing matters for a
// cosmetic patchwork like this, so that rotation isn't compensated for.
function applyGroundVertexColors(geometry) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = groundPatchColor(pos.getX(i), pos.getY(i));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// ---- Pond ---------------------------------------------------------------------
//
// A still-water pond feature in the meadow, placed clear of every existing
// NPC/pickup/mob spawn point (checked against server/index.js's PICKUP_SPAWNS/
// MOB_SPAWNS and server/store.js/questNpc.js's NPC positions — nearest
// neighbor is the (40, 40) gold-coin pickup, well outside POND_RADIUS +
// a comfortable buffer) and short of the z=90 forest boundary so it reads as
// a meadow landmark, not a forest one.
export const POND_POSITION = { x: 65, z: 60 };
export const POND_RADIUS = 14;

// Surface displacement for the pond's water plane, driven purely by
// (x, z, time) so the vertex shader (GLSL, can't be unit-tested without a GL
// context) and this JS function stay in exact sync — same pattern as
// skyGradientMixFactor mirroring buildSky()'s fragment shader. Two sine
// waves at different spatial frequencies/phases/speeds combine into a
// gentle, non-repeating ripple rather than one obviously-radial pulse.
export function pondWaveHeight(x, z, time) {
  const a = Math.sin(x * 0.35 + time * 1.6) * 0.06;
  const b = Math.sin(z * 0.45 - time * 1.1 + x * 0.15) * 0.05;
  return a + b;
}

function buildPond(scene) {
  const size = POND_RADIUS * 2.4;
  const segs = 40;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      radius: { value: POND_RADIUS },
      deepColor: { value: new THREE.Color(0x0f4a5c) },
      shallowColor: { value: new THREE.Color(0x3fa4c9) },
    },
    vertexShader: `
      uniform float time;
      varying vec2 vXz;
      varying float vHeight;
      void main() {
        vXz = position.xy;
        float h = sin(position.x * 0.35 + time * 1.6) * 0.06
                + sin(position.y * 0.45 - time * 1.1 + position.x * 0.15) * 0.05;
        vHeight = h;
        vec3 displaced = position + vec3(0.0, 0.0, h);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform float radius;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      varying vec2 vXz;
      varying float vHeight;
      void main() {
        float dist = length(vXz);
        if (dist > radius) discard;
        float edge = smoothstep(radius - 1.5, radius, dist);
        vec3 base = mix(deepColor, shallowColor, clamp(vHeight * 4.0 + 0.5, 0.0, 1.0));
        vec3 color = mix(base, vec3(1.0), edge * 0.5); // pale foam near the rim
        gl_FragColor = vec4(color, 0.92);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND_POSITION.x, 0.05, POND_POSITION.z);
  scene.add(water);

  buildPondRim(scene);

  return { water };
}

// A ring of rocks plus a few reed clusters right at the pond's edge so the
// circular water cutout (the fragment shader's `discard` above) reads as a
// deliberate pond rather than a floating disc of water. Deterministic
// placement, same mulberry32-seeded approach as scatterProps/scatterGrass.
function buildPondRim(scene) {
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x767a72, roughness: 0.95 });
  const reedGeo = new THREE.ConeGeometry(0.05, 1.4, 5);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x4a6b2f });

  const rng = mulberry32(5566);
  const rockCount = 14;
  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + rng() * 0.3;
    const r = POND_RADIUS + 0.3 + rng() * 0.8;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(POND_POSITION.x + Math.cos(angle) * r, 0.35, POND_POSITION.z + Math.sin(angle) * r);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rock.scale.setScalar(0.6 + rng() * 0.7);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  const reedClusters = 10;
  for (let i = 0; i < reedClusters; i++) {
    const angle = rng() * Math.PI * 2;
    const r = POND_RADIUS - 0.5 + rng() * 1.5;
    for (let j = 0; j < 3; j++) {
      const reed = new THREE.Mesh(reedGeo, reedMat);
      reed.position.set(
        POND_POSITION.x + Math.cos(angle) * r + (rng() - 0.5) * 0.6,
        0.7,
        POND_POSITION.z + Math.sin(angle) * r + (rng() - 0.5) * 0.6
      );
      reed.scale.y = 0.8 + rng() * 0.6;
      scene.add(reed);
    }
  }
}

// Called every frame from main.js to advance the pond's shimmer; the actual
// wave math lives in pondWaveHeight() above (mirrored in the vertex shader)
// so this just pushes the current clock time into the uniform the shader
// reads each frame.
export function updatePond(pond, elapsedSeconds) {
  pond.water.material.uniforms.time.value = elapsedSeconds;
}

// ---- Fireflies ------------------------------------------------------------------
//
// Small glowing points that only become visible once night has meaningfully
// fallen (gated on the existing day/night cycle's nightFactor, the same
// value that already brightens the gateway torches), scattered through the
// Whispering Forest interior (z > FOREST_ZONE_Z + a margin, matching
// server/index.js's FOREST_ZONE_Z = 90) so the forest doesn't go visually
// dead at night compared to the meadow's rain/moonlit sky.

export const FIREFLY_COUNT = 45;
const FIREFLY_ZONE_Z_MIN = 100;
const FIREFLY_ZONE_Z_MAX = 170;
const FIREFLY_ZONE_HALF_WIDTH = 85;

// Per-firefly wander offset, a pure function of (time, seed) — dual
// out-of-phase sines, same deterministic-drift technique as torchFlicker(),
// so each firefly meanders independently without any per-frame
// Math.random() call and stays unit-testable without a GL context.
export function fireflyOffset(time, seed) {
  const t = time + seed;
  return {
    dx: Math.sin(t * 0.6) * 2.2 + Math.sin(t * 1.7 + 1.3) * 0.8,
    dy: 0.9 + Math.sin(t * 0.9 + 2.1) * 0.45,
    dz: Math.cos(t * 0.5 + 0.7) * 2.2,
  };
}

// Maps the day/night cycle's 0..1 nightFactor to a firefly opacity: fully
// invisible through dusk, fading in only once it's genuinely dark, capped
// below fully opaque so they read as a soft glow rather than solid dots.
// Pure and testable on its own, same reasoning as splitting groundPatchColor
// out from applyGroundVertexColors.
export function fireflyOpacityForNightFactor(nightFactor) {
  return Math.max(0, Math.min(1, (nightFactor - 0.35) / 0.65)) * 0.9;
}

function buildFireflies(scene) {
  const rng = mulberry32(24601);
  const homes = [];
  const positions = new Float32Array(FIREFLY_COUNT * 3);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const x = (rng() - 0.5) * 2 * FIREFLY_ZONE_HALF_WIDTH;
    const z = FIREFLY_ZONE_Z_MIN + rng() * (FIREFLY_ZONE_Z_MAX - FIREFLY_ZONE_Z_MIN);
    const seed = rng() * 1000;
    homes.push({ x, z, seed });
    positions[i * 3] = x;
    positions[i * 3 + 1] = 1;
    positions[i * 3 + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xccff66,
    size: 0.3,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // scattered across the whole forest depth, same reasoning as the rain cloud
  scene.add(points);

  return { points, homes };
}

// Called every frame from main.js. Fades fireflies in/out with the day/night
// cycle's nightFactor and advances each one's lazy drift via fireflyOffset().
export function updateFireflies(fireflies, elapsedSeconds, nightFactor) {
  fireflies.points.material.opacity = fireflyOpacityForNightFactor(nightFactor);
  const positions = fireflies.points.geometry.attributes.position;
  for (let i = 0; i < fireflies.homes.length; i++) {
    const home = fireflies.homes[i];
    const off = fireflyOffset(elapsedSeconds, home.seed);
    positions.setXYZ(i, home.x + off.dx, off.dy, home.z + off.dz);
  }
  positions.needsUpdate = true;
}

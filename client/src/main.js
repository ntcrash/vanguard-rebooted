import * as THREE from "three";
import { buildWorld } from "./world.js";
import { createCharacterMesh, RemotePlayer, triggerAttack, updateAttack } from "./player.js";
import { initInput, keys, mouse, attack as attackInput } from "./input.js";
import { connectToServer } from "./network.js";
import { initChat } from "./chat.js";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const labelsEl = document.getElementById("labels");
const cooldownFillEl = document.getElementById("attack-cooldown-fill");

const ATTACK_COOLDOWN = 0.6; // seconds between local attacks

// ---- Renderer / scene / camera -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
buildWorld(scene);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
const cameraState = { azimuth: Math.PI, elevation: 0.45, distance: 8 };

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

initInput(canvas);

// ---- Local player ---------------------------------------------------------------

const local = {
  id: null,
  name: null,
  mesh: null,
  rotY: 0,
  hp: 100,
  maxHp: 100,
  moveSpeed: 7, // units/sec
  attackCooldownRemaining: 0, // seconds left before another attack can fire
};

const remotePlayers = new Map(); // id -> RemotePlayer
const labelEls = new Map(); // id -> HTMLDivElement (name tag)
const healthBarEls = new Map(); // id -> { outer, fill } HTMLDivElements

function makeLabel(text, isSelf) {
  const div = document.createElement("div");
  div.className = "player-label" + (isSelf ? " self" : "");
  div.textContent = text;
  labelsEl.appendChild(div);
  return div;
}

function makeHealthBar() {
  const outer = document.createElement("div");
  outer.className = "health-bar";
  const fill = document.createElement("div");
  fill.className = "health-bar-fill";
  outer.appendChild(fill);
  labelsEl.appendChild(outer);
  return { outer, fill };
}

function setHealthBarHp(id, hp, maxHp) {
  const bar = healthBarEls.get(id);
  if (!bar) return;
  const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) * 100 : 0;
  bar.fill.style.width = `${pct}%`;
  bar.fill.classList.toggle("low", pct <= 35);
}

// ---- Chat -----------------------------------------------------------------------

const chat = initChat((text) => {
  net.sendChat(text);
});

// ---- Networking -------------------------------------------------------------------

let net; // assigned below, referenced by chat callback above via closure

net = connectToServer({
  onConnect: () => {
    statusEl.textContent = "Connected";
  },
  onDisconnect: () => {
    statusEl.textContent = "Disconnected — reconnecting…";
  },
  onConnectError: () => {
    statusEl.textContent = "Cannot reach server (is it running on :3000?)";
  },

  onInit: (data) => {
    local.id = data.id;
    local.name = data.self.name;
    local.rotY = data.self.rotY;
    local.hp = data.self.hp ?? 100;
    local.maxHp = data.self.maxHp ?? 100;

    local.mesh = createCharacterMesh(data.self.color);
    local.mesh.position.set(data.self.x, data.self.y, data.self.z);
    scene.add(local.mesh);
    labelEls.set(local.id, makeLabel(local.name, true));
    healthBarEls.set(local.id, makeHealthBar());
    setHealthBarHp(local.id, local.hp, local.maxHp);

    statusEl.textContent = `Connected as ${local.name}`;
    chat.addSystemLine(`You joined as ${local.name}.`);

    for (const p of data.players) {
      if (p.id === local.id) continue;
      spawnRemote(p);
    }
  },

  onPlayerJoined: (p) => {
    spawnRemote(p);
    chat.addSystemLine(`${p.name} joined.`);
  },

  onPlayerMoved: (data) => {
    const rp = remotePlayers.get(data.id);
    if (rp) rp.setTarget(data.x, data.y, data.z, data.rotY);
  },

  onPlayerLeft: (data) => {
    const rp = remotePlayers.get(data.id);
    if (rp) {
      rp.dispose(scene);
      remotePlayers.delete(data.id);
    }
    const label = labelEls.get(data.id);
    if (label) {
      label.remove();
      labelEls.delete(data.id);
    }
    const bar = healthBarEls.get(data.id);
    if (bar) {
      bar.outer.remove();
      healthBarEls.delete(data.id);
    }
  },

  onChat: (data) => {
    chat.addLine(data.name, data.text, data.id === local.id);
  },

  onPlayerAttacked: (data) => {
    const rp = remotePlayers.get(data.id);
    if (rp) rp.triggerAttack();
  },
});

function spawnRemote(p) {
  const rp = new RemotePlayer(scene, p);
  remotePlayers.set(p.id, rp);
  labelEls.set(p.id, makeLabel(p.name, false));
  healthBarEls.set(p.id, makeHealthBar());
  setHealthBarHp(p.id, rp.hp, rp.maxHp);
}

// ---- Movement + camera update ----------------------------------------------------

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _headPos = new THREE.Vector3();
const _healthPos = new THREE.Vector3();
const _screen = new THREE.Vector3();

const WORLD_BOUNDS = 90;
let lastSendAt = 0;
let lastSent = { x: null, y: null, z: null, rotY: null };

function updateCameraOrbit(dt) {
  cameraState.azimuth += mouse.deltaAzimuth;
  cameraState.elevation = THREE.MathUtils.clamp(cameraState.elevation + mouse.deltaElevation, 0.15, 1.35);
  cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + mouse.wheel, 3, 24);
  mouse.deltaAzimuth = 0;
  mouse.deltaElevation = 0;
  mouse.wheel = 0;
}

function updateLocalPlayer(dt) {
  if (!local.mesh) return;

  const { azimuth, elevation, distance } = cameraState;

  _forward.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
  _right.set(_forward.z, 0, -_forward.x);

  _move.set(0, 0, 0);
  if (keys.forward) _move.add(_forward);
  if (keys.back) _move.sub(_forward);
  if (keys.right) _move.add(_right);
  if (keys.left) _move.sub(_right);

  if (_move.lengthSq() > 0) {
    _move.normalize().multiplyScalar(local.moveSpeed * dt);
    local.mesh.position.x = THREE.MathUtils.clamp(local.mesh.position.x + _move.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    local.mesh.position.z = THREE.MathUtils.clamp(local.mesh.position.z + _move.z, -WORLD_BOUNDS, WORLD_BOUNDS);

    const targetRotY = Math.atan2(_move.x, _move.z);
    let dr = targetRotY - local.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    local.mesh.rotation.y += dr * Math.min(1, dt * 12);
  }

  // Camera orbits around the player at head height.
  const eyeHeight = 1.5;
  camera.position.set(
    local.mesh.position.x + distance * Math.sin(azimuth) * Math.cos(elevation),
    local.mesh.position.y + eyeHeight + distance * Math.sin(elevation),
    local.mesh.position.z + distance * Math.cos(azimuth) * Math.cos(elevation)
  );
  camera.lookAt(local.mesh.position.x, local.mesh.position.y + eyeHeight, local.mesh.position.z);
}

function updateLocalAttack(dt) {
  if (local.attackCooldownRemaining > 0) {
    local.attackCooldownRemaining = Math.max(0, local.attackCooldownRemaining - dt);
  }

  if (attackInput.requested) {
    attackInput.requested = false;
    if (local.mesh && local.attackCooldownRemaining <= 0) {
      triggerAttack(local.mesh);
      local.attackCooldownRemaining = ATTACK_COOLDOWN;
      net?.sendAttack();
    }
  }

  if (local.mesh) updateAttack(local.mesh, dt);

  if (cooldownFillEl) {
    const ready = local.attackCooldownRemaining <= 0;
    cooldownFillEl.style.width = `${(1 - local.attackCooldownRemaining / ATTACK_COOLDOWN) * 100}%`;
    cooldownFillEl.classList.toggle("ready", ready);
  }
}

function maybeSendMove(now) {
  if (!local.mesh || !net) return;
  if (now - lastSendAt < 50) return; // ~20Hz cap

  const p = local.mesh.position;
  const r = local.mesh.rotation.y;
  const changed =
    lastSent.x === null ||
    Math.abs(p.x - lastSent.x) > 0.01 ||
    Math.abs(p.z - lastSent.z) > 0.01 ||
    Math.abs(r - lastSent.rotY) > 0.01;

  if (changed) {
    net.sendMove(p.x, p.y, p.z, r);
    lastSent = { x: p.x, y: p.y, z: p.z, rotY: r };
    lastSendAt = now;
  }
}

function projectToScreen(div, worldPos) {
  _screen.copy(worldPos).project(camera);
  if (_screen.z > 1) {
    div.style.display = "none";
    return;
  }
  div.style.display = "block";
  div.style.left = `${(_screen.x * 0.5 + 0.5) * window.innerWidth}px`;
  div.style.top = `${(-_screen.y * 0.5 + 0.5) * window.innerHeight}px`;
}

function updateLabels() {
  for (const [id, div] of labelEls) {
    let worldPos;
    if (id === local.id && local.mesh) {
      worldPos = _headPos.copy(local.mesh.position);
      worldPos.y += 2.3;
    } else {
      const rp = remotePlayers.get(id);
      if (!rp) continue;
      worldPos = rp.headWorldPosition(_headPos);
    }

    projectToScreen(div, worldPos);

    const bar = healthBarEls.get(id);
    if (bar) {
      const barPos = _healthPos.copy(worldPos);
      barPos.y += 0.32; // sit just above the name tag
      projectToScreen(bar.outer, barPos);
    }
  }
}

// ---- Main loop -----------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  updateCameraOrbit(dt);
  updateLocalPlayer(dt);
  updateLocalAttack(dt);

  for (const rp of remotePlayers.values()) rp.update(dt);

  maybeSendMove(performance.now());
  updateLabels();

  renderer.render(scene, camera);
}

animate();

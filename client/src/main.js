import * as THREE from "three";
import { buildWorld } from "./world.js";
import { createCharacterMesh, RemotePlayer } from "./player.js";
import { initInput, keys, mouse } from "./input.js";
import { connectToServer } from "./network.js";
import { initChat } from "./chat.js";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const labelsEl = document.getElementById("labels");

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
  moveSpeed: 7, // units/sec
};

const remotePlayers = new Map(); // id -> RemotePlayer
const labelEls = new Map(); // id -> HTMLDivElement (name tag)

function makeLabel(text, isSelf) {
  const div = document.createElement("div");
  div.className = "player-label" + (isSelf ? " self" : "");
  div.textContent = text;
  labelsEl.appendChild(div);
  return div;
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

    local.mesh = createCharacterMesh(data.self.color);
    local.mesh.position.set(data.self.x, data.self.y, data.self.z);
    scene.add(local.mesh);
    labelEls.set(local.id, makeLabel(local.name, true));

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
  },

  onChat: (data) => {
    chat.addLine(data.name, data.text, data.id === local.id);
  },
});

function spawnRemote(p) {
  const rp = new RemotePlayer(scene, p);
  remotePlayers.set(p.id, rp);
  labelEls.set(p.id, makeLabel(p.name, false));
}

// ---- Movement + camera update ----------------------------------------------------

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _headPos = new THREE.Vector3();
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

    _screen.copy(worldPos).project(camera);
    if (_screen.z > 1) {
      div.style.display = "none";
      continue;
    }
    div.style.display = "block";
    div.style.left = `${(_screen.x * 0.5 + 0.5) * window.innerWidth}px`;
    div.style.top = `${(-_screen.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}

// ---- Main loop -----------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  updateCameraOrbit(dt);
  updateLocalPlayer(dt);

  for (const rp of remotePlayers.values()) rp.update(dt);

  maybeSendMove(performance.now());
  updateLabels();

  renderer.render(scene, camera);
}

animate();

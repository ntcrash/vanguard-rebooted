import * as THREE from "three";
import { buildWorld, torchFlicker } from "./world.js";
import {
  createCharacterMesh,
  applyEquipment,
  RemotePlayer,
  triggerAttack,
  updateAttack,
  updateLocomotion,
} from "./player.js";
import { Mob } from "./mob.js";
import { Pickup } from "./pickup.js";
import { initInput, keys, mouse, attack as attackInput, inventoryToggle } from "./input.js";
import { connectToServer } from "./network.js";
import { initChat } from "./chat.js";
import { DamageNumbers } from "./damageNumbers.js";
import { initCharacterCreate } from "./characterCreate.js";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const zoneLabelEl = document.getElementById("zone-label");
const labelsEl = document.getElementById("labels");
const cooldownFillEl = document.getElementById("attack-cooldown-fill");
const levelDisplayEl = document.getElementById("level-display");
const xpBarFillEl = document.getElementById("xp-bar-fill");
const inventoryPanelEl = document.getElementById("inventory-panel");
const inventoryGridEl = document.getElementById("inventory-grid");
const INVENTORY_SLOT_COUNT = 20; // must match server's MAX_INVENTORY_SLOTS

const ATTACK_COOLDOWN = 0.6; // seconds between local attacks
const SPRINT_MULTIPLIER = 1.8; // hold Shift (input.js's keys.sprint) to move+animate this much faster
const MOB_ATTACK_RANGE = 3.2; // must match server's MOB_ATTACK_RANGE
const MOB_ATTACK_FACING_DOT = 0.3; // mob must be roughly in front of the player to be targeted

// ---- Renderer / scene / camera -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap trades a little perf for noticeably softer shadow edges
// than the default PCF map — worth it since shadow area here is small
// (single sun light, capped shadow camera frustum in world.js).
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// ACESFilmic + sRGB output: without a tone-mapping curve, the sun's 1.4
// intensity directional light blows out highlights on white/pale materials
// (character armor, stone pillars) to flat white. ACESFilmic rolls off
// highlights more like a camera would, and sRGB output color space is the
// correct/expected pairing for it in three r152+.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const { torches } = buildWorld(scene);

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
  alive: true,
  moveSpeed: 7, // units/sec
  attackCooldownRemaining: 0, // seconds left before another attack can fire
  level: 1,
  xp: 0,
  xpToNext: 100,
  inventory: [], // [{ itemId, name, icon, qty, slot }], server-authoritative
  equipment: { weapon: null, head: null, body: null }, // server-authoritative
};

const remotePlayers = new Map(); // id -> RemotePlayer
const mobs = new Map(); // id -> Mob
const pickups = new Map(); // id -> Pickup (world item pickups)
const labelEls = new Map(); // id -> HTMLDivElement (name tag), shared by players + mobs
const healthBarEls = new Map(); // id -> { outer, fill } HTMLDivElements, shared by players + mobs
const damageNumbers = new DamageNumbers(labelsEl);
let inventoryOpen = false;

/** Rebuilds the inventory panel's grid from local.inventory, padding out to
 * INVENTORY_SLOT_COUNT empty slots so unused capacity is visible. */
function renderInventory() {
  if (!inventoryGridEl) return;
  inventoryGridEl.innerHTML = "";
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    const slot = local.inventory[i];
    const div = document.createElement("div");
    div.className = "inventory-slot" + (slot ? "" : " empty");
    if (slot) {
      const isEquippable = !!slot.slot;
      const isEquipped = isEquippable && local.equipment[slot.slot] === slot.itemId;
      if (isEquippable) div.classList.add("equippable");
      if (isEquipped) div.classList.add("equipped");

      div.title =
        `${slot.name} x${slot.qty}` +
        (isEquippable ? (isEquipped ? " (equipped — click to unequip)" : " (click to equip)") : "");
      div.innerHTML =
        `<span class="item-icon">${slot.icon}</span>` +
        (slot.qty > 1 ? `<span class="item-qty">${slot.qty}</span>` : "");

      // Gear (weapon/head/body slot) can be equipped/unequipped by clicking
      // its inventory tile — re-clicking an equipped item unequips it. The
      // server is the source of truth: this only requests the change; the
      // visible result comes back via "playerEquipmentChanged".
      if (isEquippable) {
        div.addEventListener("click", () => {
          if (isEquipped) net?.sendUnequip(slot.slot);
          else net?.sendEquip(slot.itemId);
        });
      }
    }
    inventoryGridEl.appendChild(div);
  }
}

function updateInventoryToggle() {
  if (!inventoryToggle.requested) return;
  inventoryToggle.requested = false;
  inventoryOpen = !inventoryOpen;
  if (inventoryPanelEl) inventoryPanelEl.classList.toggle("hidden", !inventoryOpen);
}

function makeLabel(text, variant) {
  const div = document.createElement("div");
  div.className = "player-label" + (variant ? ` ${variant}` : "");
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

/** Refreshes the local player's level/XP HUD from local.level/xp/xpToNext. */
function updateXpUI() {
  if (levelDisplayEl) levelDisplayEl.textContent = `Level ${local.level}`;
  if (xpBarFillEl) {
    const pct = local.xpToNext > 0 ? Math.max(0, Math.min(1, local.xp / local.xpToNext)) * 100 : 0;
    xpBarFillEl.style.width = `${pct}%`;
  }
}

// ---- Chat -----------------------------------------------------------------------

const chat = initChat((text) => {
  net.sendChat(text);
});

// ---- Networking -------------------------------------------------------------------

let net; // assigned below, referenced by chat callback above via closure

function startGame(character) {
  net = connectToServer({
    onConnect: () => {
      statusEl.textContent = "Connected";
    },
    onDisconnect: () => {
      statusEl.textContent = "Disconnected — reconnecting…";
    },
    onConnectError: (err) => {
      // Covers both "server unreachable" and a rejected login (bad
      // password, invalid name — see server/index.js's io.use() middleware).
      // Either way, stop this socket from silently auto-retrying with the
      // same (possibly wrong) credentials, and send the player back to the
      // login screen with the server's reason so they can fix it and
      // resubmit, which opens a fresh connection via startGame().
      net.raw.disconnect();
      const message = err?.message || "Cannot reach server (is it running on :3000?)";
      statusEl.textContent = message;
      loginScreen.showError(message);
    },

    onInit: (data) => {
      local.id = data.id;
      local.name = data.self.name;
      local.rotY = data.self.rotY;
      local.hp = data.self.hp ?? 100;
      local.maxHp = data.self.maxHp ?? 100;
      local.alive = data.self.alive ?? true;
      local.inventory = data.self.inventory || [];
      local.equipment = data.self.equipment || { weapon: null, head: null, body: null };
      local.level = data.self.level ?? 1;
      local.xp = data.self.xp ?? 0;
      local.xpToNext = data.self.xpToNext ?? 100;
      renderInventory();
      updateXpUI();

      local.mesh = createCharacterMesh(data.self.color, local.equipment);
      local.mesh.position.set(data.self.x, data.self.y, data.self.z);
      scene.add(local.mesh);
      labelEls.set(local.id, makeLabel(local.name, "self"));
      healthBarEls.set(local.id, makeHealthBar());
      setHealthBarHp(local.id, local.hp, local.maxHp);

      statusEl.textContent = `Connected as ${local.name}`;
      chat.addSystemLine(
        data.newAccount ? `Account created — welcome, ${local.name}!` : `You joined as ${local.name}.`
      );

      for (const p of data.players) {
        if (p.id === local.id) continue;
        spawnRemote(p);
      }

      for (const m of data.mobs || []) {
        if (m.alive) spawnMob(m);
      }

      for (const pk of data.pickups || []) {
        spawnPickup(pk);
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

    onMobsState: (data) => {
      for (const m of data) {
        const mob = mobs.get(m.id);
        if (mob) {
          mob.setTarget(m.x, m.y, m.z, m.rotY);
        } else if (m.alive) {
          spawnMob(m);
        }
      }
    },

    onMobDamaged: (data) => {
      const mob = mobs.get(data.id);
      if (mob) {
        const dmg = mob.hp - data.hp;
        mob.applyDamage(data.hp);
        setHealthBarHp(data.id, mob.hp, mob.maxHp);
        damageNumbers.spawn(mob.headWorldPosition(_dmgPos), dmg);
      }
    },

    onMobDied: (data) => {
      const mob = mobs.get(data.id);
      if (mob && mob.hp > 0) {
        damageNumbers.spawn(mob.headWorldPosition(_dmgPos), mob.hp, { finishing: true });
      }
      despawnMob(data.id);
      chat.addSystemLine(`${data.name} was defeated${data.killedBy ? ` by ${data.killedBy}` : ""}.`);
    },

    onMobRespawned: (data) => {
      spawnMob(data);
      chat.addSystemLine(`${data.name} has respawned.`);
    },

    onPlayerDamaged: (data) => {
      if (data.id === local.id) {
        const dmg = local.hp - data.hp;
        local.hp = data.hp;
        setHealthBarHp(local.id, local.hp, local.maxHp);
        if (local.mesh) {
          _dmgPos.copy(local.mesh.position);
          _dmgPos.y += 2.3;
          damageNumbers.spawn(_dmgPos, dmg);
        }
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          const dmg = rp.hp - data.hp;
          rp.hp = data.hp;
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
          damageNumbers.spawn(rp.headWorldPosition(_dmgPos), dmg);
        }
      }
    },

    onPlayerDied: (data) => {
      if (data.id === local.id) {
        local.alive = false;
        if (local.mesh) local.mesh.visible = false;
        statusEl.textContent = "You died — respawning…";
        chat.addSystemLine(`You were defeated${data.killedBy ? ` by a ${data.killedBy}` : ""}.`);
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) rp.mesh.visible = false;
        chat.addSystemLine(`${data.name} was defeated${data.killedBy ? ` by a ${data.killedBy}` : ""}.`);
      }
    },

    onPlayerRespawned: (data) => {
      if (data.id === local.id) {
        local.hp = data.hp;
        local.maxHp = data.maxHp;
        local.alive = true;
        if (local.mesh) {
          local.mesh.position.set(data.x, data.y, data.z);
          local.mesh.rotation.y = data.rotY;
          local.mesh.visible = true;
        }
        setHealthBarHp(local.id, local.hp, local.maxHp);
        statusEl.textContent = `Connected as ${local.name}`;
        chat.addSystemLine("You respawned.");
        // Force the next move tick to broadcast, so remote clients see the teleport.
        lastSent = { x: null, y: null, z: null, rotY: null };
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          rp.hp = data.hp;
          rp.maxHp = data.maxHp;
          rp.mesh.position.set(data.x, data.y, data.z);
          rp.mesh.rotation.y = data.rotY;
          rp.mesh.visible = true;
          rp.setTarget(data.x, data.y, data.z, data.rotY);
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
        }
      }
    },

    // The server's anti-cheat rejected a move we sent (moved too far too
    // fast -- almost always a lag spike rather than an actual hack attempt
    // for a legit client). Snap back to the authoritative position/rotation
    // it gives us so we don't keep sending moves relative to a position the
    // server never accepted, which would just get rejected again.
    onMoveRejected: (data) => {
      if (!local.mesh) return;
      local.mesh.position.set(data.x, data.y, data.z);
      local.mesh.rotation.y = data.rotY;
      // Force the next move tick to re-send from this corrected position.
      lastSent = { x: null, y: null, z: null, rotY: null };
    },

    onItemPickedUp: (data) => {
      // The server already removed this pickup for everyone; only the
      // looting player's inventory changes (via the separate
      // "inventoryUpdated" event below), so this just handles the world
      // visual + a chat line.
      despawnPickup(data.id);
      const who = data.playerId === local.id ? "You" : data.playerName;
      const qtyPrefix = data.qty > 1 ? `${data.qty}x ` : "";
      chat.addSystemLine(`${who} picked up ${qtyPrefix}${data.name}.`);
    },

    onPickupRespawned: (data) => {
      spawnPickup(data);
    },

    onInventoryUpdated: (data) => {
      local.inventory = data.inventory || [];
      renderInventory();
    },

    onPlayerEquipmentChanged: (data) => {
      if (data.id === local.id) {
        local.equipment = data.equipment || { weapon: null, head: null, body: null };
        if (local.mesh) applyEquipment(local.mesh, local.equipment);
        renderInventory(); // refresh which tile shows as "equipped"
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) rp.setEquipment(data.equipment);
      }
    },

    onPlayerXpGained: (data) => {
      if (data.id !== local.id) return; // only the local player's HUD needs XP updates
      local.xp = data.xp;
      local.xpToNext = data.xpToNext;
      local.level = data.level;
      updateXpUI();
    },

    onPlayerLeveledUp: (data) => {
      if (data.id === local.id) {
        local.level = data.level;
        local.hp = data.hp;
        local.maxHp = data.maxHp;
        updateXpUI();
        setHealthBarHp(local.id, local.hp, local.maxHp);
        chat.addSystemLine(`You reached level ${data.level}!`);
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          rp.hp = data.hp;
          rp.maxHp = data.maxHp;
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
        }
        chat.addSystemLine(`${data.name} reached level ${data.level}!`);
      }
    },
  }, character);
}

const loginScreen = initCharacterCreate(startGame);

function spawnRemote(p) {
  const rp = new RemotePlayer(scene, p);
  remotePlayers.set(p.id, rp);
  labelEls.set(p.id, makeLabel(p.name));
  healthBarEls.set(p.id, makeHealthBar());
  setHealthBarHp(p.id, rp.hp, rp.maxHp);
}

function spawnMob(m) {
  const mob = new Mob(scene, m);
  mobs.set(m.id, mob);
  labelEls.set(m.id, makeLabel(m.name, "mob"));
  healthBarEls.set(m.id, makeHealthBar());
  setHealthBarHp(m.id, mob.hp, mob.maxHp);
}

function despawnMob(id) {
  const mob = mobs.get(id);
  if (mob) {
    mob.dispose(scene);
    mobs.delete(id);
  }
  const label = labelEls.get(id);
  if (label) {
    label.remove();
    labelEls.delete(id);
  }
  const bar = healthBarEls.get(id);
  if (bar) {
    bar.outer.remove();
    healthBarEls.delete(id);
  }
}

// Pickups have no name tag / health bar — just a mesh in the world.
function spawnPickup(pk) {
  pickups.set(pk.id, new Pickup(scene, pk));
}

function despawnPickup(id) {
  const pickup = pickups.get(id);
  if (pickup) {
    pickup.dispose(scene);
    pickups.delete(id);
  }
}

// ---- Movement + camera update ----------------------------------------------------

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _headPos = new THREE.Vector3();
const _healthPos = new THREE.Vector3();
const _dmgPos = new THREE.Vector3();
const _screen = new THREE.Vector3();

const WORLD_BOUNDS = 170; // must match server's WORLD_BOUNDS
const FOREST_ZONE_Z = 90; // must match server's FOREST_ZONE_Z
let lastSendAt = 0;
let lastSent = { x: null, y: null, z: null, rotY: null };
let currentZoneName = null; // last zone name shown in the HUD, so we only touch the DOM on change

/** Updates the "Meadow" / "Whispering Forest" HUD label from the local
 * player's current z position. Purely cosmetic client-side zone detection —
 * both areas share the same continuous world/network state. */
function updateZoneLabel() {
  if (!zoneLabelEl || !local.mesh) return;
  const zoneName = local.mesh.position.z >= FOREST_ZONE_Z ? "Whispering Forest" : "Meadow";
  if (zoneName === currentZoneName) return;
  currentZoneName = zoneName;
  zoneLabelEl.textContent = zoneName;
  zoneLabelEl.classList.toggle("forest", zoneName === "Whispering Forest");
}

function updateCameraOrbit(dt) {
  cameraState.azimuth += mouse.deltaAzimuth;
  cameraState.elevation = THREE.MathUtils.clamp(cameraState.elevation + mouse.deltaElevation, 0.15, 1.35);
  cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + mouse.wheel, 3, 24);
  mouse.deltaAzimuth = 0;
  mouse.deltaElevation = 0;
  mouse.wheel = 0;
}

function updateLocalPlayer(dt) {
  if (!local.mesh || !local.alive) return;

  const { azimuth, elevation, distance } = cameraState;

  _forward.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
  // Camera-relative right vector: cross(forward, worldUp), which for our
  // forward gives (-forward.z, 0, forward.x). The previous sign here was
  // flipped, so pressing D/right strafed toward the camera's left (and
  // vice versa) — this was the "left is right" movement bug.
  _right.set(-_forward.z, 0, _forward.x);

  _move.set(0, 0, 0);
  if (keys.forward) _move.add(_forward);
  if (keys.back) _move.sub(_forward);
  if (keys.right) _move.add(_right);
  if (keys.left) _move.sub(_right);

  const moving = _move.lengthSq() > 0;
  const effectiveSpeed = local.moveSpeed * (keys.sprint ? SPRINT_MULTIPLIER : 1);

  if (moving) {
    _move.normalize().multiplyScalar(effectiveSpeed * dt);
    local.mesh.position.x = THREE.MathUtils.clamp(local.mesh.position.x + _move.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    local.mesh.position.z = THREE.MathUtils.clamp(local.mesh.position.z + _move.z, -WORLD_BOUNDS, WORLD_BOUNDS);

    const targetRotY = Math.atan2(_move.x, _move.z);
    let dr = targetRotY - local.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    local.mesh.rotation.y += dr * Math.min(1, dt * 12);
  }

  // Walk/run gait is purely speed-driven (see updateLocomotion in player.js),
  // so sprinting just means feeding it a bigger number here — no separate
  // "running" flag to track or send over the network.
  updateLocomotion(local.mesh, dt, moving ? effectiveSpeed : 0);

  // Camera orbits around the player at head height.
  const eyeHeight = 1.5;
  camera.position.set(
    local.mesh.position.x + distance * Math.sin(azimuth) * Math.cos(elevation),
    local.mesh.position.y + eyeHeight + distance * Math.sin(elevation),
    local.mesh.position.z + distance * Math.cos(azimuth) * Math.cos(elevation)
  );
  camera.lookAt(local.mesh.position.x, local.mesh.position.y + eyeHeight, local.mesh.position.z);
}

/** Finds the nearest alive mob within attack range that's roughly in front of the player. */
function findAttackTargetMobId() {
  if (!local.mesh) return null;

  const forwardX = Math.sin(local.mesh.rotation.y);
  const forwardZ = Math.cos(local.mesh.rotation.y);

  let bestId = null;
  let bestDist = Infinity;

  for (const [id, mob] of mobs) {
    // Dead mobs are despawned immediately on "mobDied", so anything still in
    // this map is alive — no extra alive-check needed here.
    const dx = mob.mesh.position.x - local.mesh.position.x;
    const dz = mob.mesh.position.z - local.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MOB_ATTACK_RANGE || dist === 0) continue;

    const dot = (dx / dist) * forwardX + (dz / dist) * forwardZ;
    if (dot < MOB_ATTACK_FACING_DOT) continue;

    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }

  return bestId;
}

function updateLocalAttack(dt) {
  if (local.attackCooldownRemaining > 0) {
    local.attackCooldownRemaining = Math.max(0, local.attackCooldownRemaining - dt);
  }

  if (attackInput.requested) {
    attackInput.requested = false;
    if (local.mesh && local.alive && local.attackCooldownRemaining <= 0) {
      triggerAttack(local.mesh);
      local.attackCooldownRemaining = ATTACK_COOLDOWN;
      net?.sendAttack(findAttackTargetMobId());
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
  if (!local.mesh || !net || !local.alive) return;
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
      const rp = remotePlayers.get(id) || mobs.get(id);
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
  updateInventoryToggle();
  updateZoneLabel();
  for (const torch of torches) {
    torch.light.intensity = torchFlicker(clock.elapsedTime, torch.seed);
  }

  for (const rp of remotePlayers.values()) rp.update(dt);
  for (const mob of mobs.values()) mob.update(dt);
  for (const pickup of pickups.values()) pickup.update(dt);

  maybeSendMove(performance.now());
  updateLabels();
  damageNumbers.update(camera, window.innerWidth, window.innerHeight);

  renderer.render(scene, camera);
}

animate();

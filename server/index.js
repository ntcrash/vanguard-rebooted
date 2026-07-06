// Vanguard Rebooted — realtime multiplayer server
// Tracks connected players and broadcasts position + chat updates over Socket.io.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3000;
const WORLD_BOUNDS = 170; // players are clamped to +/- this on X/Z
// The map is one continuous plane split into two visually/thematically
// distinct outdoor areas: the original "Meadow" (roughly z < FOREST_ZONE_Z)
// and the new "Whispering Forest" beyond it, reachable by walking north.
// This keeps zone transitions simple (no teleport/instance/room logic
// needed) while still giving the world a second real area with its own
// mobs, pickups, and look (see client/src/world.js's scatterForest()).
const FOREST_ZONE_Z = 90; // z at/after which a player is considered "in the forest"
const ATTACK_COOLDOWN_MS = 550; // slightly under the client's 600ms to allow for latency jitter
const PLAYER_RESPAWN_MS = 5000; // delay before a defeated player returns to the world

// ---- Inventory ------------------------------------------------------------------
// Server-authoritative player inventory. Item pickups scattered in the world
// (see "Item pickups" below) call addItemToInventory() the same way the
// starter kit does — the client only ever renders what the server tells it.
const MAX_INVENTORY_SLOTS = 20;
const ITEM_DEFS = {
  "rusty-sword": { name: "Rusty Sword", icon: "⚔️" },
  "health-draught": { name: "Health Draught", icon: "🧪" },
  "gold-coin": { name: "Gold Coin", icon: "🪙" },
  // Equippable gear — each has a `slot` ("weapon" | "head" | "body") so
  // equipItem()/unequipItem() below know where it goes on the player's
  // equipment loadout. Non-gear items above have no `slot` and can't be
  // equipped.
  "steel-sword": { name: "Steel Sword", icon: "🗡️", slot: "weapon" },
  "iron-helm": { name: "Iron Helm", icon: "⛑️", slot: "head" },
  "leather-armor": { name: "Leather Armor", icon: "🥋", slot: "body" },
  // Forest-only curio -- no gameplay effect yet, just a reason to explore
  // the new zone and something for a future crafting/quest system to use.
  "moonpetal": { name: "Moonpetal", icon: "🌙" },
};
const EQUIPMENT_SLOTS = ["weapon", "head", "body"];

/** Adds `qty` of `itemId` to a player's inventory, stacking onto an existing
 * slot if one exists. Returns false (adding nothing) if the item id is
 * unknown or the inventory has no free slot for a new stack. */
function addItemToInventory(player, itemId, qty = 1) {
  const def = ITEM_DEFS[itemId];
  if (!def) return false;

  const existing = player.inventory.find((slot) => slot.itemId === itemId);
  if (existing) {
    existing.qty += qty;
    return true;
  }

  if (player.inventory.length >= MAX_INVENTORY_SLOTS) return false;

  player.inventory.push({ itemId, name: def.name, icon: def.icon, qty, slot: def.slot ?? null });
  return true;
}

// ---- Item pickups (world) -------------------------------------------------------
// Static item pickups scattered around the world. Walking within
// PICKUP_COLLECT_RANGE of one automatically loots it into the player's
// inventory (addItemToInventory) and it respawns after PICKUP_RESPAWN_MS,
// mirroring the mob respawn pattern below. No dedicated "loot" key/event is
// needed — collection is checked server-side after every validated move.
const PICKUP_COLLECT_RANGE = 2.2;
const PICKUP_RESPAWN_MS = 20000;
const PICKUP_SPAWNS = [
  { x: 0, z: 0, itemId: "health-draught", qty: 2 },
  { x: 40, z: 40, itemId: "gold-coin", qty: 5 },
  { x: -40, z: -40, itemId: "health-draught", qty: 1 },
  { x: 60, z: -20, itemId: "gold-coin", qty: 3 },
  { x: -60, z: 20, itemId: "health-draught", qty: 2 },
  { x: 20, z: -60, itemId: "gold-coin", qty: 4 },
  { x: -20, z: 60, itemId: "health-draught", qty: 1 },
  { x: 0, z: -80, itemId: "gold-coin", qty: 6 },
  { x: 80, z: 0, itemId: "iron-helm", qty: 1 },
  { x: -80, z: 0, itemId: "leather-armor", qty: 1 },
  { x: 0, z: 80, itemId: "steel-sword", qty: 1 },
  // Whispering Forest (z > FOREST_ZONE_Z) — same pickup mechanic, plus the
  // new forest-exclusive "moonpetal" curio.
  { x: 10, z: 115, itemId: "moonpetal", qty: 3 },
  { x: -35, z: 130, itemId: "moonpetal", qty: 2 },
  { x: 45, z: 150, itemId: "health-draught", qty: 2 },
  { x: -15, z: 155, itemId: "gold-coin", qty: 5 },
  { x: 0, z: 165, itemId: "moonpetal", qty: 4 },
];

/** @type {Map<string, object>} */
const pickups = new Map();

function spawnPickups() {
  PICKUP_SPAWNS.forEach((spawn, i) => {
    const def = ITEM_DEFS[spawn.itemId];
    pickups.set(`pickup-${i}`, {
      id: `pickup-${i}`,
      itemId: spawn.itemId,
      name: def.name,
      icon: def.icon,
      qty: spawn.qty,
      x: spawn.x,
      y: 0,
      z: spawn.z,
      alive: true,
    });
  });
}

function pickupsSnapshot() {
  return Array.from(pickups.values()).filter((p) => p.alive);
}

/** Brings a collected pickup back after PICKUP_RESPAWN_MS. */
function respawnPickup(pickup) {
  pickup.alive = true;
  io.emit("pickupRespawned", {
    id: pickup.id,
    itemId: pickup.itemId,
    name: pickup.name,
    icon: pickup.icon,
    qty: pickup.qty,
    x: pickup.x,
    y: pickup.y,
    z: pickup.z,
  });
}

/** Checks alive pickups near `player` and loots any within range. Called
 * after every server-validated move. */
function checkPickupCollection(player) {
  for (const pickup of pickups.values()) {
    if (!pickup.alive) continue;
    const dist = Math.hypot(pickup.x - player.x, pickup.z - player.z);
    if (dist > PICKUP_COLLECT_RANGE) continue;

    if (!addItemToInventory(player, pickup.itemId, pickup.qty)) continue; // inventory full — leave it in the world

    pickup.alive = false;
    io.emit("itemPickedUp", {
      id: pickup.id,
      playerId: player.id,
      playerName: player.name,
      itemId: pickup.itemId,
      name: pickup.name,
      icon: pickup.icon,
      qty: pickup.qty,
    });
    io.to(player.id).emit("inventoryUpdated", { inventory: player.inventory });
    setTimeout(() => respawnPickup(pickup), PICKUP_RESPAWN_MS);
  }
}

// ---- Mob NPCs -----------------------------------------------------------------
// Simple wandering mobs that players can attack and defeat. Defeated mobs
// respawn at their home spawn point after MOB_RESPAWN_MS.
const MOB_TICK_MS = 200;
const MOB_SPEED = 1.4; // units/sec while wandering
const MOB_WANDER_RADIUS = 12; // stays within this distance of its spawn point
const MOB_ARRIVE_DIST = 0.4;
const MOB_RETARGET_CHANCE = 0.02; // per-tick chance to pick a new wander point even before arriving
const MOB_MAX_HP = 60;
const MOB_DAMAGE = 20; // per hit
const MOB_ATTACK_RANGE = 3.2; // player must be within this distance of a mob to hit it
const MOB_RESPAWN_MS = 15000; // a defeated mob returns to life this long after dying
const MOB_COUNTER_CHANCE = 0.4; // chance a mob that survives a hit gouges the attacker back
const MOB_COUNTER_DAMAGE = 12; // damage dealt to the player on a mob counter-attack

// Each spawn now carries its own name directly (rather than picking one from
// a shared array by index) so the new Whispering Forest wolves below don't
// have to share a name pool with the meadow boars.
const MOB_SPAWNS = [
  { x: 20, z: 15, name: "Boar" },
  { x: -25, z: 10, name: "Wild Boar" },
  { x: 10, z: -30, name: "Tusked Boar" },
  { x: -15, z: -20, name: "Razorback" },
  { x: 35, z: -5, name: "Boar Sow" },
  { x: -5, z: 35, name: "Mud Boar" },
  // Whispering Forest (z > FOREST_ZONE_Z) — wolves, same mechanics as boars.
  { x: 15, z: 120, name: "Grey Wolf" },
  { x: -20, z: 135, name: "Timber Wolf" },
  { x: 45, z: 150, name: "Dire Wolf" },
  { x: -45, z: 115, name: "Lone Wolf" },
  { x: 0, z: 160, name: "Alpha Wolf" },
];

/** @type {Map<string, object>} */
const mobs = new Map();

function pickWanderTarget(mob) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * MOB_WANDER_RADIUS;
  mob.targetX = clamp(mob.homeX + Math.cos(angle) * radius, -WORLD_BOUNDS, WORLD_BOUNDS);
  mob.targetZ = clamp(mob.homeZ + Math.sin(angle) * radius, -WORLD_BOUNDS, WORLD_BOUNDS);
}

function spawnMobs() {
  MOB_SPAWNS.forEach((spawn, i) => {
    const mob = {
      id: `mob-${i}`,
      name: spawn.name,
      homeX: spawn.x,
      homeZ: spawn.z,
      x: spawn.x,
      y: 0,
      z: spawn.z,
      rotY: 0,
      hp: MOB_MAX_HP,
      maxHp: MOB_MAX_HP,
      alive: true,
      targetX: spawn.x,
      targetZ: spawn.z,
    };
    pickWanderTarget(mob);
    mobs.set(mob.id, mob);
  });
}

function mobsSnapshot() {
  return Array.from(mobs.values()).map((m) => ({
    id: m.id,
    name: m.name,
    x: m.x,
    y: m.y,
    z: m.z,
    rotY: m.rotY,
    hp: m.hp,
    maxHp: m.maxHp,
    alive: m.alive,
  }));
}

/** Brings a defeated mob back to life at its home spawn point. */
function respawnMob(mob) {
  mob.hp = mob.maxHp;
  mob.alive = true;
  mob.x = mob.homeX;
  mob.z = mob.homeZ;
  mob.rotY = 0;
  pickWanderTarget(mob);
  io.emit("mobRespawned", {
    id: mob.id,
    name: mob.name,
    x: mob.x,
    y: mob.y,
    z: mob.z,
    rotY: mob.rotY,
    hp: mob.hp,
    maxHp: mob.maxHp,
    alive: true,
  });
}

/** Brings a defeated player back into the world at a fresh random spot. */
function respawnPlayer(player) {
  if (!players.has(player.id)) return; // disconnected before their respawn timer fired
  player.hp = player.maxHp;
  player.alive = true;
  player.x = (Math.random() - 0.5) * 20;
  player.y = 0;
  player.z = (Math.random() - 0.5) * 20;
  player.rotY = 0;
  io.emit("playerRespawned", {
    id: player.id,
    x: player.x,
    y: player.y,
    z: player.z,
    rotY: player.rotY,
    hp: player.hp,
    maxHp: player.maxHp,
  });
}

function tickMobs() {
  for (const mob of mobs.values()) {
    if (!mob.alive) continue;

    const dx = mob.targetX - mob.x;
    const dz = mob.targetZ - mob.z;
    const dist = Math.hypot(dx, dz);

    if (dist < MOB_ARRIVE_DIST || Math.random() < MOB_RETARGET_CHANCE) {
      pickWanderTarget(mob);
    } else {
      const step = Math.min(dist, MOB_SPEED * (MOB_TICK_MS / 1000));
      mob.x += (dx / dist) * step;
      mob.z += (dz / dist) * step;
      mob.rotY = Math.atan2(dx, dz);
    }
  }

  io.emit("mobsState", mobsSnapshot());
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }, // local prototype only — tighten before any real deployment
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, players: players.size, mobs: mobs.size, mobsAlive: Array.from(mobs.values()).filter((m) => m.alive).length })
);

// ---- XP / leveling ---------------------------------------------------------------
// Simple, server-authoritative XP curve tied to defeating mobs. Leveling up
// fully heals the player and bumps their max HP a little — a real (if
// modest) reason to grind mobs beyond just gear/gold drops.
const MOB_XP_REWARD = 25; // XP awarded to a mob's killer
const XP_BASE = 100; // XP required to go from level 1 to level 2
const XP_GROWTH_PER_LEVEL = 40; // each subsequent level requires this much more XP than the last
const LEVEL_MAX_HP_BONUS = 10; // maxHp gained per level up

/** XP required to advance from `level` to `level + 1`. */
function xpToNextLevel(level) {
  return XP_BASE + (level - 1) * XP_GROWTH_PER_LEVEL;
}

/** Awards `amount` XP to `player`, applying any level-ups (a big reward could
 * cross more than one threshold at once) and broadcasting the result so
 * every client can update level/XP UI. */
function awardXp(player, amount) {
  player.xp += amount;
  let leveledUp = false;

  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.maxHp += LEVEL_MAX_HP_BONUS;
    player.hp = player.maxHp; // level-up fully restores HP
    player.xpToNext = xpToNextLevel(player.level);
    leveledUp = true;
  }

  io.emit("playerXpGained", {
    id: player.id,
    xp: player.xp,
    xpToNext: player.xpToNext,
    level: player.level,
    gained: amount,
  });

  if (leveledUp) {
    io.emit("playerLeveledUp", {
      id: player.id,
      name: player.name,
      level: player.level,
      hp: player.hp,
      maxHp: player.maxHp,
    });
  }
}

/** @type {Map<string, {id: string, name: string, color: string, x: number, y: number, z: number, rotY: number}>} */
const players = new Map();

const NAME_ADJECTIVES = ["Brave", "Swift", "Shadow", "Iron", "Storm", "Wild", "Silent", "Crimson"];
const NAME_NOUNS = ["Wolf", "Raven", "Blade", "Hawk", "Ranger", "Warden", "Ember", "Fox"];
function randomName() {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${a}${n}${Math.floor(Math.random() * 100)}`;
}
function randomColor() {
  return `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- Character creation (name/color chosen on the client's login screen) ------
const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,20}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_PATTERN = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/;

/** Returns a trimmed, validated name from client auth, or null if invalid/absent. */
function sanitizeChosenName(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return NAME_PATTERN.test(trimmed) ? trimmed : null;
}

/** Returns a validated color string from client auth, or null if invalid/absent. */
function sanitizeChosenColor(raw) {
  if (typeof raw !== "string") return null;
  if (HEX_COLOR_PATTERN.test(raw) || HSL_COLOR_PATTERN.test(raw)) return raw;
  return null;
}

io.on("connection", (socket) => {
  // Name/color chosen on the client's character-creation screen (see
  // client/src/characterCreate.js), sent as socket.io auth. Falls back to a
  // randomly generated guest name/color if missing or invalid — this keeps
  // older clients (and malformed auth payloads) working.
  const auth = socket.handshake.auth || {};
  const player = {
    id: socket.id,
    name: sanitizeChosenName(auth.name) || randomName(),
    color: sanitizeChosenColor(auth.color) || randomColor(),
    x: (Math.random() - 0.5) * 20,
    y: 0,
    z: (Math.random() - 0.5) * 20,
    rotY: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    lastAttackAt: 0,
    level: 1,
    xp: 0,
    xpToNext: xpToNextLevel(1),
    inventory: [],
    // Equippable gear currently worn, one item id (or null) per slot. Drives
    // the visible character model on every client via "playerEquipmentChanged".
    equipment: { weapon: null, head: null, body: null },
  };
  // Starter kit so the inventory panel has something to show before item
  // pickups (a later roadmap item) exist in the world.
  addItemToInventory(player, "rusty-sword", 1);
  addItemToInventory(player, "health-draught", 3);
  players.set(socket.id, player);

  console.log(`[join] ${player.name} (${socket.id}) — ${players.size} online`);

  // Send the new player their own info + the current world state.
  socket.emit("init", {
    id: socket.id,
    self: player,
    players: Array.from(players.values()),
    mobs: mobsSnapshot(),
    pickups: pickupsSnapshot(),
  });

  // Tell everyone else a new player arrived.
  socket.broadcast.emit("playerJoined", player);

  socket.on("move", (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || typeof data !== "object" || data === null) return;
    const { x, y, z, rotY } = data;
    if ([x, y, z, rotY].some((v) => typeof v !== "number" || !Number.isFinite(v))) return;

    p.x = clamp(x, -WORLD_BOUNDS, WORLD_BOUNDS);
    p.y = y;
    p.z = clamp(z, -WORLD_BOUNDS, WORLD_BOUNDS);
    p.rotY = rotY;

    socket.broadcast.emit("playerMoved", { id: socket.id, x: p.x, y: p.y, z: p.z, rotY: p.rotY });
    checkPickupCollection(p);
  });

  socket.on("attack", (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastAttackAt < ATTACK_COOLDOWN_MS) return; // ignore spam / cooldown cheats
    p.lastAttackAt = now;
    socket.broadcast.emit("playerAttacked", { id: socket.id });

    // Optional mob target: the client picks the nearest mob in range/facing
    // and includes its id. Server re-validates range so a modified client
    // can't hit mobs from across the map.
    const targetMobId = data && typeof data === "object" ? data.targetMobId : null;
    if (!targetMobId || typeof targetMobId !== "string") return;

    const mob = mobs.get(targetMobId);
    if (!mob || !mob.alive) return;

    const dist = Math.hypot(mob.x - p.x, mob.z - p.z);
    if (dist > MOB_ATTACK_RANGE) return;

    mob.hp = Math.max(0, mob.hp - MOB_DAMAGE);
    if (mob.hp <= 0) {
      mob.alive = false;
      io.emit("mobDied", { id: mob.id, name: mob.name, killedBy: p.name });
      setTimeout(() => respawnMob(mob), MOB_RESPAWN_MS);
      awardXp(p, MOB_XP_REWARD);
      return;
    }

    io.emit("mobDamaged", { id: mob.id, hp: mob.hp });

    // A mob that survives the hit has a chance to gore the attacker back —
    // gives melee combat real risk and gives player respawn something to do.
    if (p.alive && Math.random() < MOB_COUNTER_CHANCE) {
      p.hp = Math.max(0, p.hp - MOB_COUNTER_DAMAGE);
      if (p.hp <= 0) {
        p.alive = false;
        io.emit("playerDied", { id: p.id, name: p.name, killedBy: mob.name });
        setTimeout(() => respawnPlayer(p), PLAYER_RESPAWN_MS);
      } else {
        io.emit("playerDamaged", { id: p.id, hp: p.hp });
      }
    }
  });

  // ---- Equippable gear ---------------------------------------------------
  // Equip/unequip only ever move an item id already sitting in the player's
  // own inventory into/out of their equipment loadout — nothing is created,
  // consumed, or removed from inventory by (un)equipping. Broadcast to
  // everyone (not just the equipping player) so remote clients can re-skin
  // that player's character mesh (see applyEquipment() in client/src/player.js).
  socket.on("equipItem", (itemId) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || typeof itemId !== "string") return;

    const owned = p.inventory.some((slot) => slot.itemId === itemId);
    const def = ITEM_DEFS[itemId];
    if (!owned || !def || !def.slot) return; // must own it and it must be gear

    p.equipment[def.slot] = itemId;
    io.emit("playerEquipmentChanged", { id: p.id, equipment: p.equipment });
  });

  socket.on("unequipItem", (slot) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !EQUIPMENT_SLOTS.includes(slot)) return;

    p.equipment[slot] = null;
    io.emit("playerEquipmentChanged", { id: p.id, equipment: p.equipment });
  });

  socket.on("chat", (message) => {
    const p = players.get(socket.id);
    if (!p || typeof message !== "string") return;
    const text = message.slice(0, 240).trim();
    if (!text) return;
    io.emit("chat", { id: socket.id, name: p.name, text, at: Date.now() });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("playerLeft", { id: socket.id });
    console.log(`[leave] ${player.name} (${socket.id}) — ${players.size} online`);
  });
});

spawnMobs();
spawnPickups();
setInterval(tickMobs, MOB_TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`Vanguard Rebooted server listening on http://localhost:${PORT}`);
});

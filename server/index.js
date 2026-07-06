// Vanguard Rebooted — realtime multiplayer server
// Tracks connected players and broadcasts position + chat updates over Socket.io.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3000;
const WORLD_BOUNDS = 90; // players are clamped to +/- this on X/Z
const ATTACK_COOLDOWN_MS = 550; // slightly under the client's 600ms to allow for latency jitter
const PLAYER_RESPAWN_MS = 5000; // delay before a defeated player returns to the world

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
const MOB_NAMES = ["Boar", "Wild Boar", "Tusked Boar", "Razorback", "Boar Sow", "Mud Boar"];
const MOB_RESPAWN_MS = 15000; // a defeated mob returns to life this long after dying
const MOB_COUNTER_CHANCE = 0.4; // chance a mob that survives a hit gouges the attacker back
const MOB_COUNTER_DAMAGE = 12; // damage dealt to the player on a mob counter-attack

const MOB_SPAWNS = [
  { x: 20, z: 15 },
  { x: -25, z: 10 },
  { x: 10, z: -30 },
  { x: -15, z: -20 },
  { x: 35, z: -5 },
  { x: -5, z: 35 },
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
      name: MOB_NAMES[i % MOB_NAMES.length],
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
  };
  players.set(socket.id, player);

  console.log(`[join] ${player.name} (${socket.id}) — ${players.size} online`);

  // Send the new player their own info + the current world state.
  socket.emit("init", {
    id: socket.id,
    self: player,
    players: Array.from(players.values()),
    mobs: mobsSnapshot(),
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
setInterval(tickMobs, MOB_TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`Vanguard Rebooted server listening on http://localhost:${PORT}`);
});

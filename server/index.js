// Vanguard Rebooted — realtime multiplayer server
// Tracks connected players and broadcasts position + chat updates over Socket.io.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3000;
const WORLD_BOUNDS = 90; // players are clamped to +/- this on X/Z
const ATTACK_COOLDOWN_MS = 550; // slightly under the client's 600ms to allow for latency jitter

// ---- Mob NPCs -----------------------------------------------------------------
// Simple wandering mobs that players can attack and defeat. No respawn yet —
// once a mob dies it stays dead (respawn handling is a separate roadmap item).
const MOB_TICK_MS = 200;
const MOB_SPEED = 1.4; // units/sec while wandering
const MOB_WANDER_RADIUS = 12; // stays within this distance of its spawn point
const MOB_ARRIVE_DIST = 0.4;
const MOB_RETARGET_CHANCE = 0.02; // per-tick chance to pick a new wander point even before arriving
const MOB_MAX_HP = 60;
const MOB_DAMAGE = 20; // per hit
const MOB_ATTACK_RANGE = 3.2; // player must be within this distance of a mob to hit it
const MOB_NAMES = ["Boar", "Wild Boar", "Tusked Boar", "Razorback", "Boar Sow", "Mud Boar"];

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

io.on("connection", (socket) => {
  const player = {
    id: socket.id,
    name: randomName(),
    color: randomColor(),
    x: (Math.random() - 0.5) * 20,
    y: 0,
    z: (Math.random() - 0.5) * 20,
    rotY: 0,
    hp: 100,
    maxHp: 100,
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
    if (!p || typeof data !== "object" || data === null) return;
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
    if (!p) return;
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
    } else {
      io.emit("mobDamaged", { id: mob.id, hp: mob.hp });
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

// Vanguard Rebooted — realtime multiplayer server
// Tracks connected players and broadcasts position + chat updates over Socket.io.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3000;
const WORLD_BOUNDS = 90; // players are clamped to +/- this on X/Z
const ATTACK_COOLDOWN_MS = 550; // slightly under the client's 600ms to allow for latency jitter

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }, // local prototype only — tighten before any real deployment
});

app.get("/health", (_req, res) => res.json({ ok: true, players: players.size }));

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
    lastAttackAt: 0,
  };
  players.set(socket.id, player);

  console.log(`[join] ${player.name} (${socket.id}) — ${players.size} online`);

  // Send the new player their own info + the current world state.
  socket.emit("init", {
    id: socket.id,
    self: player,
    players: Array.from(players.values()),
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

  socket.on("attack", () => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastAttackAt < ATTACK_COOLDOWN_MS) return; // ignore spam / cooldown cheats
    p.lastAttackAt = now;
    socket.broadcast.emit("playerAttacked", { id: socket.id });
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

httpServer.listen(PORT, () => {
  console.log(`Vanguard Rebooted server listening on http://localhost:${PORT}`);
});

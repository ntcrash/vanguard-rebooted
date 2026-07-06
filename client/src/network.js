import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Thin wrapper around the socket.io connection. Callbacks are set once by
 * main.js; this module just centralizes the event names in one place.
 *
 * `character` (optional) is the { name, color } chosen on the character
 * creation screen; it's sent as socket.io auth payload so the server can use
 * it instead of generating a random name/color for this session.
 */
export function connectToServer(handlers, character) {
  const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    auth: character ? { name: character.name, color: character.color } : {},
  });

  socket.on("connect", () => handlers.onConnect?.(socket.id));
  socket.on("disconnect", () => handlers.onDisconnect?.());
  socket.on("connect_error", (err) => handlers.onConnectError?.(err));

  socket.on("init", (data) => handlers.onInit?.(data));
  socket.on("playerJoined", (data) => handlers.onPlayerJoined?.(data));
  socket.on("playerMoved", (data) => handlers.onPlayerMoved?.(data));
  socket.on("playerLeft", (data) => handlers.onPlayerLeft?.(data));
  socket.on("chat", (data) => handlers.onChat?.(data));
  socket.on("playerAttacked", (data) => handlers.onPlayerAttacked?.(data));
  socket.on("mobsState", (data) => handlers.onMobsState?.(data));
  socket.on("mobDamaged", (data) => handlers.onMobDamaged?.(data));
  socket.on("mobDied", (data) => handlers.onMobDied?.(data));
  socket.on("mobRespawned", (data) => handlers.onMobRespawned?.(data));
  socket.on("playerDamaged", (data) => handlers.onPlayerDamaged?.(data));
  socket.on("playerDied", (data) => handlers.onPlayerDied?.(data));
  socket.on("playerRespawned", (data) => handlers.onPlayerRespawned?.(data));

  return {
    sendMove(x, y, z, rotY) {
      socket.emit("move", { x, y, z, rotY });
    },
    sendChat(text) {
      socket.emit("chat", text);
    },
    sendAttack(targetMobId) {
      socket.emit("attack", targetMobId ? { targetMobId } : undefined);
    },
    raw: socket,
  };
}

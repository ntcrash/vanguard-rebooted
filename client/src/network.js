import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Thin wrapper around the socket.io connection. Callbacks are set once by
 * main.js; this module just centralizes the event names in one place.
 */
export function connectToServer(handlers) {
  const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

  socket.on("connect", () => handlers.onConnect?.(socket.id));
  socket.on("disconnect", () => handlers.onDisconnect?.());
  socket.on("connect_error", (err) => handlers.onConnectError?.(err));

  socket.on("init", (data) => handlers.onInit?.(data));
  socket.on("playerJoined", (data) => handlers.onPlayerJoined?.(data));
  socket.on("playerMoved", (data) => handlers.onPlayerMoved?.(data));
  socket.on("playerLeft", (data) => handlers.onPlayerLeft?.(data));
  socket.on("chat", (data) => handlers.onChat?.(data));
  socket.on("playerAttacked", (data) => handlers.onPlayerAttacked?.(data));

  return {
    sendMove(x, y, z, rotY) {
      socket.emit("move", { x, y, z, rotY });
    },
    sendChat(text) {
      socket.emit("chat", text);
    },
    sendAttack() {
      socket.emit("attack");
    },
    raw: socket,
  };
}

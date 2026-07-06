import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Thin wrapper around the socket.io connection. Callbacks are set once by
 * main.js; this module just centralizes the event names in one place.
 *
 * `character` (optional) is the { name, color, password } chosen on the
 * login screen; it's sent as socket.io auth payload so the server can verify
 * the account (see server/accountStore.js + the io.use() middleware in
 * server/index.js) instead of generating a random name/color for this
 * session. A bad password (or any other login rejection) surfaces to
 * `handlers.onConnectError` as a socket.io `connect_error` whose `.message`
 * is the human-readable reason the server gave.
 */
export function connectToServer(handlers, character) {
  const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    auth: character ? { name: character.name, color: character.color, password: character.password } : {},
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
  socket.on("itemPickedUp", (data) => handlers.onItemPickedUp?.(data));
  socket.on("pickupRespawned", (data) => handlers.onPickupRespawned?.(data));
  socket.on("inventoryUpdated", (data) => handlers.onInventoryUpdated?.(data));
  socket.on("playerEquipmentChanged", (data) => handlers.onPlayerEquipmentChanged?.(data));
  socket.on("playerXpGained", (data) => handlers.onPlayerXpGained?.(data));
  socket.on("playerLeveledUp", (data) => handlers.onPlayerLeveledUp?.(data));
  // Server-side anti-cheat (see server/index.js's MAX_MOVE_SPEED) rejected a
  // "move" this client sent as covering too much ground too fast -- either a
  // real speed/teleport hack, or (much more commonly) a bad lag spike. Either
  // way, the server's authoritative position comes along so the client can
  // snap back in sync instead of silently drifting.
  socket.on("moveRejected", (data) => handlers.onMoveRejected?.(data));

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
    sendEquip(itemId) {
      socket.emit("equipItem", itemId);
    },
    sendUnequip(slot) {
      socket.emit("unequipItem", slot);
    },
    raw: socket,
  };
}

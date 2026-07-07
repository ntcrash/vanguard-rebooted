import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Thin wrapper around the socket.io connection. Callbacks are set once by
 * main.js; this module just centralizes the event names in one place.
 *
 * `account` (optional) is the { name, password } chosen on the login screen;
 * it's sent as socket.io auth payload so the server can verify the account
 * (see server/accountStore.js + the io.use() middleware in server/index.js)
 * instead of generating a random name/color for this session. A bad
 * password (or any other login rejection) surfaces to
 * `handlers.onConnectError` as a socket.io `connect_error` whose `.message`
 * is the human-readable reason the server gave.
 *
 * Logging in no longer joins the world by itself — an account can own
 * several characters (server/characterStore.js), so the server replies with
 * "accountReady" (that account's character roster) and waits for this
 * client to call `selectCharacter()`/`createCharacter()` below before it
 * actually spawns a player and sends "init".
 */
export function connectToServer(handlers, account) {
  const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    auth: account ? { name: account.name, password: account.password } : {},
  });

  socket.on("connect", () => handlers.onConnect?.(socket.id));
  socket.on("disconnect", () => handlers.onDisconnect?.());
  socket.on("connect_error", (err) => handlers.onConnectError?.(err));

  // Multi-character accounts (server/characterStore.js): "accountReady"
  // carries this account's character roster right after login succeeds;
  // "characterActionRejected" answers a "selectCharacter"/"createCharacter"
  // request that the server refused (name taken, account already at the
  // character cap, unknown character, etc.).
  socket.on("accountReady", (data) => handlers.onAccountReady?.(data));
  socket.on("characterActionRejected", (data) => handlers.onCharacterActionRejected?.(data));

  socket.on("init", (data) => handlers.onInit?.(data));
  socket.on("playerJoined", (data) => handlers.onPlayerJoined?.(data));
  socket.on("playerMoved", (data) => handlers.onPlayerMoved?.(data));
  socket.on("playerLeft", (data) => handlers.onPlayerLeft?.(data));
  socket.on("chat", (data) => handlers.onChat?.(data));
  socket.on("playerAttacked", (data) => handlers.onPlayerAttacked?.(data));
  // Spell attacks (server/spells.js): "playerCastSpell" plays another
  // player's spell-cast glow (mirrors "playerAttacked"'s melee swing);
  // "spellRejected" is a personal notice (level-gate/cooldown/no-target) the
  // same way "partyNotice" is; "playerHealed" is a class spell's self-heal
  // (currently just the paladin's) landing, for both the caster's own HUD
  // and a floating heal number on whoever else might be watching.
  socket.on("playerCastSpell", (data) => handlers.onPlayerCastSpell?.(data));
  socket.on("spellRejected", (data) => handlers.onSpellRejected?.(data));
  socket.on("playerHealed", (data) => handlers.onPlayerHealed?.(data));
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
  // Simple quest system (server/quests.js): "questProgress" is sent only to
  // this player whenever one of their quests advances (or completes);
  // "questCompleted" is broadcast to everyone so it can post a chat line the
  // same way a level-up is announced.
  socket.on("questProgress", (data) => handlers.onQuestProgress?.(data));
  socket.on("questCompleted", (data) => handlers.onQuestCompleted?.(data));
  // Store NPC (server/store.js): "storePurchaseResult" answers this client's
  // own "buyStoreItem" request (ok, or a reason it was rejected -- too far,
  // can't afford it, wrong class's spellbook, already owned). Broadcast-free,
  // same personal-notice treatment "spellRejected"/"partyNotice" get.
  socket.on("storePurchaseResult", (data) => handlers.onStorePurchaseResult?.(data));
  // Parties (server/parties.js): "partyInviteReceived" is the only event this
  // client didn't ask for directly -- another player invited *us*, so it
  // needs its own accept/decline UI (see main.js's party invite popup).
  // "partyState" carries this party's current roster (sent to every member
  // whenever membership changes); "partyLeft"/"partyDisbanded" tell this
  // client specifically that it's no longer in a party (voluntarily vs. not);
  // "partyNotice" is a one-off informational message (invite sent/declined,
  // party full, etc.) meant to be shown the same way a chat system line is.
  socket.on("partyInviteReceived", (data) => handlers.onPartyInviteReceived?.(data));
  socket.on("partyState", (data) => handlers.onPartyState?.(data));
  socket.on("partyLeft", (data) => handlers.onPartyLeft?.(data));
  socket.on("partyDisbanded", (data) => handlers.onPartyDisbanded?.(data));
  socket.on("partyNotice", (data) => handlers.onPartyNotice?.(data));
  // Server-side anti-cheat (see server/index.js's MAX_MOVE_SPEED) rejected a
  // "move" this client sent as covering too much ground too fast -- either a
  // real speed/teleport hack, or (much more commonly) a bad lag spike. Either
  // way, the server's authoritative position comes along so the client can
  // snap back in sync instead of silently drifting.
  socket.on("moveRejected", (data) => handlers.onMoveRejected?.(data));
  // Proximity voice chat (server/voiceProximity.js + the "Proximity voice
  // chat" block in server/index.js): "voicePeerJoin"/"voicePeerLeave" tell
  // this client to start/stop a WebRTC peer connection with a specific
  // nearby player (see client/src/voice.js); "voiceSignal" carries that
  // peer's relayed SDP offer/answer/ICE candidate; "playerMicState" is a
  // purely cosmetic broadcast (like playerEquipmentChanged) so every
  // client's nameplate can show whether a player has their mic toggled on.
  socket.on("voicePeerJoin", (data) => handlers.onVoicePeerJoin?.(data));
  socket.on("voicePeerLeave", (data) => handlers.onVoicePeerLeave?.(data));
  socket.on("voiceSignal", (data) => handlers.onVoiceSignal?.(data));
  socket.on("playerMicState", (data) => handlers.onPlayerMicState?.(data));
  // Esc menu's explicit "Save Game" button: confirms the server persisted
  // this player's record right now, rather than waiting on the periodic
  // autosave/save-on-disconnect to eventually catch up.
  socket.on("saveComplete", (data) => handlers.onSaveComplete?.(data));

  return {
    // Multi-character accounts (server/characterStore.js): pick an existing
    // character off the roster "accountReady" sent, or create a brand new
    // one — exactly one of these is called once per connection, in response
    // to the character-select screen (client/src/characterSelect.js), and
    // the server answers with either "init" (joined) or
    // "characterActionRejected" (see above).
    selectCharacter(name) {
      socket.emit("selectCharacter", { name });
    },
    createCharacter({ name, color, characterClass }) {
      socket.emit("createCharacter", { name, color, characterClass });
    },
    sendMove(x, y, z, rotY) {
      socket.emit("move", { x, y, z, rotY });
    },
    sendChat(text) {
      socket.emit("chat", text);
    },
    sendAttack(targetMobId) {
      socket.emit("attack", targetMobId ? { targetMobId } : undefined);
    },
    sendSpellCast(targetMobId) {
      socket.emit("castSpell", targetMobId ? { targetMobId } : undefined);
    },
    sendEquip(itemId) {
      socket.emit("equipItem", itemId);
    },
    sendUnequip(slot) {
      socket.emit("unequipItem", slot);
    },
    sendPartyInvite(targetName) {
      socket.emit("partyInvite", targetName);
    },
    respondPartyInvite(accept) {
      socket.emit("partyRespond", { accept });
    },
    leaveParty() {
      socket.emit("partyLeave");
    },
    disbandParty() {
      socket.emit("partyDisband");
    },
    sendVoiceSignal(targetId, data) {
      socket.emit("voiceSignal", { targetId, data });
    },
    sendMicState(on) {
      socket.emit("voiceMicState", !!on);
    },
    requestSave() {
      socket.emit("requestSave");
    },
    buyStoreItem(itemId) {
      socket.emit("buyStoreItem", itemId);
    },
    raw: socket,
  };
}

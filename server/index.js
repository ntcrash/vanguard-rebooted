// Vanguard Rebooted — realtime multiplayer server
// Tracks connected players and broadcasts position + chat updates over Socket.io.

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { loadPlayerRecord, savePlayerRecord, savePlayerRecords } from "./playerStore.js";
import { resolveLogin } from "./accountStore.js";
import { QUEST_DEFS, initQuestState, advanceKillQuests, advanceCollectQuests } from "./quests.js";
import { CHARACTER_CLASSES, DEFAULT_CLASS_ID, sanitizeClassId, classMaxHp, classDamage } from "./classes.js";
import { PARTY_MAX_SIZE, createParty, isPartyFull, isPartyMember, isPartyLeader, addPartyMember, removePartyMember } from "./parties.js";
import { computeVoicePairs, diffVoicePairs, splitPairKey } from "./voiceProximity.js";
import {
  acquireAggro,
  dropAggro,
  shouldDropAggro,
  stepToward,
  canMobAttack,
  MOB_CHASE_SPEED,
  MOB_AGGRO_ATTACK_INTERVAL_MS,
} from "./mobAI.js";

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
const AUTOSAVE_INTERVAL_MS = 60000; // periodic safety-net save of every connected player,
// on top of the save-on-disconnect below, in case the process crashes/restarts uncleanly

// ---- Anti-cheat: server-side movement validation --------------------------------
// The client moves at up to `moveSpeed` (7 units/sec, see client/src/main.js)
// times SPRINT_MULTIPLIER (1.8x) while sprinting -- 12.6 units/sec at most
// under normal play. Before this, the "move" handler below just clamped
// whatever (x, z) a client sent to WORLD_BOUNDS and broadcast it as fact, so
// a modified client could teleport anywhere (or move arbitrarily fast every
// tick) and every other player would see it as real. MAX_MOVE_SPEED mirrors
// that legitimate top speed; MOVE_SPEED_TOLERANCE pads it generously to
// absorb network jitter/latency spikes and frame-time variance without
// flagging normal play, while still catching a hack that covers noticeably
// more ground than any legitimate input could. MIN_MOVE_INTERVAL_SEC floors
// the elapsed-time window at the client's own ~20Hz move-send cap
// (client/src/main.js's maybeSendMove()), so two moves arriving suspiciously
// close together (or with a bogus/duplicate timestamp) can't be used to
// shrink the allowed-distance budget toward zero.
const MAX_MOVE_SPEED = 7 * 1.8; // matches moveSpeed * SPRINT_MULTIPLIER in client/src/main.js
const MOVE_SPEED_TOLERANCE = 1.5; // 50% buffer for latency/jitter, not a cheat allowance
const MIN_MOVE_INTERVAL_SEC = 0.05; // matches the client's ~20Hz move-send cap

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

    // A "collect" quest (see server/quests.js) tracking this item id advances
    // by the stack's qty, same as the inventory it's simultaneously landing in.
    const affectedQuests = advanceCollectQuests(player.quests, pickup.itemId, pickup.qty);
    for (const questId of affectedQuests) {
      emitQuestProgress(player, questId);
      if (player.quests[questId].completed) grantQuestReward(player, questId);
    }
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
      // Aggro state (see server/mobAI.js) — null/0 means "passively wandering".
      // Set by acquireAggro() when a player lands a hit, cleared by
      // dropAggro() once the mob gives up the chase or either side dies.
      aggroTargetId: null,
      nextAttackAt: 0,
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
  dropAggro(mob); // a revived mob starts passive again, not still hunting whoever killed it
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
  // The respawn teleport is legitimate (server-initiated, not client input),
  // so reset the anti-cheat clock here too -- otherwise the player's first
  // post-respawn "move" would be measured against the time they died, not
  // the time they respawned, and could get incorrectly flagged.
  player.lastMoveAt = Date.now();
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

/** Applies a mob's attack (reusing MOB_COUNTER_DAMAGE, the same per-hit
 * amount the old "counter-attack" chance used) to `target`, handling
 * death/respawn the same way. Called both by the immediate-counter chance
 * below and by an aggroed mob's chase-and-strike tick. */
function strikePlayer(mob, target) {
  if (!target.alive) return;
  target.hp = Math.max(0, target.hp - MOB_COUNTER_DAMAGE);
  if (target.hp <= 0) {
    target.alive = false;
    dropAggro(mob); // nothing left to chase once its target is down
    io.emit("playerDied", { id: target.id, name: target.name, killedBy: mob.name });
    setTimeout(() => respawnPlayer(target), PLAYER_RESPAWN_MS);
  } else {
    io.emit("playerDamaged", { id: target.id, hp: target.hp });
  }
}

function tickMobs() {
  const now = Date.now();

  for (const mob of mobs.values()) {
    if (!mob.alive) continue;

    // A mob that's been struck chases its attacker instead of wandering
    // (see server/mobAI.js) until it gives up, at which point it falls
    // through to the normal wander logic below this run.
    if (mob.aggroTargetId) {
      const target = players.get(mob.aggroTargetId);
      if (shouldDropAggro(mob, target)) {
        dropAggro(mob);
      } else {
        const step = stepToward(mob.x, mob.z, target.x, target.z, MOB_CHASE_SPEED, MOB_TICK_MS / 1000);
        mob.x = step.x;
        mob.z = step.z;
        mob.rotY = step.rotY;

        const dist = Math.hypot(target.x - mob.x, target.z - mob.z);
        if (dist <= MOB_ATTACK_RANGE && canMobAttack(mob, now)) {
          mob.nextAttackAt = now + MOB_AGGRO_ATTACK_INTERVAL_MS;
          strikePlayer(mob, target);
        }
        continue; // aggro'd mobs skip the wander step entirely this tick
      }
    }

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

// Allowed browser origin(s) for the Socket.io handshake. Defaults to "*" for
// local development (any origin, including file:// or a different port), but
// a real deployment should set CORS_ORIGIN to the client's actual origin
// (e.g. "https://play.example.com") so a page on some other domain can't open
// a socket against this server. Comma-separate multiple origins, e.g.
// "https://play.example.com,https://staging.example.com" — see DEPLOYMENT.md.
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : "*";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN },
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

// ---- Simple quest system -----------------------------------------------------
// Quest *definitions* (name/description/targets/rewards) and the pure
// progress-tracking math live in server/quests.js so they can be unit-tested
// without booting the socket.io server; the two helpers below are the side-
// effecting glue that actually notifies clients and grants rewards, so they
// stay here alongside awardXp()/addItemToInventory() which they call into.

/** Tells just `player`'s own client how a quest's progress changed (the
 * quest log is personal, not broadcast — see client/src/main.js's
 * renderQuestLog()). */
function emitQuestProgress(player, questId) {
  const q = player.quests[questId];
  const def = QUEST_DEFS[questId];
  io.to(player.id).emit("questProgress", {
    id: questId,
    progress: q.progress,
    count: def.count,
    completed: q.completed,
  });
}

/** Grants a completed quest's XP + item rewards (reusing the same
 * awardXp()/addItemToInventory() a mob kill or item pickup would use) and
 * broadcasts a "questCompleted" event so everyone's chat log shows it, the
 * same way a level-up is announced to the whole world. Called exactly once
 * per quest per player, right when advanceKillQuests()/advanceCollectQuests()
 * report it just flipped to completed. */
function grantQuestReward(player, questId) {
  const def = QUEST_DEFS[questId];
  if (def.rewardXp) awardXp(player, def.rewardXp);
  for (const item of def.rewardItems || []) {
    addItemToInventory(player, item.itemId, item.qty);
  }
  io.to(player.id).emit("inventoryUpdated", { inventory: player.inventory });
  io.emit("questCompleted", { id: player.id, name: player.name, questId, questName: def.name });
}

/** @type {Map<string, {id: string, name: string, color: string, x: number, y: number, z: number, rotY: number}>} */
const players = new Map();

// Guest name/color generators are gone now that a real account is required
// to join (see the io.use() login middleware above) — randomColor() below is
// kept only as the cosmetic fallback when a valid account logs in without
// picking a color (e.g. an older/malformed client), not for guest identities.
function randomColor() {
  return `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- Parties (grouping) --------------------------------------------------------
// Lightweight party/group system: a handful of players banding together so
// they can see each other's status at a glance. Deliberately NOT persisted
// (see server/parties.js's file comment) — parties live only in memory for
// as long as their members are actually online, same tradeoff already made
// for the in-memory `mobs`/`pickups` state above.
//
// `parties`: partyId -> party object ({ id, leaderId, memberIds }), the pure
// shape maintained by server/parties.js.
// `playerPartyId`: player (socket) id -> the partyId they currently belong
// to, for O(1) "what party is this player in" lookups without scanning every
// party's memberIds.
// `pendingPartyInvites`: invitee (socket) id -> { inviterId, inviterName },
// at most one outstanding invite per player — a second invite simply
// overwrites the first, same as a player only ever having one thing to
// respond to at a time.
/** @type {Map<string, {id: string, leaderId: string, memberIds: string[]}>} */
const parties = new Map();
/** @type {Map<string, string>} */
const playerPartyId = new Map();
/** @type {Map<string, {inviterId: string, inviterName: string}>} */
const pendingPartyInvites = new Map();

/** Builds the roster (name + leader flag) `partyState` sends to every member
 * of `party` — deliberately excludes hp/level/position, since every client
 * already tracks that for every other connected player via the existing
 * playerMoved/playerDamaged/playerLeveledUp broadcasts; the party panel just
 * cross-references this roster's ids against that already-tracked state
 * instead of the server duplicating it here. */
function partyRoster(party) {
  return party.memberIds
    .map((id) => players.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, isLeader: p.id === party.leaderId }));
}

/** Sends every current member of `partyId` the party's current roster. */
function broadcastPartyState(partyId) {
  const party = parties.get(partyId);
  if (!party) return;
  const roster = partyRoster(party);
  for (const memberId of party.memberIds) {
    io.to(memberId).emit("partyState", { partyId: party.id, roster });
  }
}

/** Fully disbands `partyId`, telling every member (including whoever is left
 * after a leave dropped the party below 2 members — see the "leaving a
 * 1-member party" note in the `partyLeave` handler) that it's gone. */
function disbandParty(partyId, reason) {
  const party = parties.get(partyId);
  if (!party) return;
  for (const memberId of party.memberIds) {
    playerPartyId.delete(memberId);
    io.to(memberId).emit("partyDisbanded", { reason });
  }
  parties.delete(partyId);
}

/** Removes `playerId` from whatever party they're in (if any), used by both
 * the explicit `partyLeave` socket event and the `disconnect` handler below.
 * A party that would be left with exactly one member is disbanded outright
 * rather than left sitting around as a "party of one" — there's no one left
 * to group with, so the panel would just show a single-row roster with no
 * useful actions beyond what solo play already offers. */
function removePlayerFromParty(playerId) {
  const partyId = playerPartyId.get(playerId);
  if (!partyId) return;
  const party = parties.get(partyId);
  playerPartyId.delete(playerId);
  if (!party) return;

  const updated = removePartyMember(party, playerId);
  if (!updated) {
    parties.delete(partyId); // last member left; nothing more to do
    return;
  }

  parties.set(partyId, updated);
  if (updated.memberIds.length <= 1) {
    disbandParty(partyId, "not enough members left");
    return;
  }

  broadcastPartyState(partyId);
}

// ---- Proximity voice chat --------------------------------------------------------
// Server-brokered WebRTC signaling: rather than every client connecting to
// every other client's audio, a periodic tick (mirrors tickMobs' polling
// posture) recomputes which *pairs* of alive players are within
// VOICE_PROXIMITY_RANGE of each other (server/voiceProximity.js's pure
// pairing math) and tells only those specific pairs to open a peer
// connection ("voicePeerJoin") or tear one down ("voicePeerLeave"). The
// server itself never touches audio -- it only relays each pair's SDP
// offer/answer/ICE candidates via "voiceSignal", the same "dumb relay"
// posture used for every other client-to-client interaction in this game
// (e.g. attacks, chat) being mediated through server-authoritative state.
const VOICE_TICK_MS = 1000; // proximity doesn't need mob-tick (200ms) responsiveness
/** @type {Set<string>} pairKey()s (see voiceProximity.js) currently "in call" */
let voicePairs = new Set();

function tickVoiceProximity() {
  const nextPairs = computeVoicePairs(players.values());
  const { joined, left } = diffVoicePairs(voicePairs, nextPairs);

  for (const key of joined) {
    const [idA, idB] = splitPairKey(key);
    // Exactly one side is told to `initiate` the WebRTC offer -- otherwise
    // both sides would independently create an offer for the same pair.
    // Lexicographic comparison of socket ids is an arbitrary but stable,
    // collision-free tiebreak (no shared clock/counter needed).
    const initiatorId = idA < idB ? idA : idB;
    const otherId = idA < idB ? idB : idA;
    io.to(initiatorId).emit("voicePeerJoin", { peerId: otherId, initiate: true });
    io.to(otherId).emit("voicePeerJoin", { peerId: initiatorId, initiate: false });
  }

  for (const key of left) {
    const [idA, idB] = splitPairKey(key);
    io.to(idA).emit("voicePeerLeave", { peerId: idB });
    io.to(idB).emit("voicePeerLeave", { peerId: idA });
  }

  voicePairs = nextPairs;
}

/** Immediately drops every voice pair involving `playerId` (called on
 * disconnect, rather than waiting for the next tick to notice the player is
 * gone) and tells the remaining side of each such pair to tear its peer
 * connection down right away. */
function dropVoicePairsFor(playerId) {
  for (const key of Array.from(voicePairs)) {
    const [idA, idB] = splitPairKey(key);
    if (idA !== playerId && idB !== playerId) continue;
    voicePairs.delete(key);
    const otherId = idA === playerId ? idB : idA;
    io.to(otherId).emit("voicePeerLeave", { peerId: playerId });
  }
}

// ---- Persistence ----------------------------------------------------------------
// Player progress is saved keyed by the account's display-cased name (now
// verified by accountStore.js's login middleware, see io.use() above) — the
// name still doubles as the playerStore.js save-slot key, but it's no longer
// a free-for-all: a save can now only be reached by whoever knows that
// account's password. See server/playerStore.js for the on-disk format.
/** Extracts the subset of a live player object worth persisting across
 * sessions (position, HP/level/XP, inventory, equipment) — deliberately
 * excludes transient/derived fields like `id`, `alive`, and `lastAttackAt`. */
function playerSaveRecord(player) {
  return {
    characterClass: player.characterClass,
    level: player.level,
    xp: player.xp,
    xpToNext: player.xpToNext,
    maxHp: player.maxHp,
    hp: player.hp,
    inventory: player.inventory,
    equipment: player.equipment,
    quests: player.quests,
    x: player.x,
    y: player.y,
    z: player.z,
    rotY: player.rotY,
    savedAt: Date.now(),
  };
}

/** Safety-net autosave of every currently connected player, run on a timer in
 * addition to the save-on-disconnect in the connection handler below — so a
 * server crash or hard restart loses at most AUTOSAVE_INTERVAL_MS of
 * progress instead of an entire session's worth. */
function autosaveConnectedPlayers() {
  const entries = Array.from(players.values()).map((p) => ({ name: p.name, record: playerSaveRecord(p) }));
  savePlayerRecords(entries);
}

// ---- Account / login (name+password chosen on the client's login screen) ------
// Replaces the old "random guest name each session" flow: a player now
// chooses a username + password on the login screen. The *first* time a
// username is used it becomes that player's account (auto-registration, so
// there's still just one login screen rather than separate signup/login
// screens); every time after that the password must match, via
// accountStore.js's resolveLogin(). This is what actually stops one player
// from hijacking another's save just by typing in their name, which the old
// name-only scheme allowed.
const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,20}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_PATTERN = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 64;

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

/** Returns `raw` if it's a plausible password (length-bounded only — no
 * character-set restriction beyond what socket.io/JSON already require), or
 * null if missing/too short/too long. */
function sanitizePassword(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length < PASSWORD_MIN_LENGTH || raw.length > PASSWORD_MAX_LENGTH) return null;
  return raw;
}

// Socket.io connection middleware: runs before the "connection" event below
// and can reject the handshake outright (client sees it as "connect_error"
// with our message) — this is what makes login actually block entry into
// the world on a bad password, rather than just silently falling back to a
// guest identity the way the old flow did.
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const name = sanitizeChosenName(auth.name);
  if (!name) {
    return next(new Error("Enter a name: 1-20 characters (letters, numbers, spaces, - or _)."));
  }
  const password = sanitizePassword(auth.password);
  if (!password) {
    return next(new Error(`Enter a password (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters).`));
  }

  const result = resolveLogin(name, password);
  if (!result.ok) {
    return next(new Error("Incorrect password for that name."));
  }

  // Stash the resolved (display-cased) account name for the "connection"
  // handler below — socket.data persists across the middleware -> connection
  // handoff for the same socket.
  socket.data.accountName = result.name;
  socket.data.newAccount = !!result.created;
  next();
});

io.on("connection", (socket) => {
  // Username/color chosen on the client's login screen (see
  // client/src/characterCreate.js) — the username is already verified
  // against accountStore.js by the io.use() middleware above by this point,
  // so it's always a legitimate account name, never a random guest id.
  const auth = socket.handshake.auth || {};
  const chosenName = socket.data.accountName;
  const saved = loadPlayerRecord(chosenName);

  // Class is chosen once, the first time an account is created, and then
  // locked in forever after (see server/classes.js) — a returning player's
  // saved class always wins over whatever the client's auth payload sends,
  // the same way their name/password can't be changed by just typing
  // something different on the login screen. A saved record predating this
  // feature (no characterClass field yet) falls back to whatever the client
  // requested (or DEFAULT_CLASS_ID) rather than losing its already-saved HP.
  const requestedClass = sanitizeClassId(auth.characterClass) || DEFAULT_CLASS_ID;
  const characterClass = (saved && sanitizeClassId(saved.characterClass)) || requestedClass;
  const baseMaxHp = classMaxHp(characterClass, 100);

  const player = {
    id: socket.id,
    name: chosenName,
    color: sanitizeChosenColor(auth.color) || randomColor(),
    characterClass,
    x: (Math.random() - 0.5) * 20,
    y: 0,
    z: (Math.random() - 0.5) * 20,
    rotY: 0,
    hp: baseMaxHp,
    maxHp: baseMaxHp,
    alive: true,
    lastAttackAt: 0,
    lastMoveAt: Date.now(), // anti-cheat clock -- see MAX_MOVE_SPEED above
    level: 1,
    xp: 0,
    xpToNext: xpToNextLevel(1),
    inventory: [],
    // Equippable gear currently worn, one item id (or null) per slot. Drives
    // the visible character model on every client via "playerEquipmentChanged".
    equipment: { weapon: null, head: null, body: null },
    // Per-quest { progress, completed } state, one entry per server/quests.js
    // QUEST_DEFS id — overwritten just below once `saved` is known, so a
    // returning player's actual progress (not a blank slate) is used.
    quests: initQuestState(null),
    // Proximity voice chat (see "Proximity voice chat" above) -- purely a UI
    // hint broadcast to everyone (like an equipment change) so a nearby
    // player's nameplate can show a mic icon; never persisted, never
    // affects who's actually WebRTC-paired (that's voicePairs, driven
    // entirely by position).
    micOn: false,
  };

  if (saved) {
    // Returning player (matched by chosen name) — restore their progress
    // instead of starting fresh. Always join alive at a valid HP regardless
    // of what was saved (e.g. mid-respawn-timer when they disconnected), and
    // clamp position in case WORLD_BOUNDS has shrunk since they last saved.
    player.level = typeof saved.level === "number" ? saved.level : player.level;
    player.xp = typeof saved.xp === "number" ? saved.xp : player.xp;
    player.xpToNext = typeof saved.xpToNext === "number" ? saved.xpToNext : xpToNextLevel(player.level);
    player.maxHp = typeof saved.maxHp === "number" ? saved.maxHp : player.maxHp;
    player.hp = clamp(typeof saved.hp === "number" ? saved.hp : player.maxHp, 1, player.maxHp);
    player.inventory = Array.isArray(saved.inventory) ? saved.inventory : player.inventory;
    player.equipment = saved.equipment && typeof saved.equipment === "object"
      ? { weapon: null, head: null, body: null, ...saved.equipment }
      : player.equipment;
    if (typeof saved.x === "number") player.x = clamp(saved.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    if (typeof saved.z === "number") player.z = clamp(saved.z, -WORLD_BOUNDS, WORLD_BOUNDS);
    if (typeof saved.rotY === "number") player.rotY = saved.rotY;
    // initQuestState() overlays saved.quests onto a fresh state built from
    // the current QUEST_DEFS, so a quest added after this player last saved
    // still shows up (at 0 progress) instead of being missing entirely.
    player.quests = initQuestState(saved.quests);
    console.log(`[restore] ${player.name} restored (level ${player.level}, ${player.inventory.length} item stack(s))`);
  } else {
    // First time we've seen this name — starter kit so the inventory panel
    // has something to show before item pickups (a later roadmap item)
    // exist in the world.
    addItemToInventory(player, "rusty-sword", 1);
    addItemToInventory(player, "health-draught", 3);
  }
  players.set(socket.id, player);

  if (socket.data.newAccount) {
    console.log(`[account] new account created: ${player.name}`);
  }
  console.log(`[join] ${player.name} (${socket.id}) — ${players.size} online`);

  // Send the new player their own info + the current world state. Includes
  // `newAccount` so the client can show a one-time "account created" hint
  // rather than making a returning player think they created a fresh account
  // every login.
  socket.emit("init", {
    id: socket.id,
    self: player,
    newAccount: !!socket.data.newAccount,
    players: Array.from(players.values()),
    mobs: mobsSnapshot(),
    pickups: pickupsSnapshot(),
    // Static quest definitions (name/description/target count) — sent once
    // here rather than on every progress update, since they never change per
    // player. player.quests (part of `self` above) carries this player's
    // actual per-quest progress against them.
    questDefs: QUEST_DEFS,
  });

  // Tell everyone else a new player arrived.
  socket.broadcast.emit("playerJoined", player);

  socket.on("move", (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || typeof data !== "object" || data === null) return;
    const { x, y, z, rotY } = data;
    if ([x, y, z, rotY].some((v) => typeof v !== "number" || !Number.isFinite(v))) return;

    const targetX = clamp(x, -WORLD_BOUNDS, WORLD_BOUNDS);
    const targetZ = clamp(z, -WORLD_BOUNDS, WORLD_BOUNDS);

    // Anti-cheat: reject a move that covers more ground than the fastest
    // legitimate client (sprinting, plus a generous latency/jitter buffer)
    // could have covered since its last accepted move. This catches both a
    // sustained speed hack (every move a bit too far) and a one-shot
    // teleport hack (one move way too far) with the same check. A rejected
    // move is simply dropped -- p.x/p.z/p.lastMoveAt are left untouched --
    // and the offending socket is told the server's actual position so its
    // client can resync instead of drifting further out of sync with every
    // subsequent (also-rejected) move it sends.
    const now = Date.now();
    const elapsedSec = Math.max((now - p.lastMoveAt) / 1000, MIN_MOVE_INTERVAL_SEC);
    const maxDist = MAX_MOVE_SPEED * MOVE_SPEED_TOLERANCE * elapsedSec;
    const dist = Math.hypot(targetX - p.x, targetZ - p.z);

    if (dist > maxDist) {
      console.warn(
        `[anticheat] rejected move from ${p.name}: ${dist.toFixed(1)} units in ${elapsedSec.toFixed(2)}s (max ${maxDist.toFixed(1)})`
      );
      socket.emit("moveRejected", { x: p.x, y: p.y, z: p.z, rotY: p.rotY });
      return;
    }

    p.x = targetX;
    p.y = y;
    p.z = targetZ;
    p.rotY = rotY;
    p.lastMoveAt = now;

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

    // Outgoing melee damage is nudged by the attacker's class (see
    // server/classes.js) — MOB_DAMAGE is the shared per-hit baseline every
    // class's damageMultiplier scales from, same idea as classMaxHp() below
    // scaling the shared 100 baseMaxHp.
    mob.hp = Math.max(0, mob.hp - classDamage(p.characterClass, MOB_DAMAGE));
    if (mob.hp <= 0) {
      mob.alive = false;
      io.emit("mobDied", { id: mob.id, name: mob.name, killedBy: p.name });
      setTimeout(() => respawnMob(mob), MOB_RESPAWN_MS);
      awardXp(p, MOB_XP_REWARD);

      // A "kill" quest (see server/quests.js) tracking this mob's name
      // advances by one defeat.
      const affectedQuests = advanceKillQuests(p.quests, mob.name);
      for (const questId of affectedQuests) {
        emitQuestProgress(p, questId);
        if (p.quests[questId].completed) grantQuestReward(p, questId);
      }
      return;
    }

    io.emit("mobDamaged", { id: mob.id, hp: mob.hp });

    // Being struck reliably turns the mob hostile toward its attacker (see
    // server/mobAI.js) — it will now chase and periodically strike back
    // every tick (tickMobs' aggro branch above) until it dies, the player
    // dies, or the player flees beyond leash range of the mob's home, at
    // which point it gives up and resumes wandering. This is on top of —
    // not instead of — the immediate gore-back chance just below, so melee
    // has risk from the very first hit, not just once the mob catches up.
    acquireAggro(mob, p.id, now);

    if (p.alive && Math.random() < MOB_COUNTER_CHANCE) {
      strikePlayer(mob, p);
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

  // ---- Parties (grouping) -------------------------------------------------
  // See the "Parties (grouping)" block above for the in-memory storage and
  // server/parties.js for the pure membership math this all wraps. Every
  // handler below silently no-ops on an invalid/stale request (e.g. a
  // double-click, or an invite whose target already left) rather than
  // treating it as an error worth disconnecting over — same posture as the
  // existing equipItem/unequipItem handlers just above.
  socket.on("partyInvite", (targetName) => {
    const inviter = players.get(socket.id);
    if (!inviter || typeof targetName !== "string") return;

    const target = Array.from(players.values()).find(
      (p) => p.id !== inviter.id && p.name.toLowerCase() === targetName.trim().toLowerCase()
    );
    if (!target) {
      socket.emit("partyNotice", { message: `No online player named "${targetName}".` });
      return;
    }
    if (playerPartyId.has(target.id)) {
      socket.emit("partyNotice", { message: `${target.name} is already in a party.` });
      return;
    }

    const inviterPartyId = playerPartyId.get(inviter.id);
    if (inviterPartyId) {
      const inviterParty = parties.get(inviterPartyId);
      if (!isPartyLeader(inviterParty, inviter.id)) {
        socket.emit("partyNotice", { message: "Only the party leader can invite new members." });
        return;
      }
      if (isPartyFull(inviterParty)) {
        socket.emit("partyNotice", { message: `Your party is full (max ${PARTY_MAX_SIZE}).` });
        return;
      }
    }

    // At most one outstanding invite per invitee -- a second invite (from
    // this or any other player) simply overwrites the first.
    pendingPartyInvites.set(target.id, { inviterId: inviter.id, inviterName: inviter.name });
    io.to(target.id).emit("partyInviteReceived", { inviterId: inviter.id, inviterName: inviter.name });
    socket.emit("partyNotice", { message: `Party invite sent to ${target.name}.` });
  });

  socket.on("partyRespond", (data) => {
    const invitee = players.get(socket.id);
    const invite = pendingPartyInvites.get(socket.id);
    pendingPartyInvites.delete(socket.id); // consumed either way
    if (!invitee || !invite) return;

    const accept = !!(data && data.accept);
    const inviter = players.get(invite.inviterId);

    if (!accept) {
      if (inviter) io.to(inviter.id).emit("partyNotice", { message: `${invitee.name} declined your party invite.` });
      return;
    }
    if (!inviter) {
      socket.emit("partyNotice", { message: "That invite is no longer valid." });
      return;
    }
    if (playerPartyId.has(invitee.id)) return; // joined/created another party in the meantime

    // The inviter might not have a party yet (this is their first invite) --
    // create one, led by them, on the fly.
    let partyId = playerPartyId.get(inviter.id);
    let party = partyId ? parties.get(partyId) : null;
    if (!party) {
      party = createParty(inviter.id);
      parties.set(party.id, party);
      playerPartyId.set(inviter.id, party.id);
    }

    if (isPartyFull(party)) {
      socket.emit("partyNotice", { message: "That party is now full." });
      return;
    }

    const updated = addPartyMember(party, invitee.id);
    parties.set(updated.id, updated);
    playerPartyId.set(invitee.id, updated.id);
    broadcastPartyState(updated.id);
    io.to(inviter.id).emit("partyNotice", { message: `${invitee.name} joined the party.` });
  });

  socket.on("partyLeave", () => {
    if (!playerPartyId.has(socket.id)) return;
    removePlayerFromParty(socket.id);
    socket.emit("partyLeft", {});
  });

  socket.on("partyDisband", () => {
    const partyId = playerPartyId.get(socket.id);
    if (!partyId) return;
    const party = parties.get(partyId);
    if (!party || !isPartyLeader(party, socket.id)) return;
    disbandParty(partyId, "the leader disbanded the party");
  });

  // ---- Proximity voice chat ------------------------------------------------
  // Relay-only: the server never inspects SDP/ICE contents, it just forwards
  // `data` to `targetId` with the sender's id attached. Restricted to pairs
  // the proximity tick above has actually paired up (voicePairs) so a
  // modified client can't use this as a generic "send arbitrary data to any
  // socket id" relay -- same defense-in-depth posture as the attack handler
  // re-validating range server-side instead of trusting the client's claim.
  socket.on("voiceSignal", (data) => {
    const p = players.get(socket.id);
    if (!p || typeof data !== "object" || data === null) return;
    const { targetId, data: payload } = data;
    if (typeof targetId !== "string" || !players.has(targetId)) return;

    const idA = socket.id < targetId ? socket.id : targetId;
    const idB = socket.id < targetId ? targetId : socket.id;
    if (!voicePairs.has(`${idA}|${idB}`)) return; // not currently a valid pair -- drop it

    io.to(targetId).emit("voiceSignal", { fromId: socket.id, data: payload });
  });

  // Broadcast (not just to paired peers) since this is purely cosmetic
  // nameplate UI, the same posture as playerEquipmentChanged -- far cheaper
  // than tracking exactly who's currently paired with whom on the client.
  socket.on("voiceMicState", (on) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.micOn = !!on;
    io.emit("playerMicState", { id: p.id, micOn: p.micOn });
  });

  // Explicit "Save Game" from the client's Esc menu -- distinct from the
  // periodic autosave/save-on-disconnect above, this is a player-initiated
  // save they can trigger any time and get immediate confirmation for
  // ("saveComplete"), rather than trusting an invisible background timer.
  socket.on("requestSave", () => {
    const p = players.get(socket.id);
    if (!p) return;
    savePlayerRecord(p.name, playerSaveRecord(p));
    socket.emit("saveComplete", { savedAt: Date.now() });
  });

  socket.on("chat", (message) => {
    const p = players.get(socket.id);
    if (!p || typeof message !== "string") return;
    const text = message.slice(0, 240).trim();
    if (!text) return;
    io.emit("chat", { id: socket.id, name: p.name, text, at: Date.now() });
  });

  socket.on("disconnect", () => {
    savePlayerRecord(player.name, playerSaveRecord(player));
    removePlayerFromParty(socket.id);
    pendingPartyInvites.delete(socket.id);
    dropVoicePairsFor(socket.id);
    players.delete(socket.id);
    io.emit("playerLeft", { id: socket.id });
    console.log(`[leave] ${player.name} (${socket.id}) — ${players.size} online`);
  });
});

spawnMobs();
spawnPickups();
setInterval(tickMobs, MOB_TICK_MS);
setInterval(autosaveConnectedPlayers, AUTOSAVE_INTERVAL_MS);
setInterval(tickVoiceProximity, VOICE_TICK_MS);

httpServer.listen(PORT, () => {
  console.log(`Vanguard Rebooted server listening on http://localhost:${PORT}`);
});

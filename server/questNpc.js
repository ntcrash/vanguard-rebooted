// Vanguard Rebooted — quest NPC
//
// A stationary quest giver (QUEST_NPC_POSITION below, rendered client-side
// by client/src/questNpc.js) that gives the existing auto-tracked quests
// (server/quests.js) a physical presence in the world instead of only
// living inside the "L" quest-log panel. Walking up and interacting (see
// client/src/main.js's updateQuestNpcToggle) opens a "quest board" panel
// listing the same QUEST_DEFS + this player's own per-quest progress the
// quest log already tracks -- kept in its own pure module, mirroring
// store.js's stationary-merchant pattern, so the proximity math is
// unit-testable without booting the socket.io server.
//
// Unlike the store NPC, this NPC has no purchase/side-effecting step of its
// own: quests still auto-advance on kill/collect and auto-grant their
// reward the instant they complete (server/quests.js + index.js's
// grantQuestReward), regardless of whether a player has ever talked to this
// NPC. Redesigning that into a real accept/turn-in flow would be a bigger
// change than a single roadmap item warrants -- this NPC is a lore/UX
// anchor for the quest system that already exists, not a gate on it.

export const QUEST_NPC_NAME = "Elder Maren";
// Placed a short walk from the world origin spawn area, clear of every
// PICKUP_SPAWNS/MOB_SPAWNS entry in index.js and of the store NPC
// (server/store.js's STORE_NPC_POSITION at (12, -12)) so the two NPCs don't
// visually overlap.
export const QUEST_NPC_POSITION = { x: -12, z: 12 };
export const QUEST_NPC_INTERACT_RANGE = 4;

/** Whether a player standing at (x, z) is close enough to the quest NPC to
 * talk to them -- mirrors server/store.js's isNearStore(). Not currently
 * used to gate any server-authoritative action (quests auto-track/auto-
 * grant regardless of NPC proximity, see the module comment above), but
 * kept here, pure and exported, for parity with store.js and in case a
 * future roadmap item wants the NPC to gate something (e.g. a manual
 * quest-accept step). */
export function isNearQuestNpc(x, z) {
  return Math.hypot(x - QUEST_NPC_POSITION.x, z - QUEST_NPC_POSITION.z) <= QUEST_NPC_INTERACT_RANGE;
}

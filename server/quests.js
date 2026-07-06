// Vanguard Rebooted — simple quest system
//
// Server-authoritative quest definitions plus pure progress-tracking
// helpers, kept in their own module (mirroring accountStore.js/
// playerStore.js) so the progress math can be unit-tested without booting
// the socket.io server. index.js owns all the side effects (granting XP/
// items, emitting socket events, persistence) — this module only tracks
// "how far along is each quest" as plain data.

export const QUEST_DEFS = {
  "boar-cull": {
    id: "boar-cull",
    name: "Boar Cull",
    description: "Defeat 5 boars in the Meadow.",
    type: "kill",
    // Must match the `name` field of the Meadow's MOB_SPAWNS entries in index.js.
    targets: ["Boar", "Wild Boar", "Tusked Boar", "Razorback", "Boar Sow", "Mud Boar"],
    count: 5,
    rewardXp: 100,
    rewardItems: [{ itemId: "gold-coin", qty: 5 }],
  },
  "wolf-hunter": {
    id: "wolf-hunter",
    name: "Wolf Hunter",
    description: "Defeat 3 wolves in the Whispering Forest.",
    type: "kill",
    // Must match the `name` field of the Whispering Forest's MOB_SPAWNS entries.
    targets: ["Grey Wolf", "Timber Wolf", "Dire Wolf", "Lone Wolf", "Alpha Wolf"],
    count: 3,
    rewardXp: 150,
    rewardItems: [{ itemId: "gold-coin", qty: 8 }],
  },
  "moonpetal-gathering": {
    id: "moonpetal-gathering",
    name: "Moonpetal Gathering",
    description: "Collect 3 Moonpetals in the Whispering Forest.",
    type: "collect",
    // Must match an ITEM_DEFS key in index.js.
    targets: ["moonpetal"],
    count: 3,
    rewardXp: 80,
    rewardItems: [{ itemId: "health-draught", qty: 3 }],
  },
};

// Stable iteration order for QUEST_DEFS, since Object.entries() order isn't
// guaranteed to be meaningful once quests are added/removed over time.
export const QUEST_ORDER = Object.keys(QUEST_DEFS);

/** Builds a fresh per-player quest-progress object — one
 * `{ progress, completed }` entry per id in QUEST_DEFS — overlaying any
 * matching progress found in `saved` (a plain object as persisted in
 * server/data/players.json, or null/undefined for a brand-new player).
 * Any quest id present in `saved` but no longer in QUEST_DEFS is silently
 * dropped, and any quest added to QUEST_DEFS *after* a player's last save
 * shows up here with fresh (0, not completed) progress — so returning
 * players automatically pick up newly added quests instead of crashing on
 * an unrecognized id or missing one added later. */
export function initQuestState(saved) {
  const state = {};
  for (const id of QUEST_ORDER) {
    const def = QUEST_DEFS[id];
    const prior = saved && typeof saved === "object" ? saved[id] : null;
    const priorProgress = prior && typeof prior.progress === "number" ? prior.progress : 0;
    state[id] = {
      progress: Math.max(0, Math.min(priorProgress, def.count)),
      completed: !!(prior && prior.completed) || priorProgress >= def.count,
    };
  }
  return state;
}

/** Advances every not-yet-completed quest of `type` whose `targets` list
 * includes `key` by `amount`, clamping at that quest's `count` and marking
 * it completed once reached. Mutates `quests` in place (it's per-player
 * live state, same pattern as awardXp() mutating a live player object in
 * index.js) and returns the list of quest ids that were touched (whether or
 * not they just completed) so the caller knows which ones to notify the
 * client about / grant rewards for. Already-completed quests are skipped
 * entirely, even if their targets match, so a reward is never granted twice. */
function advance(quests, type, key, amount) {
  const affected = [];
  for (const id of QUEST_ORDER) {
    const def = QUEST_DEFS[id];
    if (def.type !== type || !def.targets.includes(key)) continue;
    const q = quests[id];
    if (!q || q.completed) continue;

    q.progress = Math.min(q.progress + amount, def.count);
    if (q.progress >= def.count) q.completed = true;
    affected.push(id);
  }
  return affected;
}

/** Advances every not-yet-completed "kill" quest that tracks `mobName` by
 * one defeat. Returns the affected quest ids. */
export function advanceKillQuests(quests, mobName) {
  return advance(quests, "kill", mobName, 1);
}

/** Advances every not-yet-completed "collect" quest that tracks `itemId` by
 * `qty` (a single pickup can grant more than one of an item). Returns the
 * affected quest ids. */
export function advanceCollectQuests(quests, itemId, qty) {
  return advance(quests, "collect", itemId, qty);
}

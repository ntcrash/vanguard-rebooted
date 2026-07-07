// Vanguard Rebooted — character classes
//
// A player picks one of these once, on the login screen, the first time
// their account is created (see client/src/characterCreate.js) — like the
// chosen name/password (server/accountStore.js), it's persisted forever
// after (server/playerStore.js) rather than re-picked on every login the
// way color is. Kept in its own module (mirroring quests.js) so the plain
// multiplier math can be unit-tested without booting the socket.io server.
//
// A class nudges maxHp and melee damage here; each class's actual spell (one
// per class for now, level-gated) lives in the separate server/spells.js
// module instead of alongside these multipliers, since a spell needs its own
// cooldown/range/self-heal fields that don't apply to plain melee stats.

export const CHARACTER_CLASSES = {
  warrior: {
    id: "warrior",
    name: "Warrior",
    description: "Balanced fighter — steady HP and damage.",
    maxHpMultiplier: 1.15,
    damageMultiplier: 1.05,
  },
  paladin: {
    id: "paladin",
    name: "Paladin",
    description: "Tanky defender — highest HP, softest hits.",
    maxHpMultiplier: 1.3,
    damageMultiplier: 0.9,
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    description: "Fragile striker — lowest HP, hardest hits.",
    maxHpMultiplier: 0.85,
    damageMultiplier: 1.3,
  },
  mage: {
    id: "mage",
    name: "Mage",
    description: "Glass cannon — low HP, strong hits ahead of a future spellbook.",
    maxHpMultiplier: 0.8,
    damageMultiplier: 1.15,
  },
};

// Stable iteration/display order, same rationale as quests.js's QUEST_ORDER.
export const CLASS_ORDER = Object.keys(CHARACTER_CLASSES);

// What a brand-new account gets if the client didn't send a recognized
// class id (old client build, tampered auth payload, etc.) — a neutral
// middle-of-the-road choice rather than refusing the login outright.
export const DEFAULT_CLASS_ID = "warrior";

/** Returns `raw` if it's a real CHARACTER_CLASSES id, or null otherwise. */
export function sanitizeClassId(raw) {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(CHARACTER_CLASSES, raw) ? raw : null;
}

/** Scales `baseMaxHp` by `classId`'s maxHpMultiplier (falling back to
 * DEFAULT_CLASS_ID's if `classId` isn't recognized), rounded to a whole HP
 * value. */
export function classMaxHp(classId, baseMaxHp) {
  const def = CHARACTER_CLASSES[classId] || CHARACTER_CLASSES[DEFAULT_CLASS_ID];
  return Math.round(baseMaxHp * def.maxHpMultiplier);
}

/** Scales `baseDamage` by `classId`'s damageMultiplier (same fallback as
 * classMaxHp), rounded to a whole damage value. */
export function classDamage(classId, baseDamage) {
  const def = CHARACTER_CLASSES[classId] || CHARACTER_CLASSES[DEFAULT_CLASS_ID];
  return Math.round(baseDamage * def.damageMultiplier);
}

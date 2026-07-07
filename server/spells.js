// Vanguard Rebooted — spell attacks
//
// Each character class (see server/classes.js) gets exactly one spell for
// now, gated by player level and its own independent cooldown from the
// plain melee attack. Kept in its own module (mirrors classes.js/quests.js)
// so the level-gate/cooldown/damage math can be unit-tested without booting
// the socket.io server.
//
// Damage reuses the same shared MOB_DAMAGE baseline melee attacks scale
// from (see server/index.js's "attack" handler) -- a spell's damage is that
// baseline run through classDamage() (the class's plain melee multiplier)
// and then through the spell's own damageMultiplier on top, so a class's
// spell always hits harder than its melee swing without needing a second,
// disconnected damage constant to keep in sync.

import { classDamage } from "./classes.js";

// Melee-range spells (everyone except the mage) must match server/index.js's
// MOB_ATTACK_RANGE so "in range to melee" and "in range to melee-spell" mean
// the same thing to a player. The mage's bolt reaches further, since playing
// a ranged class should actually let you stand back.
export const MELEE_SPELL_RANGE = 3.2; // must match server/index.js's MOB_ATTACK_RANGE
export const MAGE_SPELL_RANGE = 9;

export const SPELL_DEFS = {
  warrior: {
    id: "rending_strike",
    classId: "warrior",
    name: "Rending Strike",
    icon: "\u{1F5E1}️", // 🗡️
    description: "A brutal follow-up strike that rends armor.",
    minLevel: 3,
    cooldownMs: 6000,
    damageMultiplier: 1.8,
    range: MELEE_SPELL_RANGE,
    selfHeal: 0,
  },
  paladin: {
    id: "holy_smite",
    classId: "paladin",
    name: "Holy Smite",
    icon: "✨", // ✨
    description: "Smites a foe with holy light and mends a little of your own wounds.",
    minLevel: 3,
    cooldownMs: 7000,
    damageMultiplier: 1.5,
    range: MELEE_SPELL_RANGE,
    selfHeal: 15,
  },
  rogue: {
    id: "shadow_strike",
    classId: "rogue",
    name: "Shadow Strike",
    icon: "\u{1F5E1}️", // 🗡️
    description: "A vicious burst from the shadows.",
    minLevel: 3,
    cooldownMs: 5000,
    damageMultiplier: 2.2,
    range: MELEE_SPELL_RANGE,
    selfHeal: 0,
  },
  mage: {
    id: "arcane_bolt",
    classId: "mage",
    name: "Arcane Bolt",
    icon: "\u{1F52E}", // 🔮
    description: "A ranged bolt of arcane energy.",
    minLevel: 3,
    cooldownMs: 4500,
    damageMultiplier: 1.8,
    range: MAGE_SPELL_RANGE,
    selfHeal: 0,
  },
};

/** Returns `classId`'s spell def, or null if the class id isn't recognized
 * (shouldn't happen for a real account, since every CHARACTER_CLASSES id
 * above has exactly one entry here — guarded anyway the same way
 * classes.js's own lookups fall back rather than throw). */
export function spellForClass(classId) {
  return SPELL_DEFS[classId] || null;
}

/** Whether `level` has reached `spell`'s minLevel. */
export function isSpellUnlocked(spell, level) {
  return !!spell && typeof level === "number" && level >= spell.minLevel;
}

/** Whether enough time has passed since `lastCastAt` (0/undefined means
 * "never cast yet", which is always off cooldown) for `spell` to be cast
 * again at `now`. */
export function isSpellOffCooldown(lastCastAt, spell, now) {
  if (!spell) return false;
  return now - (lastCastAt || 0) >= spell.cooldownMs;
}

/** The actual damage `spell` deals for a caster of `classId`: the shared
 * `baseDamage` baseline, scaled by the class's plain melee multiplier
 * (classDamage, see server/classes.js), then scaled again by the spell's
 * own damageMultiplier, rounded once at the end. */
export function computeSpellDamage(classId, baseDamage, spell) {
  if (!spell) return 0;
  return Math.round(classDamage(classId, baseDamage) * spell.damageMultiplier);
}

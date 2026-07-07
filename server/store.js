// Vanguard Rebooted — store NPC
//
// A stationary shopkeeper (STORE_NPC_POSITION below, rendered client-side by
// client/src/storeNpc.js) that players can walk up to and buy goods from
// using "gold-coin" (see server/index.js's ITEM_DEFS) as currency. Kept in
// its own pure module, mirroring quests.js/classes.js/spells.js, so the
// afford/range/eligibility math is unit-testable without booting the
// socket.io server -- server/index.js's "buyStoreItem" handler owns all the
// actual side effects (removing gold, granting the item or flipping the
// early-spell-unlock flag, persistence, socket events).
//
// Catalog item names/icons are intentionally duplicated here rather than
// imported from index.js's ITEM_DEFS (which would create a circular import,
// server/index.js -> store.js -> index.js) -- the same "kept in manual sync"
// tradeoff client/src/characterCreate.js's CLASSES array already makes
// against server/classes.js's CHARACTER_CLASSES.

import { spellForClass } from "./spells.js";

export const STORE_NPC_NAME = "Wandering Merchant";
// Placed a short walk from the world origin spawn area, clear of every
// PICKUP_SPAWNS entry in server/index.js so the merchant doesn't visually
// overlap a floating item pickup.
export const STORE_NPC_POSITION = { x: 12, z: -12 };
export const STORE_INTERACT_RANGE = 4;

export const STORE_CATALOG = [
  { itemId: "health-draught", name: "Health Draught", icon: "\u{1F9EA}", cost: 3 }, // 🧪
  { itemId: "moonpetal", name: "Moonpetal", icon: "\u{1F319}", cost: 8 }, // 🌙
  { itemId: "iron-helm", name: "Iron Helm", icon: "⛑️", cost: 30, slot: "head" }, // ⛑️
  { itemId: "leather-armor", name: "Leather Armor", icon: "\u{1F94B}", cost: 30, slot: "body" }, // 🥋
  { itemId: "steel-sword", name: "Steel Sword", icon: "\u{1F5E1}️", cost: 40, slot: "weapon" }, // 🗡️
  // Spellbooks -- one per class (server/spells.js), keyed "spellbook-<classId>".
  // Buying your own class's spellbook instantly unlocks that class's spell
  // (bypasses spells.js's minLevel gate) -- buying another class's spellbook,
  // or buying your own twice, is rejected server-side (see
  // validateStorePurchase below), since it wouldn't do anything useful.
  { itemId: "spellbook-warrior", name: "Warrior's Spellbook", icon: "\u{1F4D5}", cost: 120, spellClassId: "warrior" }, // 📕
  { itemId: "spellbook-paladin", name: "Paladin's Spellbook", icon: "\u{1F4D8}", cost: 120, spellClassId: "paladin" }, // 📘
  { itemId: "spellbook-rogue", name: "Rogue's Spellbook", icon: "\u{1F4D3}", cost: 120, spellClassId: "rogue" }, // 📓
  { itemId: "spellbook-mage", name: "Mage's Spellbook", icon: "\u{1F4D9}", cost: 120, spellClassId: "mage" }, // 📙
];

export const STORE_CATALOG_BY_ID = Object.fromEntries(STORE_CATALOG.map((entry) => [entry.itemId, entry]));

/** Whether a player standing at (x, z) is close enough to the store NPC to interact with it. */
export function isNearStore(x, z) {
  return Math.hypot(x - STORE_NPC_POSITION.x, z - STORE_NPC_POSITION.z) <= STORE_INTERACT_RANGE;
}

/** How many gold-coins `inventory` (a player's inventory array,
 * [{ itemId, qty, ... }]) currently holds. 0 if there's no gold-coin stack
 * (or `inventory` itself is missing/malformed). */
export function goldBalance(inventory) {
  if (!Array.isArray(inventory)) return 0;
  const stack = inventory.find((slot) => slot && slot.itemId === "gold-coin");
  return stack && typeof stack.qty === "number" ? stack.qty : 0;
}

/** Pure validation of a "buy this item" request -- returns { ok: true, entry }
 * or { ok: false, reason }. Doesn't mutate anything; server/index.js's
 * "buyStoreItem" handler only performs the actual inventory/gold/flag
 * mutation once this returns ok, the same "pure check, side effects happen
 * at the call site" split spells.js's isSpellUnlocked()/isSpellOffCooldown()
 * already use. `ownedSpellbooks` is a per-player { [classId]: true } map
 * (server/index.js tracks this as player.ownedSpellbooks) so a spellbook
 * can't be bought twice. */
export function validateStorePurchase({ itemId, x, z, inventory, characterClass, ownedSpellbooks }) {
  if (!isNearStore(x, z)) {
    return { ok: false, reason: "You're too far from the merchant." };
  }

  const entry = STORE_CATALOG_BY_ID[itemId];
  if (!entry) {
    return { ok: false, reason: "The merchant doesn't carry that." };
  }

  if (entry.spellClassId) {
    if (entry.spellClassId !== characterClass) {
      return { ok: false, reason: `Only a ${entry.spellClassId} can use that spellbook.` };
    }
    if (ownedSpellbooks && ownedSpellbooks[entry.spellClassId]) {
      return { ok: false, reason: "You already own that spellbook." };
    }
    if (!spellForClass(characterClass)) {
      return { ok: false, reason: "Your class has no spell to unlock." };
    }
  }

  const gold = goldBalance(inventory);
  if (gold < entry.cost) {
    return { ok: false, reason: `Not enough gold (need ${entry.cost}, have ${gold}).` };
  }

  return { ok: true, entry };
}

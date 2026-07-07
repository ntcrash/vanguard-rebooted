// Vanguard Rebooted — multi-character accounts
//
// Until now an account (server/accountStore.js) mapped 1:1 onto exactly one
// character/save (server/playerStore.js, keyed directly by the account's
// display name) — logging in dropped you straight into the world as "your"
// one and only character. This module adds the missing layer in between:
// which characters an account owns, so an account can create several and
// pick one each session instead of always being the same single character.
//
// Deliberately does NOT replace playerStore.js — a character's actual game
// state (level, inventory, position, etc.) still lives there, keyed by the
// character's own name exactly as before. This module only tracks the
// roster (name/class/color/createdAt) an account is allowed to choose from,
// mirroring accountStore.js/playerStore.js's "plain fs, own data file, no new
// dependency" pattern.
//
// Character *names* are still unique across the whole server, not just
// within one account — playerStore.js's save-slot key is the character name
// alone, so two different accounts both owning a character named "Aria"
// would silently share (and corrupt) one save. characterNameTaken() below
// enforces that uniqueness at creation time.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(SERVER_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "characters.json");

// An account can own at most this many characters. Small and arbitrary for
// this prototype — just enough to make "multiple characters" meaningful
// without an unbounded roster.
export const MAX_CHARACTERS_PER_ACCOUNT = 5;

/** Loads the whole character-roster file into memory. Returns {} if it
 * doesn't exist yet or fails to parse (corrupt/partial write) rather than
 * crashing the server — same defensive posture as accountStore.js/
 * playerStore.js's loadAll(). Shape: { [accountKey]: [{ name,
 * characterClass, color, createdAt, migrated? }, ...] }. */
function loadAll() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[characterStore] failed to read ${DATA_FILE}, starting fresh:`, err.message);
    }
    return {};
  }
}

/** Writes the whole character-roster file atomically (write to a temp file,
 * then rename), same pattern as accountStore.js/playerStore.js's saveAll(). */
function saveAll(all) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(all, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.warn(`[characterStore] failed to write ${DATA_FILE}:`, err.message);
  }
}

/** Returns a copy of `accountKey`'s character list (already-lowercased
 * account key, see server/accountStore.js's normalizeAccountKey), or an
 * empty array if the account has none yet (brand new, or not migrated —
 * see ensureMigratedAccount below). */
export function listCharacters(accountKey) {
  if (!accountKey) return [];
  const all = loadAll();
  const list = all[accountKey];
  return Array.isArray(list) ? list.slice() : [];
}

/** Returns true if any account anywhere already owns a character named
 * `name` (case-insensitive) — characters share one global namespace since
 * playerStore.js's save file is keyed by name alone, not name+account. */
export function characterNameTaken(name) {
  if (!name) return false;
  const target = name.toLowerCase();
  const all = loadAll();
  return Object.values(all).some(
    (list) => Array.isArray(list) && list.some((c) => c && typeof c.name === "string" && c.name.toLowerCase() === target)
  );
}

/**
 * Adds a new character to `accountKey`'s roster. Callers are expected to
 * have already validated the name's format and checked
 * characterNameTaken()/the account's current list length themselves (this
 * project's existing pattern — see accountStore.js's resolveLogin — favors
 * pre-validated inputs over this layer re-deriving policy), but the
 * account-size cap and global-uniqueness check are re-verified here too
 * right before the write, closing the small race between an earlier check
 * and this call.
 *
 * Returns { ok: true, character } on success, or { ok: false, reason } if
 * the account is already at MAX_CHARACTERS_PER_ACCOUNT or the name was taken
 * by the time this actually wrote.
 */
export function addCharacter(accountKey, { name, characterClass, color }) {
  if (!accountKey || !name) return { ok: false, reason: "Missing account or character name." };

  const all = loadAll();
  const list = Array.isArray(all[accountKey]) ? all[accountKey] : [];

  if (list.length >= MAX_CHARACTERS_PER_ACCOUNT) {
    return { ok: false, reason: `An account can have at most ${MAX_CHARACTERS_PER_ACCOUNT} characters.` };
  }
  const target = name.toLowerCase();
  const takenAnywhere = Object.values(all).some(
    (l) => Array.isArray(l) && l.some((c) => c && typeof c.name === "string" && c.name.toLowerCase() === target)
  );
  if (takenAnywhere) {
    return { ok: false, reason: `"${name}" is already taken.` };
  }

  const character = { name, characterClass, color: color || null, createdAt: Date.now() };
  all[accountKey] = [...list, character];
  saveAll(all);
  return { ok: true, character };
}

/**
 * One-time migration for an account created before multi-character support
 * existed: back then the account's own display name doubled directly as its
 * single character's name (see server/playerStore.js's file comment). Called
 * only when `accountKey` has no roster entry yet *and* a caller has already
 * confirmed a legacy playerStore.js save exists under `legacyName` — this
 * function doesn't reach into playerStore.js itself, keeping the two stores
 * decoupled (server/index.js is what already knows both and glues them
 * together, same as it already glues accountStore+playerStore+classes).
 *
 * Synthesizes a single-character roster (`migrated: true` for observability)
 * so that account's existing save keeps working exactly as before, just now
 * expressed as "an account with one character" instead of "an account that
 * is its character". No-ops (returns the existing list untouched) if the
 * account already has a roster — this must never silently overwrite a
 * roster a player has already grown past one character.
 */
export function ensureMigratedAccount(accountKey, legacyName, legacyClass) {
  if (!accountKey || !legacyName) return [];
  const all = loadAll();
  if (Array.isArray(all[accountKey]) && all[accountKey].length > 0) {
    return all[accountKey].slice(); // already migrated (or already has characters) — no-op
  }

  const character = {
    name: legacyName,
    characterClass: legacyClass || "warrior",
    color: null,
    createdAt: Date.now(),
    migrated: true,
  };
  all[accountKey] = [character];
  saveAll(all);
  return all[accountKey].slice();
}

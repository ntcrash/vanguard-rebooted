// Vanguard Rebooted — basic account/login store
//
// Replaces the old "random guest name each session" flow with real (if very
// lightweight) accounts: a chosen username is now a persistent account
// protected by a password, instead of just a free-for-all save-slot key
// (see playerStore.js) that anyone could type in and inherit. This is
// intentionally still simple — no email/reset flow, no sessions/tokens, just
// "does this password match what was set the first time this username was
// used" — but it means a name can no longer be hijacked by someone else
// just typing it in, which the old scheme allowed.
//
// Kept dependency-free (Node's built-in `crypto`, plain fs) for the same
// reason as playerStore.js: this prototype can't reliably `npm install` new
// packages in every environment it's developed in. `crypto.scryptSync` is
// part of Node's standard library, so no new dependency is introduced.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(SERVER_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "accounts.json");

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/** Loads the whole accounts file into memory. Returns {} if it doesn't exist
 * yet or fails to parse (corrupt/partial write) rather than crashing the
 * server. Keyed by lowercased username so logins are case-insensitive while
 * the display name (see accounts[key].name) preserves the casing the account
 * was created with. */
function loadAll() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[accountStore] failed to read ${DATA_FILE}, starting fresh:`, err.message);
    }
    return {};
  }
}

/** Writes the whole accounts file atomically (write to a temp file, then
 * rename) so a crash mid-write can't leave behind a half-written,
 * unparseable file — same pattern as playerStore.js's saveAll(). */
function saveAll(all) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(all, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.warn(`[accountStore] failed to write ${DATA_FILE}:`, err.message);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}

/** Canonical account lookup key for a chosen username — lowercased so logins
 * are case-insensitive (see loadAll()'s comment above). Exported so
 * server/characterStore.js (and server/index.js, which glues the two
 * stores together for multi-character accounts) key their own per-account
 * data the exact same way this module does internally, rather than each
 * re-deriving `.toLowerCase()` and risking the two keyings drifting apart. */
export function normalizeAccountKey(username) {
  return typeof username === "string" ? username.toLowerCase() : "";
}

/** Constant-time-ish comparison of two hex hash strings (guards against
 * trivial timing attacks on the comparison itself; scrypt's cost is the real
 * defense against brute-forcing the password). */
function hashesMatch(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Returns true if an account already exists for `username` (case-insensitive). */
export function accountExists(username) {
  if (!username) return false;
  const all = loadAll();
  return Object.prototype.hasOwnProperty.call(all, normalizeAccountKey(username));
}

/**
 * Resolves a login attempt for `username`/`password`:
 * - Unknown username: creates a new account with this password (auto-register
 *   on first use — keeps the flow to a single "enter name + password" step
 *   rather than a separate signup screen) and returns { ok: true, name }.
 * - Known username: returns { ok: true, name } only if the password's hash
 *   matches what was stored when the account was created; otherwise
 *   { ok: false, reason: "bad-password" }.
 *
 * `name` in the result is the account's original display-cased username
 * (e.g. "Aria" even if this login attempt was "aria"), which is what should
 * actually be used as the player's in-game name / playerStore.js save key.
 */
export function resolveLogin(username, password) {
  const key = normalizeAccountKey(username);
  const all = loadAll();
  const existing = all[key];

  if (!existing) {
    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    all[key] = {
      name: username,
      salt,
      hash: hashPassword(password, salt),
      createdAt: Date.now(),
    };
    saveAll(all);
    return { ok: true, name: username, created: true };
  }

  const attemptHash = hashPassword(password, existing.salt);
  if (!hashesMatch(attemptHash, existing.hash)) {
    return { ok: false, reason: "bad-password" };
  }

  return { ok: true, name: existing.name, created: false };
}

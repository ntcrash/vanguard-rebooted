// Vanguard Rebooted — persistent player state
//
// A deliberately tiny "database": one JSON file on disk, keyed by the
// player's chosen character name (see server/index.js's sanitizeChosenName).
// There's no real account/login system yet (that's the next roadmap item),
// so the chosen name doubles as the save-slot key for now — two players
// picking the identical name will share a save, which is an accepted
// limitation until real accounts land.
//
// Kept deliberately dependency-free (plain fs, no sqlite/lowdb/etc.) since
// this prototype can't `npm install` new packages in every environment it's
// developed in; a real DB can swap in later behind this same
// loadPlayerRecord/savePlayerRecord interface without touching index.js.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(SERVER_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "players.json");

/** Loads the whole save file into memory. Returns {} if it doesn't exist yet
 * or fails to parse (corrupt/partial write) rather than crashing the server. */
function loadAll() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[playerStore] failed to read ${DATA_FILE}, starting fresh:`, err.message);
    }
    return {};
  }
}

/** Writes the whole save file atomically (write to a temp file, then rename)
 * so a crash mid-write can't leave behind a half-written, unparseable file. */
function saveAll(all) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(all, null, 2));
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.warn(`[playerStore] failed to write ${DATA_FILE}:`, err.message);
  }
}

/** Returns the saved record for `name`, or null if none exists. */
export function loadPlayerRecord(name) {
  if (!name) return null;
  const all = loadAll();
  return all[name] ?? null;
}

/** Persists `record` under `name`, merging into the existing save file
 * (other players' saves aren't touched/lost). */
export function savePlayerRecord(name, record) {
  if (!name) return;
  const all = loadAll();
  all[name] = record;
  saveAll(all);
}

/** Persists many {name, record} pairs in a single read-modify-write pass —
 * used by the periodic autosave so saving N connected players costs one disk
 * write instead of N. */
export function savePlayerRecords(entries) {
  if (!entries || entries.length === 0) return;
  const all = loadAll();
  for (const { name, record } of entries) {
    if (!name) continue;
    all[name] = record;
  }
  saveAll(all);
}

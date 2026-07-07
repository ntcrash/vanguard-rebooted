import * as THREE from "three";
import {
  buildWorld,
  torchFlicker,
  updateDayNight,
  updateRain,
  updatePond,
  updateFireflies,
  dayPeriodLabel,
  dayNightPhase,
} from "./world.js";
import {
  createCharacterMesh,
  applyEquipment,
  RemotePlayer,
  triggerAttack,
  updateAttack,
  triggerSpellCast,
  updateSpellCast,
  updateLocomotion,
} from "./player.js";
import { Mob } from "./mob.js";
import { Pickup } from "./pickup.js";
import { StoreNpc } from "./storeNpc.js";
import { QuestNpc } from "./questNpc.js";
import {
  initInput,
  keys,
  mouse,
  attack as attackInput,
  spellCast as spellCastInput,
  inventoryToggle,
  questLogToggle,
  partyToggle,
  micToggle,
  menuToggle,
  storeToggle,
  questNpcToggle,
} from "./input.js";
import { connectToServer } from "./network.js";
import { initChat } from "./chat.js";
import { DamageNumbers } from "./damageNumbers.js";
import { initCharacterCreate } from "./characterCreate.js";
import { createVoiceManager } from "./voice.js";

const canvas = document.getElementById("scene");
const statusEl = document.getElementById("status");
const zoneLabelEl = document.getElementById("zone-label");
const timeLabelEl = document.getElementById("time-label");
const labelsEl = document.getElementById("labels");
const cooldownFillEl = document.getElementById("attack-cooldown-fill");
const spellCooldownFillEl = document.getElementById("spell-cooldown-fill");
const spellInfoEl = document.getElementById("spell-info");
const levelDisplayEl = document.getElementById("level-display");
const xpBarFillEl = document.getElementById("xp-bar-fill");
const inventoryPanelEl = document.getElementById("inventory-panel");
const inventoryGridEl = document.getElementById("inventory-grid");
const INVENTORY_SLOT_COUNT = 20; // must match server's MAX_INVENTORY_SLOTS
const questPanelEl = document.getElementById("quest-panel");
const questListEl = document.getElementById("quest-list");
const partyPanelEl = document.getElementById("party-panel");
const partyRosterEl = document.getElementById("party-roster");
const partyInviteInputEl = document.getElementById("party-invite-input");
const partyInviteBtnEl = document.getElementById("party-invite-btn");
const partyLeaveBtnEl = document.getElementById("party-leave-btn");
const partyDisbandBtnEl = document.getElementById("party-disband-btn");
const partyInvitePopupEl = document.getElementById("party-invite-popup");
const partyInviteTextEl = document.getElementById("party-invite-text");
const partyInviteAcceptBtnEl = document.getElementById("party-invite-accept-btn");
const partyInviteDeclineBtnEl = document.getElementById("party-invite-decline-btn");
const micToggleBtnEl = document.getElementById("mic-toggle-btn");
const touchMicBtnEl = document.getElementById("touch-mic-btn");
const gameMenuPanelEl = document.getElementById("game-menu-panel");
const gameMenuResumeBtnEl = document.getElementById("game-menu-resume-btn");
const gameMenuSaveBtnEl = document.getElementById("game-menu-save-btn");
const gameMenuSaveStatusEl = document.getElementById("game-menu-save-status");
const gameMenuExitBtnEl = document.getElementById("game-menu-exit-btn");
let saveStatusClearTimer = null;
const storePanelEl = document.getElementById("store-panel");
const storeHeaderEl = document.getElementById("store-header");
const storeGoldEl = document.getElementById("store-gold");
const storeListEl = document.getElementById("store-list");
const STORE_INTERACT_RANGE = 4; // must match server/store.js's STORE_INTERACT_RANGE
const STORE_NPC_LABEL_ID = "store-npc"; // synthetic id so the NPC shares labelEls/updateLabels' per-id loop
const questBoardPanelEl = document.getElementById("quest-board-panel");
const questBoardHeaderEl = document.getElementById("quest-board-header");
const questBoardListEl = document.getElementById("quest-board-list");
const QUEST_NPC_INTERACT_RANGE = 4; // must match server/questNpc.js's QUEST_NPC_INTERACT_RANGE
const QUEST_NPC_LABEL_ID = "quest-npc"; // synthetic id, same treatment as STORE_NPC_LABEL_ID

const ATTACK_COOLDOWN = 0.6; // seconds between local attacks
const SPRINT_MULTIPLIER = 1.8; // hold Shift (input.js's keys.sprint) to move+animate this much faster
const MOB_ATTACK_RANGE = 3.2; // must match server's MOB_ATTACK_RANGE
const MOB_ATTACK_FACING_DOT = 0.3; // mob must be roughly in front of the player to be targeted

// ---- Renderer / scene / camera -------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// PCFSoftShadowMap trades a little perf for noticeably softer shadow edges
// than the default PCF map — worth it since shadow area here is small
// (single sun light, capped shadow camera frustum in world.js).
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// ACESFilmic + sRGB output: without a tone-mapping curve, the sun's 1.4
// intensity directional light blows out highlights on white/pale materials
// (character armor, stone pillars) to flat white. ACESFilmic rolls off
// highlights more like a camera would, and sRGB output color space is the
// correct/expected pairing for it in three r152+.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const { torches, sky, sun, hemi, rain, pond, fireflies } = buildWorld(scene);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
const cameraState = { azimuth: Math.PI, elevation: 0.45, distance: 8 };

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

initInput(canvas);

// ---- Local player ---------------------------------------------------------------

const local = {
  id: null,
  name: null,
  mesh: null,
  rotY: 0,
  hp: 100,
  maxHp: 100,
  alive: true,
  moveSpeed: 7, // units/sec
  attackCooldownRemaining: 0, // seconds left before another attack can fire
  spell: null, // this class's spell def (server/spells.js), sent once on "init"
  spellCooldownRemaining: 0, // seconds left before the spell can be cast again
  level: 1,
  xp: 0,
  xpToNext: 100,
  characterClass: "warrior", // server/classes.js id, chosen once at account creation — server-authoritative
  inventory: [], // [{ itemId, name, icon, qty, slot }], server-authoritative
  equipment: { weapon: null, head: null, body: null }, // server-authoritative
  quests: {}, // { [questId]: { progress, completed } }, server-authoritative
  partyId: null, // server/parties.js party id, or null if not in a party
  partyRoster: [], // [{ id, name, isLeader }], server-authoritative (see "partyState")
  ownedSpellbooks: {}, // { [classId]: true }, server-authoritative (server/store.js) -- lets the spell HUD/cast gate bypass minLevel
};

// Static quest definitions ({ id, name, description, count, ... }), sent
// once on "init" — server/quests.js's QUEST_DEFS. Doesn't change per player,
// unlike local.quests' progress, so it's kept separate from `local`.
let questDefs = {};

const remotePlayers = new Map(); // id -> RemotePlayer
const mobs = new Map(); // id -> Mob
const pickups = new Map(); // id -> Pickup (world item pickups)
const npcs = new Map(); // synthetic id -> StoreNpc | QuestNpc (currently the merchant + Elder Maren)
const labelEls = new Map(); // id -> HTMLDivElement (name tag), shared by players + mobs + npcs
const healthBarEls = new Map(); // id -> { outer, fill } HTMLDivElements, shared by players + mobs
const damageNumbers = new DamageNumbers(labelsEl);
let inventoryOpen = false;
let questLogOpen = false;
let partyOpen = false;
let menuOpen = false;
let storeOpen = false;
let storeCatalog = []; // server/store.js's STORE_CATALOG, sent once on "init"
let storeNpcInfo = null; // { name, x, z }, sent once on "init"
let questBoardOpen = false;
let questNpcInfo = null; // { name, x, z }, sent once on "init" (server/questNpc.js)
// The single incoming party invite (if any) this client is currently showing
// an Accept/Decline popup for -- mirrors pendingPartyInvites' "at most one
// outstanding invite per player" rule on the server (server/index.js).
let pendingIncomingInvite = null;

/** Rebuilds the inventory panel's grid from local.inventory, padding out to
 * INVENTORY_SLOT_COUNT empty slots so unused capacity is visible. */
function renderInventory() {
  if (!inventoryGridEl) return;
  inventoryGridEl.innerHTML = "";
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    const slot = local.inventory[i];
    const div = document.createElement("div");
    div.className = "inventory-slot" + (slot ? "" : " empty");
    if (slot) {
      const isEquippable = !!slot.slot;
      const isEquipped = isEquippable && local.equipment[slot.slot] === slot.itemId;
      if (isEquippable) div.classList.add("equippable");
      if (isEquipped) div.classList.add("equipped");

      div.title =
        `${slot.name} x${slot.qty}` +
        (isEquippable ? (isEquipped ? " (equipped — click to unequip)" : " (click to equip)") : "");
      div.innerHTML =
        `<span class="item-icon">${slot.icon}</span>` +
        (slot.qty > 1 ? `<span class="item-qty">${slot.qty}</span>` : "");

      // Gear (weapon/head/body slot) can be equipped/unequipped by clicking
      // its inventory tile — re-clicking an equipped item unequips it. The
      // server is the source of truth: this only requests the change; the
      // visible result comes back via "playerEquipmentChanged".
      if (isEquippable) {
        div.addEventListener("click", () => {
          if (isEquipped) net?.sendUnequip(slot.slot);
          else net?.sendEquip(slot.itemId);
        });
      }
    }
    inventoryGridEl.appendChild(div);
  }
}

function updateInventoryToggle() {
  if (!inventoryToggle.requested) return;
  inventoryToggle.requested = false;
  inventoryOpen = !inventoryOpen;
  if (inventoryPanelEl) inventoryPanelEl.classList.toggle("hidden", !inventoryOpen);
}

/** Rebuilds a quest list panel (either the always-available "L" quest log,
 * or the quest-NPC's quest board -- see renderQuestLog()/renderQuestBoard()
 * below, which just pick the target container) from questDefs (static) +
 * local.quests (this player's live progress against each one), in
 * questDefs' insertion order so the list doesn't reshuffle as quests
 * complete. Both panels show identical content -- the quest board's only
 * difference is that it's gated behind walking up to Elder Maren
 * (server/questNpc.js) rather than always available. */
function renderQuestList(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  for (const [id, def] of Object.entries(questDefs)) {
    const q = local.quests[id] || { progress: 0, completed: false };
    const div = document.createElement("div");
    div.className = "quest-entry" + (q.completed ? " completed" : "");
    div.innerHTML =
      `<div class="quest-name">${def.name}${q.completed ? " ✓" : ""}</div>` +
      `<div class="quest-desc">${def.description}</div>` +
      `<div class="quest-progress">${Math.min(q.progress, def.count)}/${def.count}</div>`;
    containerEl.appendChild(div);
  }
}

function renderQuestLog() {
  renderQuestList(questListEl);
}

function renderQuestBoard() {
  renderQuestList(questBoardListEl);
}

/** Re-renders whichever quest panel(s) are relevant right now -- the quest
 * log always (it has no visibility gate of its own; renderQuestList() is
 * cheap even while hidden, same posture as renderPartyPanel()), and the
 * quest board only while it's actually open, mirroring how the store panel
 * only re-renders on demand while storeOpen. Called from every place that
 * used to call renderQuestLog() alone, so the board doesn't show stale
 * progress if a player completes a quest step while it's open. */
function refreshQuestPanels() {
  renderQuestLog();
  if (questBoardOpen) renderQuestBoard();
}

function updateQuestLogToggle() {
  if (!questLogToggle.requested) return;
  questLogToggle.requested = false;
  questLogOpen = !questLogOpen;
  if (questPanelEl) questPanelEl.classList.toggle("hidden", !questLogOpen);
}

/** Whether the local player is currently close enough to the quest NPC to
 * check the quest board -- mirrors isNearStoreNpc()/server/questNpc.js's
 * isNearQuestNpc(). Purely a client-side UX gate (unlike the store, there's
 * no server-authoritative action here to re-validate against). */
function isNearQuestNpc() {
  if (!local.mesh || !questNpcInfo) return false;
  const dist = Math.hypot(local.mesh.position.x - questNpcInfo.x, local.mesh.position.z - questNpcInfo.z);
  return dist <= QUEST_NPC_INTERACT_RANGE;
}

/** Opens/closes the quest board panel -- same proximity-gated pattern as
 * updateStoreToggle(), but the panel is read-only (no buy buttons), so
 * opening it just renders the current quest list once. */
function updateQuestNpcToggle() {
  if (!questNpcToggle.requested) return;
  questNpcToggle.requested = false;

  if (!questBoardOpen) {
    if (!isNearQuestNpc()) {
      chat.addSystemLine(`You need to be near ${questNpcInfo?.name || "the quest giver"} to check the quest board.`);
      return;
    }
    questBoardOpen = true;
    renderQuestBoard();
  } else {
    questBoardOpen = false;
  }
  if (questBoardPanelEl) questBoardPanelEl.classList.toggle("hidden", !questBoardOpen);
}

/** Rebuilds the party panel's roster from local.partyRoster (server-sent
 * names + leader flag) plus each member's hp/maxHp -- read straight off
 * `local` (self) or the matching RemotePlayer, both of which are already
 * kept up to date by the existing playerDamaged/playerLeveledUp/
 * playerRespawned handlers below, so the server doesn't need to duplicate
 * hp into every "partyState" broadcast. Called every frame while the panel
 * is open (cheap: at most PARTY_MAX_SIZE rows), same as the floating health
 * bars' per-frame refresh, so a member's hp bar here stays live without
 * wiring a re-render call into every place hp can change. */
function renderPartyPanel() {
  if (!partyRosterEl) return;
  partyRosterEl.innerHTML = "";
  for (const member of local.partyRoster) {
    const hp = member.id === local.id ? local.hp : remotePlayers.get(member.id)?.hp ?? 0;
    const maxHp = member.id === local.id ? local.maxHp : remotePlayers.get(member.id)?.maxHp ?? 100;
    const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) * 100 : 0;

    const div = document.createElement("div");
    div.className = "party-member";
    div.innerHTML =
      `<div class="party-member-name">${member.isLeader ? '<span class="leader-icon">★</span>' : ""}${member.name}</div>` +
      `<div class="party-member-hp"><div class="party-member-hp-fill${pct <= 35 ? " low" : ""}" style="width:${pct}%"></div></div>`;
    partyRosterEl.appendChild(div);
  }

  const isLeader = local.partyRoster.find((m) => m.id === local.id)?.isLeader ?? false;
  if (partyLeaveBtnEl) partyLeaveBtnEl.classList.toggle("hidden", !local.partyId);
  if (partyDisbandBtnEl) partyDisbandBtnEl.classList.toggle("hidden", !local.partyId || !isLeader);
}

function updatePartyToggle() {
  if (!partyToggle.requested) return;
  partyToggle.requested = false;
  partyOpen = !partyOpen;
  if (partyPanelEl) partyPanelEl.classList.toggle("hidden", !partyOpen);
  if (partyOpen) renderPartyPanel();
}

/** Toggles this player's own mic on/off (proximity voice chat) -- requests
 * mic hardware access on first enable (see voice.js's ensureLocalStream),
 * tells the server so other clients' nameplates can show the icon, and
 * updates this client's own button state. Mirrors the other panel-toggle
 * functions' edge-triggered "requested" flag pattern, even though this
 * toggles a mic rather than a panel. */
function updateMicToggle() {
  if (!micToggle.requested) return;
  micToggle.requested = false;
  micOn = !micOn;
  voice.setMicEnabled(micOn);
  net?.sendMicState(micOn);
  if (micToggleBtnEl) {
    micToggleBtnEl.textContent = micOn ? "\u{1F3A4} Mic On" : "\u{1F3A4} Mic Off";
    micToggleBtnEl.classList.toggle("active", micOn);
  }
  if (touchMicBtnEl) touchMicBtnEl.classList.toggle("active", micOn);
}

/** Opens/closes the Esc game menu (Resume/Save Game/Exit to Login) -- same
 * edge-triggered "requested" flag pattern as the other panel toggles above. */
function updateMenuToggle() {
  if (!menuToggle.requested) return;
  menuToggle.requested = false;
  menuOpen = !menuOpen;
  if (gameMenuPanelEl) gameMenuPanelEl.classList.toggle("hidden", !menuOpen);
}

function closeGameMenu() {
  menuOpen = false;
  if (gameMenuPanelEl) gameMenuPanelEl.classList.add("hidden");
}

/** Whether the local player is currently close enough to the store NPC to
 * shop -- mirrors server/store.js's isNearStore() so the panel doesn't claim
 * to be open against an NPC too far away to actually buy from (the server
 * re-validates range on every "buyStoreItem" regardless, same posture as
 * every other client-side pre-check in this file). */
function isNearStoreNpc() {
  if (!local.mesh || !storeNpcInfo) return false;
  const dist = Math.hypot(local.mesh.position.x - storeNpcInfo.x, local.mesh.position.z - storeNpcInfo.z);
  return dist <= STORE_INTERACT_RANGE;
}

/** Rebuilds the store panel's item list from storeCatalog (static) + the
 * player's current gold/class/ownedSpellbooks (server-authoritative) --
 * mirrors renderInventory()'s always-rebuild-from-scratch pattern. A
 * spellbook tile shows "Owned"/"Wrong class" instead of "Buy" once it no
 * longer makes sense to purchase, so the disabled reason is visible rather
 * than just a greyed-out button. */
function renderStorePanel() {
  if (!storeListEl) return;
  storeListEl.innerHTML = "";

  const gold = local.inventory.find((slot) => slot.itemId === "gold-coin")?.qty ?? 0;
  if (storeGoldEl) storeGoldEl.textContent = `Your gold: ${gold}`;

  for (const entry of storeCatalog) {
    const owned = !!(entry.spellClassId && local.ownedSpellbooks[entry.spellClassId]);
    const wrongClass = !!(entry.spellClassId && entry.spellClassId !== local.characterClass);
    const canAfford = gold >= entry.cost;

    const div = document.createElement("div");
    div.className = "store-entry" + (owned ? " owned" : "");
    div.innerHTML =
      `<span class="store-item-icon">${entry.icon}</span>` +
      `<span class="store-item-name">${entry.name}</span>` +
      `<span class="store-item-cost">${entry.cost}g</span>`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = owned ? "Owned" : wrongClass ? "Wrong class" : canAfford ? "Buy" : "Need gold";
    btn.disabled = owned || wrongClass || !canAfford;
    btn.addEventListener("click", () => net?.buyStoreItem(entry.itemId));
    div.appendChild(btn);

    storeListEl.appendChild(div);
  }
}

function updateStoreToggle() {
  if (!storeToggle.requested) return;
  storeToggle.requested = false;

  if (!storeOpen) {
    if (!isNearStoreNpc()) {
      chat.addSystemLine(`You need to be near the ${storeNpcInfo?.name || "merchant"} to shop.`);
      return;
    }
    storeOpen = true;
    renderStorePanel();
  } else {
    storeOpen = false;
  }
  if (storePanelEl) storePanelEl.classList.toggle("hidden", !storeOpen);
}

/** Shows the Accept/Decline popup for an incoming party invite, replacing
 * any previous one this client hadn't responded to yet -- mirrors the
 * server's own "at most one outstanding invite" rule. */
function showPartyInvitePopup(inviterId, inviterName) {
  pendingIncomingInvite = { inviterId, inviterName };
  if (partyInviteTextEl) partyInviteTextEl.textContent = `${inviterName} invited you to a party.`;
  if (partyInvitePopupEl) partyInvitePopupEl.classList.remove("hidden");
}

function hidePartyInvitePopup() {
  pendingIncomingInvite = null;
  if (partyInvitePopupEl) partyInvitePopupEl.classList.add("hidden");
}

function makeLabel(text, variant) {
  const div = document.createElement("div");
  div.className = "player-label" + (variant ? ` ${variant}` : "");
  div.textContent = text;
  labelsEl.appendChild(div);
  return div;
}

function makeHealthBar() {
  const outer = document.createElement("div");
  outer.className = "health-bar";
  const fill = document.createElement("div");
  fill.className = "health-bar-fill";
  outer.appendChild(fill);
  labelsEl.appendChild(outer);
  return { outer, fill };
}

function setHealthBarHp(id, hp, maxHp) {
  const bar = healthBarEls.get(id);
  if (!bar) return;
  const pct = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) * 100 : 0;
  bar.fill.style.width = `${pct}%`;
  bar.fill.classList.toggle("low", pct <= 35);
}

/** Capitalizes a character class id ("warrior") into its display form
 * ("Warrior") for the HUD — the server only ever sends the lowercase id
 * (see server/classes.js), same as how mob/item ids are cased. */
function classDisplayName(classId) {
  if (!classId) return "";
  return classId.charAt(0).toUpperCase() + classId.slice(1);
}

/** Refreshes the local player's level/XP HUD from local.level/xp/xpToNext. */
function updateXpUI() {
  if (levelDisplayEl) {
    const className = classDisplayName(local.characterClass);
    levelDisplayEl.textContent = className ? `Level ${local.level} ${className}` : `Level ${local.level}`;
  }
  if (xpBarFillEl) {
    const pct = local.xpToNext > 0 ? Math.max(0, Math.min(1, local.xp / local.xpToNext)) * 100 : 0;
    xpBarFillEl.style.width = `${pct}%`;
  }
  // A level-up can cross a spell's minLevel gate, so keep the spell HUD's
  // locked/unlocked text in sync with the XP HUD rather than needing its own
  // separate call wired into every place level can change.
  updateSpellUI();
}

/** Refreshes the spell HUD row: shows the class's spell name/icon once
 * local.level reaches its minLevel, a "locked until level X" hint before
 * that, and drives the cooldown bar the same way updateLocalAttack drives
 * `cooldownFillEl`. A player with no spell yet (local.spell still null,
 * briefly true before the first "init" arrives) leaves the row blank. */
/** Whether the local player can cast their class spell right now regardless
 * of level -- either they've actually reached spell.minLevel, or they bought
 * their class's spellbook from the store NPC (server/store.js), which lets
 * server/index.js's castSpell handler bypass the level gate entirely. */
function hasSpellUnlock() {
  return !!local.spell && (local.level >= local.spell.minLevel || !!local.ownedSpellbooks[local.characterClass]);
}

function updateSpellUI() {
  if (spellInfoEl) {
    if (!local.spell) {
      spellInfoEl.textContent = "";
    } else if (!hasSpellUnlock()) {
      spellInfoEl.textContent = `\u{1F512} ${local.spell.name} unlocks at level ${local.spell.minLevel} (or buy the spellbook)`;
    } else {
      spellInfoEl.textContent = `${local.spell.icon} ${local.spell.name} (Q)`;
    }
  }
  if (spellCooldownFillEl) {
    const cooldownSec = local.spell ? local.spell.cooldownMs / 1000 : 1;
    const ready = local.spellCooldownRemaining <= 0;
    spellCooldownFillEl.style.width = `${(1 - local.spellCooldownRemaining / cooldownSec) * 100}%`;
    spellCooldownFillEl.classList.toggle("ready", ready);
  }
}

// ---- Chat -----------------------------------------------------------------------

const chat = initChat((text) => {
  net.sendChat(text);
});

// ---- Networking -------------------------------------------------------------------

let net; // assigned below, referenced by chat callback above via closure

// Proximity voice chat (client/src/voice.js). Built against a small facade
// rather than `net` directly, since `net` itself isn't assigned until
// startGame() runs (on login) -- the facade just forwards to whatever `net`
// currently is by the time voice.js actually calls it, same closure trick
// the chat callback above already relies on.
const voice = createVoiceManager({
  sendVoiceSignal: (targetId, data) => net?.sendVoiceSignal(targetId, data),
});
let micOn = false;
const playerNames = new Map(); // id -> display name, for rebuilding a nameplate's text when its mic indicator changes
const micOnState = new Map(); // id -> bool, last-known mic-toggle state per player (cosmetic only)

/** Rebuilds a player's nameplate text from their stored name plus a trailing
 * mic icon if their mic is currently toggled on -- the only two things a
 * nameplate ever shows, so this always fully replaces (rather than patches)
 * the label's textContent. */
function refreshNameplate(id) {
  const label = labelEls.get(id);
  const name = playerNames.get(id);
  if (!label || !name) return;
  label.textContent = micOnState.get(id) ? `${name} \u{1F3A4}` : name;
}

function setPlayerMicState(id, on) {
  micOnState.set(id, !!on);
  refreshNameplate(id);
}

function startGame(character) {
  net = connectToServer({
    onConnect: () => {
      statusEl.textContent = "Connected";
    },
    onDisconnect: () => {
      statusEl.textContent = "Disconnected — reconnecting…";
      // Every peer connection was necessarily with players on this same
      // server session -- a reconnect gets entirely new "voicePeerJoin"
      // events (or none, if no one's nearby yet) rather than resuming these.
      voice.disposeAll();
    },
    onConnectError: (err) => {
      // Covers both "server unreachable" and a rejected login (bad
      // password, invalid name — see server/index.js's io.use() middleware).
      // Either way, stop this socket from silently auto-retrying with the
      // same (possibly wrong) credentials, and send the player back to the
      // login screen with the server's reason so they can fix it and
      // resubmit, which opens a fresh connection via startGame().
      net.raw.disconnect();
      const message = err?.message || "Cannot reach server (is it running on :3000?)";
      statusEl.textContent = message;
      loginScreen.showError(message);
    },

    onInit: (data) => {
      local.id = data.id;
      local.name = data.self.name;
      local.rotY = data.self.rotY;
      local.hp = data.self.hp ?? 100;
      local.maxHp = data.self.maxHp ?? 100;
      local.alive = data.self.alive ?? true;
      local.inventory = data.self.inventory || [];
      local.equipment = data.self.equipment || { weapon: null, head: null, body: null };
      local.level = data.self.level ?? 1;
      local.xp = data.self.xp ?? 0;
      local.xpToNext = data.self.xpToNext ?? 100;
      local.characterClass = data.self.characterClass || "warrior";
      local.spell = data.self.spell || null;
      local.spellCooldownRemaining = 0;
      local.quests = data.self.quests || {};
      local.ownedSpellbooks = data.self.ownedSpellbooks || {};
      // A fresh connection never starts already in a party server-side (see
      // server/index.js's connection handler) -- reset any stale roster from
      // a prior connection so a reconnect doesn't show a party we've already
      // left as far as the server is concerned.
      local.partyId = null;
      local.partyRoster = [];
      questDefs = data.questDefs || {};
      storeCatalog = data.storeCatalog || [];
      storeNpcInfo = data.storeNpc || null;
      questNpcInfo = data.questNpc || null;
      renderInventory();
      refreshQuestPanels();
      renderPartyPanel();
      updateXpUI();

      // Store NPC (server/store.js) -- a single static merchant, spawned
      // once here the same way mobs/pickups are below. Uses a synthetic id
      // (STORE_NPC_LABEL_ID) so it shares labelEls/updateLabels' existing
      // per-id nameplate loop without needing its own separate rendering path.
      if (storeNpcInfo && !npcs.has(STORE_NPC_LABEL_ID)) {
        const npc = new StoreNpc(scene, storeNpcInfo, storeNpcInfo.name);
        npcs.set(STORE_NPC_LABEL_ID, npc);
        labelEls.set(STORE_NPC_LABEL_ID, makeLabel(storeNpcInfo.name, "npc"));
        if (storeHeaderEl) storeHeaderEl.textContent = storeNpcInfo.name;
      }

      // Quest NPC (server/questNpc.js) -- same treatment as the store NPC
      // above, a single static "Elder Maren" spawned once here.
      if (questNpcInfo && !npcs.has(QUEST_NPC_LABEL_ID)) {
        const qnpc = new QuestNpc(scene, questNpcInfo, questNpcInfo.name);
        npcs.set(QUEST_NPC_LABEL_ID, qnpc);
        labelEls.set(QUEST_NPC_LABEL_ID, makeLabel(questNpcInfo.name, "npc"));
        if (questBoardHeaderEl) questBoardHeaderEl.textContent = questNpcInfo.name;
      }

      local.mesh = createCharacterMesh(data.self.color, local.equipment, local.characterClass);
      local.mesh.position.set(data.self.x, data.self.y, data.self.z);
      scene.add(local.mesh);
      playerNames.set(local.id, local.name);
      labelEls.set(local.id, makeLabel(local.name, "self"));
      healthBarEls.set(local.id, makeHealthBar());
      setHealthBarHp(local.id, local.hp, local.maxHp);
      // A reconnect gets a fresh socket id and fresh server-side voice state
      // (server/index.js always starts a joining player's micOn at false),
      // so the mic toggle itself resets here too rather than carrying a
      // stale "on" from a previous connection into a session the server
      // doesn't know about yet.
      micOn = false;
      voice.setMicEnabled(false);
      if (micToggleBtnEl) {
        micToggleBtnEl.textContent = "\u{1F3A4} Mic Off";
        micToggleBtnEl.classList.remove("active");
      }
      if (touchMicBtnEl) touchMicBtnEl.classList.remove("active");

      statusEl.textContent = `Connected as ${local.name}`;
      chat.addSystemLine(
        data.newAccount ? `Account created — welcome, ${local.name}!` : `You joined as ${local.name}.`
      );

      for (const p of data.players) {
        if (p.id === local.id) continue;
        spawnRemote(p);
      }

      for (const m of data.mobs || []) {
        if (m.alive) spawnMob(m);
      }

      for (const pk of data.pickups || []) {
        spawnPickup(pk);
      }
    },

    onPlayerJoined: (p) => {
      spawnRemote(p);
      chat.addSystemLine(`${p.name} joined.`);
    },

    onPlayerMoved: (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) rp.setTarget(data.x, data.y, data.z, data.rotY);
    },

    onPlayerLeft: (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) {
        rp.dispose(scene);
        remotePlayers.delete(data.id);
      }
      const label = labelEls.get(data.id);
      if (label) {
        label.remove();
        labelEls.delete(data.id);
      }
      const bar = healthBarEls.get(data.id);
      if (bar) {
        bar.outer.remove();
        healthBarEls.delete(data.id);
      }
      playerNames.delete(data.id);
      micOnState.delete(data.id);
      // The server also drops any voice pair involving a disconnecting
      // player and tells us via "voicePeerLeave" -- but that event and this
      // "playerLeft" event aren't guaranteed to arrive in a particular
      // order, so tear down defensively here too rather than depend on it.
      voice.handlePeerLeave(data.id);
    },

    onChat: (data) => {
      chat.addLine(data.name, data.text, data.id === local.id);
    },

    onPlayerAttacked: (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) rp.triggerAttack();
    },

    onPlayerCastSpell: (data) => {
      const rp = remotePlayers.get(data.id);
      if (rp) rp.triggerSpellCast();
    },

    // Personal notice that a spell cast was rejected server-side (still on
    // cooldown, not unlocked yet, or no valid target in range) -- surfaced
    // as a chat system line the same lightweight way "partyNotice" is,
    // rather than its own dedicated UI element.
    onSpellRejected: (data) => {
      if (data?.reason) chat.addSystemLine(data.reason);
    },

    // A class spell's self-heal (currently just the paladin's Holy Smite)
    // landed -- update hp same as onPlayerDamaged, but spawn a "+N" heal
    // number instead of a "-N" damage one.
    onPlayerHealed: (data) => {
      if (data.id === local.id) {
        local.hp = data.hp;
        setHealthBarHp(local.id, local.hp, local.maxHp);
        if (local.mesh) {
          _dmgPos.copy(local.mesh.position);
          _dmgPos.y += 2.3;
          damageNumbers.spawn(_dmgPos, data.amount, { heal: true });
        }
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          rp.hp = data.hp;
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
          damageNumbers.spawn(rp.headWorldPosition(_dmgPos), data.amount, { heal: true });
        }
      }
    },

    onMobsState: (data) => {
      for (const m of data) {
        const mob = mobs.get(m.id);
        if (mob) {
          mob.setTarget(m.x, m.y, m.z, m.rotY);
        } else if (m.alive) {
          spawnMob(m);
        }
      }
    },

    onMobDamaged: (data) => {
      const mob = mobs.get(data.id);
      if (mob) {
        const dmg = mob.hp - data.hp;
        mob.applyDamage(data.hp);
        setHealthBarHp(data.id, mob.hp, mob.maxHp);
        damageNumbers.spawn(mob.headWorldPosition(_dmgPos), dmg);
      }
    },

    onMobDied: (data) => {
      const mob = mobs.get(data.id);
      if (mob && mob.hp > 0) {
        damageNumbers.spawn(mob.headWorldPosition(_dmgPos), mob.hp, { finishing: true });
      }
      despawnMob(data.id);
      chat.addSystemLine(`${data.name} was defeated${data.killedBy ? ` by ${data.killedBy}` : ""}.`);
    },

    onMobRespawned: (data) => {
      spawnMob(data);
      chat.addSystemLine(`${data.name} has respawned.`);
    },

    onPlayerDamaged: (data) => {
      if (data.id === local.id) {
        const dmg = local.hp - data.hp;
        local.hp = data.hp;
        setHealthBarHp(local.id, local.hp, local.maxHp);
        if (local.mesh) {
          _dmgPos.copy(local.mesh.position);
          _dmgPos.y += 2.3;
          damageNumbers.spawn(_dmgPos, dmg);
        }
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          const dmg = rp.hp - data.hp;
          rp.hp = data.hp;
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
          damageNumbers.spawn(rp.headWorldPosition(_dmgPos), dmg);
        }
      }
    },

    onPlayerDied: (data) => {
      if (data.id === local.id) {
        local.alive = false;
        if (local.mesh) local.mesh.visible = false;
        statusEl.textContent = "You died — respawning…";
        chat.addSystemLine(`You were defeated${data.killedBy ? ` by a ${data.killedBy}` : ""}.`);
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) rp.mesh.visible = false;
        chat.addSystemLine(`${data.name} was defeated${data.killedBy ? ` by a ${data.killedBy}` : ""}.`);
      }
    },

    onPlayerRespawned: (data) => {
      if (data.id === local.id) {
        local.hp = data.hp;
        local.maxHp = data.maxHp;
        local.alive = true;
        if (local.mesh) {
          local.mesh.position.set(data.x, data.y, data.z);
          local.mesh.rotation.y = data.rotY;
          local.mesh.visible = true;
        }
        setHealthBarHp(local.id, local.hp, local.maxHp);
        statusEl.textContent = `Connected as ${local.name}`;
        chat.addSystemLine("You respawned.");
        // Force the next move tick to broadcast, so remote clients see the teleport.
        lastSent = { x: null, y: null, z: null, rotY: null };
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          rp.hp = data.hp;
          rp.maxHp = data.maxHp;
          rp.mesh.position.set(data.x, data.y, data.z);
          rp.mesh.rotation.y = data.rotY;
          rp.mesh.visible = true;
          rp.setTarget(data.x, data.y, data.z, data.rotY);
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
        }
      }
    },

    // The server's anti-cheat rejected a move we sent (moved too far too
    // fast -- almost always a lag spike rather than an actual hack attempt
    // for a legit client). Snap back to the authoritative position/rotation
    // it gives us so we don't keep sending moves relative to a position the
    // server never accepted, which would just get rejected again.
    onMoveRejected: (data) => {
      if (!local.mesh) return;
      local.mesh.position.set(data.x, data.y, data.z);
      local.mesh.rotation.y = data.rotY;
      // Force the next move tick to re-send from this corrected position.
      lastSent = { x: null, y: null, z: null, rotY: null };
    },

    onItemPickedUp: (data) => {
      // The server already removed this pickup for everyone; only the
      // looting player's inventory changes (via the separate
      // "inventoryUpdated" event below), so this just handles the world
      // visual + a chat line.
      despawnPickup(data.id);
      const who = data.playerId === local.id ? "You" : data.playerName;
      const qtyPrefix = data.qty > 1 ? `${data.qty}x ` : "";
      chat.addSystemLine(`${who} picked up ${qtyPrefix}${data.name}.`);
    },

    onPickupRespawned: (data) => {
      spawnPickup(data);
    },

    onInventoryUpdated: (data) => {
      local.inventory = data.inventory || [];
      renderInventory();
      // A store purchase (server/store.js) also fires "inventoryUpdated" (new
      // item, or gold spent) -- keep the open store panel's gold/afford state
      // in sync the same way it already re-renders on open/every purchase
      // result below, rather than only refreshing on the next manual toggle.
      if (storeOpen) renderStorePanel();
    },

    onPlayerEquipmentChanged: (data) => {
      if (data.id === local.id) {
        local.equipment = data.equipment || { weapon: null, head: null, body: null };
        if (local.mesh) applyEquipment(local.mesh, local.equipment);
        renderInventory(); // refresh which tile shows as "equipped"
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) rp.setEquipment(data.equipment);
      }
    },

    onPlayerXpGained: (data) => {
      if (data.id !== local.id) return; // only the local player's HUD needs XP updates
      local.xp = data.xp;
      local.xpToNext = data.xpToNext;
      local.level = data.level;
      updateXpUI();
    },

    onPlayerLeveledUp: (data) => {
      if (data.id === local.id) {
        local.level = data.level;
        local.hp = data.hp;
        local.maxHp = data.maxHp;
        updateXpUI();
        setHealthBarHp(local.id, local.hp, local.maxHp);
        chat.addSystemLine(`You reached level ${data.level}!`);
      } else {
        const rp = remotePlayers.get(data.id);
        if (rp) {
          rp.hp = data.hp;
          rp.maxHp = data.maxHp;
          setHealthBarHp(data.id, rp.hp, rp.maxHp);
        }
        chat.addSystemLine(`${data.name} reached level ${data.level}!`);
      }
    },

    // Personal — only this player's quests advance, so no id check is
    // needed the way remote-vs-local branches elsewhere in this file do.
    onQuestProgress: (data) => {
      local.quests[data.id] = { progress: data.progress, completed: data.completed };
      refreshQuestPanels(); // matches renderInventory()'s always-refresh pattern, cheap DOM rebuild
    },

    // Broadcast to everyone (mirrors the level-up chat announcement above),
    // so the whole server sees someone finish a quest.
    onQuestCompleted: (data) => {
      const who = data.id === local.id ? "You" : data.name;
      chat.addSystemLine(`${who} completed the quest: ${data.questName}!`);
    },

    // Parties (server/parties.js) -- see the party panel functions above and
    // network.js's comment on each of these events for what they mean.
    onPartyInviteReceived: (data) => {
      showPartyInvitePopup(data.inviterId, data.inviterName);
    },

    onPartyState: (data) => {
      local.partyId = data.partyId;
      local.partyRoster = data.roster || [];
      if (partyOpen) renderPartyPanel();
    },

    onPartyLeft: () => {
      local.partyId = null;
      local.partyRoster = [];
      chat.addSystemLine("You left the party.");
      if (partyOpen) renderPartyPanel();
    },

    onPartyDisbanded: (data) => {
      local.partyId = null;
      local.partyRoster = [];
      chat.addSystemLine(`Your party disbanded${data?.reason ? ` (${data.reason})` : ""}.`);
      if (partyOpen) renderPartyPanel();
    },

    onPartyNotice: (data) => {
      if (data?.message) chat.addSystemLine(data.message);
    },

    // Proximity voice chat (server/voiceProximity.js) -- see voice.js's
    // handlePeerJoin/handlePeerLeave/handleSignal for the actual WebRTC
    // plumbing this just forwards into.
    onVoicePeerJoin: (data) => {
      voice.handlePeerJoin(data.peerId, data.initiate);
    },
    onVoicePeerLeave: (data) => {
      voice.handlePeerLeave(data.peerId);
    },
    onVoiceSignal: (data) => {
      voice.handleSignal(data.fromId, data.data);
    },
    onPlayerMicState: (data) => {
      if (data.id === local.id) return; // our own mic state is driven locally by updateMicToggle(), not this broadcast
      setPlayerMicState(data.id, data.micOn);
    },

    // Esc menu's "Save Game" button -- confirms the server actually
    // persisted this player's record just now (see server/index.js's
    // "requestSave" handler), rather than the player just trusting an
    // invisible background autosave.
    onSaveComplete: () => {
      if (!gameMenuSaveStatusEl) return;
      gameMenuSaveStatusEl.textContent = "Saved!";
      clearTimeout(saveStatusClearTimer);
      saveStatusClearTimer = setTimeout(() => {
        gameMenuSaveStatusEl.textContent = "";
      }, 2000);
    },

    // Store NPC (server/store.js): answers this client's own "buyStoreItem"
    // request. A rejection (too far, can't afford it, wrong class's
    // spellbook, already owned) surfaces as a chat system line the same
    // lightweight way "spellRejected"/"partyNotice" do. A successful
    // spellbook purchase also refreshes the spell HUD immediately, since
    // hasSpellUnlock() now depends on local.ownedSpellbooks -- otherwise the
    // "locked until level X" text would linger until the next level-up.
    onStorePurchaseResult: (data) => {
      if (!data) return;
      if (!data.ok) {
        chat.addSystemLine(data.reason || "Purchase failed.");
        return;
      }
      if (data.spellClassId) {
        local.ownedSpellbooks[data.spellClassId] = true;
        chat.addSystemLine(`You bought the ${classDisplayName(data.spellClassId)}'s Spellbook — your spell is unlocked!`);
        updateSpellUI();
      } else {
        const bought = storeCatalog.find((entry) => entry.itemId === data.itemId);
        chat.addSystemLine(`Bought ${bought?.name || data.itemId}.`);
      }
      if (storeOpen) renderStorePanel();
    },
  }, character);
}

const loginScreen = initCharacterCreate(startGame);

// ---- Party UI wiring --------------------------------------------------------------
// Button/input handlers are wired once at module load (not per-connection,
// unlike the socket event handlers inside startGame()) since they only ever
// request something from the server through `net` -- same pattern as the
// chat input's callback above.

if (partyInviteBtnEl && partyInviteInputEl) {
  const sendInvite = () => {
    const name = partyInviteInputEl.value.trim();
    if (!name || !net) return;
    net.sendPartyInvite(name);
    partyInviteInputEl.value = "";
  };
  partyInviteBtnEl.addEventListener("click", sendInvite);
  partyInviteInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendInvite();
  });
}

if (partyLeaveBtnEl) {
  partyLeaveBtnEl.addEventListener("click", () => net?.leaveParty());
}

if (partyDisbandBtnEl) {
  partyDisbandBtnEl.addEventListener("click", () => net?.disbandParty());
}

if (partyInviteAcceptBtnEl) {
  partyInviteAcceptBtnEl.addEventListener("click", () => {
    net?.respondPartyInvite(true);
    hidePartyInvitePopup();
  });
}

if (partyInviteDeclineBtnEl) {
  partyInviteDeclineBtnEl.addEventListener("click", () => {
    net?.respondPartyInvite(false);
    hidePartyInvitePopup();
  });
}

if (micToggleBtnEl) {
  micToggleBtnEl.addEventListener("click", () => {
    micToggle.requested = true;
  });
}

// ---- Esc game menu wiring (Resume / Save Game / Exit to Login) --------------------

if (gameMenuResumeBtnEl) {
  gameMenuResumeBtnEl.addEventListener("click", () => closeGameMenu());
}

if (gameMenuSaveBtnEl) {
  gameMenuSaveBtnEl.addEventListener("click", () => {
    if (!net) return;
    net.requestSave();
    if (gameMenuSaveStatusEl) gameMenuSaveStatusEl.textContent = "Saving…";
  });
}

if (gameMenuExitBtnEl) {
  gameMenuExitBtnEl.addEventListener("click", () => {
    // A full page reload is the simplest reliable way back to a clean login
    // screen -- it avoids having to hand-write teardown for the entire
    // scene/socket/UI state (meshes, remote players, mobs, pickups, chat
    // log, panels, voice peers, etc.) that only ever gets built up, never
    // torn down, elsewhere in this file. The server's own "disconnect"
    // handler already saves this player's record before the socket closes.
    net?.raw.disconnect();
    window.location.reload();
  });
}

function spawnRemote(p) {
  const rp = new RemotePlayer(scene, p);
  remotePlayers.set(p.id, rp);
  playerNames.set(p.id, p.name);
  labelEls.set(p.id, makeLabel(p.name));
  healthBarEls.set(p.id, makeHealthBar());
  setHealthBarHp(p.id, rp.hp, rp.maxHp);
  // A player who already had their mic on before we spawned them in (e.g.
  // they were mid-session when we joined/reconnected) should show the icon
  // immediately rather than only after their next toggle.
  if (p.micOn) setPlayerMicState(p.id, true);
}

function spawnMob(m) {
  const mob = new Mob(scene, m);
  mobs.set(m.id, mob);
  labelEls.set(m.id, makeLabel(m.name, "mob"));
  healthBarEls.set(m.id, makeHealthBar());
  setHealthBarHp(m.id, mob.hp, mob.maxHp);
}

function despawnMob(id) {
  const mob = mobs.get(id);
  if (mob) {
    mob.dispose(scene);
    mobs.delete(id);
  }
  const label = labelEls.get(id);
  if (label) {
    label.remove();
    labelEls.delete(id);
  }
  const bar = healthBarEls.get(id);
  if (bar) {
    bar.outer.remove();
    healthBarEls.delete(id);
  }
}

// Pickups have no name tag / health bar — just a mesh in the world.
function spawnPickup(pk) {
  pickups.set(pk.id, new Pickup(scene, pk));
}

function despawnPickup(id) {
  const pickup = pickups.get(id);
  if (pickup) {
    pickup.dispose(scene);
    pickups.delete(id);
  }
}

// ---- Movement + camera update ----------------------------------------------------

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _headPos = new THREE.Vector3();
const _healthPos = new THREE.Vector3();
const _dmgPos = new THREE.Vector3();
const _screen = new THREE.Vector3();

const WORLD_BOUNDS = 170; // must match server's WORLD_BOUNDS
const FOREST_ZONE_Z = 90; // must match server's FOREST_ZONE_Z
let lastSendAt = 0;
let lastSent = { x: null, y: null, z: null, rotY: null };
let currentZoneName = null; // last zone name shown in the HUD, so we only touch the DOM on change
let currentTimeLabel = null; // last day/night label shown in the HUD, so we only touch the DOM on change

/** Updates the "Meadow" / "Whispering Forest" HUD label from the local
 * player's current z position. Purely cosmetic client-side zone detection —
 * both areas share the same continuous world/network state. */
function updateZoneLabel() {
  if (!zoneLabelEl || !local.mesh) return;
  const zoneName = local.mesh.position.z >= FOREST_ZONE_Z ? "Whispering Forest" : "Meadow";
  if (zoneName === currentZoneName) return;
  currentZoneName = zoneName;
  zoneLabelEl.textContent = zoneName;
  zoneLabelEl.classList.toggle("forest", zoneName === "Whispering Forest");
}

/** Updates the "Dawn"/"Day"/"Dusk"/"Night" HUD label from the day/night
 * cycle's current phase. Purely cosmetic — the cycle itself is client-side
 * and not synced across players, same as the meadow/forest zone label. */
function updateTimeLabel(elapsedSeconds) {
  if (!timeLabelEl) return;
  const label = dayPeriodLabel(dayNightPhase(elapsedSeconds));
  if (label === currentTimeLabel) return;
  currentTimeLabel = label;
  timeLabelEl.textContent = label;
}

function updateCameraOrbit(dt) {
  cameraState.azimuth += mouse.deltaAzimuth;
  cameraState.elevation = THREE.MathUtils.clamp(cameraState.elevation + mouse.deltaElevation, 0.15, 1.35);
  cameraState.distance = THREE.MathUtils.clamp(cameraState.distance + mouse.wheel, 3, 24);
  mouse.deltaAzimuth = 0;
  mouse.deltaElevation = 0;
  mouse.wheel = 0;
}

function updateLocalPlayer(dt) {
  if (!local.mesh || !local.alive) return;

  const { azimuth, elevation, distance } = cameraState;

  _forward.set(-Math.sin(azimuth), 0, -Math.cos(azimuth));
  // Camera-relative right vector: cross(forward, worldUp), which for our
  // forward gives (-forward.z, 0, forward.x). The previous sign here was
  // flipped, so pressing D/right strafed toward the camera's left (and
  // vice versa) — this was the "left is right" movement bug.
  _right.set(-_forward.z, 0, _forward.x);

  _move.set(0, 0, 0);
  if (keys.forward) _move.add(_forward);
  if (keys.back) _move.sub(_forward);
  if (keys.right) _move.add(_right);
  if (keys.left) _move.sub(_right);

  const moving = _move.lengthSq() > 0;
  const effectiveSpeed = local.moveSpeed * (keys.sprint ? SPRINT_MULTIPLIER : 1);

  if (moving) {
    _move.normalize().multiplyScalar(effectiveSpeed * dt);
    local.mesh.position.x = THREE.MathUtils.clamp(local.mesh.position.x + _move.x, -WORLD_BOUNDS, WORLD_BOUNDS);
    local.mesh.position.z = THREE.MathUtils.clamp(local.mesh.position.z + _move.z, -WORLD_BOUNDS, WORLD_BOUNDS);

    const targetRotY = Math.atan2(_move.x, _move.z);
    let dr = targetRotY - local.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    local.mesh.rotation.y += dr * Math.min(1, dt * 12);
  }

  // Walk/run gait is purely speed-driven (see updateLocomotion in player.js),
  // so sprinting just means feeding it a bigger number here — no separate
  // "running" flag to track or send over the network.
  updateLocomotion(local.mesh, dt, moving ? effectiveSpeed : 0);

  // Camera orbits around the player at head height.
  const eyeHeight = 1.5;
  camera.position.set(
    local.mesh.position.x + distance * Math.sin(azimuth) * Math.cos(elevation),
    local.mesh.position.y + eyeHeight + distance * Math.sin(elevation),
    local.mesh.position.z + distance * Math.cos(azimuth) * Math.cos(elevation)
  );
  camera.lookAt(local.mesh.position.x, local.mesh.position.y + eyeHeight, local.mesh.position.z);
}

/** Finds the nearest alive mob within `range` that's roughly in front of the
 * player -- shared by the plain melee attack and spell casts below, which
 * just pass their own range (a melee-range spell matches MOB_ATTACK_RANGE;
 * the mage's longer bolt passes its own larger spell.range instead). */
function findNearestMobInRange(range) {
  if (!local.mesh) return null;

  const forwardX = Math.sin(local.mesh.rotation.y);
  const forwardZ = Math.cos(local.mesh.rotation.y);

  let bestId = null;
  let bestDist = Infinity;

  for (const [id, mob] of mobs) {
    // Dead mobs are despawned immediately on "mobDied", so anything still in
    // this map is alive — no extra alive-check needed here.
    const dx = mob.mesh.position.x - local.mesh.position.x;
    const dz = mob.mesh.position.z - local.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range || dist === 0) continue;

    const dot = (dx / dist) * forwardX + (dz / dist) * forwardZ;
    if (dot < MOB_ATTACK_FACING_DOT) continue;

    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }

  return bestId;
}

/** Finds the nearest alive mob within attack range that's roughly in front of the player. */
function findAttackTargetMobId() {
  return findNearestMobInRange(MOB_ATTACK_RANGE);
}

/** Same idea as findAttackTargetMobId, but using this class's spell's own
 * range (see server/spells.js) instead of the fixed melee range -- the
 * mage's bolt reaches further than its melee attack does. */
function findSpellTargetMobId() {
  return findNearestMobInRange(local.spell?.range ?? MOB_ATTACK_RANGE);
}

function updateLocalAttack(dt) {
  if (local.attackCooldownRemaining > 0) {
    local.attackCooldownRemaining = Math.max(0, local.attackCooldownRemaining - dt);
  }

  if (attackInput.requested) {
    attackInput.requested = false;
    if (local.mesh && local.alive && local.attackCooldownRemaining <= 0) {
      triggerAttack(local.mesh);
      local.attackCooldownRemaining = ATTACK_COOLDOWN;
      net?.sendAttack(findAttackTargetMobId());
    }
  }

  if (local.mesh) updateAttack(local.mesh, dt);

  if (cooldownFillEl) {
    const ready = local.attackCooldownRemaining <= 0;
    cooldownFillEl.style.width = `${(1 - local.attackCooldownRemaining / ATTACK_COOLDOWN) * 100}%`;
    cooldownFillEl.classList.toggle("ready", ready);
  }
}

/** Mirrors updateLocalAttack above, but for this class's single spell (see
 * server/spells.js) -- its own cooldown clock (local.spellCooldownRemaining),
 * its own key/touch-button input (spellCastInput), and its own level gate,
 * all independent of the plain melee attack. The server re-validates level/
 * cooldown/range authoritatively (a rejected cast comes back as
 * "spellRejected"); this local gate just avoids firing a cast that's
 * obviously not going to be accepted. */
function updateLocalSpellCast(dt) {
  if (local.spellCooldownRemaining > 0) {
    local.spellCooldownRemaining = Math.max(0, local.spellCooldownRemaining - dt);
  }

  if (spellCastInput.requested) {
    spellCastInput.requested = false;
    if (local.spell && local.mesh && local.alive && hasSpellUnlock() && local.spellCooldownRemaining <= 0) {
      triggerSpellCast(local.mesh);
      local.spellCooldownRemaining = local.spell.cooldownMs / 1000;
      net?.sendSpellCast(findSpellTargetMobId());
    }
  }

  if (local.mesh) updateSpellCast(local.mesh, dt);
  updateSpellUI();
}

function maybeSendMove(now) {
  if (!local.mesh || !net || !local.alive) return;
  if (now - lastSendAt < 50) return; // ~20Hz cap

  const p = local.mesh.position;
  const r = local.mesh.rotation.y;
  const changed =
    lastSent.x === null ||
    Math.abs(p.x - lastSent.x) > 0.01 ||
    Math.abs(p.z - lastSent.z) > 0.01 ||
    Math.abs(r - lastSent.rotY) > 0.01;

  if (changed) {
    net.sendMove(p.x, p.y, p.z, r);
    lastSent = { x: p.x, y: p.y, z: p.z, rotY: r };
    lastSendAt = now;
  }
}

function projectToScreen(div, worldPos) {
  _screen.copy(worldPos).project(camera);
  if (_screen.z > 1) {
    div.style.display = "none";
    return;
  }
  div.style.display = "block";
  div.style.left = `${(_screen.x * 0.5 + 0.5) * window.innerWidth}px`;
  div.style.top = `${(-_screen.y * 0.5 + 0.5) * window.innerHeight}px`;
}

function updateLabels() {
  for (const [id, div] of labelEls) {
    let worldPos;
    if (id === local.id && local.mesh) {
      worldPos = _headPos.copy(local.mesh.position);
      worldPos.y += 2.3;
    } else {
      const rp = remotePlayers.get(id) || mobs.get(id) || npcs.get(id);
      if (!rp) continue;
      worldPos = rp.headWorldPosition(_headPos);
    }

    projectToScreen(div, worldPos);

    const bar = healthBarEls.get(id);
    if (bar) {
      const barPos = _healthPos.copy(worldPos);
      barPos.y += 0.32; // sit just above the name tag
      projectToScreen(bar.outer, barPos);
    }
  }
}

// ---- Main loop -----------------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  updateCameraOrbit(dt);
  updateLocalPlayer(dt);
  updateLocalAttack(dt);
  updateLocalSpellCast(dt);
  updateInventoryToggle();
  updateQuestLogToggle();
  updatePartyToggle();
  updateMicToggle();
  updateMenuToggle();
  updateStoreToggle();
  // Walking away from the merchant while the panel is open auto-closes it
  // (silently -- the chat hint above is only for a *failed open attempt*, not
  // for every step taken afterward) rather than leaving a panel open the
  // server would reject any purchase against.
  if (storeOpen && !isNearStoreNpc()) {
    storeOpen = false;
    if (storePanelEl) storePanelEl.classList.add("hidden");
  }
  updateQuestNpcToggle();
  // Same auto-close-on-walk-away treatment as the store panel above, even
  // though the quest board has no server action to protect -- staying
  // consistent with every other proximity-gated panel in this file.
  if (questBoardOpen && !isNearQuestNpc()) {
    questBoardOpen = false;
    if (questBoardPanelEl) questBoardPanelEl.classList.add("hidden");
  }
  updateZoneLabel();
  if (partyOpen) renderPartyPanel(); // keeps roster hp bars live, see renderPartyPanel()'s comment

  const dayNight = updateDayNight(scene, sky, sun, hemi, clock.elapsedTime);
  updateTimeLabel(clock.elapsedTime);
  // Torches burn brighter relative to the ambient dark at night, and dimmer
  // (barely noticeable) in full daylight — baseIntensity feeds straight into
  // torchFlicker()'s existing dual-sine wobble, so the flicker itself is
  // unaffected, only its average brightness.
  const torchBase = THREE.MathUtils.lerp(1.0, 1.9, dayNight.nightFactor);
  for (const torch of torches) {
    torch.light.intensity = torchFlicker(clock.elapsedTime, torch.seed, torchBase);
  }
  updateRain(rain, dt, clock.elapsedTime, local.mesh?.position.x ?? 0, local.mesh?.position.z ?? 0);
  updatePond(pond, clock.elapsedTime);
  updateFireflies(fireflies, clock.elapsedTime, dayNight.nightFactor);

  for (const rp of remotePlayers.values()) rp.update(dt);
  for (const mob of mobs.values()) mob.update(dt);
  for (const pickup of pickups.values()) pickup.update(dt);
  for (const npc of npcs.values()) npc.update(dt);

  maybeSendMove(performance.now());
  updateLabels();
  damageNumbers.update(camera, window.innerWidth, window.innerHeight);

  renderer.render(scene, camera);
}

animate();

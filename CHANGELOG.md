# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Walk/run character animation instead of a static primitive-shape sliding
  around: `client/src/player.js`'s character mesh now has hinged leg pivots
  (hip-mounted capsules, previously just one floor-to-head torso capsule with
  no legs at all) and a second, unarmed left-arm pivot alongside the existing
  weapon arm, animated by a new `updateLocomotion()` function into an
  alternating walk cycle (each arm counter-swings opposite its same-side leg).
  Both stride frequency and amplitude scale continuously with how fast the
  character is actually moving — there's no separate "is running" flag sent
  over the network; holding **Shift now sprints** (`SPRINT_MULTIPLIER` = 1.8x
  move speed in `client/src/main.js`, tracked as `keys.sprint` in
  `client/src/input.js`) and every client, including remote ones (whose speed
  is inferred from position deltas in `RemotePlayer.update()`), naturally
  animates a faster/wider gait to match. The existing melee-swing attack
  animation (`triggerAttack`/`updateAttack`) takes priority over the gait on
  the weapon arm while a swing is in progress, so attacking while moving
  doesn't look broken. Equippable gear (weapon/helmet/chestplate) still
  layers on top unchanged. Torso proportions were shortened/raised slightly
  to make room for the new visible legs. Server-side movement/speed
  validation is unaffected (still absent — see the "basic anti-cheat" item in
  `ROADMAP.md`, which will need to account for the new sprint speed cap when
  it's built).
- Basic account/login instead of a random guest name each session: the login
  screen now collects a username *and* password, backed by a new
  dependency-free `server/accountStore.js` (Node's built-in `crypto.scrypt`
  for salted password hashing, one atomically-written JSON file
  `server/data/accounts.json`, gitignored). The first login with a given
  username auto-registers that account with the given password; every login
  after that must match, enforced by a Socket.io `io.use()` handshake
  middleware in `server/index.js` that rejects the connection outright
  (surfaced client-side as `connect_error`) on a missing/short password or a
  wrong one — no more silent fallback to a randomly generated guest name.
  The account's (display-cased) username is what `server/playerStore.js`
  persistence keys off of, same as before, so existing saves keep working
  the first time their owner "claims" the name with a password. Client-side,
  `client/src/characterCreate.js` gained a password field and a
  `showError()` re-entry point so a rejected login re-shows the screen with
  the server's reason instead of leaving the player stuck; a one-time
  "Account created" chat line (vs. "You joined as ...") tells new vs.
  returning players apart on login.
- Persistent player state across sessions: level, XP, HP, inventory, and
  equipment, plus last position, are now saved server-side and restored on
  reconnect. Storage is a deliberately tiny "database" — a single JSON file
  (`server/data/players.json`, gitignored, written atomically via a
  temp-file-then-rename in `server/playerStore.js`) keyed by the player's
  chosen character name, since there's no separate account/login system yet
  (next roadmap item). New names still get the usual starter kit; a name
  that's been seen before loads its saved record instead, with position
  re-clamped to the current `WORLD_BOUNDS` in case it's changed since the
  save. Saved on every disconnect, plus a 60s safety-net autosave
  (`autosaveConnectedPlayers()`) of all connected players so a server crash
  or hard restart loses at most a minute of progress rather than a whole
  session.
- Larger, zoned world: the map now spans two distinct outdoor areas on one
  continuous plane — the original Meadow and a new Whispering Forest to the
  north (`FOREST_ZONE_Z` = 90 on both server and client), reached on foot
  rather than via a teleport/instance, so no new networking/room logic was
  needed. `WORLD_BOUNDS` (the player movement clamp) grew from 90 to 170 to
  fit the new area. The forest has its own denser, darker pine treeline and a
  tinted ground overlay (`scatterForest()` in `client/src/world.js`), flanked
  by a pair of stone gateway pillars at the boundary, plus a HUD zone label
  that switches between "Meadow" and "Whispering Forest" as you cross it
  (`updateZoneLabel()` in `client/src/main.js`). Five wolf mobs (Grey Wolf,
  Timber Wolf, Dire Wolf, Lone Wolf, Alpha Wolf) spawn in the forest using the
  same wandering/combat/respawn logic as the meadow's boars, just re-tinted
  grey (`client/src/mob.js`); `MOB_SPAWNS` entries now carry their own `name`
  directly instead of indexing into a shared `MOB_NAMES` array. New forest
  item pickups include a fresh curio item, Moonpetal (no gameplay effect yet),
  alongside more health draughts/gold coins.

- Basic XP/leveling tied to defeating mobs: players now have `level`, `xp`,
  and `xpToNext` fields (`server/index.js`), starting at level 1. Defeating a
  mob awards flat XP (`MOB_XP_REWARD` = 25) via a new `awardXp()` helper,
  which broadcasts a `playerXpGained` event so the HUD can update the XP bar.
  Crossing the XP threshold for the current level (`xpToNextLevel()`, growing
  by 40 XP per level on top of a 100 XP base) levels the player up — possibly
  more than once for a single big reward — fully restores their HP, and
  raises max HP by 10 per level, broadcasting a `playerLeveledUp` event.
  Client-side, a new level display + XP bar sit under the attack cooldown bar
  in the HUD (`client/index.html`, `client/src/style.css`), driven by the two
  new socket events wired up in `client/src/main.js`/`client/src/network.js`,
  with a chat system line announcing level-ups for everyone.
- Equippable gear that visibly changes the character model: items can now
  have an equipment `slot` ("weapon", "head", or "body" — see `ITEM_DEFS` in
  `server/index.js`), starting with a Steel Sword, Iron Helm, and Leather
  Armor, each added as a new world pickup. Clicking a gear tile in the
  inventory panel equips it (or unequips it if already worn) via new
  `equipItem`/`unequipItem` socket events; the server validates the player
  owns the item and tracks a per-player `equipment` loadout
  (`{ weapon, head, body }`), broadcasting changes to everyone as
  `playerEquipmentChanged` so the character model updates live for all
  connected clients, not just the equipping player. Client-side,
  `applyEquipment()` (`client/src/player.js`) rebuilds only the affected gear
  mesh — a re-skinned blade for weapons, a metallic dome for the head slot, a
  cylinder-plus-shoulder-pads overlay for the body slot — so re-equipping
  doesn't require rebuilding the whole character mesh. Equipped tiles are
  highlighted in the inventory panel.
- Item pickups in the world: 8 glowing gem pickups (health draughts and a new
  Gold Coin currency item) are scattered around the map at fixed points
  (`PICKUP_SPAWNS` in `server/index.js`). Walking within range automatically
  loots one into your inventory (`checkPickupCollection()`, checked after
  every server-validated move) — no separate interact key needed. Looted
  pickups respawn after 20 seconds (`respawnPickup()`, mirroring the existing
  mob respawn pattern). Client-side, pickups render as small rotating/bobbing
  gems color-coded by item type (`client/src/pickup.js`); a new
  `inventoryUpdated` event pushes the looting player's updated inventory to
  their own client, and a broadcast `itemPickedUp`/`pickupRespawned` pair
  keeps everyone's view of the world in sync and posts a "picked up" chat line.
- Player inventory: each player now has a server-authoritative inventory
  (`inventory` array on the player object in `server/index.js`, capped at
  `MAX_INVENTORY_SLOTS` = 20, with items stacking by id via
  `addItemToInventory()`). New players are granted a small starter kit (1
  Rusty Sword, 3 Health Draughts) so the panel has something to show before
  item pickups (a later roadmap item) exist. Client-side, press `I` to toggle
  an inventory panel (`#inventory-panel` in `client/index.html`, rendered by
  `renderInventory()` in `client/src/main.js`) showing a 4-column grid of 20
  slots — filled slots show an icon and stack count, empty ones are dashed
  placeholders. No new network events were needed: the inventory rides along
  on the existing `init` payload as part of the player's own state.
- Character creation screen: before joining, players now pick a display name and a color from a palette on a pre-game overlay (`client/src/characterCreate.js`, wired into `client/index.html` as `#login-screen`). The choice is sent to the server as socket.io auth and replaces the old behavior of auto-assigning a random name/color on connect. The server validates and sanitizes both fields (`sanitizeChosenName`/`sanitizeChosenColor` in `server/index.js`) and falls back to a random guest name/color if the input is missing or invalid, so older or malformed clients still work.
- Respawn handling for mobs and players:
  - Defeated mobs return to life at their home spawn point 15 seconds after
    dying (`respawnMob()` in `server/index.js`), broadcast as `mobRespawned`.
    The client re-spawns the mob's mesh/health bar/name tag and posts a system
    chat line, reusing the existing mob spawn path.
  - Mobs that survive a hit now have a 40% chance to gore the attacker back
    for damage (`MOB_COUNTER_CHANCE`/`MOB_COUNTER_DAMAGE`), giving melee combat
    real risk and giving players an actual way to die.
  - A player whose HP hits 0 is marked dead server-side (`playerDied`), can no
    longer move or attack (server re-validates `alive` on both `move` and
    `attack`), and respawns 5 seconds later at a fresh random spot with full
    HP (`playerRespawned`). Client-side, the dead player's mesh is hidden and
    reappears at the new position on respawn; the local player sees a "You
    died — respawning…" status message and loses input control while dead.
  - New `playerDamaged` event keeps everyone's health bars in sync when a
    player (not just a mob) takes damage.
- Damage numbers: floating combat text pops up above a mob and rises/fades
  whenever it takes a hit, showing the exact damage dealt
  (`client/src/damageNumbers.js`). Killing blows are shown larger and in a
  distinct color. Purely a client-side visual layer driven by the existing
  `mobDamaged`/`mobDied` events — no server or protocol changes.
- Mob NPCs: 6 wandering boars spawn at fixed points around the world and roam
  within a radius of their spawn, server-authoritative (position + wander AI
  ticked every 200ms and broadcast as `mobsState`). Rendered client-side as a
  simple low-poly boar (`client/src/mob.js`) with a floating name tag and
  health bar, same as players.
- Mobs can be attacked and defeated: the client auto-targets the nearest alive
  mob within range and roughly in front of the player on each swing, sending
  it alongside the existing `attack` event. The server re-validates range
  server-side before applying damage (`mobDamaged`) or, at 0 HP, defeat
  (`mobDied`) — a modified client can't hit mobs from across the map. Defeated
  mobs briefly flash red for hit feedback and are removed from the world until
  they respawn (see respawn handling above).
- Health bars floating above every character (self and remote players), tracked
  server-side (`hp`/`maxHp` per player, defaulting to 100/100) and rendered as a
  small DOM bar just above each player's name tag, color-shifting to red at low HP.
- Basic melee attack: left-click (a quick click, not a camera drag) or the `F`/
  `Space` keybind triggers a weapon swing animation with a client-enforced
  cooldown and a HUD cooldown bar.
- Attack events are synced over Socket.io (`attack` / `playerAttacked`) so
  other connected players see your swing animation in real time.
- Server-side cooldown enforcement on the `attack` event to prevent spam/cheating.

### Fixed

- Strafe movement direction was inverted: pressing A/Left strafed right and
  D/Right strafed left, relative to the camera. The camera-relative right
  vector in `updateLocalPlayer()` (`client/src/main.js`) had a flipped sign;
  it's now derived correctly from the forward vector so A/D strafe the way
  they visually should.

## [0.1.0] - 2026-07-05

### Added

- Initial project scaffold: `server/` (Node + Express + Socket.io) and `client/`
  (Three.js + Vite).
- Server: player join/leave tracking, position broadcast, global chat relay,
  server-side world-bounds clamping, `/health` endpoint.
- Client: 3D outdoor world (ground, trees, rocks, lighting, shadows, sky/fog),
  camera-relative WASD movement, mouse-drag orbit camera with scroll zoom,
  remote player interpolation, floating name tags, global text chat UI.
- Project docs: README (setup/run instructions), ROADMAP, this changelog.
- Gitflow branching (`main` + `develop`) established for future work.

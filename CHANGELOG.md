# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning loosely follows [Semantic Versioning](https://semver.org/); each
version is cut from a Gitflow `release/*` branch merged into `main` and
tagged there.

## [Unreleased]

### Added

- Spell attacks: each character class now has one signature spell, unlocked
  at level 3 and gated by its own cooldown independent of the plain melee
  attack — Warrior's Rending Strike, Paladin's Holy Smite (which also heals
  the caster a little), Rogue's Shadow Strike, and the Mage's longer-ranged
  Arcane Bolt. Cast with `Q` (or the new 🔮 touch button) at the nearest
  in-range mob roughly in front of you, mirroring the existing melee-attack
  targeting. A new `server/spells.js` module (mirroring `classes.js`/
  `quests.js`'s "pure logic in its own file" pattern) holds each class's
  `SPELL_DEFS` (name/icon/minLevel/cooldownMs/damageMultiplier/range/
  selfHeal) plus `spellForClass()`/`isSpellUnlocked()`/`isSpellOffCooldown()`/
  `computeSpellDamage()` helpers; damage is the same shared melee baseline
  run through the caster's class multiplier and then the spell's own
  multiplier, so a spell always hits harder than a plain melee swing.
  `server/index.js`'s new `castSpell` handler re-validates level/cooldown/
  range server-side (rejections come back as `spellRejected` with a
  human-readable reason) and reuses the existing `mobDamaged`/`mobDied`/XP/
  quest pipeline the melee `attack` handler already drives; a melee-range
  spell also risks the same immediate mob counter-hit chance melee does,
  but the Mage's ranged bolt does not. The HUD gained a spell name/icon row
  (showing a 🔒 "unlocks at level X" hint before that) and its own cooldown
  bar beneath the existing attack cooldown bar; a class's spell-cast plays a
  brief blue glow pulse on the caster's torso (`triggerSpellCast()`/
  `updateSpellCast()` in `client/src/player.js`), distinct from the melee
  swing animation, visible on remote players too via a new
  `playerCastSpell` broadcast.
- Character classes: choose Warrior, Paladin, Rogue, or Mage on the login
  screen alongside your name/password/color (new `#class-options` picker in
  `client/src/characterCreate.js`/`index.html`). A new `server/classes.js`
  module (mirroring `quests.js`'s "pure logic in its own file" pattern) holds
  each class's `maxHpMultiplier`/`damageMultiplier` plus `sanitizeClassId()`/
  `classMaxHp()`/`classDamage()` helpers; `server/index.js` applies these to
  a player's starting max HP and outgoing melee damage (the `attack`
  handler's `mob.hp -= MOB_DAMAGE` became `classDamage(p.characterClass,
  MOB_DAMAGE)`). Like name/password, a class is chosen once — the first time
  an account is created — and persisted forever after in
  `server/data/players.json`; a later login can't switch it, even if the
  client sends a different one. HUD's level display now reads e.g. "Level 3
  Rogue" instead of just "Level 3".
- Esc game menu: pressing `Esc` (or tapping the new ☰ touch button) opens a
  centered Resume / Save Game / Exit to Login menu, mirroring the toggle
  pattern already used by the inventory/quest/party panels. "Save Game" asks
  the server to persist your record immediately (new `requestSave` socket
  event in `server/index.js`, confirmed back via `saveComplete`) instead of
  waiting on the periodic autosave or a disconnect; "Exit to Login" disconnects
  cleanly and reloads the page back to the login screen, since the server
  already saves on disconnect and a full reload is simpler and more reliable
  than hand-writing teardown for the entire scene/socket/UI state built up
  over a session.

### Fixed

- Mobs now actually fight back: landing a hit on a boar/wolf makes it
  hostile toward you (`acquireAggro()` in the new `server/mobAI.js`, mirroring
  the `quests.js`/`parties.js` pure-logic-in-its-own-file pattern) — it chases
  at `MOB_CHASE_SPEED` (2.4 units/sec, faster than its normal wander speed)
  and strikes back roughly every 1.4s once in range, instead of only having a
  40% chance of a single passive counter-hit the moment you struck it. It
  keeps chasing until it or you dies, you flee more than `MOB_LEASH_RANGE`
  (25 units) from its home spawn point, or it's defeated — at which point it
  gives up (or, on death, respawns) and resumes idle wandering. The old
  40%-chance immediate counter-hit on the triggering blow is unchanged and
  still fires on top of the new chase, so combat has risk from the very
  first swing, not just once the mob catches up.

## [0.6.0] - 2026-07-06

The "Later / stretch ideas" section of `ROADMAP.md`, now fully shipped.

### Added

- Proximity voice chat: players near each other can hear one another over a
  live WebRTC audio connection, negotiated automatically as they walk into
  and out of range — no manual "call" step. `server/voiceProximity.js` holds
  the pure, unit-tested pairing math (`computeVoicePairs()`/
  `diffVoicePairs()`, `VOICE_PROXIMITY_RANGE` = 18 units), mirroring the
  `parties.js`/`quests.js` side-effect-free-logic-in-its-own-file pattern; a
  new 1-second server tick (`tickVoiceProximity()` in `server/index.js`)
  recomputes which *pairs* of alive players are currently in range and tells
  only those specific pairs to open a peer connection (`voicePeerJoin`,
  with exactly one side told to `initiate` the WebRTC offer) or tear one
  down (`voicePeerLeave`) — deliberately not an every-client-to-every-client
  mesh, since most pairs in a larger world would be silent/wasted. The
  server never touches audio itself; it only relays each pair's SDP offer/
  answer/ICE candidates via a `voiceSignal` event, restricted to pairs the
  proximity tick has actually formed so it can't be used as a generic relay
  to an arbitrary socket. Disconnecting drops that player's pairs and
  notifies the other side immediately (`dropVoicePairsFor()`) rather than
  waiting for the next tick. Client-side, `client/src/voice.js` manages the
  actual `RTCPeerConnection`s (STUN-only for now — see `DEPLOYMENT.md`) and
  a hidden `<audio>` element per connected peer; a new mic toggle (`V` key,
  the `🎤 Mic Off/On` HUD button, or a new touch button) requests
  microphone access on first use and toggles the local track's `enabled`
  flag afterward (so re-toggling never needs fresh WebRTC renegotiation). A
  player's mic on/off state is also broadcast globally (`playerMicState`,
  cosmetic only, like an equipment change) so every nameplate can show a 🎤
  icon next to anyone with their mic on, regardless of whether you're
  currently paired with them. Verified `server/voiceProximity.js`'s pairing
  math with a standalone Node script — 26 checks covering symmetric/
  distinct pair keys, in-range/out-of-range/exact-boundary/dead-player/
  malformed-position cases, a 3-player "triangle" producing all 3 pairs, and
  a simulated multi-tick sequence (converge → pair forms once → stays
  stable while in range → diverges → pair breaks once) — all passed. Also
  ran a full integration test booting the real server and driving 3 real
  `socket.io-client` connections through the entire flow — pairing forming
  only for in-range players, exactly one side told to initiate, signal
  relay between a genuine pair, a signal to a non-paired target silently
  dropped, mic-state broadcast reaching even a far-away player, a pair
  breaking after moving apart, and (critically) a new pairing partner
  getting `voicePeerLeave` *immediately* on disconnect rather than waiting
  for the next 1-second tick — 18/18 checks passed. The WebRTC/`getUserMedia`
  client glue itself can't be runtime-tested in this sandbox (no real
  browser), the same limitation already noted for the day/night cycle's
  GLSL shader and the touch-controls' real touch events — kept as small and
  boring as possible to minimize that untested surface.
- Guilds/parties: a lightweight grouping system so a handful of players can
  band together. `server/parties.js` holds the pure, unit-tested membership
  math (`createParty`/`addPartyMember`/`removePartyMember`, capped at
  `PARTY_MAX_SIZE` = 5, with leadership passing to the next-longest-tenured
  member if the leader leaves), mirroring the `quests.js`/`accountStore.js`
  side-effect-free-logic-in-its-own-file pattern. `server/index.js` wires in
  five new socket events — `partyInvite` (leader-only once a party exists,
  at most one outstanding invite per invitee), `partyRespond` (accept/
  decline, creating the party on the fly on a first accept),
  `partyLeave`/`partyDisband`, and a `partyState` roster broadcast (name +
  leader flag only — HP/level/position are cross-referenced from each
  member's already-tracked player state rather than duplicated) sent to
  every member on any membership change; a party that would be left with
  exactly one member auto-disbands rather than lingering as a "party of
  one." Parties are intentionally not persisted (same in-memory tradeoff as
  mobs/pickups) since they only make sense while members are online
  together. Client gained a party panel (`P` key or a new 🛡️ touch button,
  same toggle pattern as inventory/quest log) showing each member's name,
  leader star, and a live HP bar, an invite-by-name box, and an Accept/
  Decline popup for incoming invites. Verified `server/parties.js`'s pure
  membership math with a standalone Node script — 16 checks covering party
  creation, add/remove, the max-size cap (including a no-op past the cap),
  leadership handoff on the leader leaving, the last-member-leaves-returns-
  null case, and non-mutation of the original party object on every
  operation — all passed. Also ran a full integration test booting the real
  server and driving multiple `socket.io-client` connections through invite
  → accept → roster broadcast → non-leader-invite-rejected →
  already-partied-invite-rejected → voluntary leave → auto-disband →
  explicit leader disband → 5-member cap enforcement — 12/12 checks passed.
- Simple quest system: three server-authoritative quests — "Boar Cull"
  (defeat 5 boars in the Meadow), "Wolf Hunter" (defeat 3 wolves in the
  Whispering Forest), and "Moonpetal Gathering" (collect 3 Moonpetals) —
  defined alongside pure progress-tracking helpers in a new
  `server/quests.js` module (mirroring the existing `accountStore.js`/
  `playerStore.js` pattern of keeping side-effect-free logic in its own
  file). Kill quests advance on `mobDied` (matched by the defeated mob's
  name), collect quests advance in `checkPickupCollection()` (matched by
  item id, incremented by the pickup's stack `qty`, so a single big stack
  can finish a quest in one pickup) — both hook into the existing mob-kill
  and item-pickup code paths rather than adding new ones. Completing a
  quest auto-grants its XP + item rewards through the same `awardXp()`/
  `addItemToInventory()` calls a mob kill or pickup already uses, and
  broadcasts a `questCompleted` chat line to everyone, the same way a
  level-up is announced. Progress (and completion) persists across
  sessions in `server/data/players.json` alongside inventory/equipment/XP,
  and `initQuestState()` overlays a returning player's saved progress onto
  a fresh state built from the current quest list, so a quest added after
  a player's last save shows up automatically at 0 progress instead of
  being missing or crashing on load. Client-side, a new quest log panel
  (`L` to toggle, or the new 📜 button on touchscreens) lists each quest's
  name, description, and live `x/y` progress, checking off completed ones —
  driven entirely by two new socket events, a one-time `questDefs` payload
  on `init` (static name/description/target count) and a personal
  `questProgress` event whenever this player's own progress changes.
  Verified the pure progress-tracking module (`initQuestState`,
  `advanceKillQuests`, `advanceCollectQuests`) with a standalone Node
  script — 17 checks covering fresh state, overlaying/clamping/dropping/
  adding quest ids in saved data, per-mob-name and per-item-id target
  matching (including a quest's alternate target names), completing
  exactly at a quest's count, never exceeding it, skipping an
  already-completed quest, and kill/collect advances not cross-
  contaminating each other's quests — all passed; also spot-checked HTML
  tag balance and CSS brace balance after the markup/stylesheet edits,
  same as the mobile-touch-controls run, since there's no real browser to
  load the page in here.
- Day/night cycle and weather: `client/src/world.js` gained a client-side,
  clock-driven day/night loop (`DAY_CYCLE_SECONDS` = 300s = one full loop) that
  smoothly cross-fades the sky dome's gradient colors, the sun
  `DirectionalLight`'s color/intensity, the `HemisphereLight`'s intensity, and
  the scene fog color between five keyframes — midnight, dawn, noon, dusk,
  midnight again (`dayNightPhase()`/`dayNightState()`, pure functions of
  elapsed time so the interpolation math is unit-testable without a GL
  context, same pattern as the existing `skyGradientMixFactor`/
  `torchFlicker`). The noon keyframe exactly matches the sky/lighting's old
  static values, so full daylight looks identical to before this change.
  Forest gateway torches (`torchFlicker()`) now burn measurably brighter at
  night via a `nightFactor` the day/night state also returns, and a new HUD
  label (`#time-label` in `client/index.html`, driven by `dayPeriodLabel()`)
  shows "Dawn"/"Day"/"Dusk"/"Night" and updates live as the cycle progresses.
  A separate, independent weather cycle (`WEATHER_CYCLE_SECONDS` = 600s,
  raining for the first `RAIN_DURATION_SECONDS` = 90s of each) drives a
  `THREE.Points` rain cloud (`buildRain()`) that recenters on the local
  player every frame and whose individual drops fall and wrap via a pure
  `advanceRainDrop()` helper — both `isRaining()` and `advanceRainDrop()` are
  plain functions of elapsed time/position, not `Math.random()` per frame, so
  they're deterministic and unit-testable. Verified with a standalone Node
  script (using the `three` package in `client/node_modules`) covering
  `dayNightPhase` (wraparound, negative-elapsed handling), `dayNightState`
  (noon matches the old static values exactly, midnight is darkest, symmetric
  dawn/dusk keyframes interpolate correctly, phase clamps outside [0,1]),
  `dayPeriodLabel`, `isRaining` (on/off boundaries, cycle wraparound), and
  `advanceRainDrop` (fall distance, wrap-at-zero boundary); also built a real
  `THREE.Scene` via `buildWorld()` and exercised `updateDayNight()`/
  `updateRain()` against real `Light`/`ShaderMaterial`/`BufferGeometry`
  objects to confirm sun/hemi intensity, fog color, sky shader uniforms, rain
  visibility, and rain-follows-player positioning all update as expected, and
  that the sky mesh, rain particle cloud, and both torch lights land in the
  scene graph.

### Fixed

- Mouse look was inverted vertically: dragging the pointer up swung the
  orbit camera up and tilted the view down at the player, and dragging down
  did the opposite — backwards from the conventional non-inverted feel used
  by most first/third-person games. The dx/dy-to-camera-delta math was
  pulled out of the `mousemove`/`touchmove` handlers in `client/src/input.js`
  into a small pure, exported `mouseDeltaToLook(dx, dy, sensitivity)` helper
  (mirrors the rest of the codebase's "extract the math into a pure,
  testable function" pattern) with the vertical sign flipped; horizontal
  (azimuth) look is unchanged. Applies to both mouse-drag and the mobile
  single-finger camera-drag, since both now go through the same helper.

## [0.5.0] - 2026-07-06

The "Polish & deployment" roadmap section.

### Added

- Enhanced world/rendering graphics: a gradient sky dome (`buildSky()` in
  `client/src/world.js`, a large `BackSide` sphere with a vertical-gradient
  `ShaderMaterial`) replaces the previous flat `scene.background` color, so
  the sky actually reads as sky instead of a solid-colored void; fog color
  now matches the dome's horizon color instead of its old flat sky color so
  distance fog blends into the dome without a visible seam. The renderer
  gained `PCFSoftShadowMap` (softer shadow edges), `ACESFilmicToneMapping` +
  `SRGBColorSpace` output (rolls off highlight blowout on pale materials like
  armor/stone under the sun light more like a camera would) in
  `client/src/main.js`. The meadow/forest boundary gateway pillars each now
  carry a brazier bowl mesh and a warm flickering `PointLight`
  (`torchFlicker()`, a deterministic dual-sine function driven by
  `clock.elapsedTime` rather than `Math.random()`, so it's frame-rate
  independent and unit-testable) instead of being unlit stone posts. The
  meadow also gained ~600 InstancedMesh grass-blade tufts
  (`generateGrassPositions()`, deterministic/seeded, clamped short of the
  forest boundary) as one extra draw call instead of one Mesh per blade.
  Verified with a standalone Node script (using the `three` package present
  in `client/node_modules`) directly exercising `skyGradientMixFactor`
  (zenith/horizon/straight-down/exponent-steepness cases — kept in exact sync
  with the sky dome's GLSL fragment shader), `torchFlicker` (determinism,
  never drops below its floor across a dense time sweep, two different seeds
  desync from each other), and `generateGrassPositions` (exact count,
  in-bounds/clamped positions, deterministic per seed, different seed ⇒
  different layout); also constructed a real `THREE.Scene` via `buildWorld()`
  in that same script and confirmed via `scene.traverse()` that the sky mesh,
  both torch point lights, and the grass `InstancedMesh` (with the right
  instance count) actually end up in the scene graph, and confirmed
  `PCFSoftShadowMap`/`ACESFilmicToneMapping`/`SRGBColorSpace` all exist as
  constants in the installed three r164.
- Mobile/touch controls: a virtual joystick (`#touch-joystick-base`/`-knob`)
  drives movement by converting finger offset from the base's center into
  the same `forward`/`back`/`left`/`right` booleans WASD already produces
  (`joystickVectorToKeys()` in `client/src/input.js`), with a deadzone so
  small jitter near center doesn't register and the offset clamped to a max
  radius (`clampToRadius()`) so the visual knob can't travel further than the
  base; diagonal joystick positions naturally set two direction flags at
  once, same as pressing two WASD keys together. A single-finger drag
  anywhere else on the canvas orbits the camera using the exact same
  azimuth/elevation math as the existing mouse-drag handler, tracked by
  touch identifier so it doesn't conflict with the joystick or button
  touches. Three new round buttons (Sprint/hold, Attack/tap, Inventory/tap)
  cover the remaining keyboard shortcuts (`Shift`, click-or-`F`, `I`). The
  whole control overlay (`#touch-controls` in `client/index.html`) is hidden
  by default and only shown via a `@media (pointer: coarse)` CSS rule, so
  desktop mouse+keyboard play is completely unaffected. Verified the pure
  joystick math (`clampToRadius`, `joystickVectorToKeys`) with a standalone
  Node script covering centered/within-radius/clamped/diagonal/deadzone
  cases, since touch events can't be simulated without a real browser in
  this sandbox; also checked HTML tag balance and CSS brace balance after
  the markup/stylesheet edits.
- Basic anti-cheat / server-side movement validation: the `move` handler in
  `server/index.js` now rejects a position update that covers more ground
  than the fastest legitimate client could have traveled since its last
  accepted move — `MAX_MOVE_SPEED` mirrors the client's real top speed
  (`moveSpeed` * `SPRINT_MULTIPLIER` = 12.6 units/sec), padded by a generous
  `MOVE_SPEED_TOLERANCE` (1.5x) so ordinary latency/jitter isn't mistaken for
  a hack, with the elapsed-time window floored at `MIN_MOVE_INTERVAL_SEC`
  (matching the client's own ~20Hz move-send cap) so back-to-back moves can't
  be used to shrink the allowed distance toward zero. This catches both a
  sustained speed hack (every move a bit too far) and a one-shot teleport
  hack (one move way too far) with the same check — previously the server
  only clamped an incoming `(x, z)` to `WORLD_BOUNDS` and broadcast it as
  fact, trusting the client's position completely. A rejected move is
  dropped server-side (the player's authoritative position is left
  unchanged) and the offending socket receives a new `moveRejected` event
  carrying that authoritative position/rotation; the client
  (`client/src/network.js`, `client/src/main.js`) snaps its local player back
  to it and forces the next tick to re-send, so a legitimate player who
  triggered a false positive from a lag spike resyncs cleanly instead of
  drifting further out of sync with every subsequent (also-rejected) move.
  The respawn teleport (a legitimate, server-initiated position jump) resets
  the same anti-cheat clock so it isn't mistaken for a hack on the player's
  first post-respawn move.
- Deployment guide for hosting the server on a cloud provider: new
  [`DEPLOYMENT.md`](./DEPLOYMENT.md) covering host options (Render, Railway,
  Fly.io, or a plain VPS) for the stateful Socket.io server, required/
  recommended environment variables, why `server/data/` (accounts + player
  saves) needs a genuinely persistent volume rather than the platform's
  ephemeral filesystem, building and hosting the static Vite client
  separately (with `VITE_SERVER_URL` baked in at build time, not runtime),
  reverse-proxy/WebSocket-upgrade notes for a self-managed VPS, and a
  post-deploy verification checklist. Also hardened
  `server/index.js`'s Socket.io CORS config: it previously hardcoded
  `origin: "*"` (any site could open a socket to it) with a comment saying
  to tighten it before real deployment; it now reads an optional
  `CORS_ORIGIN` env var (comma-separated list of allowed origins) and only
  falls back to `"*"` when that's unset, so local development is unaffected
  but a production deploy can lock it down per DEPLOYMENT.md.
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
  to make room for the new visible legs.

## [0.4.0] - 2026-07-06

The "World & persistence" roadmap section.

### Added

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
  chosen character name (an account/login system arrived one step later, in
  this same release). New names still get the usual starter kit; a name
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

## [0.3.0] - 2026-07-06

The "Progression & items" roadmap section.

### Added

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

## [0.2.0] - 2026-07-06

The "Core gameplay loop" roadmap section: turning the initial scaffold into
an actual playable game with combat, mobs, and a real inventory/character
identity.

### Added

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
- Character creation screen: before joining, players now pick a display name
  and a color from a palette on a pre-game overlay
  (`client/src/characterCreate.js`, wired into `client/index.html` as
  `#login-screen`). The choice is sent to the server as socket.io auth and
  replaces the old behavior of auto-assigning a random name/color on
  connect. The server validates and sanitizes both fields
  (`sanitizeChosenName`/`sanitizeChosenColor` in `server/index.js`) and
  falls back to a random guest name/color if the input is missing or
  invalid, so older or malformed clients still work.
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

### Changed

- Repo housekeeping: IDE config and lockfiles are now tracked in git, and
  `.gitignore` was extended to exclude credentials and build archives.

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

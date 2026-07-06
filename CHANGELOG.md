# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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

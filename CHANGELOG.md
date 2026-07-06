# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
  mobs briefly flash red for hit feedback and are removed from the world; mob
  respawn is a separate, not-yet-implemented roadmap item.
- Health bars floating above every character (self and remote players), tracked
  server-side (`hp`/`maxHp` per player, defaulting to 100/100) and rendered as a
  small DOM bar just above each player's name tag, color-shifting to red at low HP.
- Basic melee attack: left-click (a quick click, not a camera drag) or the `F`/
  `Space` keybind triggers a weapon swing animation with a client-enforced
  cooldown and a HUD cooldown bar.
- Attack events are synced over Socket.io (`attack` / `playerAttacked`) so
  other connected players see your swing animation in real time.
- Server-side cooldown enforcement on the `attack` event to prevent spam/cheating.

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

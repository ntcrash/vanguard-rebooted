# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

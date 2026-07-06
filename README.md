# Vanguard Rebooted

A simple, graphical 3D multiplayer prototype in the spirit of World of Warcraft: an
open outdoor area you can walk around in, see other connected players moving in
real time, and chat with them. Built to be a small, hackable foundation rather than
a full game.

- **Client**: [Three.js](https://threejs.org/) (WebGL) + [Vite](https://vitejs.dev/), runs in the browser
- **Server**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) + [Socket.io](https://socket.io/) for realtime state sync

## Features

- Basic account/login: choose a username, password, and color on the login
  screen — the first login with a given name creates that account, every
  login after that must use the same password (see `server/accountStore.js`);
  a wrong password is rejected outright rather than silently handing you a
  guest identity
- 3D outdoor world (ground, grass, trees, rocks, soft shadows, a gradient sky
  dome, and fog) spanning two distinct zones — the starting Meadow and the
  Whispering Forest to the north, reached on foot past a pair of stone
  gateway pillars, each lit by a flickering torch
- Multiplayer: see other connected players move around in real time
- Third-person camera you orbit with the mouse and zoom with the scroll wheel
- WASD (or arrow key) movement, camera-relative, with a real walk/run gait —
  hold `Shift` to sprint — instead of a static shape sliding across the ground
- Global text chat
- Name tags floating above each character
- Health bars floating above each character and mob
- Basic melee attack (click or `F`/`Space`) with a cooldown, synced to other players
- Player inventory: a server-tracked item inventory with a toggleable panel
  (`I`); new players start with a small kit of items
- Equippable gear: gear items (a sword, helm, and armor) can be equipped or
  unequipped by clicking them in the inventory panel, visibly changing your
  character model for everyone in real time
- Item pickups: glowing gems scattered around the world (health draughts,
  gold coins) that are automatically looted into your inventory when you
  walk over them, and respawn after a short delay
- Mob NPCs: wandering boars in the Meadow and wolves in the Whispering Forest,
  scattered around the world, that can be attacked and defeated (auto-targeted
  when one's in range and roughly in front of you)
- XP/leveling: defeating mobs earns XP toward your next level, shown as a
  level + XP bar in the HUD; leveling up fully heals you and raises your max HP
- Floating damage numbers pop up whenever a mob takes a hit
- Respawn handling: defeated mobs come back to life at their spawn point after
  a short delay, and mobs occasionally hit back — a player defeated in combat
  respawns nearby a few seconds later with full health
- Persistent player state: level, XP, HP, inventory, equipment, and position
  are saved server-side (`server/data/players.json`, gitignored) keyed by
  your account name, and restored automatically the next time you log in —
  progress survives reconnects and server restarts, and (now that accounts
  are password-protected) can't be reached by someone else just typing in
  your name.
- Server-side movement validation: every position update is checked against
  how far the fastest legitimate (sprinting) client could actually have
  moved since its last accepted move, so a modified client can't speed-hack
  or teleport around the map — an implausible move is dropped and the
  player's client is snapped back in sync, generously tolerant of ordinary
  lag so normal play is never affected.
- Mobile/touch controls: on a touchscreen (detected via a `(pointer: coarse)`
  media query, so desktop mouse+keyboard play is unaffected), an on-screen
  virtual joystick drives movement, a single-finger drag anywhere else on the
  scene orbits the camera exactly like a mouse drag, and dedicated Sprint/
  Attack/Inventory buttons cover the rest of the keyboard shortcuts
- Day/night cycle and weather: a 5-minute real-time day/night loop smoothly
  fades the sky, sun, ambient light, and fog between midnight/dawn/noon/dusk,
  with a HUD label showing the current time of day; forest gateway torches
  burn visibly brighter at night. Rain occasionally rolls in (a following
  particle-based shower centered on your position) for a stretch of every
  10-minute weather cycle
- Simple quest system: three quests — Boar Cull, Wolf Hunter, and Moonpetal
  Gathering — tracked server-side and shown in a toggleable quest log (`L`);
  defeating the right mobs or collecting the right item advances progress
  automatically, and completing a quest grants XP and item rewards and
  announces it in chat

Accounts are stored alongside player saves in `server/data/accounts.json`
(gitignored, password hashes only — never plaintext).

Not included yet — see [ROADMAP.md](./ROADMAP.md).

## Project layout

```
server/   Node + Socket.io realtime server (authoritative-ish player state)
client/   Three.js + Vite browser client
```

## Running it locally

Requires Node.js 18+.

### 1. Start the server

```bash
cd server
npm install
npm start
```

The server listens on `http://localhost:3000` by default (override with the `PORT`
env var). A health check is available at `http://localhost:3000/health`.

### 2. Start the client

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Vite will print a local URL (typically `http://localhost:5173`) — open it in a
browser. Open it in multiple tabs/browsers (or have a friend on the same LAN load
your machine's IP) to see multiplayer in action.

If your server isn't on `localhost:3000`, set `VITE_SERVER_URL` in a `client/.env`
file, e.g.:

```
VITE_SERVER_URL=http://192.168.1.23:3000
```

Deploying this somewhere other players can reach it? See
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Controls

| Input                  | Action                          |
|-------------------------|----------------------------------|
| `W` / `A` / `S` / `D`   | Move (camera-relative)          |
| `Shift` (hold)          | Sprint                            |
| Mouse drag              | Orbit camera around your character |
| Scroll wheel            | Zoom camera in/out               |
| Click (no drag) / `F` / `Space` | Melee attack (cooldown applies) |
| `I`                     | Toggle inventory panel           |
| `L`                     | Toggle quest log                 |
| `Enter`                 | Focus chat box / send message    |
| `Esc`                   | Clear & unfocus chat box          |

On a touchscreen, a virtual joystick (bottom-left) replaces WASD, and a
Sprint/Attack/Inventory/Quest Log button stack (bottom-right) replaces
`Shift`/click-or-`F`/`I`/`L`. Dragging a finger anywhere else on the scene
orbits the camera, same as a mouse drag.

## Development notes

This project follows [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/):
`main` holds released/stable code, `develop` is the integration branch, and new
work happens on `feature/*` branches merged into `develop`.

See [CHANGELOG.md](./CHANGELOG.md) for release history,
[ROADMAP.md](./ROADMAP.md) for planned features, and
[DEPLOYMENT.md](./DEPLOYMENT.md) for hosting this on a cloud provider.

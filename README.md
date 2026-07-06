# Vanguard Rebooted

A simple, graphical 3D multiplayer prototype in the spirit of World of Warcraft: an
open outdoor area you can walk around in, see other connected players moving in
real time, and chat with them. Built to be a small, hackable foundation rather than
a full game.

- **Client**: [Three.js](https://threejs.org/) (WebGL) + [Vite](https://vitejs.dev/), runs in the browser
- **Server**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) + [Socket.io](https://socket.io/) for realtime state sync

## Features

- Character creation screen: pick a name and color before joining the world
- 3D outdoor world (ground, trees, rocks, lighting/shadows, sky/fog) spanning two
  distinct zones — the starting Meadow and the Whispering Forest to the north,
  reached on foot past a pair of stone gateway pillars
- Multiplayer: see other connected players move around in real time
- Third-person camera you orbit with the mouse and zoom with the scroll wheel
- WASD (or arrow key) movement, camera-relative
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

## Controls

| Input                  | Action                          |
|-------------------------|----------------------------------|
| `W` / `A` / `S` / `D`   | Move (camera-relative)          |
| Mouse drag              | Orbit camera around your character |
| Scroll wheel            | Zoom camera in/out               |
| Click (no drag) / `F` / `Space` | Melee attack (cooldown applies) |
| `I`                     | Toggle inventory panel           |
| `Enter`                 | Focus chat box / send message    |
| `Esc`                   | Clear & unfocus chat box          |

## Development notes

This project follows [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/):
`main` holds released/stable code, `develop` is the integration branch, and new
work happens on `feature/*` branches merged into `develop`.

See [CHANGELOG.md](./CHANGELOG.md) for release history and
[ROADMAP.md](./ROADMAP.md) for planned features.

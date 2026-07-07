# Vanguard Rebooted

A simple, graphical 3D multiplayer prototype in the spirit of World of Warcraft: an
open outdoor area you can walk around in, see other connected players moving in
real time, and chat with them. Built to be a small, hackable foundation rather than
a full game.

- **Client**: [Three.js](https://threejs.org/) (WebGL) + [Vite](https://vitejs.dev/), runs in the browser
  — or as a native desktop app via the [Electron](https://www.electronjs.org/)
  wrapper in `desktop/` (same client, no browser tab required)
- **Server**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) + [Socket.io](https://socket.io/) for realtime state sync

## Features

- Basic account/login: choose a username, password, and color on the login
  screen — the first login with a given name creates that account, every
  login after that must use the same password (see `server/accountStore.js`);
  a wrong password is rejected outright rather than silently handing you a
  guest identity
- Character classes: pick Warrior, Paladin, Rogue, or Mage on the login
  screen the first time your account is created — each nudges your max HP
  and melee damage differently (Paladin tankiest/softest hits, Rogue
  squishiest/hardest hits, Warrior balanced, Mage a glass cannon), shown
  alongside your level in the HUD (see `server/classes.js`). Your class is
  locked in for that account from then on, the same way your name/password
  are. Each class also looks visually distinct in the world: Warrior is
  broader-framed with steel pauldrons, Paladin has a golden collar and
  tabard, Rogue wears a dark hood, and Mage wears a pointed hat and a
  flowing robe (see `client/src/player.js`)
- Spell attacks: each class has one signature spell (`server/spells.js`),
  unlocked at level 3 — Warrior's Rending Strike, Paladin's Holy Smite (also
  heals you a little), Rogue's Shadow Strike, and the Mage's longer-ranged
  Arcane Bolt. Cast it with `Q` (or the 🔮 touch button) at the nearest
  in-range mob in front of you; it always hits harder than your plain melee
  attack but has its own, longer cooldown, shown in a dedicated HUD bar
- 3D outdoor world (a subtly patchwork-colored ground, grass, trees, rocks,
  soft shadows, a gradient sky dome, and fog) spanning two distinct zones —
  the starting Meadow (with a shimmering pond ringed by rocks and reeds) and
  the Whispering Forest to the north, reached on foot past a pair of stone
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
- Mob aggro: hitting a mob makes it hostile — it chases you down and strikes
  back every second or so until it or you dies, or you flee far enough from
  its home territory that it gives up and resumes wandering
- Respawn handling: defeated mobs come back to life at their spawn point after
  a short delay; a player defeated in combat respawns nearby a few seconds
  later with full health
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
  10-minute weather cycle; fireflies drift through the Whispering Forest once
  it gets dark enough
- Simple quest system: three quests — Boar Cull, Wolf Hunter, and Moonpetal
  Gathering — tracked server-side and shown in a toggleable quest log (`L`);
  defeating the right mobs or collecting the right item advances progress
  automatically, and completing a quest grants XP and item rewards and
  announces it in chat
- Guilds/parties: group up with other players (`P` to open the party panel)
  — invite by name, accept/decline incoming invites, see the whole party's
  names, leader status, and live HP at a glance, and leave or disband the
  party; groups are capped at 5, and leadership automatically passes to
  another member if the leader leaves
- Proximity voice chat: toggle your mic (`V`, the HUD button, or a touch
  button) and automatically hear/be heard by other players near you over a
  live WebRTC connection — no call/invite step, it just connects as you walk
  into range and disconnects as you walk out. A small 🎤 icon on a
  nameplate shows who currently has their mic on
- Esc game menu: `Esc` (or the ☰ touch button) opens a Resume / Save Game /
  Exit to Login menu. "Save Game" persists your progress immediately and
  confirms it; "Exit to Login" disconnects and returns you to the login screen
- Store NPC: a "Wandering Merchant" you can shop with (`B`, or the 🛒 touch
  button, while standing near them) — spend gold coins you've collected on
  health draughts, moonpetals, gear, or a one-time class spellbook that
  instantly unlocks your class's spell early, bypassing the normal level-3
  requirement (see `server/store.js`)
- Quest NPC: a quest giver, "Elder Maren," you can talk to (`N`, or the 📋
  touch button, while standing near them) — opens a Quest Board panel
  listing the same quest descriptions and progress as the `L` quest log.
  Quests still auto-track and auto-grant their reward on kill/collect
  regardless of whether you've talked to her; she's a physical presence for
  the existing quest system, not a new requirement (see `server/questNpc.js`)

Accounts are stored alongside player saves in `server/data/accounts.json`
(gitignored, password hashes only — never plaintext).

Not included yet — see [ROADMAP.md](./ROADMAP.md).

## Project layout

```
server/   Node + Socket.io realtime server (authoritative-ish player state)
client/   Three.js + Vite browser client
desktop/  Electron wrapper that packages client/ as a native desktop app
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

### 3. (Optional) Run it as a desktop app instead of a browser tab

`desktop/` wraps the exact same client in [Electron](https://www.electronjs.org/)
so it runs as a standalone window instead of a browser tab — no separate game
logic to maintain, it just loads the client.

For development (hot-reloading against the Vite dev server from step 2 above):

```bash
cd desktop
npm install
npm run dev
```

For a "production-like" run against a real built client:

```bash
cd client && npm run build && cd ..   # produces client/dist/
cd desktop
npm install
npm start
```

`desktop/main.js` loads `client/dist/index.html` directly when
`ELECTRON_START_URL` isn't set (that's what `npm run dev` sets, pointing at
the Vite dev server; `npm start` leaves it unset). Which server the client
connects to is still decided by `VITE_SERVER_URL` at `client` build time, the
same as any other static host — see step 2 above and
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Controls

| Input                  | Action                          |
|-------------------------|----------------------------------|
| `W` / `A` / `S` / `D`   | Move (camera-relative)          |
| `Shift` (hold)          | Sprint                            |
| Mouse drag              | Orbit camera around your character |
| Scroll wheel            | Zoom camera in/out               |
| Click (no drag) / `F` / `Space` | Melee attack (cooldown applies) |
| `Q`                     | Cast your class spell (once unlocked at level 3) |
| `I`                     | Toggle inventory panel           |
| `L`                     | Toggle quest log                 |
| `P`                     | Toggle party panel                |
| `V`                     | Toggle mic (proximity voice chat) |
| `B`                     | Open the merchant's store (must be standing near them) |
| `N`                     | Open the quest board (must be standing near Elder Maren) |
| `Enter`                 | Focus chat box / send message    |
| `Esc`                   | Clear & unfocus chat box (while chatting); otherwise open the game menu |

On a touchscreen, a virtual joystick (bottom-left) replaces WASD, and a
Sprint/Attack/Spell/Inventory/Quest Log/Party/Mic/Store/Quest Board/Menu
button stack (bottom-right) replaces
`Shift`/click-or-`F`/`Q`/`I`/`L`/`P`/`V`/`B`/`N`/`Esc`. Dragging a finger
anywhere else on the scene orbits the camera, same as a mouse drag.

## Development notes

This project follows [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/):
`main` holds released/stable code, `develop` is the integration branch, and new
work happens on `feature/*` branches merged into `develop`.

See [CHANGELOG.md](./CHANGELOG.md) for release history,
[ROADMAP.md](./ROADMAP.md) for planned features, and
[DEPLOYMENT.md](./DEPLOYMENT.md) for hosting this on a cloud provider.

# Vanguard Rebooted

A simple, graphical 3D multiplayer prototype in the spirit of World of Warcraft: an
open outdoor area you can walk around in, see other connected players moving in
real time, and chat with them. Built to be a small, hackable foundation rather than
a full game.

- **Client**: [Three.js](https://threejs.org/) (WebGL) + [Vite](https://vitejs.dev/), runs in the browser
- **Server**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) + [Socket.io](https://socket.io/) for realtime state sync

## Features

- 3D outdoor world (ground, trees, rocks, lighting/shadows, sky/fog)
- Multiplayer: see other connected players move around in real time
- Third-person camera you orbit with the mouse and zoom with the scroll wheel
- WASD (or arrow key) movement, camera-relative
- Global text chat
- Name tags floating above each character
- Basic melee attack (click or `F`/`Space`) with a cooldown, synced to other players

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
| `Enter`                 | Focus chat box / send message    |
| `Esc`                   | Clear & unfocus chat box          |

## Development notes

This project follows [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/):
`main` holds released/stable code, `develop` is the integration branch, and new
work happens on `feature/*` branches merged into `develop`.

See [CHANGELOG.md](./CHANGELOG.md) for release history and
[ROADMAP.md](./ROADMAP.md) for planned features.

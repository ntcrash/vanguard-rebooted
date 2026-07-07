# Deployment Guide

This project is two independently deployable pieces:

```
server/   Node + Express + Socket.io realtime server (stateful — holds live
          player/mob state in memory, persists saves to server/data/*.json)
client/   Three.js + Vite static site (builds to plain HTML/JS/CSS)
```

The server needs a place that keeps a **long-running Node process** (not a
serverless/edge function — Socket.io needs a persistent connection) and,
ideally, **persistent disk** so `server/data/` survives restarts/redeploys.
The client is a static build and can be hosted almost anywhere, including
for free, separately from the server.

This guide is written for any generic Node host; a few concrete options are
called out where the steps differ.

## 1. Pick a host for the server

Any of these work well for a small Node + WebSocket app:

- **Render** (Web Service) — simplest option with a free/low-cost persistent
  disk add-on for `server/data/`. Auto-detects Node, deploys on git push.
- **Railway** — similar to Render, has a "Volume" feature for persistent disk.
- **Fly.io** — deploys as a small VM (a "Fly Machine"), supports persistent
  volumes, good if you want the server physically close to your players.
- **A plain VPS** (DigitalOcean, Hetzner, Linode, etc.) — most control, but
  you own the process manager, reverse proxy, and TLS setup yourself (see
  §5 below).

Whichever you pick, the important settings are the same:

| Setting        | Value                                      |
|----------------|---------------------------------------------|
| Root directory | `server/`                                   |
| Build command  | `npm install`                               |
| Start command  | `npm start` (runs `node index.js`)          |
| Node version   | 18 or newer                                 |
| Port           | Read from the `PORT` env var (already wired up — the platform sets this for you; don't hardcode 3000 in production) |

## 2. Environment variables

Set these on the server host:

| Variable      | Required? | Purpose |
|---------------|-----------|---------|
| `PORT`        | Usually set automatically by the host | Port the server listens on. Defaults to `3000` locally. |
| `CORS_ORIGIN` | Recommended for production | Restricts which browser origin(s) may open a Socket.io connection. Defaults to `*` (any origin) if unset, which is fine for local dev but should be locked down once the client has a real URL. Comma-separate multiple origins, e.g. `https://play.example.com,https://staging.example.com`. |

Nothing else needs a secret — there's no third-party API key in this
project. Account passwords are hashed at rest (`server/accountStore.js`,
Node's built-in `crypto.scrypt`) and never leave the server.

## 3. Persistent data

`server/data/accounts.json` and `server/data/players.json` are how player
accounts and saved progress survive a restart. They're gitignored (never
committed) and written atomically (temp-file-then-rename) by
`accountStore.js`/`playerStore.js`.

**This directory must live on a persistent volume**, not the platform's
ephemeral/container filesystem, or every redeploy silently wipes every
player's account and progress:

- **Render**: add a "Disk" in the service settings, mount it at
  `/opt/render/project/src/server/data` (or wherever your build path puts
  `server/data`), 1 GB is overkill for this project's needs.
- **Railway**: add a "Volume", mount it at the equivalent `server/data` path.
- **Fly.io**: create a volume (`fly volumes create`) and mount it in
  `fly.toml` at `/app/server/data`.
- **VPS**: no extra step needed — the disk is already persistent — just make
  sure `server/data/` isn't inside a path that gets wiped by your deploy
  script (e.g. a `git clean -fdx` before pulling new code).

Back up that directory periodically (it's the entire "database") — a
simple cron `tar`/copy to another disk or object storage is enough for a
project this size.

## 4. Build and host the client

The client is a static Vite app — build it once and host the output
anywhere that serves static files:

```bash
cd client
npm install
VITE_SERVER_URL=https://your-server-host.example.com npm run build
```

This produces `client/dist/`. `VITE_SERVER_URL` is baked into the build at
build time (Vite inlines `import.meta.env.*` at build time, not runtime), so
point it at the server's real public URL *before* building, not after.

Host `client/dist/` on any static host:

- **Netlify / Vercel / Cloudflare Pages / GitHub Pages** — point the build
  at `client/`, build command `npm run build`, publish directory `dist`.
  Set `VITE_SERVER_URL` as a build-time environment variable in the host's
  dashboard.
- **Serve it from the same server** — if you'd rather run one host instead
  of two, add `app.use(express.static("../client/dist"))` (and a catch-all
  route returning `index.html` for client-side routing, though this project
  doesn't currently have any) to `server/index.js`, and build the client
  into a location the server can see at runtime. Simpler ops (one deploy),
  but couples client and server releases together — the two are currently
  deployed independently, so this is a deliberate trade-off, not a bug.

## 5. Reverse proxy / TLS (VPS only)

Render/Railway/Fly/Netlify/Vercel handle TLS and reverse-proxying for you.
On a plain VPS, put Nginx (or Caddy) in front of the Node process:

- Terminate TLS at the proxy (e.g. via Let's Encrypt/Certbot).
- Proxy `/` to `http://127.0.0.1:3000` (or whatever `PORT` you chose).
- **Socket.io needs WebSocket upgrade headers forwarded**, or it'll silently
  fall back to slower HTTP long-polling. For Nginx, that means including
  `proxy_set_header Upgrade $http_upgrade;` and
  `proxy_set_header Connection "upgrade";` on the relevant `location` block.
- Run the Node process under a supervisor so it restarts on crash/reboot —
  either `pm2` (`pm2 start index.js --name vanguard-server`) or a `systemd`
  unit calling `npm start` from `server/`.

## 6. Verify the deployment

1. Hit `https://your-server-host.example.com/health` — should return
   `{"ok":true,"players":0,"mobs":11,"mobsAlive":11}` (mob count may differ
   if `MOB_SPAWNS` changes).
2. Load the deployed client URL, log in, and confirm you can move, chat, and
   see your player in the world.
3. Open the client in a second browser/tab and confirm both players see each
   other move in real time (confirms the WebSocket upgrade actually worked,
   not just the initial HTTP handshake).
4. Restart the server process and log back in as the same account — your
   saved level/inventory/position should be restored (confirms the
   persistent volume from §3 is actually mounted where the app expects it,
   not just configured in the dashboard).

## 7. Voice chat (WebRTC) behind restrictive networks

Proximity voice chat (`client/src/voice.js`) uses a public STUN-only
configuration (`stun:stun.l.google.com:19302`) to establish peer
connections. STUN alone is enough for most home/office NATs, but players
behind especially restrictive NATs or corporate firewalls that block direct
peer-to-peer UDP may fail to connect audio to each other even though
everything else in the game (movement, chat, combat) works fine over the
existing Socket.io connection, since that's plain WebSocket/HTTP traffic and
not affected by this at all.

If that turns out to matter for your players, add a TURN server (which
relays audio when a direct connection can't be established) to the
`ICE_SERVERS` array in `client/src/voice.js` — e.g. a self-hosted
[coturn](https://github.com/coturn/coturn) instance, or a managed TURN
provider (Twilio, Cloudflare, Xirsys, and others all offer one). This is the
only part of the voice chat feature that costs anything to run beyond your
existing server/client hosting — signaling itself (who's near whom, and
relaying the SDP/ICE handshake) is handled entirely by the existing
Socket.io server at no extra infrastructure cost.

## Not covered yet

- No CI/CD pipeline is set up in this repo — deploys are triggered manually
  or via each host's own git-push-to-deploy integration.
- No horizontal scaling story: this server keeps all state in a single
  process's memory (the `players`/`mobs`/`pickups` maps in
  `server/index.js`), so it can only ever run as one instance. Running more
  than one instance behind a load balancer would need a shared state store
  (e.g. Redis) and Socket.io's Redis adapter — out of scope for this
  prototype.

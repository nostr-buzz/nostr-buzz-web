# nostr.buzz push server

Delivers notifications while the app is closed.

Browsers only wake a closed web app for a Web Push message, and a Web Push message has to be sent by a
server. This small Node service does that and nothing else:

1. A device registers its push subscription and the pubkeys it wants to hear about
   (the user's pubkey and the keys of their groups).
2. The server keeps WebSockets open to the device's inbox relays and subscribes to gift wraps
   (kind `1059`) and, optionally, legacy DMs (kind `4`) for those pubkeys.
3. Each new event is forwarded, **still encrypted**, as a Web Push message.
4. The service worker on the device decrypts it and shows the notification.

The server never receives private keys or message text.

## What the server can see

- Which pubkey belongs to which push subscription, and which relays it reads.
- When an encrypted event for that pubkey arrives (not who sent it, not what it says).
- The ids of gift wraps a user published themselves (sent so their own devices are not alerted).

## Run it

Needs Node 22 or newer and a disk that survives restarts.

```bash
cd push-server
npm install
npm start
```

Or with Docker:

```bash
docker build -t nostr-buzz-push push-server
docker run -d --restart=always -p 8787:8787 -v nostr-buzz-push:/data nostr-buzz-push
```

Put it behind HTTPS (Caddy, nginx, Fly.io, Railway, Render...). It must be **one always-on process**:
serverless platforms that sleep will miss messages.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `DATA_DIR` | `./data` | Where subscriptions and the VAPID keys are stored |
| `ALLOWED_ORIGINS` | `*` | Comma separated origins allowed to call the API, e.g. `https://nostr.buzz` |
| `VAPID_SUBJECT` | `https://nostr.buzz` | Contact URL or `mailto:` sent to push services |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Set both to bring your own keys |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For` |
| `MAX_SUBSCRIPTIONS` | `50000` | Upper bound on registered devices |
| `TURN_URLS` / `TURN_SECRET` | none | Optional TURN relay for calls (coturn `use-auth-secret`), e.g. `turn:turn.example.com:3478` |

Keep `DATA_DIR/vapid.json`. If the VAPID keys change, every device has to subscribe again.

## Connect the web app

Build the app with the server's public URL:

```bash
VITE_PUSH_SERVER_URL=https://push.example.com npm run build
```

On GitHub Pages, add a repository variable named `PUSH_SERVER_URL` (Settings → Secrets and variables →
Actions → Variables). The deploy workflow passes it to the build.

Without it the app still shows notifications while it is open in the background, but not when closed.

## API

All bodies are JSON. `token` is a random 64-hex secret made by the device.

| Route | Body | Purpose |
| --- | --- | --- |
| `GET /health` | | Liveness and counters |
| `GET /vapid` | | `{ key }`, the VAPID public key |
| `GET /ice` | | `{ iceServers }` for calls: STUN, plus short-lived TURN credentials when configured |
| `POST /subscribe` | `{ token, owner, subscription, watch[], relays[], legacy }` | Register or update a device |
| `POST /unsubscribe` | `{ token }` | Remove a device |
| `POST /ignore` | `{ token, ids[] }` | Skip these event ids for the owner's devices (own messages) |
| `POST /test` | `{ token }` | Send a test notification |

## Limits

- Relays that only serve gift wraps after NIP-42 AUTH (for example `auth.nostr1.com`) cannot be watched,
  because the server has no key to authenticate with. Keep at least one open inbox relay.
- Push endpoints must belong to Google, Mozilla, Apple or Microsoft push services.
- Relay URLs must be public `wss://` hosts.

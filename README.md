<div align="center">
  <img src="public/bee.png" alt="nostr.buzz bee" width="120" />
  <h1>nostr.buzz</h1>
  <p><strong>Private chats on Nostr with a BUZZ! 🐝</strong></p>
  <p><a href="https://nostr.buzz">nostr.buzz</a></p>
</div>

A fast, mobile-friendly [Nostr](https://nostr.com) messenger. Chats are end-to-end encrypted (NIP-17).
Send a **BUZZ** to shake your friend's screen with sound and vibration.

## Features

- 🐝 **BUZZ**: shake your friend's screen with sound + vibration (8-second cooldown, strangers can't buzz you by default)
- 🔒 **Private DMs**: NIP-17 gift-wrapped messages with NIP-44 encryption; metadata stays hidden
- 👥 **Group chats**: encrypted rooms of up to 10 people with an optional group name
- 📎 **Encrypted files**: photos, videos and files are AES-GCM encrypted on-device before upload (Blossom)
- 💬 **Telegram-style chat**: replies, reactions, edit, delete for everyone, emoji picker, drafts, pinned & muted chats, unread badges, Saved messages, message requests
- 🔔 **Push notifications**: messages and buzzes reach you even with the app closed, decrypted on your device
- 🔄 **Updates itself**: open tabs and installed apps move to each new release on their own, without losing drafts
- 📷 **Scan to chat**: scan someone's QR code with the in-app camera (or from a photo), and show your own
- 📱 **Feels native on phones**: swipe a chat to pin, mute or mark it read, swipe a message to reply, app icon badge
- 🌍 **RTL friendly**: Persian/Arabic messages render right-to-left with the Vazirmatn font
- 🌗 **Light & dark** themes, installable as a PWA, works great from 360px phones to desktops
- ↩️ **Legacy support**: reads NIP-04 DMs and replies with NIP-04 to people who haven't upgraded

Protocol details (including the buzz convention) are documented in [NIP.md](NIP.md).

## Development

```bash
npm install
npm run dev      # http://localhost:8080
npm test         # type check, lint, unit tests and production build
npm run build    # production build in dist/
```

Built with React 19, TypeScript, Vite, TailwindCSS 4, shadcn/ui and [Nostrify](https://nostrify.dev).

## Deployment

Every push to `main` runs `.github/workflows/deploy-pages.yml`, which tests and builds the app and publishes
`dist/` to GitHub Pages at **https://nostr.buzz** (`public/CNAME`). The build also writes `dist/404.html`
so deep links such as `/chat/npub1…` work on GitHub Pages.

In the repository settings, **Pages → Build and deployment → Source** must be set to **GitHub Actions**.

### Push notifications

GitHub Pages only serves static files, so notifications with the app closed need the small always-on
service in [`push-server/`](push-server/README.md). Host it anywhere that runs Node or Docker, then add a
repository variable `PUSH_SERVER_URL` (Settings → Secrets and variables → Actions → Variables) with its
HTTPS URL and redeploy. Without it, notifications work only while the app is open.

On iPhone and iPad, notifications work after the app is added to the Home Screen.

The previous static landing page is kept in [`docs/`](docs/).

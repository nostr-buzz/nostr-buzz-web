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
- 🔔 **Notifications**: sounds and desktop notifications for new messages and buzzes
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

The previous static landing page is kept in [`docs/`](docs/).

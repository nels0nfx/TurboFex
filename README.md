# ⚡ TurboFex v0.4.0

[![CI](https://github.com/nels0nfx/TurboFex/actions/workflows/ci.yml/badge.svg)](https://github.com/nels0nfx/TurboFex/actions/workflows/ci.yml)

WhatsApp group management and assistant bot by **Nelson Fx** (Trinity Flow). It runs on Node.js with the
[Baileys](https://github.com/WhiskeySockets/Baileys) library and is built to run for months without attention:
it reconnects by itself, backs up its login, updates itself safely and protects the server it runs on.

> Unofficial bots can get a number banned. Use a spare number for the bot, never your main one.

## Features
- **210+ commands** in 18 categories (group management, security, community, lookup, status tools, games, media, audio/video/picture editing, budget, tools...). Send `.menu`.
- **Link previews:** every message with a link shows the preview card (picture, title, description).
- **Private by default.** Only the owner can use commands; everybody else gets no reply at all. `.mode public` opens it up.
- **Formatted replies.** Every command reply uses WhatsApp formatting (bold titles and labels, `▸` bullets, commands in monospace).
- **Safe in production:** server protection for heavy commands, safe self-update with automatic rollback, daily login backup, write-behind key store for fast replies.
- **Watchers:** auto view-once, anti-delete and anti-edit (also for the new sealed edits), auto view / like / save for statuses.
- **Reactions** (⏳ then ✅), **watermark** under results, **sticker credit**, **AFK** that tells each person once.

## Requirements
- Node.js **20 or newer**
- A WhatsApp number for the bot
- Optional tools (only the commands that need them are affected if missing): `sharp` (pictures), `ffmpeg` (audio/video), `qrcode`

## Quick start
1. Upload the files (or the release zip) to your host and unarchive them. On a Pterodactyl panel use the **Files** tab and **Unarchive**.
2. Open `config.js` and set `ownerNumber` (your personal number) and, optionally, `pairingNumber` (the bot's number). Country code, digits only, no `+`. Every setting can also be an environment variable.
3. Make sure the host runs `npm install`, then start it with `npm start`.
4. Link the bot (see below), add it to a group, make it admin, and send `.ping`.

### Linking the bot
Since **28 July 2026** WhatsApp links new devices differently and the WhatsApp library does not handle it. TurboFex handles it itself:
1. Start the bot with an **empty** `session/` folder. A **QR code** is drawn in the console (or a pairing code if you set `pairingNumber`).
2. On your phone open WhatsApp → Linked devices → Link a device and scan the QR (or enter the pairing code).
3. The bot saves the login in `session/` and restarts. From then on it reconnects by itself.

If the QR expires, restart the process. If linking fails, delete the `session/` folder and try again.

## Config
All settings are in `config.js` (or environment variables of the same name):

| Setting | Env | Default | Notes |
|---------|-----|---------|-------|
| `ownerNumber` | `OWNER_NUMBER` | (required) | Your number, country code + digits, no + |
| `pairingNumber` | `PAIRING_NUMBER` | none | Bot number for pairing code instead of QR |
| `prefix` | `PREFIX` | `.` | Command prefix |
| `mode` | `MODE` | `private` | `private` or `public` |
| `botName` | - | TurboFex | Fixed in code |

See `config.js` for the full list (anti-spam, capacity, update interval, etc.).

## Commands
Send `.menu` for the full list, grouped by category. Owner-only and admin-only commands are marked.

## Hosting
Works on any Node host: VPS, Pterodactyl, Render, Railway, etc. Use a process manager (pm2, or the panel's) so it restarts on crash. Keep the `session/` and `data/` folders persistent across restarts.

## Update
The bot checks for updates from this repository (see `update.json`). When a new version is available it can download and apply it safely (with rollback if the new version fails to start). You can also force an update with `.update`.

## Troubleshooting
- Bot stops answering: send `.repair` (clears chat sessions, you stay logged in). Make sure the number is linked to only ONE running bot.
- `.status` shows version, library version, loaded commands, watcher counters and problems. `.statusinfo` shows status counters and the like route.
- View-once files arrive empty on linked devices. Reply to them with `.vv`.

## Security
- **`session/` and `data/` hold the bot's login and private data. Never commit or share them.** The included `.gitignore` excludes them.
- Owner commands (`.block`, `.update`, `.restart`, `.loginbackup`...) are limited to the owner number; destructive ones to the main owner only.
- Update notes and links come from `update.json` (the repo to update from). Point it to your own repository if you fork this project.
- The bot only fetches PUBLIC web addresses (link previews, downloads, lookups): private, local and cloud-metadata addresses are refused, also after redirects.
- The bot name is part of the code: it cannot be changed from a panel setting, and editing `core/brand.js` stops the bot from starting.

## Development
```
npm test        # unit tests (no network, no WhatsApp, no install needed)
```
- `index.js` supervises `core/boot.js`; `whatsapp/` holds the connection, handler and features; `commands/` has one file per command (or a list of related ones); `core/` holds shared services (updater, backup, capacity guard...); `tests/` has the tests, which also run on every push (GitHub Actions).
- A command is `{ name, aliases?, category, description, run(ctx) }`. Optional: `ownerOnly`, `realOwnerOnly`, `adminOnly`, `groupOnly`, `botAdminRequired`, `slow`, `weight: 'light'|'medium'|'heavy'`, `needs: [...]`, `format: false`, `noReact`, `watermark`. The tests check names, aliases (no duplicates), categories and descriptions.
- Replies are formatted automatically (see `whatsapp/format.js`); write plain text and it comes out formatted, or write your own WhatsApp formatting and it is left alone.
- **Publishing an update:** bump `version` in `package.json`, add notes at the top of `changelog.txt`, run `npm test`, then upload the new `turbofex-latest.zip` to the main page of the GitHub repo. Every bot picks it up on its next check or restart.

## Community and support
- 💬 Support group (Telegram): https://t.me/+7PwU2Vo9czE1NTRk
- 📣 Telegram channel: https://t.me/+e89lCBU2wLpjNWNk
- 🟢 WhatsApp channel: https://whatsapp.com/channel/0029VbDpuKM8qIzkoQscOE2w
- 💻 GitHub: https://github.com/nels0nfx/TurboFex

# TurboFex: project guide for developers and AI assistants

This is the handover document. It explains how TurboFex is built so a new developer, or a new Claude session, does not have to
rediscover it. It was written during the v0.9.2 audit from the actual source. Anything this guide could not verify is listed under
**Known limitations and open items**. [`AGENTS.md`](AGENTS.md) covers how the owner packages, pushes and releases (Termux, flat ZIP, GitHub Release);
read it before you hand over any ZIP. The public, user-facing guide is [`README.md`](README.md).

Contents: 1 Overview · 2 Architecture · 3 Folder structure · 4 WhatsApp and Baileys · 5 Pairing and session ID · 6 Commands · 7 Permissions ·
8 Messages and events · 9 Data storage · 10 Configuration · 11 Dependencies · 12 Error handling and logging · 13 Updating and rollback ·
14 Testing · 15 Deployment · 16 Decisions · 17 Known limitations · 18 Instructions for AI assistants

## 1. Overview

TurboFex is a WhatsApp group-management and assistant bot (Node.js 20 or newer, CommonJS, no build step) on the Baileys library
(`@whiskeysockets/baileys`, pinned to `7.0.0-rc14`). Version is in `package.json`. The owner is a non-developer who works from a phone, so
**code comments are written in simple English**; keep that style.

## 2. Architecture

```
index.js (supervisor)
  └─ spawns itself as a child with FLASH_CHILD=1 ──► core/boot.js
        1. quiet the library logs (core/quiet.js)
        2. auto-update check (core/updater.js)
        3. restore login from a session ID if one is given (core/sessionid.js)
        4. is it linked? (core/setup.js)  no → print the steps and wait (the process stays alive)
        5. whatsapp/connection.js: start the socket, wire the events
              └─ whatsapp/handler.js: every incoming message
                    ├─ protections (whatsapp/protect.js), passive features (passive.js, chatbot.js, play/)
                    └─ commands/*.js (one file = one command or a list of related commands)
```

- `index.js` restarts the child when it exits with code **42** (`core/restart.js`), stops on **43** (bot name was edited, `core/integrity.js`), rolls
  back a bad update when the child crashes within 10 minutes of an update, and gives up after more than 5 restarts in 60 seconds.
- `core/boot.js` also installs the auto-repair for floods of "Bad MAC" decryption errors (clears chat sessions, not the login, at most every 3 hours) and
  global `unhandledRejection` / `uncaughtException` loggers (they log and keep the process alive; see limitations).

## 3. Folder structure

| Path | Purpose |
|---|---|
| `index.js` | Supervisor: start, restart (code 42), rollback |
| `config.js` | Reads settings from environment variables and `data/setup.json` |
| `core/` | Engine: boot, updater, session ID, setup, storage helpers, web helpers (`safefetch`, `http`, `linkpreview`), capacity guard, backups, brand and integrity |
| `core/realm/` | The Empire of Fex game logic: money (`aurum`), `market`, `trade`, `auction`, `gov`, `court`, `guild`, `dungeon`, `god` (owner tools), `settings`, `ledger`, `ui` |
| `whatsapp/` | Connection, handler, store, protections, watchers, welcome, levels, formatting, menu categories; `whatsapp/play/` has the chat games |
| `commands/` | Command files (about 190 files, 335 commands, 224 aliases) |
| `tests/` | Node built-in tests, one file per area; `tests/_setup.js` points data to a temporary folder |
| `update.json` | Which GitHub repo and branch the updater reads |
| `removed.txt` | Files to delete on bots that update themselves |
| `changelog.txt` | Newest first; the updater shows it |
| `session/`, `data/`, `session_id.txt`, `config.env`, `.env` | Live data; in `.gitignore`; never commit, never ship in a ZIP |

## 4. WhatsApp integration and Baileys

- `core/baileys.js` wraps the library (version lookup, a test hook `setForTests`). `whatsapp/connection.js` builds the socket with `useMultiFileAuthState(sessionDir)`
  (default folder `session/`), adds the optional write-behind key store (`core/fastkeys.js`, off with `FAST_KEYS=off`), a message cache for retries (`whatsapp/outbox.js`),
  and a custom `getUrlInfo` for link previews (`core/linkpreview.js`).
- Events wired in `connection.js`: `creds.update` (save login), `connection.update` (open, close, reconnect, logged out), `messages.upsert` (to the handler),
  `group-participants.update` (welcome, goodbye, promote/demote guard, raid protection), `call` (anti-call).
- Reconnect: on close it waits and calls `startWhatsApp()` again. `loggedOut` removes the saved login and returns to the "link again" instructions;
  `connectionReplaced` (the same number running in two places) stops fighting; `restartRequired` reconnects at once.
- `core/pairfix.js` is a workaround for a WhatsApp change (July 2026) that breaks linking a *new* device from the library. It is only used while the bot is not linked. Remove it when the library fixes this itself.
- Messages that arrive while reconnecting are still answered if they are younger than 120 seconds (`FRESH_SECONDS`).

## 5. Pairing system and the pairing website

The pairing website (https://turbofex-pair.onrender.com) is a **separate project** (a free Render service). Its source is not in this repository. What is known:

- A person links their number on the site (pairing code or QR) and gets a session ID `TFX-XXXX-XXXX-XXXX` (letters without the ambiguous ones, digits 2 to 9).
  The site shows "Session ID lasts 5 min" and says the data is deleted after collection (read from the live page during this audit).
- The bot downloads the login with `GET <PAIR_SITE_URL>/api/session/<ID>` (`core/sessionid.js`). `400`/`404` means unknown or already used or expired; the bot waits up to 45 s per try and tries 3 times for a sleeping site.
- The bot remembers the ID it used (`data/session-id.json`, a hash only), so an old ID left in `session_id.txt` does nothing. A **new** ID replaces the current login and keeps the old one in `data/session-previous`.
- The ID can be put in `session_id.txt` (`SESSION_ID=...`, created automatically with the steps), in `config.env`, or in the host variable `SESSION_ID` (the variable wins).
- The linked number becomes the bot number and the owner (`config.js`, `core/setup.js`). An unlinked bot prints the steps and **waits**; it never asks anything in the console unless `CONSOLE_LINK=1`.
- **Expiry wording:** every place agrees on *works once, expires after 5 minutes*: `README.md`, `AGENTS.md`, `core/sessionid.js`, `core/setup.js`, the generated `session_id.txt` and the site page.
  The old "24 hours" wording was fixed in v0.9.1 and is guarded by a test. The 5 minutes is enforced by the site, not by the bot; the bot only reports it.
- The bot-side contract is tested with a fake site. The test against the real site code is skipped when the `pairsite` folder is absent (it is absent here).

## 6. Command registration and development conventions

`whatsapp/handler.js` loads every `commands/*.js` at start. A file exports one command object or an array. Registration: `commands.set(name)` plus every alias; a file that fails to load is
recorded in `diag.loadErrors`, and the owner is told if they try that command. A command is:

```js
module.exports = {
  name: 'weather',            // required, unique
  aliases: ['w'],             // optional, unique across all commands
  category: 'lookup',         // must exist in whatsapp/categories.js
  description: 'Weather for a city: weather Lagos',   // required, shown in menu and list
  // optional flags:
  ownerOnly: true, realOwnerOnly: true, adminOnly: true, groupOnly: true, botAdminRequired: true,
  everyone: true,            // also works in PRIVATE mode for members (use sparingly)
  slow: true, weight: 'light|medium|heavy', needs: ['sharp'], format: false, noReact: true, watermark: true,
  async run(ctx) { /* ctx.reply(text), ctx.args, ctx.rest, ctx.prefix, ctx.isOwner, ctx.isAdmin, ctx.sock, ctx.jid, ... */ },
};
```

Conventions:
1. **Missing input:** say what is missing, show the command with the real prefix (`${ctx.prefix}`), give one realistic example. Never answer "Invalid input".
2. **Replies are plain text.** `whatsapp/format.js` adds WhatsApp formatting automatically (it leaves text that already has formatting alone, long text over 3500 characters, `format: false` commands, and "content" commands such as jokes, in their own way).
3. **Public vs owner errors:** show members a simple sentence; add technical `Reason:` text only when `ctx.isOwner` (see `commands/weather.js`, `whatsapp/media.js`). Never put paths, stack traces, package names or "run npm install" in a member-visible reply.
4. **Never say it worked when it did not.** Check the result of WhatsApp calls before replying with a tick.
5. **Permissions are silent** (section 7). Do not add `reply('Only admins can...')`.
6. Add the command to a category; add a test; the tests check names, aliases, categories and descriptions.

## 7. Permissions and access control

Roles come from `getRoles()` in `handler.js`: `isRealOwner` (the linked number or `OWNER_NUMBER`), `isOwner` (real owner or a sudo user, `data/groups.json`), `isAdmin`/`isBotAdmin` (group metadata), `isBanned`.

Order of checks for a command (v0.9.2): banned → unknown command → **private mode** (non-owner without `everyone` → silent) → **permission flags** (`realOwnerOnly`, `ownerOnly`, `adminOnly` → silent) →
disabled-in-group notice → maintenance notice → rate limit → `groupOnly` → `botAdminRequired` → capacity guard → run.

**Rule from the owner (v0.9.2): a person who may not use a command gets no reply at all** (no denial, warning or explanation, in groups or in private), for owner-only, admin-only and role-restricted commands.
The permission check was moved *before* the rate limit and the group-only notice so that nothing else can answer them either. Sub-actions inside commands follow the same rule
(`rank on/off`, `herald on/off`, `realm on/off`, `delete`, `schedule`, `filter`, `stop`, `unschedule`, `birthday on/off`, `antipromote`/`antidemote`, `endgame`; locked `promote`/`demote`).
Still answered on purpose: "this command is turned off in this group" (an admin setting, not a role), "maintenance", "slow down" for people who are allowed, and **in-game offices of the Empire**
(Sovereign, Treasurer, Marshal, guild leader: for example "Only the Sovereign can pardon"). Those are game rules, not bot permissions; see open items if the owner wants them silent too.

## 8. Events and message handling

`handleMessageInner` in `handler.js`: ignore broadcasts/newsletters → edits and deletes go to the watchers → drop our own and duplicate messages → learn names and ids → watchers (view-once, anti-delete, anti-edit) →
banned check → private-message blocker → group protections and counters → ranks and Aurum for chatting → decide if it is a command (prefix or no-prefix mode, games may claim a word) →
passive features (games, AFK, auto-replies, chatbot) → command dispatch. `runText` runs a scheduled command as the owner (`msg.synthetic`).
Slow commands (`slow: true`) run in the background so the chat is not blocked.

## 9. Data storage and persistence

Everything saved lives in `data/` (override with `TURBOFEX_DATA`; tests use a temporary folder). JSON files are written by `core/jsonstore.js` (kept in memory, written a moment later and always on stop/restart).
Known files: `groups.json` (group settings and bot settings, `whatsapp/store.js`), `setup.json` (number), `session-id.json`, `session-previous/`, `session-backup/` (last 3 login copies, daily), `rollback/`, `maintenance.json`, `last-repair.txt`,
plus per-feature stores (levels, notes, birthdays, stats, the Empire in `core/realm/state.js` with a ledger of owner changes). Realm data is **per group**; nothing is shared between groups.
**Never delete or reset `data/`** and never write a migration that changes balances without a backup and the owner's approval.

## 10. Configuration and environment variables

`config.js` reads the environment; an optional `config.env` (`KEY=value`, `#` notes) is loaded first by `core/envfile.js` and never overrides a host variable. Names only, no values:

`SESSION_ID`, `PAIR_SITE_URL`, `NUMBER` / `PAIRING_NUMBER`, `OWNER_NUMBER` (legacy), `PREFIX`, `TIMEZONE`, `BOT_BROWSER`, `CONSOLE_LINK`, `PAIR_METHOD`, `FAST_KEYS`, `RESTORE_LOGIN`, `YTDLP_PATH`, `YTDLP_COOKIES`,
`PLAY_MAX_MB`, `PLAY_MAX_SECONDS`, `DL_MAX_MB`, `DL_MAX_SECONDS`, `TURBOFEX_DATA`. Settings changed at run time (`.mode`, `.setprefix`, `.linkpreview`, ...) are saved in `data/groups.json`.
Default mode is **private**; default prefix is `.`; default timezone `Africa/Johannesburg`.

## 11. Dependencies and runtime

Node.js ≥ 20 (tested here on Node 22). Required: `@whiskeysockets/baileys`, `adm-zip`, `pino`, `qrcode-terminal`, `jsqr`. Optional (the commands that need them say "not available"): `sharp` (pictures), `@ffmpeg-installer/ffmpeg` (audio/video), `qrcode`.
`yt-dlp` is downloaded on first use of `.play`/`.dl`. The host needs write access to its folder.
The unit tests do **not** need `npm install` (they use fakes), so passing tests say nothing about whether dependencies are installed on a host.

## 12. Error handling and logging

- Command errors: caught in `handler.js`; members see "Something went wrong running that command. Please try again in a moment."; the owner also sees `Reason:` (150 characters). The full error goes to the console and `whatsapp/stats.js` (`.stats`).
- The capacity guard (`core/capacity.js`) refuses heavy commands when a tool is missing, memory is low or the server is busy; members get a plain sentence, the owner also gets the numbers.
- `.status` (owner) shows version, load errors, timing and watcher counters. `.ping` shows one response time; the split (bot time vs WhatsApp time) is written to the console only.
- Do not log credentials, session IDs or private message text. `core/sessionid.js` stores only a hash of a used ID.

## 13. Updating and rollback

`core/updater.js` reads `package.json` from the GitHub repo in `update.json`; if the version differs it downloads the branch ZIP, **validates it before touching anything** (every `.js` compiles, required files exist, relative `require`s resolve),
saves a rollback copy in `data/rollback`, replaces files, restarts. Fallbacks: `turbofex-latest.zip` in the repo, then a ZIP on a GitHub Release. It never touches `config.js`, `session_id.txt`, `config.env`, `session/`, `data/`, `node_modules/`, `.env`.
`index.js` restores the rollback copy if the child crashes within 10 minutes of an update. Release steps are in `AGENTS.md`. **No GitHub Actions, ever.**

## 14. Testing

```
npm test        # node --test tests/*.test.js
```
- No network, no WhatsApp, no install needed. A test file starts with `require('./_setup')`. Handler-level tests use a fake `sock`; see `tests/v092.test.js` for a compact example (permissions, ping, help, error replies, README counts).
- **What the suite proves:** command loading and registration, menus and help text, silent permissions, usage hints, public/owner error text, session ID handling against a fake site, updater validation, the Empire rules.
- **What it cannot prove:** real WhatsApp behaviour (pairing, delivery, link previews, media, groups), the live pairing site, downloads, hosting, memory on small hosts. These need a manual test on a spare number (checklist in `changelog.txt` entry 0.9.2 and the audit report).
- After a change: `npm test`; for a new command also run it by hand with no arguments, with wrong arguments, as a member, as an admin and as the owner.

## 15. Deployment and hosting

Pterodactyl-style panels run `node /home/container/index.js`, so `index.js` must be in the top folder. The ZIP must be flat, contain every project file (the push replaces the whole repo) and never contain `.github/`, `node_modules/`, `session/`, `data/`, `session_id.txt` or `config.env`.
The host needs to run `npm install`, keep the process alive, and keep `session/` and `data/` between restarts. A free host with a sleeping disk or no persistent storage loses the login.

## 16. Important decisions

- Link with a **session ID** from the pairing site; the console never asks for a number (old console linking only with `CONSOLE_LINK=1`).
- **Private mode by default**; strangers get no replies. `everyone: true` marks the member-friendly exceptions.
- **Silent permissions** (section 7), decided by the owner for v0.9.2.
- `.ping` shows one number: the time from receiving the message to WhatsApp accepting the reply. It does not include network delivery to the phone.
- The bot name is part of the code (`core/brand.js`, `core/integrity.js`): do not edit them.
- `.help` is a short guide; `.menu` is the full list and used to be the same command (the old `help` alias was removed).

## 17. Known limitations and open items

1. **Real WhatsApp is untested by this audit.** Everything above was checked by reading code and running the unit tests; nothing was run against WhatsApp, the pairing site's server, or a host.
2. **Pairing site source is not in the repo.** The 5-minute expiry is read from the site's public page, not from its server code.
3. **Pairing codes:** `core/pairfix.js` says WhatsApp refused pairing codes in July 2026 and only QR worked. The site offers both; the README tells people to use QR if the code fails. Re-test the code path.
4. **`uncaughtException` is swallowed** in `core/boot.js` (logs "Crash prevented"), so a real bug may leave the bot running half broken instead of restarting.
5. **Empire offices** still explain themselves to people who lack the office (game rules, not permissions); the owner may want them silent too.
6. **"Turned off in this group"** and **maintenance** notices are still sent to non-owners.
7. **Link previews** are best effort: only on text the bot sends, 3.5 s budget, depends on the page's metadata, and can be switched off.
8. **Formatting** is not applied to every reply (see section 6, point 2).
9. **No uptime guarantee:** the bot reconnects and can roll back a bad update, but nothing proves it runs for months unattended.
10. **Usage hints** were checked for 325 commands with no arguments (most already show an example). Wrong-argument cases and every text string were not exhaustively reviewed.
11. Only the owner sees console diagnostics; there is no log file or log rotation.

## 18. Instructions for AI assistants

1. **Read `AGENTS.md` and this file first.** Inspect the existing implementation (`grep`, open the file) before changing it.
2. **Preserve existing functionality** and data. Do not delete commands because their text is technical. Keep changes small; avoid rewrites and architecture changes unless the owner agrees. Propose big or risky changes first.
3. **Keep backward compatibility:** command names and aliases, saved data formats, `config.js` settings, the flat ZIP layout.
4. **Run `npm test` after every change** and say exactly what you ran. **Never claim a test passed, or a feature works on WhatsApp, if you did not run it.** Say which things still need a real WhatsApp test.
5. **Update the docs** when behaviour changes: `README.md` (users), this file (architecture), `changelog.txt`, the version in `package.json` and the version tests.
6. Respect the hard rules: no GitHub Actions or `.github/`; do not edit `core/brand.js` or `core/integrity.js`; keep comments in simple English.
7. **Never include secrets**: no session IDs, tokens, API keys, phone numbers of real people, or contents of `session/` or `data/`. Use placeholders such as `TFX-XXXX-XXXX-XXXX`.
8. **Never invent functionality.** If something cannot be verified from the code or the live site, write it under "Known limitations".
9. Do not run any live economy migration, reset or irreversible change without a backup, a dry-run report and the owner's explicit approval.
10. Public messages are for ordinary people: no developer words, no paths, no stack traces. Owner detail goes to the owner or the console.

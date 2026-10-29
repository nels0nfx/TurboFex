# ⚡ TurboFex v0.7.10

[![CI](https://github.com/nels0nfx/TurboFex/actions/workflows/ci.yml/badge.svg)](https://github.com/nels0nfx/TurboFex/actions/workflows/ci.yml)

WhatsApp group management and assistant bot by **Nelson Fx** (Trinity Flow). It runs on Node.js with the
[Baileys](https://github.com/WhiskeySockets/Baileys) library and is built to run for months without attention:
it reconnects by itself, backs up its login, updates itself safely and protects the server it runs on.

> Unofficial bots can get a number banned. Use a spare number for the bot, never your main one.

## Features
- **300+ commands** in 16 categories (group management incl. ranks and birthdays, security, lookup, status tools, games, media, audio/video/picture editing, budget, tools...). Send `.menu`.
- **The Empire of Fex (per group):** every group is a realm with its own money (Aurum), ranks, bank and shop. God (the bot owner) sets the limits of everything. See "The Empire of Fex" below.
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
2. Make sure the host runs `npm install`, then start it with `npm start`.
3. Link the bot with a **session ID** from the pairing site (next section). The console never asks for a number or a pairing code.
4. Add the bot to a group, make it admin, and send `.ping`.

### Linking the bot (session ID)
1. Open the **pairing site**, https://turbofex-pair.onrender.com (a bot that is not linked also prints this in the console).
2. Link your WhatsApp number there (pairing code or QR) and copy the session ID, like `TFX-K7M2-9QXA-4BNP`. The site also sends it to your own WhatsApp chat.
3. Open the file **`session_id.txt`** in the bot's main folder (the bot creates it for you when it starts without a login) and paste the ID after `SESSION_ID=`. Save it. (The `SESSION_ID` variable of the host works too and wins when both are set.)
4. **Restart** the bot. It downloads the login, saves it in `session/`, and your number becomes the bot's number and its owner.

- A session ID works **once** and expires after 24 hours. After the first start the bot keeps its login, so the ID can stay in the file; an old ID does nothing.
- To move the bot to **another number**, or after WhatsApp logged it out, link again on the site and paste the **new** ID in `session_id.txt`. The old login is kept in `data/session-previous`.
- A bot that is not linked prints these steps and waits. It never asks for a number in the console.
- The old console linking (number question, pairing code or QR in the console) is still there for developers: set `CONSOLE_LINK=1` (and optionally `NUMBER`, `PAIR_METHOD=code|qr`).

### Updating the bot
Push the new files to the GitHub repo and raise `version` in `package.json`. Bots check on every start (and with `.update`), download the repo from GitHub when the version differs, check it, and restart. No zip file is needed. `.gitignore` should contain `node_modules/`, `session/`, `data/`, `.env` and `session_id.txt`.

## Configuration
| Setting (`config.js`) | Environment variable | Meaning |
|---|---|---|
| `sessionIdFile` | `SESSION_ID` (variable) | The session ID from the pairing site: the file `session_id.txt` (or the variable, which wins) |
| `pairSiteUrl` | `PAIR_SITE_URL` | Address of the pairing site (built in: https://turbofex-pair.onrender.com) |
| `number` | `NUMBER` | The bot's number, which is also its owner. Empty = taken from the linked login |
| `consoleLink` | `CONSOLE_LINK=1` | Old console linking (number question, pairing code or QR). `PAIR_METHOD=code\|qr` only counts with it |
| `prefix` | `PREFIX` | Command prefix (default `.`; `.setprefix` changes it while running) |
| `timezone` | `TIMEZONE` | For the menu clock and auto open/close |
| | `BOT_BROWSER` | Device identity used when linking (`android` can receive view-once files) |
| | `FAST_KEYS=off` | Turns off the write-behind key store |
| | `RESTORE_LOGIN=1` | Start once to restore the login from the last backup |
| | `YTDLP_PATH`, `YTDLP_COOKIES` | Your own yt-dlp binary, a cookies.txt for YouTube |
| | `PLAY_MAX_MB`, `PLAY_MAX_SECONDS` | Limits for `.play` (default 60 MB / 60 min) |
| | `DL_MAX_MB`, `DL_MAX_SECONDS` | Limits for `.dl` videos (default 60 MB / 30 min) |
| | `TURBOFEX_DATA` | Folder for saved data (default `data/`) |

## The Empire of Fex
Every group is a **realm** with its own citizens, money (**Aurum**) and treasury. It is open in every group by default (admins close it with `.realm off`).
The Empire is built in phases: the foundation and God (phase 1), careers, estates, goods and crafting (phase 2). The market, the government, guilds and more come next.

| Command | What it does |
|---|---|
| `.daily` | A gift every day, bigger with more days in a row and a higher rank |
| `.purse` / `.profile` | Your Aurum, bank, net worth and rank / everything about a citizen (`@user` to see another) |
| `.deposit 500` / `.withdraw all` / `.bank` | The bank pays interest every day (the space is limited; a Merchant's Satchel adds more) |
| `.give @user 100` | Give Aurum (a small fee goes to the realm's treasury) |
| `.wealth` | The richest citizens of the realm |
| `.shop` / `.buy charm` | Fortune Charm (more pay), Merchant's Satchel (bigger bank), titles |
| `.realm` / `.realm guide` / `.realm off` / `.realm on` | The realm itself; admins open and close it |

Ranks (by net worth, goods and estates count too): Commoner, Citizen, Merchant, Noble, Lord. A higher rank pays more, opens better careers and estates, allows more estates and gives a bigger bag. Chatting earns a little Aurum too.

### Careers, estates and crafting
| Command | What it does |
|---|---|
| `.career` / `.career farmer` / `.career quit` | Choose a profession: Farmer, Miner, Scribe, Guard, Smith, Healer (the better ones need a higher rank) |
| `.work` | Work for Aurum and goods. Levels, tools (`.buy hoe`), meals and the first work of the day pay more |
| `.weekly` | A big bonus once a week |
| `.estates` / `.estates buy farm` / `upgrade` / `sell` | Farm, Mine, Weaver's Hut, Tavern and Forge make goods while you are away |
| `.collect` | Take what your estates made (the realm keeps a tax, kept in its granary) |
| `.inventory` | Your bag: goods, items, tools, and how much it is worth |
| `.recipes` / `.craft bread 3` | The workbench: bread, tonic, tunic, sword and tools made from goods |
| `.sell grain 10` / `.sell all` | Sell to the realm (the market of a later phase will move prices) |
| `.use bread` / `.use tonic` | A meal pays more for a few hours; a tonic skips the waiting of your next work |

### God (the bot owner)
God does not rule the realms. God sets the limits and can change anything that exists, in a group or in a private chat.
Every feature has an on/off switch and every number has a safe minimum and maximum. Every change is written in the ledger.

| Command | What it does |
|---|---|
| `.god` | The list of everything God can do |
| `.god settings` / `.god settings core` | All features / the numbers of one feature |
| `.god set core.dailyBase 400` / `... here` | Change a number for all realms / for one realm only (`reset` puts it back) |
| `.god off shop here` / `.god on shop` | Switch a whole feature |
| `.god give @user 500`, `take`, `purse`, `rank @user lord`, `bless @user 50 12`, `curse` | Change citizens |
| `.god item @user bread 5`, `.god estate @user farm 3`, `.god career @user smith`, `.god stock` | Give or take goods, set an estate or a career, see the realm's granary |
| `.god wipe @user confirm`, `.god wipe realm confirm` | Delete a citizen or a whole realm |
| `.god realm 2` | In a private chat: choose the realm every Empire command works on |
| `.god realm off` / `.god realm on all` | Close or open one realm or all of them |
| `.god move 1 to 2 [number] [copy]` | Move the progress of citizens from one realm to another |
| `.god ledger` | What God changed lately |

## Using the bot
- `.menu` shows the categories (alphabetical). `.menu group` shows one category, `.menu kick` shows help for one command, `.list` shows everything with descriptions.
- Anti-link, anti-word, anti-spam, anti-fake, welcome and goodbye are OFF by default and are turned on per group. The bot must be a group admin to delete messages, remove people and change group settings.
- Auto-replies, AFK notices, protections and running games still work in private mode; they are not commands.
- **AFK:** `.afk on lunch` stays on until `.afk off`. Everybody who writes to you or mentions you is told once per AFK session.
- **Reactions:** `.cmdreact on|smart|clean|off` (`smart` = only slow commands).
- **Watermark:** `.watermark on|off|text ...`, added under the result of media, audio, video and editor commands.
- **Sticker credit:** `.stickerpack My Pack | My Name` (default: bot name by Nelson Fx).
- **Status tools:** `.autoviewstatus on`, `.autolikestatus on`, `.statusemoji`, `.statusdelay`, `.statuslimit 200`, `.statusinfo`. WhatsApp only delivers the statuses of people saved as contacts on the bot's phone.
- **Watchers:** `.autoviewonce`, `.antidelete`, `.antiedit` plus `.viewoncejid`, `.deletejid`, `.editjid` for where copies go. `.vv` opens a view-once you reply to. Anti-edit and anti-delete only know messages the bot saw before they changed. Use these only for messages that were sent to you.
- **Security:** `.ratelimit 20` (commands per person per minute), `.anticall reject|block`, `.privacy` (bot account privacy), `.antipromote on` / `.antidemote on` (undo promotions and demotions made by anyone except the group creator and the bot owner, the bot must be admin), `.antimedia sticker on` (block stickers, images, videos, audio or documents), `.slowmode 10` (seconds between messages of a member).
- **Community:** `.rules` / `.setrules`, `.report <why>` (reply to a message: tags the admins), `.rank on` then `.rank` and `.top` (XP and levels for chatting), `.giveaway 2 prize`, `.setbirthday 25 Dec` and `.birthday on` (wishes at 08:00), `.feedback <message>` (to the owner, 3 a day per person).
- **Lookup:** `.weather <city>`, `.define <word>`, `.wiki <topic>`, `.currency 100 usd ngn`, `.translate fr <text>`. They use free public services (Open-Meteo, dictionaryapi.dev, Wikipedia, exchangerate-api.com, MyMemory) which can be slow or limit use.
- **Media and tools:** `.dl <link or name>` (video, up to 720p), `.take My Pack | Me` (new credit on a sticker), `.attp <text>` (text sticker), `.setgpp` (group picture), `.note` and `.todo` (private, in a private chat).
- **Owner:** `.stats` (usage and last errors), `.broadcast <text>` then `.broadcast confirm` (all groups, slowly, 100 at most), `.linkpreview on|off|test <link>`.
- **play:** `.play <name or link>` always sends audio (YouTube, TikTok, SoundCloud, Instagram and most other sites, through yt-dlp, downloaded automatically on first use). If YouTube blocks the server, send a `cookies.txt` with `.ytcookies`. Only download content you have the right to.
- **Server protection:** heavy commands are blocked with a clear message when a tool is missing, memory is low, the server is overloaded or too many run at once. `.server` shows the state, `.server guard off` disables it.

## Operating the bot
### Updates
- `.update` checks, `.update now` installs and restarts, and the bot checks at start (`.autoupdate off` to stop). After an update you get an "update complete" message; after a restart an "I am back" message with a short menu (`.restartmsg off` to silence restarts).
- A downloaded update is **validated before any file is replaced** (every file must compile, required files must exist, `package.json` must be valid). A broken zip is rejected and nothing changes.
- If a valid update still crashes the bot at start, the previous version is put back automatically.
- `config.js`, `session/` and `data/` are never touched by updates.

### Backups and cleanup
- A copy of the login is made a few minutes after connecting and then daily (last 3 kept) in `data/session-backup/`. It is never sent over WhatsApp. `.loginbackup` lists the copies, `.loginbackup now` makes one.
- If `session/` has files but `creds.json` is damaged, the last backup is restored at start. An empty `session/` means "link a fresh device". To restore on purpose start once with `RESTORE_LOGIN=1`. After WhatsApp logs the bot out the copies are deleted.
- Once a month encryption files of chats silent for 90+ days are removed (`.sessionclean` runs it now). The login itself is never touched.
- `.backup` saves the bot's settings.

### Troubleshooting
- Lots of `Bad MAC` lines, "Waiting for this message", or the bot stops answering: send `.repair` (clears chat sessions, you stay logged in). Make sure the number is linked to only ONE running bot.
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

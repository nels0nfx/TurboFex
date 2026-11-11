# ⚡ TurboFex v1.4.0

**TurboFex is a WhatsApp bot that helps you run your groups and gives your chats tools, games and fun.**
It protects groups from spam and links, welcomes new members, answers questions, makes stickers, plays games, and more.

<!-- counts: 321 commands, 13 categories -->
Members can use **321 commands in 13 categories** (the bot owner has even more, such as settings and diagnostics).
Send `.menu` to see them all.

> ⚠️ **Please read:** WhatsApp does not officially allow bots, and a number used for a bot can be banned.
> Use a **spare number** for the bot, never your main one.

## What TurboFex can do

| | |
|---|---|
| 👥 **Group management** | Welcome and goodbye messages, rules, warnings, kick / promote / demote, open and close the group, tag everyone, polls, giveaways, scheduled messages, birthdays, chat levels (`.rank`, `.top`), nicknames, and lists of who is active or new (`.listonline`, `.newmembers`, `.staff`). |
| 🛡️ **Protection** | Anti-link, banned words, anti-spam, anti-bot, anti-raid, slow mode, verification questions for new members. All of them are **off until an admin switches them on**. |
| 🎮 **Games and fun** | Wordle, hangman, trivia, tic-tac-toe, connect four, slots, riddles, quizzes, jokes, truth or dare, hugs, a love meter, fortune cookies, cat and dog pictures, and more. |
| 🧰 **Tools and lookups** | Weather, dictionary, Wikipedia, currency, translation, QR codes, calculator, reminders, timers, notes and to-dos, country facts, Pokémon, recipes, the space station, earthquakes, tip and discount calculators. |
| 🎨 **Media** | Stickers, picture editing, audio and video effects, downloads (`.play`, `.dl`, `.ytsearch`, `.tiktok`, `.ig`) and PDFs (`.pdf`). Some of these need extra tools on the computer or host that runs the bot; if one is missing, the bot says the feature is not available. |

The exact list is always in `.menu` and `.list`; they are built from the commands your version really has.

## Get started

You need a WhatsApp number for the bot and a place where the bot can keep running (a hosting panel or a computer that stays on).

1. **Get the bot.** Download the *hosting ZIP* (`TurboFex-hosting-...zip`) from the **Releases** page of https://github.com/nels0nfx/TurboFex and upload it to your host.
   Do not use the green *Code > Download ZIP* button: it adds an extra folder and the host cannot start the bot.
2. **Open `session_id.txt`.** It is already in the main folder of the ZIP, with the steps inside. (If it is ever missing, the bot makes a new one when it starts. It never overwrites yours.)
3. **Link your WhatsApp.** Open the pairing site **https://turbofex-pair.onrender.com** and follow its steps. In WhatsApp go to
   *Linked devices > Link a device*. If the pairing code is not accepted, use the **QR code** option. When it finishes, the site gives you a **session ID** that looks like `TFX-K7M2-9QXA-4BNP`.
4. **Give the ID to the bot.** Paste the ID after `SESSION_ID=` in `session_id.txt`, save, and **start (or restart) the bot straight away**.
5. **Try it.** Add the bot to a group, make it a group admin, and send **`.ping`**, then **`.help`**.

Good to know about the session ID:
- It works **once** and **expires after 5 minutes**, so paste it and restart right away. If it expired, just link again on the site and use the new ID.
- After the first successful start the bot keeps its login, so you do not need the ID again.
- The pairing site runs on a free host and can take up to a minute to wake up.
- Never share your session ID or pairing code with anyone.

The number you link becomes the bot's number **and its owner**.

## Hosting guides

TurboFex is plain Node.js (version 20 or newer). It runs on a phone, a VPS, a hosting panel, Docker, or a normal computer. Pick one.
Every guide ends the same way: paste your session ID in `session_id.txt` (see *Get started* above) and start the bot.

### Termux (Android phone)

1. Install **Termux** from F-Droid (the Play Store version is old and no longer updated).
2. In Termux: `pkg update && pkg upgrade`, then `pkg install nodejs-lts git ffmpeg unzip nano`.
3. Allow Termux to read your downloads: `termux-setup-storage`.
4. Unpack the bot: `unzip ~/storage/downloads/TurboFex-hosting-*.zip -d ~/TurboFex` then `cd ~/TurboFex`.
5. Install it: `npm install`.
6. Open the session file, paste the session ID after `SESSION_ID=`, save (`Ctrl+O`, `Enter`, `Ctrl+X`): `nano session_id.txt`.
7. Start: `npm start`.

To keep it running when the screen is off: run `termux-wake-lock`, turn off battery optimisation for Termux in Android settings, and start the bot inside `tmux`
(`pkg install tmux`, then `tmux new -s bot`, `npm start`, and leave with `Ctrl+B` then `D`). Or use pm2: `npm install -g pm2` then `pm2 start ecosystem.config.js`.
*Termux note:* Termux has its own variable called `PREFIX`. TurboFex ignores it. To change the command symbol use `BOT_PREFIX=!` (or `.setprefix` in the chat).

### VPS or any Linux server (Ubuntu, Debian)

1. Install the tools: `sudo apt update && sudo apt install -y git ffmpeg unzip curl`.
2. Install Node.js 20 or newer (for example `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` then `sudo apt install -y nodejs`). Check with `node -v`.
3. Upload the hosting ZIP to the server, then `unzip TurboFex-hosting-*.zip -d ~/TurboFex && cd ~/TurboFex && npm install`.
4. Paste the session ID in `session_id.txt` (`nano session_id.txt`) and test: `npm start`. Stop with `Ctrl+C` once it works.
5. Keep it running forever, with **one** of these:
   - **pm2:** `sudo npm install -g pm2`, then `pm2 start ecosystem.config.js`, `pm2 save`, `pm2 startup` (run the command it prints). Log: `pm2 logs turbofex`.
   - **systemd:** edit `hosting/turbofex.service` (your user name and folder), copy it to `/etc/systemd/system/`, then `sudo systemctl enable --now turbofex`. Log: `journalctl -u turbofex -f`.

### Docker

1. Install Docker and Docker Compose on the server.
2. Unpack the hosting ZIP, open the folder, and create a file called `.env` with your settings: `SESSION_ID=TFX-XXXX-XXXX-XXXX` (and optionally `TIMEZONE=Africa/Lagos`, `BOT_PREFIX=.`).
3. Start: `docker compose up -d --build`. Log: `docker compose logs -f`.
4. The login and the settings are saved in the `data`, `session` and `accounts` folders next to `docker-compose.yml`, so they survive a rebuild.
5. The bot can update itself, but inside Docker that only lasts until the container is rebuilt. For Docker, switch it off with `.autoupdate off` and update by unpacking a newer ZIP and running `docker compose up -d --build` again.

### Hosting panels (Pterodactyl and similar)

1. Create a server with a **Node.js 20 or newer** egg, then upload the hosting ZIP in the file manager and unzip it so that `index.js` is in the main folder.
2. Set the startup command to `npm start` (or `node index.js`) and let the panel run `npm install`.
3. Open `session_id.txt` in the file manager, paste the session ID, save, and start the server. If your panel has a *Variables* page, you can set `SESSION_ID` there instead.

### Web-service hosts (Render, Railway, Koyeb, Heroku and similar)

1. Deploy the repository or the unpacked ZIP. Build command: `npm install`. Start command: `npm start` (a `Procfile` is included).
2. Add the variable `SESSION_ID` with your session ID (a host without file access cannot edit `session_id.txt`).
3. These hosts give the bot a `PORT`. TurboFex then opens a tiny status page on it (it only says that the bot is running; no numbers, no chats), so the host does not stop the bot for having no open port.
4. **Important:** many of these plans wipe the disk on every restart or deploy, and some put free apps to sleep. If the disk is wiped, the bot loses its login and needs a new session ID each time. Use a plan with a **persistent disk or volume**, mounted on the `data` and `session` folders, and a plan that does not sleep.

### Windows or Mac

Install Node.js (LTS) and Git, unpack the ZIP, open a terminal in the folder, run `npm install`, paste the session ID in `session_id.txt`, and run `npm start`. Install `ffmpeg` if you want the sticker, audio and video commands.

### Updates and "does it keep running?"

The bot checks for a new version when it starts and puts the old one back if an update breaks it. Nothing can promise it never stops: the host, the network and WhatsApp can all interrupt it,
which is why pm2, systemd or Docker's `restart: unless-stopped` are worth setting up on a server.

## Plugins

Plugins add extra commands made by other developers. They are **off** until the owner sends `.plugin on`, and each one runs in a sealed sandbox: it cannot read your files, passwords or other plugins. Plugins need Node.js 22 or newer; on older versions TurboFex works as usual without them.

1. Copy a plugin folder into `data/plugins/` (see `examples/hello-plugin`).
2. Send `.plugin list`, then `.plugin install <name>`. The bot shows what the plugin asks for and gives you a code.
3. Send `.plugin confirm <code>`. The plugin's commands now appear in the menu under PLUGINS.

`.plugin off` removes every plugin command at once. Inside a group, `.plugin groups <name> deny` turns a plugin off for that group only.

## Several accounts on the same server

You can run more than one WhatsApp number (more than one bot) from the same folder. Each account is its own bot with **its own login, settings and data**; nothing is shared, so they cannot overwrite each other.

1. Copy `accounts.example.json` to **`accounts.json`** and list your accounts:
   ```json
   { "accounts": [ { "name": "main" }, { "name": "shop", "prefix": "!", "timezone": "Africa/Lagos" } ] }
   ```
   (No file access? Set the variable `ACCOUNTS=main,shop` instead.) A name is 1 to 20 letters, digits, `-` or `_`. Options per account: `prefix`, `timezone`, `number`, `sessionId`, and `"enabled": false` to switch one off for now.
2. The account called **`main`** keeps using the old places (`data/`, `session/`, `session_id.txt`), so a bot that already runs does not have to be linked again. Every other account gets its own folder `accounts/<name>/`
   with its own `session_id.txt`, created when you start the bot.
3. **Link each number on the pairing site**, one at a time, and paste each session ID in that account's own file (`accounts/shop/session_id.txt`), or set the variable `SESSION_ID_SHOP` (the name in capital letters).
4. Start the bot as usual (`npm start`). The log lines start with the account name, for example `[shop] ...`. If one account has a problem, the others keep running.
5. Updates: the first account in the list updates the shared program files, then **all accounts restart together**.
6. Every account uses its own memory. Start with one or two accounts on a small server or phone and add more only if it stays fast.

To remove an account, take it out of the list; its folder `accounts/<name>/` is kept until you delete it yourself.

## Using the bot

Every command starts with a symbol, called the *prefix*. The default is a dot: `.ping`.

| Send | What you get |
|---|---|
| `.help` | A short guide for beginners |
| `.menu` | All commands, by category |
| `.menu group` | One category with a description of each command |
| `.menu kick` | Help for one command: who can use it and where |
| `.list` | Every command with its description |
| `.help ask <question>` | Ask the AI about the bot, for example `.help ask how do I make a sticker`. It knows every command and is always up to date |

If you leave something out, the bot tells you what is missing and shows an example. For instance, `.weather` alone explains that it
needs a city and shows `.weather Lagos`.

### Who can use what

- **Everyone** can use general commands, games and tools (when the bot is in *public* mode, see below).
- **Group admins** can use the group management commands (kick, warn, open, close, welcome and so on). The bot itself must be a group admin to remove people, delete messages or change group settings.
- **The bot owner** has extra commands for settings and for looking after the bot.
- If you are **not allowed** to use a command, the bot simply **does not answer**. It will not tell you why.

### Public and private mode

- **Private mode (the default):** only the owner can use commands. Everybody else gets no reply to commands, with a few exceptions made for members
  (`.rank`, `.top`, `.rules`, `.report`, `.birthday`, `.feedback`, `.roast`). Group protections, running games and auto-replies still work.
- **Public mode:** everybody can use the commands they are allowed to. The owner switches with `.mode public` or `.mode private`.

## Owner shortcuts: saved statuses, sticker commands, where copies go

- **Save a status by replying to it.** Send `.statusreply on`. From then on, every status you reply to (from your phone) is saved and sent to your own chat, or to the chat you choose with `.statusjid`. Nothing is sent or reacted in the chat where you replied. Switch it off with `.statusreply off`.
- **Sticker commands.** Reply to any sticker with `.setstickercmd vv`. When *you* send that sticker as a reply to a view-once message, the bot opens it **silently** (no answer, no reaction in the chat) and sends it to your view-once chat. Other commands work too (`.setstickercmd ping`) and answer normally. `.stickercmds` lists them, `.delstickercmd` removes one. Only you can use them.
- **Where copies go.** `.viewoncejid`, `.deletejid` and `.editjid` choose the chat that gets the copy of view-once, deleted and edited messages. Besides *me*, *here*, a number or a group, you can now say **`chat`**: the copy is then sent to the chat where it happened. Everybody in that chat will see it.

## Good things to know

- **Protections are off by default.** Admins switch them on one by one, for example `.antilink delete` or `.welcome on`.
- **The bot must be an admin** for anything that changes the group.
- **Link previews:** when the bot sends a message with a link, it tries to add a preview card (picture, title, description).
  It depends on the website giving that information and on being quick enough, so some links will not show one. The owner can turn it off with `.linkpreview off`.
- **Statuses:** WhatsApp only gives the bot the statuses of people saved as contacts on the bot's phone.
- **Anti-delete, anti-edit and view-once saving** can only save messages the bot saw before they changed, and should only be used for messages sent to you.
- **Lookups** (weather, dictionary, Wikipedia, currency, translation) use free public services, which can be slow or busy. If one does not answer, try again in a moment.
- **Downloads:** only download content you have the right to.
- **Backups:** while the bot is running it keeps a copy of its WhatsApp login every day (the last 3 copies) in its own `data` folder, and it can restore from them if the login file is damaged. These copies are never sent over WhatsApp.
- **Reconnecting and updates:** if the connection drops, the bot tries to reconnect by itself. When it starts, it checks for a new version, and if an update breaks it at start-up, the previous version is put back.
  This is not a promise that it never stops: the host, your internet and WhatsApp itself can all interrupt it.

## Help and community

- 💬 Support group (Telegram): https://t.me/+7PwU2Vo9czE1NTRk
- 📣 Telegram channel: https://t.me/+e89lCBU2wLpjNWNk
- 🟢 WhatsApp channel: https://whatsapp.com/channel/0029VbDpuKM8qIzkoQscOE2w
- 💻 Source code and releases: https://github.com/nels0nfx/TurboFex

Developers: the project is plain Node.js (CommonJS, no build step). `npm test` runs the tests in `tests/`.

---
TurboFex is made by Nelson Fx (Trinity Flow). Released under the MIT license.

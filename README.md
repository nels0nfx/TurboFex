# ⚡ TurboFex v0.9.2

**TurboFex is a WhatsApp bot that helps you run your groups and gives your chats tools, games and fun.**
It protects groups from spam and links, welcomes new members, answers questions, makes stickers, plays games, and even
runs a small "Empire" game where every group becomes its own realm with its own money.

<!-- counts: 262 commands, 14 categories -->
Members can use **262 commands in 14 categories** (the bot owner has even more, such as settings and diagnostics).
Send `.menu` to see them all.

> ⚠️ **Please read:** WhatsApp does not officially allow bots, and a number used for a bot can be banned.
> Use a **spare number** for the bot, never your main one.

## What TurboFex can do

| | |
|---|---|
| 👥 **Group management** | Welcome and goodbye messages, rules, warnings, kick / promote / demote, open and close the group, tag everyone, polls, giveaways, scheduled messages, birthdays, and chat levels (`.rank`, `.top`). |
| 🛡️ **Protection** | Anti-link, banned words, anti-spam, anti-bot, anti-raid, slow mode, verification questions for new members. All of them are **off until an admin switches them on**. |
| ⚜️ **Empire of Fex** | A game inside every group: earn Aurum (the money), choose a career, own estates, craft goods, trade, bid at auctions, hold elections, join guilds and enter dungeons. Start with `.daily`. |
| 🎮 **Games and fun** | Wordle, hangman, trivia, tic-tac-toe, connect four, slots, riddles, quizzes, jokes, truth or dare, and more. |
| 🧰 **Tools and lookups** | Weather, dictionary, Wikipedia, currency, translation, QR codes, calculator, reminders, notes and to-dos. |
| 🎨 **Media** | Stickers, picture editing, audio and video effects, and downloads (`.play`, `.dl`). Some of these need extra tools on the computer or host that runs the bot; if one is missing, the bot says the feature is not available. |

The exact list is always in `.menu` and `.list`; they are built from the commands your version really has.

## Get started

You need a WhatsApp number for the bot and a place where the bot can keep running (a hosting panel or a computer that stays on).

1. **Get the bot.** Download the *hosting ZIP* (`TurboFex-hosting-...zip`) from the **Releases** page of https://github.com/nels0nfx/TurboFex and upload it to your host.
   Do not use the green *Code > Download ZIP* button: it adds an extra folder and the host cannot start the bot.
2. **Start the bot.** The first time, it tells you it is not linked to WhatsApp yet and creates a file called `session_id.txt`.
3. **Link your WhatsApp.** Open the pairing site **https://turbofex-pair.onrender.com** and follow its steps. In WhatsApp go to
   *Linked devices > Link a device*. If the pairing code is not accepted, use the **QR code** option. When it finishes, the site gives you a **session ID** that looks like `TFX-K7M2-9QXA-4BNP`.
4. **Give the ID to the bot.** Open `session_id.txt`, paste the ID after `SESSION_ID=`, save, and **restart the bot straight away**.
5. **Try it.** Add the bot to a group, make it a group admin, and send **`.ping`**, then **`.help`**.

Good to know about the session ID:
- It works **once** and **expires after 5 minutes**, so paste it and restart right away. If it expired, just link again on the site and use the new ID.
- After the first successful start the bot keeps its login, so you do not need the ID again.
- The pairing site runs on a free host and can take up to a minute to wake up.
- Never share your session ID or pairing code with anyone.

The number you link becomes the bot's number **and its owner**.

## Using the bot

Every command starts with a symbol, called the *prefix*. The default is a dot: `.ping`.

| Send | What you get |
|---|---|
| `.help` | A short guide for beginners |
| `.menu` | All commands, by category |
| `.menu group` | One category with a description of each command |
| `.menu kick` | Help for one command: who can use it and where |
| `.list` | Every command with its description |

If you leave something out, the bot tells you what is missing and shows an example. For instance, `.weather` alone explains that it
needs a city and shows `.weather Lagos`.

### Who can use what

- **Everyone** can use general commands, games and tools (when the bot is in *public* mode, see below).
- **Group admins** can use the group management commands (kick, warn, open, close, welcome and so on). The bot itself must be a group admin to remove people, delete messages or change group settings.
- **The bot owner** has extra commands for settings and for looking after the bot.
- If you are **not allowed** to use a command, the bot simply **does not answer**. It will not tell you why.

### Public and private mode

- **Private mode (the default):** only the owner can use commands. Everybody else gets no reply to commands, with a few exceptions made for members
  (the Empire of Fex commands, `.rank`, `.top`, `.rules`, `.report`, `.birthday`, `.feedback`, `.roast`). Group protections, running games and auto-replies still work.
- **Public mode:** everybody can use the commands they are allowed to. The owner switches with `.mode public` or `.mode private`.

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

## The Empire of Fex in short

Every group is a realm with its own money (**Aurum**). Nothing is shared between groups.

| Command | What it does |
|---|---|
| `.daily` | A gift every day, bigger when you come back several days in a row |
| `.purse` / `.profile` | Your Aurum and rank / everything about a citizen |
| `.career` and `.work` | Choose a profession and work for Aurum and goods |
| `.estates` and `.collect` | Own a farm, mine or tavern that makes goods while you are away |
| `.market`, `.sell`, `.trade`, `.auction` | Buy and sell goods, trade with others, bid at auctions |
| `.election`, `.law`, `.court` | Choose a ruler, pass laws, take someone to court |
| `.guild` and `.dungeon` | Join a guild, go into a dungeon with a party |
| `.realm guide` | A guide to the whole game |

Group admins can close the Empire in their group with `.realm off` and open it again with `.realm on`.

## Help and community

- 💬 Support group (Telegram): https://t.me/+7PwU2Vo9czE1NTRk
- 📣 Telegram channel: https://t.me/+e89lCBU2wLpjNWNk
- 🟢 WhatsApp channel: https://whatsapp.com/channel/0029VbDpuKM8qIzkoQscOE2w
- 💻 Source code and releases: https://github.com/nels0nfx/TurboFex

Developers and AI assistants: see [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) for how the project is built, and [`AGENTS.md`](AGENTS.md) for how it is released.

---
TurboFex is made by Nelson Fx (Trinity Flow). Released under the MIT license.

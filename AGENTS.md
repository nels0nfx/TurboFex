# TurboFex project guide (for AI assistants and new contributors)

Read this first. It explains how this project is pushed, packaged, released and hosted, so you do not break the owner's workflow.
For how the code itself works (architecture, commands, permissions, data, testing, known limitations) read [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) next.

## What this is
- TurboFex: a WhatsApp group-management bot (Node.js >= 20, Baileys). Entry point: `index.js` (a small supervisor that starts `core/boot.js` as a child process, restarts it, and rolls back a bad update).
- Repo: `nels0nfx/TurboFex`, branch `main` (see `update.json`).
- Hosted on Pterodactyl-style panels (for example Spaceify). The panel runs `node /home/container/index.js`, so **`index.js` must be directly in the main folder, never inside a sub-folder**.

## Hard rules
1. **No GitHub Actions, no workflows, no `.github/` folder.** The owner's GitHub account cannot run them. Everything is done by hand or from Termux.
2. Keep every existing bot feature working. Run `npm test` (Node's built-in runner: `node --test tests/*.test.js`) before handing over work.
3. Do not edit `core/brand.js` or `core/integrity.js`: the bot refuses to start (exit code 43) if the bot name changes.
4. Never commit secrets or live data: `session/`, `data/`, `session_id.txt`, `config.env`, `.env`, `node_modules/` are in `.gitignore` and are kept by the updater.
5. Propose big changes and let the owner decide before implementing them. Small fixes can just be done.

## How the owner pushes (Termux on Android)
The owner has no desktop. Work arrives as a ZIP of the whole project saved to the phone's Downloads, and is pushed like this (replaces everything except `.git`, then commits):

```
cp ~/storage/downloads/TurboFex-hosting-vX.Y.Z.zip ~/ && cd ~/TurboFex && find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + && unzip -oq ~/TurboFex-hosting-vX.Y.Z.zip -d ~/TurboFex && grep '"version"' package.json && git add -A && git commit -m "vX.Y.Z - short summary" && git push && rm ~/TurboFex-hosting-vX.Y.Z.zip
```

Consequences you must respect:
- Because the folder is wiped first, **the ZIP must contain every project file**. A file missing from the ZIP is deleted from the repo.
- The ZIP must be **flat**: `index.js`, `package.json`, `core/`, ... at the top level, no wrapper folder.
- A ZIP must never contain `.github/`, `node_modules/`, `session/`, `data/`, `session_id.txt` or `config.env`.
- To delete a file for bots that update themselves, list it in `removed.txt` (one path per line, `#` for notes).

## Releasing a new version
1. Change the code. Add or update tests in `tests/`.
2. Bump `"version"` in `package.json`, the title line of `README.md`, and the version check in `tests/realm.test.js` ("the version is X.Y.Z"). If the number of commands or categories changed, update the `<!-- counts: ... -->` line in `README.md` (a test checks it).
3. Add a block at the **top** of `changelog.txt`, newest first:
   ```
   TurboFex vX.Y.Z - short title
   CHANGED IN X.Y.Z
   - NEW / FIXED ... one line per change

   ```
4. Run `npm test`. Build the flat ZIP and push it with the command above.
5. After pushing, create the GitHub Release (the hosting download for people), from the repo folder in Termux:
   ```
   cd ~/TurboFex
   git archive --format=zip -o ~/TurboFex-hosting.zip HEAD
   gh release create vX.Y.Z ~/TurboFex-hosting.zip --title "TurboFex vX.Y.Z" --notes "short summary" --latest
   rm ~/TurboFex-hosting.zip
   ```
   `git archive` builds a flat ZIP of the committed files only (no `.git`, nothing from `.gitignore`). Keep the asset name exactly `TurboFex-hosting.zip` so
   `https://github.com/nels0nfx/TurboFex/releases/latest/download/TurboFex-hosting.zip` always gives the newest flat ZIP. (`gh` is installed with `pkg install gh`; log in once with `gh auth login`.)

## Why the green "Code > Download ZIP" button does not work for hosting
GitHub wraps that download in an extra `TurboFex-main/` folder. On the panel `index.js` then sits in `/home/container/TurboFex-main/`, and the bot fails with `Cannot find module '/home/container/index.js'`. A repo cannot turn this off without GitHub Actions. People should download the **hosting ZIP from Releases** instead. If someone already used the green button: open `TurboFex-main`, select everything inside, move it up one level, delete the empty folder.

## Self-update
On every start (and with the `.update` command) the bot reads `package.json` from the repo (`core/updater.js`). If the version differs it downloads the branch zip (this one has the wrapper folder; the updater strips it), **validates it before replacing anything** (every `.js` file must compile, required files must exist, relative `require`s must resolve, `package.json` must have a version), keeps a rollback copy in `data/rollback`, and restarts. Other update sources, in order: `turbofex-latest.zip` in the repo, then a `.zip` attached to a GitHub Release. Files the updater never touches: `config.js`, `session_id.txt`, `config.env`, `session/`, `data/`, `node_modules/`, `.env`, `.git`, `.github`. If you add a new required file, make sure it is in the repo before the version is bumped.

## Linking the bot (session ID and the pairing site)
- The owner runs a pairing site: `https://turbofex-pair.onrender.com` (free Render host, it can be asleep for up to a minute). The user links a WhatsApp number there and gets an ID like `TFX-K7M2-9QXA-4BNP`.
- The ID is **one-use and valid for 5 minutes**. Paste it in `session_id.txt` (`SESSION_ID=TFX-...`), in a `config.env` line, or in the host variable `SESSION_ID` (the host variable wins), then restart.
- The bot downloads the login from `GET <pair site>/api/session/<ID>` (JSON with `me.id`; 404/400 for an unknown ID), saves it to `session/creds.json`, and the linked number becomes the bot's number and owner. Code: `core/sessionid.js`, `core/setup.js`, `config.js`. `PAIR_SITE_URL` changes the site.
- The old console linking (pairing code/QR) only runs with `CONSOLE_LINK=1`.

## Settings
`config.js` reads environment variables. An optional `config.env` file in the main folder (`KEY=value`, `#` notes, Levanter-style) is loaded first by `core/envfile.js`; host variables always win. Common keys: `SESSION_ID`, `PREFIX`, `TIMEZONE`, `NUMBER`, `PAIR_SITE_URL`, `BOT_BROWSER`. The full table is in `README.md`.

## Code map
- `index.js` supervisor; `core/` engine (boot, updater, session, storage, web helpers); `whatsapp/` connection, handler, games under `whatsapp/play/`; `commands/` one file per command group; `tests/` one test file per area (they use a temporary data folder, see `tests/_setup.js`).
- Plain CommonJS, no build step. Comments in the code are written in simple English for a non-developer owner: keep that style.

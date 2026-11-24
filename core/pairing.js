// Pairing for somebody else, the same way as the pairing site: the owner types `pair 27821234567` and is given the pairing CODE only. He gives it
// to that person; when they have entered it, their SESSION ID and the instructions are sent to THEIR OWN WhatsApp (their "Message yourself" chat),
// not to the owner. Nothing runs for them on the owner's server and nothing of the owner's bot is touched:
//   - a temporary bot process (the normal linking of the bot, with a pairing code) is started in its own folder, with its own login, data and
//     settings. It never uses accounts.json or the launcher, and it does nothing but link and deliver (TURBOFEX_PAIR_ONLY).
//   - it writes the code to pairing-status.json (note() below); the owner is sent that code in the PRIVATE chat.
//   - when the person has entered the code, that process turns its own login into a session ID (core/sessionid.js, "TFXS.…") and sends it
//     from the person's account to the person's own chat (core/pairdeliver.js). The owner is only told that it was delivered.
//   - the process is then stopped and the temporary folder is deleted. The person puts the ID in SESSION_ID on THEIR host.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sessionid = require('./sessionid');

const FILE = 'pairing-status.json';
const CODE_FRESH_MS = 110 * 1000; // a pairing code is only good for a short time

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// ---- inside the temporary process: tell the owner's side what is happening
function note(dataDir, state, extra = {}) {
  try {
    writeJson(path.join(dataDir, FILE), { state, at: Date.now(), ...extra });
  } catch (err) {
    // only a message for the owner: never a reason to fail
  }
}
// when the process has just come online: the linking is finished
function noteOnline(dataDir, number) {
  const file = path.join(dataDir, FILE);
  const cur = readJson(file, null);
  if (cur && (cur.state === 'code' || cur.state === 'refused')) note(dataDir, 'linked', { number }); // never back from "delivered" after a reconnect
}

// ---- the owner's side
// the temporary folder of one pairing
const folderFor = (base, number) => path.join(base, 'pairing', number);

// what the temporary process says now: { state: 'none' | 'code' | 'refused' | 'linked', code?, fresh? }
function statusOf(folder) {
  const s = readJson(path.join(folder, 'data', FILE), null);
  if (!s || !s.state) return { state: 'none' };
  return { ...s, fresh: Date.now() - (s.at || 0) < CODE_FRESH_MS };
}

// The login in a session folder as a session ID: { id, jid } or { error } (used by the temporary process, on its own login)
function exportSession(sessionDir) {
  const creds = readJson(path.join(sessionDir, 'creds.json'), null);
  if (!creds || !(creds.me && creds.me.id)) return { error: 'no login was saved' };
  creds.registered = true;
  return { id: sessionid.encode(creds), jid: creds.me.id };
}

// What the person receives in their own chat (the same kind of message the pairing site sends): the explanation, then the ID alone.
function userMessages(id) {
  return [
    '✅ *Your WhatsApp is linked.*\n▸ Your *session ID* is in the next message. Treat it like a password: whoever has it controls this linked device, so never share it.\n▸ Put it in the *SESSION_ID* variable of your TurboFex bot on your host (or in the file session_id.txt as `SESSION_ID=<the ID>`), then start the bot.\n▸ Use it in *ONE place only*. If it runs in two places, WhatsApp logs one of them out.\n▸ To remove it any time: WhatsApp > Linked devices > this device > Log out.',
    id,
  ];
}

// Starts the temporary linking process for a number. Returns { child, folder }. `spawnFn` is only replaced by the tests.
function startLinker({ root, base, number, spawnFn = spawn, execPath = process.execPath, env = process.env }) {
  const folder = folderFor(base, number);
  fs.rmSync(folder, { recursive: true, force: true }); // never reuse an old login
  fs.mkdirSync(path.join(folder, 'data'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'session'), { recursive: true });
  const log = fs.openSync(path.join(folder, 'linker.log'), 'a');
  const child = spawnFn(execPath, [path.join(root, 'index.js')], {
    cwd: root,
    stdio: ['ignore', log, log],
    env: {
      ...env,
      FLASH_CHILD: '1',
      ACCOUNT_NAME: `pair-${number}`,
      TURBOFEX_ISOLATED: '1', // config.env must not hand this process the login or the number of the real bot
      TURBOFEX_NO_UPDATE: '1',
      TURBOFEX_PAIR_ONLY: '1', // it only links: nothing else starts
      TURBOFEX_DATA: path.join(folder, 'data'),
      SESSION_DIR: path.join(folder, 'session'),
      SESSION_ID_FILE: path.join(folder, 'session_id.txt'),
      SESSION_ID: '',
      NUMBER: number,
      PAIRING_NUMBER: '',
      OWNER_NUMBER: '',
      CONSOLE_LINK: '1',
      PAIR_METHOD: 'code',
    },
  });
  try {
    fs.closeSync(log);
  } catch (err) {
    // the child has its own copy
  }
  return { child, folder };
}

// stops the process (politely first) and deletes the folder
async function finish({ child, folder }) {
  try {
    if (child && child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (err) { /* gone */ } resolve(); }, 8000);
        if (child.once) child.once('exit', () => { clearTimeout(t); resolve(); });
        else { clearTimeout(t); resolve(); }
      });
    }
  } catch (err) {
    // already gone
  }
  try {
    fs.rmSync(folder, { recursive: true, force: true });
  } catch (err) {
    // the owner can delete data/pairing by hand
  }
}

// Watches one pairing and calls back: onCode(code), onRefused(), onLinked() (once), onDelivered(), onFailed(reason), onTimeout(linked).
// Resolves with how it ended. After "linked" it waits up to `deliverMs` more for the delivery to the person's own chat.
const watching = new Set();
async function watch({ folder, number, onCode, onRefused, onLinked, onDelivered, onFailed, onTimeout, intervalMs = 2000, maxMs = 6 * 60 * 1000, deliverMs = 120 * 1000 }) {
  if (watching.has(number)) return 'already';
  watching.add(number);
  const began = Date.now();
  let lastCode = '';
  let linkedAt = 0;
  try {
    for (;;) {
      const s = statusOf(folder);
      if (s.state === 'delivered') {
        await onDelivered(number);
        return 'delivered';
      }
      if (s.state === 'failed') {
        await onFailed(number, s.reason || '');
        return 'failed';
      }
      if (s.state === 'linked' && !linkedAt) {
        linkedAt = Date.now();
        await onLinked(number);
      }
      if (s.state === 'refused' && s.fresh) {
        await onRefused(number);
        return 'refused';
      }
      if (s.state === 'code' && s.fresh && s.code && s.code !== lastCode) {
        lastCode = s.code;
        await onCode(s.code, number);
      }
      const over = linkedAt ? Date.now() - linkedAt > deliverMs : Date.now() - began > maxMs;
      if (over) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    await onTimeout(number, !!linkedAt);
    return 'timeout';
  } finally {
    watching.delete(number);
  }
}

const isWatching = (number) => watching.has(number);

module.exports = { note, noteOnline, statusOf, exportSession, userMessages, startLinker, finish, watch, isWatching, folderFor, CODE_FRESH_MS };

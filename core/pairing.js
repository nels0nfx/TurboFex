// Pairing for somebody else: the owner types `pair 27821234567` and gets a pairing code to give to that person, instead of the person
// going to the pairing site. How it works:
//   1) the number becomes a new ACCOUNT of this bot (an entry in accounts.json with link "code"): its own bot process, its own login folder
//      accounts/<name>/ (core/accounts.js). The launcher (index.js) notices the new entry within 5 seconds and starts it.
//   2) that account asks WhatsApp for a pairing code for the number (the normal linking code of the bot) and writes it to
//      accounts/<name>/data/pairing-status.json (note() below).
//   3) the command reads that file and sends the code to the owner, who gives it to the person: WhatsApp > Linked devices > Link a device >
//      "Link with phone number instead" > the code.
//   4) when the person has entered it, the account writes "linked" and the owner is told. From then on it is that person's own bot.
const fs = require('fs');
const path = require('path');

const FILE = 'pairing-status.json';
const PENDING = 'pair-pending.json';
const CODE_FRESH_MS = 110 * 1000; // a pairing code is only good for a short time

const nameFor = (number) => `p${number}`;
const accountDir = (root, name) => path.join(root, 'accounts', name);
const statusFile = (root, name) => path.join(accountDir(root, name), 'data', FILE);

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

// ---- inside the new account: tell the owner's side what is happening
function note(dataDir, state, extra = {}) {
  try {
    writeJson(path.join(dataDir, FILE), { state, at: Date.now(), ...extra });
  } catch (err) {
    // only a message for the owner: never a reason to fail
  }
}
// when the account has just come online: a pairing that was waiting is now finished
function noteOnline(dataDir, number) {
  const file = path.join(dataDir, FILE);
  const cur = readJson(file, null);
  if (cur && cur.state !== 'linked') note(dataDir, 'linked', { number });
}

// ---- the owner's side
function readEntries(root) {
  const file = path.join(root, 'accounts.json');
  if (!fs.existsSync(file)) return { exists: false, entries: [] };
  const json = readJson(file, null);
  if (json === null) return { exists: true, broken: true, entries: [] };
  return { exists: true, entries: Array.isArray(json) ? json : Array.isArray(json.accounts) ? json.accounts : [] };
}

const entryName = (e) => String(typeof e === 'string' ? e : e && e.name || '').trim().toLowerCase();
const entryNumber = (e) => (e && typeof e === 'object' ? String(e.number || '').replace(/\D/g, '') : '');

function isLinked(root, name) {
  const creds = readJson(path.join(accountDir(root, name), 'session', 'creds.json'), null);
  return !!(creds && creds.registered);
}

// Starts pairing for a number. Returns { status: 'started' | 'waiting' | 'linked' | 'own' | 'broken', name, restartsOnce }
function start(root, number, ownNumber = '') {
  if (ownNumber && number === ownNumber) return { status: 'own' };
  const name = nameFor(number);
  const read = readEntries(root);
  if (read.broken) return { status: 'broken' };
  const byNumber = read.entries.find((e) => entryNumber(e) === number || entryName(e) === name);
  if (byNumber) {
    const n = entryName(byNumber);
    return { status: isLinked(root, n) ? 'linked' : 'waiting', name: n };
  }
  const entries = read.exists ? read.entries : [{ name: 'main' }]; // the bot that is running now stays the main account
  entries.push({ name, number, link: 'code' });
  writeJson(path.join(root, 'accounts.json'), { accounts: entries });
  return { status: 'started', name, restartsOnce: !read.exists };
}

// what the account says now: { state: 'none' | 'code' | 'refused' | 'linked', code?, fresh? }
function statusOf(root, name) {
  if (isLinked(root, name)) return { state: 'linked' };
  const s = readJson(statusFile(root, name), null);
  if (!s || !s.state) return { state: 'none' };
  return { ...s, fresh: Date.now() - (s.at || 0) < CODE_FRESH_MS };
}

// ---- requests that must survive the one restart that happens when the bot becomes several accounts
const pendingFile = (dataDir) => path.join(dataDir, PENDING);
const pending = (dataDir) => readJson(pendingFile(dataDir), []).filter((p) => p && p.name && Date.now() - p.at < 15 * 60 * 1000);
function addPending(dataDir, item) {
  const all = pending(dataDir).filter((p) => p.name !== item.name);
  all.push({ ...item, at: Date.now() });
  writeJson(pendingFile(dataDir), all);
}
function clearPending(dataDir, name) {
  writeJson(pendingFile(dataDir), pending(dataDir).filter((p) => p.name !== name));
}

// Watches one pairing and calls back: onCode(code, number), onRefused(), onLinked(), onTimeout(). Resolves when it is over.
const watching = new Set();
async function watch({ root, name, number, onCode, onRefused, onLinked, onTimeout, intervalMs = 2000, maxMs = 6 * 60 * 1000 }) {
  if (watching.has(name)) return 'already';
  watching.add(name);
  const began = Date.now();
  let lastCode = '';
  try {
    while (Date.now() - began < maxMs) {
      const s = statusOf(root, name);
      if (s.state === 'linked') {
        await onLinked(number);
        return 'linked';
      }
      if (s.state === 'refused' && s.fresh) {
        await onRefused(number);
        return 'refused';
      }
      if (s.state === 'code' && s.fresh && s.code && s.code !== lastCode) {
        lastCode = s.code;
        await onCode(s.code, number);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    await onTimeout(number);
    return 'timeout';
  } finally {
    watching.delete(name);
  }
}

module.exports = { note, noteOnline, start, statusOf, watch, addPending, clearPending, pending, nameFor, isLinked, statusFile, CODE_FRESH_MS };

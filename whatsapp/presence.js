// Owner automation: typing / recording indicators, always online, auto bio, auto reactions, private message blocker.
const store = require('./store');
const clock = require('../core/clock');
const { num } = require('./utils');
const config = require('../config');

let current = null;
let onlineTimer = null;
let bioTimer = null;
let lastBio = '';

const DEFAULT_BIO = '🤖 TurboFex • {time} • {date}';
const DEFAULT_EMOJIS = ['❤️', '😂', '🔥', '👍', '😮', '🎉'];

const fillBio = (t) => {
  const p = clock.parts();
  return String(t || DEFAULT_BIO).replace(/\{time\}/g, p.time).replace(/\{date\}/g, p.date).replace(/\{day\}/g, p.day || '').slice(0, 139);
};

async function updateBio(force = false) {
  const cfg = store.getAuto('bio');
  if (!current || !cfg?.on) return;
  const text = fillBio(cfg.text);
  if (!force && text === lastBio) return;
  lastBio = text;
  try {
    await current.updateProfileStatus(text);
  } catch (err) {
    console.log(`Auto bio failed: ${err.message}`);
  }
}

// (re)starts the loops that are switched on; called when the bot connects and when a setting changes
function apply(sock) {
  if (sock) current = sock;
  clearInterval(onlineTimer);
  clearInterval(bioTimer);
  onlineTimer = bioTimer = null;
  if (!current) return;
  if (store.getAuto('online')) {
    const ping = () => current.sendPresenceUpdate('available').catch(() => {});
    ping();
    onlineTimer = setInterval(ping, 25000);
    if (onlineTimer.unref) onlineTimer.unref();
  }
  if (store.getAuto('bio')?.on) {
    updateBio(true);
    bioTimer = setInterval(() => updateBio(false), 10 * 60 * 1000); // WhatsApp does not like faster changes
    if (bioTimer.unref) bioTimer.unref();
  }
}

// "typing..." / "recording..." the moment someone writes to the bot (private chats by default, see "autotyping where").
// It is NOT shown while a command runs, and never for the owner's own messages.
const shownAt = new Map();
let warnedOnce = false;
const kindNow = () => (store.getAuto('recording') ? 'recording' : store.getAuto('typing') ? 'composing' : null);
const incomingAllowed = (jid) => {
  const where = store.getAuto('presenceWhere', 'dms');
  const isGroup = jid.endsWith('@g.us');
  return where === 'all' || (where === 'groups' ? isGroup : !isGroup);
};
// a private chat is addressed the way WhatsApp addresses that person (the hidden id when known), like the messages are
const chatTarget = (jid) => (jid.endsWith('@s.whatsapp.net') ? require('./idmap').lidSync(jid) || jid : jid);
const isOwnerJid = (jid) => {
  const owner = String(config.ownerNumber || '');
  if (!owner || !jid) return false;
  const idmap = require('./idmap');
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : jid;
  return num(pn || jid) === owner;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the real sequence, with every step reported (used by the "autotyping test" command and by incoming messages)
const timing = { pause: 400, hold: 4000, step: 2000, tail: 2000 }; // milliseconds (tests make them tiny)
async function indicate(sock, jid, kind, { hold = timing.hold, report = null } = {}) {
  const to = chatTarget(jid);
  const step = async (name, fn) => {
    try {
      await fn();
      if (report) report.push(`✅ ${name}`);
      return true;
    } catch (err) {
      if (report) report.push(`❌ ${name}: ${String(err.message || err).slice(0, 80)}`);
      else if (!warnedOnce) {
        warnedOnce = true;
        console.log(`ℹ️ Typing indicator: ${name} failed (${err.message}). Run "autotyping test" in a chat to see details.`);
      }
      return false;
    }
  };
  if (sock.presenceSubscribe) await step('subscribe to the chat', () => sock.presenceSubscribe(to));
  await wait(timing.pause);
  await step('go online', () => sock.sendPresenceUpdate('available'));
  if (!(await step(kind === 'recording' ? 'show "recording audio..."' : 'show "typing..."', () => sock.sendPresenceUpdate(kind, to)))) return;
  // WhatsApp lets the indicator fade after a few seconds, so it is repeated while it is shown
  for (let waited = 0; waited + timing.step < hold; waited += timing.step) {
    await wait(timing.step);
    await sock.sendPresenceUpdate(kind, to).catch(() => {});
  }
  await wait(Math.min(timing.tail, hold));
  await step('stop the indicator', () => sock.sendPresenceUpdate('paused', to));
}

function onIncoming(sock, msg, jid) {
  const kind = kindNow();
  if (!kind || msg.key.fromMe || !jid || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  if (!incomingAllowed(jid) || isOwnerJid(msg.key.participant || jid)) return;
  if (Date.now() - (shownAt.get(jid) || 0) < 8000) return; // not again and again for every message of a conversation
  shownAt.set(jid, Date.now());
  if (shownAt.size > 3000) shownAt.clear();
  indicate(sock, jid, kind).catch(() => {});
}

// ---- auto react: where does it work?  scope = all | groups | dms | selected (the chats and people the owner picked)
const SCOPES = ['all', 'groups', 'dms', 'selected'];
const lastReact = new Map();

function reactAllowed(cfg, jid, senderKeys) {
  const scope = SCOPES.includes(cfg.scope) ? cfg.scope : 'all';
  const isGroup = jid.endsWith('@g.us');
  if (scope === 'groups') return isGroup;
  if (scope === 'dms') return !isGroup;
  if (scope === 'selected') return (cfg.chats || []).includes(jid) || senderKeys.some((k) => (cfg.people || []).includes(k));
  return true;
}

// a reaction under a message of someone else (at most one in 20 seconds per chat, so it never floods)
function reactTo(sock, msg, jid, senderKeys = []) {
  const cfg = store.getAuto('react');
  if (!cfg?.on || msg.key.fromMe) return;
  if (!reactAllowed(cfg, jid, senderKeys)) return;
  if (Date.now() - (lastReact.get(jid) || 0) < 20000) return;
  lastReact.set(jid, Date.now());
  if (lastReact.size > 2000) lastReact.clear();
  const list = cfg.emojis?.length ? cfg.emojis : DEFAULT_EMOJIS;
  sock.sendMessage(jid, { react: { text: list[Math.floor(Math.random() * list.length)], key: msg.key } }).catch(() => {});
}

// private message blocker: strangers who write to the bot in private get a notice, and with "block" they are blocked on the next message.
// A "stranger" is NOT: someone in the owner's contacts, someone the owner has written to in that chat, or someone allowed with "pmblocker allow".
const warned = new Map();
const WARN_AGAIN_MS = 24 * 60 * 60 * 1000;
const NOTICE = '🚫 This bot does not answer private messages. Please use it in a group.';
const MAX_ALLOWED = 1500;

const allowedList = () => store.getAuto('pmAllow', []);
const keysOf = (jid) => {
  const idmap = require('./idmap');
  const keys = new Set([num(jid)]);
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  const lid = idmap.isPn(jid) ? idmap.lidSync(jid) : null;
  if (pn) keys.add(num(pn));
  if (lid) keys.add(num(lid));
  return [...keys].filter(Boolean);
};
const isAllowed = (jid) => {
  const list = allowedList();
  return keysOf(jid).some((k) => list.includes(k)) || require('./names').isSaved(jid);
};
function allow(jid) {
  const list = allowedList().slice();
  let changed = false;
  for (const k of keysOf(jid)) if (!list.includes(k)) { list.push(k); changed = true; }
  if (!changed) return false;
  store.setAuto('pmAllow', list.slice(-MAX_ALLOWED));
  return true;
}
function deny(jid) {
  const keys = keysOf(jid);
  const list = allowedList().filter((k) => !keys.includes(k));
  const changed = list.length !== allowedList().length;
  if (changed) store.setAuto('pmAllow', list);
  return changed;
}
// the owner wrote in this private chat: that person is not a stranger
const engage = (jid) => {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  if (!isAllowed(jid)) allow(jid);
};

async function pmGuard(sock, jid, mode) {
  if (isAllowed(jid)) return;
  const at = warned.get(jid);
  const fresh = at && Date.now() - at < WARN_AGAIN_MS;
  if (!fresh) {
    warned.set(jid, Date.now());
    if (warned.size > 5000) warned.clear();
    await sock.sendMessage(jid, { text: mode === 'block' ? `${NOTICE}\n⚠️ If you write again you will be blocked.` : NOTICE }).catch(() => {});
    return;
  }
  if (mode === 'block') {
    await sock.updateBlockStatus(jid, 'block').catch(() => {});
    warned.delete(jid);
  }
}

module.exports = { apply, onIncoming, indicate, kindNow, timing, reactTo, reactAllowed, pmGuard, allow, deny, engage, allowedList, fillBio, DEFAULT_BIO, DEFAULT_EMOJIS };

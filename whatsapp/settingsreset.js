// Reset the bot's settings, with a snapshot so it can be undone.
//   RESET:  the bot-wide settings (mode, prefix, automation, status, watchers, rate limit, watermark, sticker pack, link previews, anti-call,
//           menu title...), auto tag and the ignored chats.
//   KEPT:   your extra owners and the banned list, saved API keys, the private-chat allow list, reminders and schedules, filters, AFK,
//           group settings, user data, the login (session), and the way this bot appears as a linked device.
// The snapshot is saved (data/settingsundo.json), so `undo` still works after a restart, for 10 minutes.
const jsonstore = require('../core/jsonstore');
const store = require('./store');
const autotag = require('./autotag');
const ignored = require('./ignored');

const KEYS = ['mode', 'prefix', 'noPrefix', 'anticall', 'autoUpdate', 'cmdReact', 'guard', 'linkPreview', 'rate', 'region', 'restartMsg', 'sticker', 'status', 'watch', 'watermark'];
const KEEP_IN_AUTO = new Set(['apikeys', 'pmAllow']); // inside the "auto" settings: secrets and a list of people, not settings
const UNDO_MS = 10 * 60 * 1000;

const undoStore = jsonstore.open('settingsundo', { snap: null });
const timing = { stepMs: 1000 }; // one second per number of the countdown (the tests make it short)
let pending = null; // a countdown in progress: { cancelled }

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// a picture of everything that a reset would change
function take() {
  const b = store.rawBot();
  const bot = {};
  for (const k of KEYS) bot[k] = clone(b[k]);
  const auto = {};
  for (const k of Object.keys(b.auto || {})) if (!KEEP_IN_AUTO.has(k)) auto[k] = clone(b.auto[k]);
  return { at: Date.now(), bot, auto, autotag: clone(autotag.state()), ignored: ignored.list() };
}

// puts the settings back to the defaults
function reset() {
  const b = store.rawBot();
  for (const k of KEYS) delete b[k];
  if (b.auto) for (const k of Object.keys(b.auto)) if (!KEEP_IN_AUTO.has(k)) delete b.auto[k];
  store.touchBot();
  autotag.setAll(false);
  ignored.restore([]);
}

// puts a snapshot back exactly as it was
function restore(snap) {
  const b = store.rawBot();
  for (const k of KEYS) {
    if (snap.bot && snap.bot[k] !== undefined && snap.bot[k] !== null) b[k] = clone(snap.bot[k]);
    else if (snap.bot && snap.bot[k] === null) b[k] = null;
    else delete b[k];
  }
  if (b.auto) for (const k of Object.keys(b.auto)) if (!KEEP_IN_AUTO.has(k)) delete b.auto[k];
  if (snap.auto && Object.keys(snap.auto).length) {
    b.auto = b.auto || {};
    for (const [k, v] of Object.entries(snap.auto)) b.auto[k] = clone(v);
  }
  store.touchBot();
  autotag.restore(snap.autotag);
  ignored.restore(snap.ignored);
}

const keepForUndo = (snap) => { undoStore.data.snap = snap; undoStore.touch(); undoStore.flush && undoStore.flush(); };
const undoable = () => {
  const s = undoStore.data.snap;
  return s && Date.now() - s.at < UNDO_MS ? s : null;
};
const clearUndo = () => { undoStore.data.snap = null; undoStore.touch(); };

const countdown = { get active() { return !!pending; } };
const startCountdown = () => { pending = { cancelled: false }; return pending; };
const stopCountdown = () => { pending = null; };
const cancelCountdown = () => { if (!pending) return false; pending.cancelled = true; return true; };

module.exports = { take, reset, restore, keepForUndo, undoable, clearUndo, startCountdown, stopCountdown, cancelCountdown, countdown, timing, KEYS, KEEP_IN_AUTO, UNDO_MS };

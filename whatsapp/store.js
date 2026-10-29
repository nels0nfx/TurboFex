// Saves each group's settings and the bot's own settings in data/groups.json
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { num } = require('./utils');
const { DATA } = require('../core/paths');

const MAX_WARNINGS = Number(config.maxWarnings) || 3;
const DEFAULT_WELCOME = '👋 Welcome @user to *{group}*!\n👥 You are member #{count}.';
const DEFAULT_GOODBYE = '🚪 @user has left *{group}*. Goodbye! 👋';
const ANTILINK_MODES = ['off', 'delete', 'warn', 'kick'];
const BOT_KEY = '__bot';

const dir = DATA;
const file = path.join(dir, 'groups.json');

let db = {};
try {
  db = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  db = {};
}

// Saves are batched: many changes within a moment become ONE disk write (keeps the bot fast)
let saveTimer = null;
let dirty = false;

function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty) return; // nothing changed: never touch the disk
  dirty = false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db));
  } catch (err) {
    console.error('Could not save settings:', err.message);
  }
}

function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 400);
  if (saveTimer.unref) saveTimer.unref();
}

process.on('exit', flush);

function getGroup(jid) {
  const g = db[jid] || (db[jid] = {});
  if (!ANTILINK_MODES.includes(g.antilinkMode)) g.antilinkMode = g.antilink === true ? 'warn' : 'off';
  delete g.antilink; // old v0.0.2 setting
  if (!ANTILINK_MODES.includes(g.antiwordMode)) g.antiwordMode = 'off';
  if (!ANTILINK_MODES.includes(g.antigmMode)) g.antigmMode = 'off'; // group mentions in a status
  if (!ANTILINK_MODES.includes(g.antigstatusMode)) g.antigstatusMode = 'off'; // group status posts
  if (!ANTILINK_MODES.includes(g.antibotMode)) g.antibotMode = 'off'; // other bots writing in the group
  if (!ANTILINK_MODES.includes(g.antitagMode)) g.antitagMode = 'off'; // mass tagging
  if (!Number.isInteger(g.antitagLimit) || g.antitagLimit < 2) g.antitagLimit = 8; // this many tags in one message = mass tagging
  if (!Array.isArray(g.silenced)) g.silenced = []; // members whose messages are deleted
  if (!Array.isArray(g.disabled)) g.disabled = []; // commands switched off in this group
  if (typeof g.autosticker !== 'boolean') g.autosticker = false; // pictures and videos become stickers
  if (typeof g.captcha !== 'boolean') g.captcha = false; // new members must answer a question
  if (!Number.isInteger(g.captchaSeconds) || g.captchaSeconds < 30) g.captchaSeconds = 120;
  if (!['off', 'lock', 'kick'].includes(g.antiraid)) g.antiraid = 'off'; // many joins at once
  if (!Number.isInteger(g.antiraidJoins) || g.antiraidJoins < 3) g.antiraidJoins = 8;
  if (!Number.isInteger(g.antiraidSeconds) || g.antiraidSeconds < 10) g.antiraidSeconds = 60;
  if (!Array.isArray(g.botList)) g.botList = []; // people the admins marked as bots
  if (typeof g.antibotStrict !== 'boolean') g.antibotStrict = true; // also use the message id of linked-device bots
  if (!Array.isArray(g.silenceTold)) g.silenceTold = []; // silenced members who were already told once
  if (!ANTILINK_MODES.includes(g.antispamMode)) g.antispamMode = g.antispam ? 'warn' : 'off'; // flooding: off / delete / warn / kick
  if (!Number.isInteger(g.antispamLimit) || g.antispamLimit < 2) g.antispamLimit = 6; // this many messages...
  if (!Number.isInteger(g.antispamSeconds) || g.antispamSeconds < 2) g.antispamSeconds = 8; // ...within this many seconds
  if (!Number.isInteger(g.antispamRepeat) || g.antispamRepeat < 0) g.antispamRepeat = 0; // the same text this many times (0 = not checked)
  for (const k of ['welcome', 'goodbye', 'antispam', 'pdm']) {
    if (typeof g[k] !== 'boolean') g[k] = false;
  }
  if (typeof g.welcomeText !== 'string') g.welcomeText = null;
  if (typeof g.goodbyeText !== 'string') g.goodbyeText = null;
  if (!Number.isInteger(g.warnLimit)) g.warnLimit = null;
  if (!g.warnings) g.warnings = {};
  if (!Array.isArray(g.badWords)) g.badWords = [];
  if (!Array.isArray(g.antifake)) g.antifake = [];
  if (!g.filters || typeof g.filters !== 'object' || Array.isArray(g.filters)) g.filters = {};
  if (!g.autoMute || typeof g.autoMute !== 'object') g.autoMute = { mute: null, unmute: null };
  if (!g.antimedia || typeof g.antimedia !== 'object') g.antimedia = {}; // { sticker, image, video, audio, document }: true = not allowed
  if (!Number.isInteger(g.slowmode) || g.slowmode < 0) g.slowmode = 0; // seconds between two messages of a member
  if (typeof g.rules !== 'string') g.rules = null;
  for (const k of ['antipromote', 'antidemote', 'rank', 'birthdays']) {
    if (typeof g[k] !== 'boolean') g[k] = false;
  }
  return g;
}

function update(jid, fn) {
  const g = getGroup(jid);
  fn(g);
  save();
  return g;
}

function forEachGroup(fn) {
  for (const jid of Object.keys(db)) {
    if (jid.endsWith('@g.us')) fn(jid, getGroup(jid));
  }
}

// ----- warnings -----
function getLimit(jid) {
  return getGroup(jid).warnLimit || MAX_WARNINGS;
}

function setLimit(jid, n) {
  return update(jid, (g) => {
    g.warnLimit = n;
  });
}

function addWarning(jid, id) {
  const g = getGroup(jid);
  const key = num(id);
  const count = (g.warnings[key]?.count || 0) + 1;
  g.warnings[key] = { jid: id, count };
  save();
  return { count, max: getLimit(jid) };
}

function resetWarnings(jid, id) {
  const g = getGroup(jid);
  delete g.warnings[num(id)];
  save();
}

function getWarnings(jid, id) {
  return getGroup(jid).warnings[num(id)]?.count || 0;
}

function allWarnings(jid) {
  return Object.values(getGroup(jid).warnings).filter((w) => w.count > 0);
}

// ----- bot-wide settings -----
function bot() {
  return db[BOT_KEY] || (db[BOT_KEY] = {});
}

// Default is PRIVATE: only the owner can use commands until the owner sends "mode public"
function getMode() {
  return bot().mode === 'public' ? 'public' : 'private';
}

function setMode(mode) {
  bot().mode = mode;
  save();
}

function getAutoUpdate() {
  return bot().autoUpdate !== false;
}

function setAutoUpdate(on) {
  bot().autoUpdate = !!on;
  save();
}

const DEFAULT_PREFIX = '.';

function setPrefix(p) {
  bot().prefix = p || null;
  bot().noPrefix = false; // choosing a prefix switches "no prefix" mode off
  save();
}

// "No prefix" mode: commands are used without any symbol (menu, ping, play song...)
function setNoPrefix(on) {
  bot().noPrefix = !!on;
  save();
}

// The region (time zone) chosen with the "region" command. null = the one from config.js / TIMEZONE
const getRegion = () => bot().region || null;
function setRegion(zone) {
  bot().region = zone || null;
  save();
}

// The prefix that is really used: the one saved with "setprefix", else config.js / PREFIX, else "."
// (old config.js files still contain the previous default "!", which counts as "not chosen")
function effectivePrefix() {
  if (bot().noPrefix === true) return ''; // no prefix mode
  const saved = bot().prefix;
  if (saved) return saved;
  const fromConfig = process.env.PREFIX || config.prefix;
  if (fromConfig && fromConfig !== '!') return fromConfig;
  return DEFAULT_PREFIX;
}

// one time: the old default "!" that was saved before is dropped, so the new default "." applies
(function migratePrefix() {
  const b = bot();
  if (b.prefixMigrated) return;
  b.prefixMigrated = true;
  if (b.prefix === '!') b.prefix = null;
  dirty = true;
})();

// Owner automation (autotyping, autoread, alwaysonline, autobio, autoreact, pmblocker...): small named settings
const getAuto = (key, fallback = null) => (bot().auto && key in bot().auto ? bot().auto[key] : fallback);
function setAuto(key, value) {
  const b = bot();
  if (!b.auto || typeof b.auto !== 'object') b.auto = {};
  b.auto[key] = value;
  save();
}

// API keys the owner gave the bot with the setapi command (an environment variable still works too)
const API_ENV = { removebg: 'REMOVEBG_API_KEY', ocr: 'OCR_API_KEY', musixmatch: 'MUSIXMATCH_API_KEY', gemini: 'GEMINI_API_KEY' };
const getApiKey = (name) => (getAuto('apikeys', {}) || {})[name] || process.env[API_ENV[name]] || null;
function setApiKey(name, key) {
  const keys = { ...(getAuto('apikeys', {}) || {}) };
  if (key) keys[name] = key;
  else delete keys[name];
  setAuto('apikeys', keys);
}
const apiKeyNames = () => Object.keys(API_ENV);

// ----- how the bot shows up in Linked devices (set by "relink"); empty = default
function getBrowser() {
  return bot().browser || '';
}

// ----- command rate limit per person (the owner is never limited)
function rateCfg() {
  const b = bot();
  if (!b.rate || typeof b.rate !== 'object') b.rate = {};
  if (typeof b.rate.on !== 'boolean') b.rate.on = true;
  if (typeof b.rate.owner !== 'boolean') b.rate.owner = false; // true = the owner is limited too (to test the limit)
  if (!Number.isInteger(b.rate.limit) || b.rate.limit < 1) b.rate.limit = 20; // commands per minute
  return b.rate;
}

function updateRate(fn) {
  fn(rateCfg());
  save();
}

// ----- what to do with incoming calls: 'off' | 'reject' | 'block'
const getAnticall = () => (['reject', 'block'].includes(bot().anticall) ? bot().anticall : 'off');
function setAnticall(v) {
  bot().anticall = v;
  save();
}

// ----- link previews under messages that contain a link
const getLinkPreview = () => bot().linkPreview !== false;
function setLinkPreview(on) {
  bot().linkPreview = !!on;
  save();
}

// ----- credit inside the stickers the bot makes ("Sticker by ...")
function stickerCfg() {
  const b = bot();
  if (!b.sticker || typeof b.sticker !== 'object') b.sticker = {};
  if (typeof b.sticker.on !== 'boolean') b.sticker.on = true;
  return b.sticker;
}

function updateSticker(fn) {
  fn(stickerCfg());
  save();
}

// ----- reactions on commands (hourglass while working, tick when done) -----
// 'on' = hourglass then tick, 'smart' = only for slow commands, 'clean' = hourglass then removed, 'off' = no reactions
function getCmdReact() {
  const v = bot().cmdReact;
  return v === 'off' || v === 'clean' || v === 'smart' ? v : 'on';
}

function setCmdReact(v) {
  bot().cmdReact = v;
  save();
}

// ----- watermark added under the result of some commands -----
function watermarkCfg() {
  const b = bot();
  if (!b.watermark || typeof b.watermark !== 'object') b.watermark = {};
  if (typeof b.watermark.on !== 'boolean') b.watermark.on = true;
  if (typeof b.watermark.text !== 'string') b.watermark.text = null;
  return b.watermark;
}

function updateWatermark(fn) {
  fn(watermarkCfg());
  save();
}

// ----- message sent after a restart or an update -----
function getRestartMsg() {
  return bot().restartMsg !== false;
}

function setRestartMsg(on) {
  bot().restartMsg = !!on;
  save();
}

// ----- protection that blocks heavy commands when the server cannot cope -----
function getGuard() {
  return bot().guard !== false;
}

function setGuard(on) {
  bot().guard = !!on;
  save();
}

// lists of phone numbers (digits only): extra owners and banned users
function listOf(key) {
  const b = bot();
  return Array.isArray(b[key]) ? b[key] : (b[key] = []);
}

function addTo(key, id) {
  const n = num(id);
  const list = listOf(key);
  if (n && !list.includes(n)) {
    list.push(n);
    save();
  }
}

function removeFrom(key, id) {
  const n = num(id);
  const list = listOf(key);
  const i = list.indexOf(n);
  if (i !== -1) {
    list.splice(i, 1);
    save();
    return true;
  }
  return false;
}

// ----- filters that apply everywhere (owner) -----
function getGlobalFilters() {
  const b = bot();
  if (!b.filters || typeof b.filters !== 'object' || Array.isArray(b.filters)) b.filters = {};
  return b.filters;
}

// filters for private chats (owner)
function getPrivateFilters() {
  const b = bot();
  if (!b.pfilters || typeof b.pfilters !== 'object' || Array.isArray(b.pfilters)) b.pfilters = {};
  return b.pfilters;
}

// the filters of one chat without creating an empty record for it
function peekFilters(jid) {
  const f = db[jid]?.filters;
  return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
}

function saveNow() {
  flush();
}

// ----- AFK (away) -----
function afkMap() {
  const b = bot();
  if (!b.afk || typeof b.afk !== 'object') b.afk = {};
  return b.afk;
}

function afkGet(ids) {
  const map = afkMap();
  for (const id of ids) if (map[id]) return map[id];
  return null;
}

function afkSet(ids, reason) {
  const map = afkMap();
  const record = { reason: reason || '', since: Date.now(), ids: [...ids], told: {} };
  for (const id of ids) map[id] = record;
  save();
}

// each person is told about an AFK only ONCE per AFK session (turning AFK on again starts a new session)
function afkWasTold(record, who) {
  return !!(record.told && record.told[who]);
}

function afkMarkTold(record, who) {
  if (!record.told || typeof record.told !== 'object') record.told = {};
  const keys = Object.keys(record.told);
  if (keys.length > 3000) for (const k of keys.slice(0, 1000)) delete record.told[k];
  record.told[who] = Date.now();
  save();
}

function afkDel(ids) {
  const map = afkMap();
  const record = afkGet(ids);
  if (!record) return;
  for (const id of record.ids) delete map[id];
  save();
}

// ----- scheduled messages -----
function schedules() {
  const b = bot();
  return Array.isArray(b.schedules) ? b.schedules : (b.schedules = []);
}

// repeat = { kind: 'once' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly' | 'interval', ... } (see core/repeat.js)
// cmd = a bot command to run (without prefix) instead of sending text
function addSchedule({ jid, time, text, once, repeat, cmd }) {
  const b = bot();
  b.scheduleSeq = (b.scheduleSeq || 0) + 1;
  const rep = repeat || { kind: once ? 'once' : 'daily' };
  const item = { id: b.scheduleSeq, jid, time, text, once: rep.kind === 'once', repeat: rep };
  if (cmd) item.cmd = cmd;
  schedules().push(item);
  save();
  return item;
}

// a schedule item was changed in place (an "every N hours" item moves its next time): save it
const touchSchedules = () => save();

function removeSchedule(id) {
  const list = schedules();
  const i = list.findIndex((s) => s.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  save();
  return true;
}

// ----- reminders (!remind) -----
function reminders() {
  const b = bot();
  return Array.isArray(b.reminders) ? b.reminders : (b.reminders = []);
}

function addReminder({ jid, who, ids, at, text }) {
  const b = bot();
  b.reminderSeq = (b.reminderSeq || 0) + 1;
  const item = { id: b.reminderSeq, jid, who, ids, at, text };
  reminders().push(item);
  save();
  return item;
}

function removeReminder(id) {
  const list = reminders();
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  save();
  return true;
}

// ----- greeting for people who write privately (!setgreet) -----
const getGreet = () => bot().greet || null;

function setGreet(text) {
  bot().greet = text || null;
  save();
}

function wasGreeted(jid, withinMs) {
  const t = (bot().greeted || {})[jid];
  return !!t && Date.now() - t < withinMs;
}

function markGreeted(jid) {
  const b = bot();
  if (!b.greeted) b.greeted = {};
  b.greeted[jid] = Date.now();
  const keys = Object.keys(b.greeted);
  if (keys.length > 2000) {
    keys.sort((a, c) => b.greeted[a] - b.greeted[c]).slice(0, keys.length - 2000).forEach((k) => delete b.greeted[k]);
  }
  save();
}

// ----- welcome message sent once to whoever connects the bot -----
const getWelcomedFor = () => bot().welcomedFor || null;

function setWelcomedFor(account) {
  bot().welcomedFor = account;
  save();
}

// ----- WhatsApp status features (auto view / like / save) -----
function statusCfg() {
  const b = bot();
  const defaults = { view: false, like: false, save: false, emojis: ['❤️'], delayMin: 0, delayMax: 0, saveTo: null, dailyLikeLimit: 200 };
  b.status = { ...defaults, ...(b.status || {}) };
  if (!Array.isArray(b.status.emojis) || !b.status.emojis.length) b.status.emojis = ['❤️'];
  return b.status;
}

function updateStatusCfg(fn) {
  fn(statusCfg());
  save();
}

// ----- watchers: view-once, deleted and edited messages, each with its own destination -----
function watchCfg(name) {
  const b = bot();
  if (!b.watch) b.watch = {};
  const w = b.watch[name] || (b.watch[name] = {});
  if (!['off', 'all', 'dm', 'group'].includes(w.mode)) w.mode = 'off';
  if (typeof w.to !== 'string') w.to = null;
  return w;
}

function updateWatch(name, fn) {
  fn(watchCfg(name));
  save();
}

module.exports = {
  statusCfg, updateStatusCfg, watchCfg, updateWatch,
  getWelcomedFor, setWelcomedFor,
  reminders, addReminder, removeReminder, getGreet, setGreet, wasGreeted, markGreeted,
  getGlobalFilters, getPrivateFilters, peekFilters, saveNow,
  afkGet, afkSet, afkDel, afkWasTold, afkMarkTold,
  schedules, addSchedule, removeSchedule, touchSchedules,
  MAX_WARNINGS, DEFAULT_WELCOME, DEFAULT_GOODBYE, ANTILINK_MODES,
  getGroup, update, forEachGroup,
  getLimit, setLimit, addWarning, resetWarnings, getWarnings, allWarnings,
  getMode, setMode, getAutoUpdate, setAutoUpdate, setPrefix, setNoPrefix, getAuto, setAuto, getApiKey, setApiKey, apiKeyNames, getRegion, setRegion, effectivePrefix, DEFAULT_PREFIX,
  rateCfg, updateRate, getAnticall, setAnticall, getLinkPreview, setLinkPreview, getBrowser, stickerCfg, updateSticker, getCmdReact, setCmdReact, watermarkCfg, updateWatermark, getRestartMsg, setRestartMsg, getGuard, setGuard,
  getSudo: () => listOf('sudo'),
  addSudo: (id) => addTo('sudo', id),
  removeSudo: (id) => removeFrom('sudo', id),
  getBanned: () => listOf('banned'),
  addBanned: (id) => addTo('banned', id),
  removeBanned: (id) => removeFrom('banned', id),
};

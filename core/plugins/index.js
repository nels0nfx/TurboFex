'use strict';
// Plugin manager: turns plugins on and off, installs the ones the owner approves, adds their commands to the bot and runs
// every call in a sealed sandbox (see host.js). Light on purpose: nothing heavy is loaded while plugins are off.
const fs = require('node:fs');
const path = require('node:path');
const stats = require('./stats');
const crypto = require('node:crypto');
const manifestLib = require('./manifest');
const state = require('./state');
const registry = require('./registry');

const MIN_NODE = 22;
const CONFIRM_MS = 5 * 60 * 1000;
const botVersion = () => { try { return require('../../package.json').version; } catch (e) { return '0.0.0'; } };

let commands = null; let commandList = null; let sock = null;
let status = { state: 'off', reason: '' }; // off | unsupported | failed | ready
let selftested = false;
let revTimer = null;
const loaded = new Map(); // plugin id -> { manifest, source, cmds: [command objects] }
const hosts = new Map();
const timers = new Map();
const logs = new Map();
const pending = new Map(); // confirm code -> { id, folder, sha, expires }
const stores = new Map();

function attach(cmds, list) { commands = cmds; commandList = list; }

const WHY = {
  timeout: 'took too long to answer', memory_guard: 'used too much memory', memory_limit: 'used too much memory', cpu_limit: 'used too much processing time',
  stack_limit: 'got stuck in itself', withdrawn: 'was withdrawn from the store for safety', faults: 'kept failing', rules: 'tried things it was not allowed to do', worker_memory: 'used too much memory',
};
const plainWhy = (c) => WHY[c] || 'stopped working';

function log(id, line) { const a = logs.get(id) || []; a.push(new Date().toISOString().slice(11, 19) + ' ' + String(line).slice(0, 300)); if (a.length > 50) a.shift(); logs.set(id, a); }
const builtinNames = () => { const s = new Set(); if (commands) for (const [k, c] of commands) if (!c.pluginId) s.add(k); return s; };
const nodeOk = () => parseInt(process.versions.node, 10) >= MIN_NODE;
const engineOk = () => { try { require.resolve('quickjs-emscripten'); return true; } catch (e) { return false; } };
const prefixOf = () => { try { return require('../../config').prefix || '.'; } catch (e) { return '.'; } };

// ---------------------------------------------------------------- turning on and off
async function start(s) {
  if (s) sock = s;
  if (!state.isEnabled()) { status = { state: 'off', reason: '' }; return status; }
  if (!nodeOk()) { status = { state: 'unsupported', reason: 'Plugins need Node.js ' + MIN_NODE + ' or newer.' }; return status; }
  if (!engineOk()) { status = { state: 'unsupported', reason: 'The plugin engine is not installed on this server.' }; return status; }
  if (!selftested) {
    const r = await require('./selftest').run();
    if (!r.ok) { status = { state: 'failed', reason: 'The safety check failed: ' + r.reason + '.' }; console.error('Plugins stay off:', r.reason); return status; }
    selftested = true;
  }
  status = { state: 'ready', reason: '' };
  for (const [id, rec] of Object.entries(state.open().data.installed)) if (rec.enabled && !loaded.has(id)) activate(id, rec);
  startTimers(); try { purgeOldNotes(); } catch (e) { /* never stops the bot */ }
  if (!revTimer) { revTimer = setInterval(() => { checkWithdrawn(); setTimeout(() => checkUpdates(), Math.floor(Math.random() * 600000)).unref(); try { purgeOldNotes(); } catch (e) { /* ignore */ } }, 6 * 3600 * 1000); if (revTimer.unref) revTimer.unref(); }
  setTimeout(() => checkWithdrawn(), 15000).unref(); scheduleStats();
  setTimeout(() => checkUpdates(), 60000 + Math.floor(Math.random() * 300000)).unref();
  return status;
}
function stop() {
  if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
  if (revTimer) { clearInterval(revTimer); revTimer = null; } for (const t of timers.values()) clearInterval(t); timers.clear(); for (const h of hosts.values()) h.stop(); hosts.clear(); }
async function turnOn() { state.open().data.enabled = true; state.open().touch(); return start(sock); }
function turnOff() {
  state.open().data.enabled = false; state.open().touch();
  stop(); for (const id of [...loaded.keys()]) deactivate(id);
  status = { state: 'off', reason: '' };
}
const isRunning = () => status.state === 'ready';

// ---------------------------------------------------------------- commands
// the files in the plugin folder are not the ones the owner approved (for example a store update was fetched but never confirmed):
// put back the saved copy of the approved version, if there is one
function healFromPrevious(id, rec) {
  try {
    if (!rec.store) return false;
    const src = path.join(state.previousDir(id), rec.store.version);
    const v = manifestLib.validate(src, { botVersion: botVersion(), taken: builtinNames() });
    if (!v.ok || v.entrySha !== rec.sha) return false;
    const to = path.join(state.dir(), id); fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(src, to, { recursive: true }); return true;
  } catch (e) { return false; }
}
function activate(id, rec) {
  let v = manifestLib.validate(findFolder(id) || '/nonexistent', { botVersion: botVersion(), taken: builtinNames() });
  if ((!v.ok || v.entrySha !== rec.sha) && healFromPrevious(id, rec)) v = manifestLib.validate(findFolder(id) || '/nonexistent', { botVersion: botVersion(), taken: builtinNames() });
  if (!v.ok || v.entrySha !== rec.sha) { rec.enabled = false; rec.reason = 'its files changed'; state.open().touch(); return false; }
  for (const c of v.manifest.commands) for (const n of [c.name, ...c.aliases]) { const o = commands.get(n); if (o && o.pluginId !== id) { rec.enabled = false; rec.reason = 'a command name is already used'; state.open().touch(); return false; } }
  const cmds = v.manifest.commands.map((c) => standIn(id, v.manifest, c));
  for (const cmd of cmds) { commandList.push(cmd); commands.set(cmd.name, cmd); cmd.aliases.forEach((a) => commands.set(a, cmd)); }
  commandList.sort((a, b) => a.name.localeCompare(b.name));
  loaded.set(id, { manifest: v.manifest, source: v.source, cmds });
  return true;
}
function deactivate(id) {
  const l = loaded.get(id); if (!l) return;
  for (const cmd of l.cmds) { const i = commandList.indexOf(cmd); if (i >= 0) commandList.splice(i, 1); for (const k of [cmd.name, ...cmd.aliases]) if (commands.get(k) === cmd) commands.delete(k); }
  loaded.delete(id);
  const h = hosts.get(id); if (h) { h.stop(); hosts.delete(id); }
  const t = timers.get(id); if (t) { for (const x of t) clearInterval(x); timers.delete(id); }
}
function standIn(id, manifest, c) {
  return {
    name: c.name, aliases: c.aliases, category: 'plugins', description: c.description, usage: c.usage || undefined, pluginId: id,
    ownerOnly: c.who === 'owner', adminOnly: c.who === 'admin', groupOnly: c.groupOnly, everyone: false, capacity: { needs: [], weight: 'light' },
    deniedIn: (jid) => denied(id, jid),
    run: (ctx) => invoke(id, 'command', c.name, ctx),
  };
}
function denied(id, jid) {
  const rec = state.open().data.installed[id];
  if (!rec || !rec.enabled || !String(jid).endsWith('@g.us')) return false;
  return (Array.isArray(rec.allowOnly) && !rec.allowOnly.includes(jid)) || (rec.blocked || []).includes(jid);
}

// ---------------------------------------------------------------- running a plugin
function getHost(id) {
  let h = hosts.get(id); const l = loaded.get(id);
  if (h && h.disabled) { hosts.delete(id); h = null; }
  if (!h) {
    const d = state.open().data; const max = d.max;
    if (max > 0 && hosts.size >= max) { // keep only the most recently used ones: the oldest idle one is put to sleep
      const idle = [...hosts.entries()].filter(([, x]) => !x.busy()).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (idle) { idle[1].stop(); hosts.delete(idle[0]); }
    }
    const { PluginHost } = require('./host');
    const store = stores.get(id) || state.dataStore(id); stores.set(id, store);
    const env = {
      storage: new Map(Object.entries(store.data.kv || {})),
      persist: (map) => { store.data.kv = Object.fromEntries(map); store.touch(); },
      log: (t) => log(id, t),
      isPublicHost: async (host) => { try { await require('../safefetch').assertPublicUrl('https://' + host); return true; } catch (e) { return false; } },
      fetch: async (url) => { const r = await require('../safefetch').get(url, { timeout: 5000, maxBytes: 256 * 1024 }); return { status: r.status, text: r.body.toString('utf8') }; },
      fetchBytes: async (url) => { const r = await require('../safefetch').get(url, { timeout: 5000, maxBytes: 1024 * 1024 + 1 }); return { status: r.status, bytes: r.body }; },
      notifyOwner: async (t) => { if (sock) await sock.sendMessage(require('../../whatsapp/owner').ownerChat(sock), { text: '🧩 *Message from ' + l.manifest.name + '*\n▸ ' + t }); },
    };
    const rec = state.open().data.installed[id];
    h = new PluginHost({ id, manifest: l.manifest, source: l.source, grants: rec.grants, limits: { memoryGuardMb: d.guardMb }, env, onDisabled: (why) => onDisabled(id, why) });
    hosts.set(id, h);
  }
  return h;
}
function onDisabled(id, why) {
  if (why !== 'withdrawn') { try { stats.bumpError(id); } catch (e) { /* statistics never stop the bot */ } }
  const rec = state.open().data.installed[id]; const l = loaded.get(id); const name = l ? l.manifest.name : id;
  // a new version that keeps failing within a day of its update: return to the version before (the same rule as three faults in ten minutes)
  if (why !== 'withdrawn' && rec && rec.previous && Date.now() - (rec.installedAt || 0) < 86400000) {
    const bad = rec.version; const r = rollback(id);
    if (r.ok) { tellOwner(`⚠️ *${name} ${bad} kept failing, so I went back to ${r.to}.*\n▸ *Reason:* it ${plainWhy(why)}.\n▸ _That version will not be installed automatically again._`); return; }
  }
  if (rec) { rec.enabled = false; rec.reason = plainWhy(why); state.open().touch(); }
  deactivate(id);
  if (sock) {
    const p = prefixOf();
    Promise.resolve(sock.sendMessage(require('../../whatsapp/owner').ownerChat(sock), { text: `⚠️ *The plugin "${name}" was switched off.*\n▸ *Reason:* it ${plainWhy(why)}.\n▸ *See what happened:* \`${p}plugin log ${id}\`\n▸ *Turn it on again:* \`${p}plugin enable ${id}\`\n_It stays off until you turn it on._` })).catch(() => {});
  }
}
function plainCtx(id, c, extra) {
  const meta = c.groupMetadata; const o = (v) => state.opaque(id, v);
  const parts = meta && meta.participants ? meta.participants : [];
  const people = new Map(); const senderJid = c.msg && c.msg.key && (c.msg.key.participant || c.msg.key.remoteJid) || c.jid;
  const seen = (jid) => { const k = o(jid); people.set(k, jid); return k; };
  let mentions = [];
  if (c.isGroup) { try { mentions = require('../../whatsapp/utils').getTargets(c.msg || {}).slice(0, 10).map(seen); } catch (e) { mentions = []; } }
  const senderId = seen(senderJid);
  return {
    ctx: { args: (c.args || []).slice(0, 50).map((a) => String(a).slice(0, 500)), rest: String(c.rest || '').slice(0, 4000), prefix: c.prefix || prefixOf(),
      chat: { id: o(c.jid), isGroup: !!c.isGroup, name: String(meta && meta.subject || '').slice(0, 100) },
      settings: settingsFor(id, c.isGroup ? c.jid : null), mentions, sender: { id: senderId, name: String(c.msg && c.msg.pushName || '').slice(0, 40), isAdmin: !!c.isAdmin, isOwner: !!c.isOwner } },
    extra: { send: (t) => c.reply(t), react: c.msg && c.msg.key ? (e) => (c.sock || sock).sendMessage(c.jid, { react: { text: e, key: c.msg.key } }) : null, sendMedia: (m) => (c.sock || sock).sendMessage(c.jid, mediaMessage(m)), manage: c.isGroup ? makeManage(id, { s: c.sock || sock, jid: c.jid, people, actorOk: !!(c.isAdmin || c.isOwner), fromCommand: true }) : null, groupInfo: meta ? { name: meta.subject, size: parts.length, admins: parts.filter((p) => p.admin).length } : null, ...(extra || {}) },
  };
}
async function invoke(id, kind, name, c) {
  const p = c.prefix || prefixOf();
  if (!isRunning() || !loaded.has(id)) return c.reply('⚠️ *This command is not available right now.*\n▸ _Please try again in a little while._');
  try {
    const { ctx, extra } = plainCtx(id, c);
    await getHost(id).call(kind, name, ctx, extra);
  } catch (e) {
    log(id, 'call failed: ' + (e.code || e.message));
    if (e.code === 'disabled') return null; // the owner was already told
    const own = c.isOwner ? `\n▸ *See what happened:* \`${p}plugin log ${id}\`` : '';
    return c.reply(`⚠️ *This command did not work.*\n▸ _Please try again in a moment._${own}`);
  }
}
// Removing people and opening or closing a group. Every check is made here, in the bot, never by the plugin:
// the bot must be an admin, the person must be part of this very command or event, and never the owner, a sudo user, an admin or the bot.
function makeManage(id, { s, jid, people, actorOk, fromCommand }) {
  const { BrokerError } = require('./broker');
  const meta = require('../../whatsapp/metadata');
  const { num, participantIds } = require('../../whatsapp/utils');
  return async (action, opaque) => {
    if (!actorOk) throw new BrokerError('not_allowed', 'only admins can use this');
    const md = await meta.getMeta(s, jid); const idx = meta.indexOf(md);
    const botIds = [s.user && s.user.id, s.user && s.user.lid].filter(Boolean).map(num);
    if (!botIds.some((b) => idx.admins.has(b))) throw new BrokerError('not_allowed', 'the bot is not an admin here');
    if (action === 'promote' || action === 'demote' || action === 'rename') {
      // changing who the admins are, or the group name: only through a command used by an admin or the owner, never from a listener or a timer
      if (!fromCommand) throw new BrokerError('not_allowed', 'only inside a command used by an admin');
      if (action === 'rename') { await s.groupUpdateSubject(jid, opaque); log(id, 'renamed the group ' + jid); meta.invalidate(jid); return; }
      const target = people.get(opaque);
      if (!target) throw new BrokerError('not_allowed', 'that person is not part of this event');
      const p = idx.byId.get(num(target));
      if (!p) throw new BrokerError('not_allowed', 'that person is not in the group');
      const ids = [...participantIds(p), num(target)]; const config = require('../../config');
      const protectedIds = [config.ownerNumber, ...botIds, ...require('../../whatsapp/store').getSudo()].filter(Boolean);
      if (ids.some((x) => protectedIds.includes(x))) throw new BrokerError('not_allowed', 'that person is protected');
      if (action === 'promote') { if (p.admin === 'admin' || p.admin === 'superadmin') throw new BrokerError('not_allowed', 'that person is already an admin'); }
      else if (p.admin !== 'admin') throw new BrokerError('not_allowed', p.admin === 'superadmin' ? 'the group creator cannot be demoted' : 'that person is not an admin');
      await s.groupParticipantsUpdate(jid, [p.id || target], action); log(id, action + 'd ' + num(target) + ' in ' + jid);
    } else if (action === 'kick') {
      const target = people.get(opaque);
      if (!target) throw new BrokerError('not_allowed', 'that person is not part of this event');
      const p = idx.byId.get(num(target));
      if (!p) throw new BrokerError('not_allowed', 'that person is not in the group');
      const ids = [...participantIds(p), num(target)]; const config = require('../../config');
      const protectedIds = [config.ownerNumber, ...botIds, ...require('../../whatsapp/store').getSudo()].filter(Boolean);
      if (p.admin === 'admin' || p.admin === 'superadmin' || ids.some((x) => protectedIds.includes(x))) throw new BrokerError('not_allowed', 'that person is protected');
      await s.groupParticipantsUpdate(jid, [p.id || target], 'remove'); log(id, 'removed ' + num(target) + ' from ' + jid);
    } else {
      await s.groupSettingUpdate(jid, action === 'close' ? 'announcement' : 'not_announcement'); log(id, action + 'd the group ' + jid);
    }
    meta.invalidate(jid);
  };
}
const mediaMessage = (m) => (m.kind === 'sticker' ? { sticker: m.buffer } : m.kind === 'image' ? { image: m.buffer, caption: m.caption || undefined } : { document: m.buffer, mimetype: m.mimetype, fileName: m.fileName, caption: m.caption || undefined });

// Events (stage 1b): a plugin can listen to group messages that are not commands, and to members joining or leaving.
// It never slows the bot: nothing is waited for, a plugin gets at most 10 events per 10 seconds, and when it is busy extra events are dropped.
const evTimes = new Map();
const evPending = new Map();
function emit(event, info) {
  if (!isRunning() || !info || !info.jid || !String(info.jid).endsWith('@g.us')) return;
  for (const [id, l] of loaded) {
    if (!l.manifest.events.includes(event) || denied(id, info.jid)) continue;
    const t = Date.now(); const recent = (evTimes.get(id) || []).filter((x) => t - x < 10000);
    if (recent.length >= 10 || (evPending.get(id) || 0) >= 3) continue;
    recent.push(t); evTimes.set(id, recent); evPending.set(id, (evPending.get(id) || 0) + 1);
    const o = (v) => state.opaque(id, v); const s = info.sock || sock; const people = new Map();
    const seen = (jid) => { const k = o(jid); people.set(k, jid); return k; };
    const ctx = { args: [], rest: '', prefix: prefixOf(), event, text: String(info.text || '').slice(0, 4000),
      members: (info.members || []).slice(0, 50).map((m) => seen(typeof m === 'string' ? m : (m && m.id) || '')),
      chat: { id: o(info.jid), isGroup: true, name: '' }, settings: settingsFor(id, info.jid),
      sender: info.senderJid ? { id: seen(info.senderJid), name: String(info.pushName || '').slice(0, 40), isAdmin: false, isOwner: false } : null };
    const extra = { send: (x) => s.sendMessage(info.jid, { text: x }), react: info.key ? (e) => s.sendMessage(info.jid, { react: { text: e, key: info.key } }) : null, sendMedia: (m) => s.sendMessage(info.jid, mediaMessage(m)), manage: makeManage(id, { s, jid: info.jid, people, actorOk: true }), groupInfo: null };
    Promise.resolve().then(() => getHost(id).call('event', event, ctx, extra)).catch((e) => log(id, 'event ' + event + ' failed: ' + (e.code || e.message))).finally(() => evPending.set(id, Math.max(0, (evPending.get(id) || 1) - 1)));
  }
}
function startTimers() {
  for (const [id, l] of loaded) {
    if (timers.has(id)) continue;
    const arr = l.manifest.schedules.map((s) => setInterval(async () => {
      const h = hosts.get(id);
      if (!isRunning() || (h && h.busy())) return;
      try { await getHost(id).call('schedule', s.id, { args: [], rest: '', prefix: prefixOf(), chat: null, sender: null, settings: settingsFor(id, null) }, {}); } catch (e) { log(id, 'schedule ' + s.id + ' failed: ' + (e.code || e.message)); }
    }, s.everyMinutes * 60000));
    arr.forEach((x) => x.unref && x.unref()); timers.set(id, arr);
  }
}

// ---------------------------------------------------------------- finding, installing, removing
function findFolder(id) { for (const f of state.folders()) { try { const m = JSON.parse(fs.readFileSync(f + '/turbofex-plugin.json', 'utf8')); if (m && m.id === id) return f; } catch (e) { /* not a plugin */ } } return null; }
function available() { // plugin folders found in data/plugins
  const seen = new Set(); const out = [];
  for (const f of state.folders()) {
    const v = manifestLib.validate(f, { botVersion: botVersion(), taken: builtinNames() });
    if (v.ok) { if (seen.has(v.manifest.id)) continue; seen.add(v.manifest.id); }
    out.push({ folder: f, ...v });
  }
  return out;
}
const RISK = { 'chat.react': ['🟢', 'React to the message that used it with an emoji'], 'chat.send': ['🟢', 'Send messages in the chat where it is used'], storage: ['🟢', 'Keep its own small saved notes'], 'group.read': ['🟢', 'See the group name and how many members and admins it has'], schedule: ['🟡', 'Run by itself on a timer'], 'owner.notify': ['🟡', 'Send you a short message now and then'], network: ['🟡', 'Connect to the internet'],
  'events.message': ['🟡', 'Read the text of messages sent in the groups where it is allowed'], 'events.members': ['🟡', 'Know when members join or leave a group (no phone numbers)'], 'media.send': ['🟢', 'Send pictures, stickers and files in the chat where it is used'],
  'group.admins': ['🔴', 'Make a member an admin or take admin away (only through a command used by a group admin, where the bot is an admin; never the owner or the group creator)'],
  'group.manage': ['🔴', 'Remove members, open or close the group, and rename it (only where I am an admin; never the owner or an admin)'] };
function permissionLines(m) {
  const out = m.permissions.map((p) => `▸ ${RISK[p][0]} ${RISK[p][1]}` + (p === 'network' ? ': ' + m.network.domains.join(', ') : ''));
  return out.length ? out : ['▸ 🟢 Nothing special: it only answers its commands'];
}
function prepare(id) { // step 1 of installing: show what it asks for
  const f = findFolder(id); if (!f) return { ok: false, why: 'missing' };
  const v = manifestLib.validate(f, { botVersion: botVersion(), taken: builtinNames() });
  if (!v.ok) return { ok: false, why: 'invalid', errors: v.errors };
  for (const [oid, l] of loaded) if (oid !== id) for (const c of v.manifest.commands) for (const n of [c.name, ...c.aliases]) if (l.manifest.commands.some((x) => [x.name, ...x.aliases].includes(n))) return { ok: false, why: 'invalid', errors: ['the command "' + n + '" is used by the plugin "' + oid + '"'] };
  const rec = state.open().data.installed[id];
  if (rec && rec.sha === v.entrySha && rec.enabled) return { ok: false, why: 'same' };
  const code = Array.from(crypto.randomBytes(4), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
  for (const [k, p] of pending) if (p.expires < Date.now() || p.id === id) pending.delete(k);
  pending.set(code, { id, folder: f, sha: v.entrySha, expires: Date.now() + CONFIRM_MS });
  return { ok: true, code, manifest: v.manifest, update: !!rec, lines: permissionLines(v.manifest) };
}
function confirm(code) { // step 2: the owner confirmed
  const p = pending.get(String(code || '').toUpperCase());
  if (!p || p.expires < Date.now()) return { ok: false, why: 'expired' };
  pending.delete(String(code).toUpperCase());
  let v = manifestLib.validate(p.folder, { botVersion: botVersion(), taken: builtinNames() });
  if (!v.ok || v.entrySha !== p.sha) return { ok: false, why: 'changed' };
  if (p.folder.startsWith(state.examplesDir() + require('node:path').sep)) { // a sample that came with the bot is copied into the plugins folder first
    const to = require('node:path').join(state.dir(), p.id);
    try { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(p.folder, to, { recursive: true }); } catch (e) { return { ok: false, why: 'changed' }; }
    v = manifestLib.validate(to, { botVersion: botVersion(), taken: builtinNames() });
    if (!v.ok || v.entrySha !== p.sha) return { ok: false, why: 'changed' };
  }
  const d = state.open().data; const old = d.installed[p.id];
  deactivate(p.id);
  if (d.removed) delete d.removed[p.id];
  d.installed[p.id] = { version: v.manifest.version, sha: v.entrySha, enabled: true, grants: v.manifest.permissions.slice(), allowOnly: old ? old.allowOnly : null, blocked: old ? old.blocked : [], installedAt: Date.now(), ...(registry.storeVersionOf(p.folder) ? { store: { version: registry.storeVersionOf(p.folder) } } : {}) };
  const cur = d.installed[p.id];
  if (old && old.updateMode) cur.updateMode = old.updateMode;
  if (old && old.settings) cur.settings = old.settings;   // the owner's settings survive an update (a value that no longer fits is ignored when read)   // the owner's update choice survives an update
  if (old && old.store && cur.store && cur.store.version !== old.store.version && fs.existsSync(path.join(state.previousDir(p.id), old.store.version))) {
    cur.previous = { version: old.version, sha: old.sha, grants: (old.grants || []).slice(), store: { version: old.store.version } };   // the version the owner had approved before: one command back
  }
  try { // only the running version and the one before it are kept
    const keepV = new Set([cur.store && cur.store.version, cur.previous && cur.previous.store.version]);
    for (const n of fs.readdirSync(state.previousDir(p.id))) if (!keepV.has(n)) fs.rmSync(path.join(state.previousDir(p.id), n), { recursive: true, force: true });
  } catch (e) { /* nothing saved yet */ }
  state.open().touch();
  if (isRunning()) { if (!activate(p.id, d.installed[p.id])) return { ok: false, why: 'changed' }; startTimers(); }
  return { ok: true, manifest: v.manifest, update: !!old };
}
// the store (see registry.js)
async function prepareStore(id) {
  const f = await registry.fetchPlugin(id);
  if (!f.ok) return f;
  return prepare(id);
}
async function prepareTest(code, fetchImpl) {
  const f = await require('./testcode').fetchTest(code, builtinNames(), fetchImpl);
  if (!f.ok) return f;
  const r = prepare(f.id); if (!r.ok) return r;
  return { ...r, test: true, developer: f.developer };
}
async function storeList(text) { return registry.list(await registry.getIndex(), text); }
async function storeInfo(id) {
  const index = await registry.getIndex(); const p = index.plugins[id]; const v = registry.latestOf(index, id);
  if (!p || !v) return null;
  const e = p.versions[v];
  return { id, name: p.name, description: p.description, author: p.author, version: v, permissions: e.permissions || [], domains: e.domains || [] };
}
async function updatesAvailable() {
  const index = await registry.getIndex(true); const out = [];
  for (const [id, rec] of Object.entries(state.open().data.installed)) {
    if (!rec.store) continue; const v = registry.latestOf(index, id);
    if (v && registry.semverCmp(v, rec.store.version) > 0) out.push({ id, from: rec.store.version, to: v });
  }
  return out;
}
// A plugin the store withdrew (for safety) is switched off on this bot and the owner is told. If the store cannot be reached, nothing changes.
async function checkWithdrawn() {
  try {
    if (!isRunning() || !registry.configured()) return;
    const mine = Object.entries(state.open().data.installed).filter(([, r]) => r.store && r.enabled); if (!mine.length) return;
    const index = await registry.getIndex(true);
    for (const [id, rec] of mine) if (registry.isRevoked(index, id, rec.store.version)) onDisabled(id, 'withdrawn');
  } catch (e) { /* offline or no store: keep running */ }
}


// ---------------------------------------------------------------- settings (typed options the owner changes with `.plugin set`)
function defsOf(id) {
  const l = loaded.get(id); if (l) return l.manifest.settings || [];
  try { const v = manifestLib.validate(findFolder(id) || '/nonexistent', { botVersion: botVersion(), taken: builtinNames() }); return v.ok ? v.manifest.settings || [] : []; } catch (e) { return []; }
}
function fitSetting(t, v) { // a stored value is used only if it still fits the plugin's definition, else the default
  if (t.type === 'toggle') return typeof v === 'boolean' ? v : t.default;
  if (t.type === 'number') return typeof v === 'number' && Number.isFinite(v) && v >= t.min && v <= t.max ? v : t.default;
  if (t.type === 'choice') return t.options.includes(v) ? v : t.default;
  return typeof v === 'string' && v.length <= t.maxLength && !/[\u0000-\u001f\u007f]/.test(v) ? v : t.default;
}
// what the plugin sees: the group's own value (if the setting is per group and one was set), else the owner's value, else the default
function settingsFor(id, jid) {
  const rec = state.open().data.installed[id]; const st = (rec && rec.settings) || {}; const out = {};
  for (const t of defsOf(id)) {
    const g = t.perGroup && jid && st.groups && st.groups[jid] && Object.prototype.hasOwnProperty.call(st.groups[jid], t.key) ? st.groups[jid][t.key] : undefined;
    const b = st.values && Object.prototype.hasOwnProperty.call(st.values, t.key) ? st.values[t.key] : undefined;
    out[t.key] = fitSetting(t, g !== undefined ? g : b);
  }
  return out;
}
function settingsList(id, jid) {
  if (!state.open().data.installed[id]) return null;
  const now = settingsFor(id, jid); return defsOf(id).map((t) => ({ ...t, value: now[t.key] }));
}
function setSetting(id, key, raw, jid, isGroup) {
  const d = state.open().data; const rec = d.installed[id]; if (!rec) return { ok: false, why: 'missing' };
  const t = defsOf(id).find((x) => x.key === String(key || '').toLowerCase()); if (!t) return { ok: false, why: 'nokey' };
  const text = String(raw === undefined ? '' : raw).trim(); let v; let reset = false;
  if (text.toLowerCase() === 'reset') reset = true;
  else if (t.type === 'toggle') { const x = text.toLowerCase(); if (['on', 'yes', 'true', 'enable'].includes(x)) v = true; else if (['off', 'no', 'false', 'disable'].includes(x)) v = false; else return { ok: false, why: 'value', t }; }
  else if (t.type === 'number') { if (!/^-?\d{1,10}(\.\d{1,6})?$/.test(text)) return { ok: false, why: 'value', t }; v = Number(text); if (v < t.min || v > t.max) return { ok: false, why: 'value', t }; }
  else if (t.type === 'choice') { v = t.options.find((o) => o.toLowerCase() === text.toLowerCase()); if (v === undefined) return { ok: false, why: 'value', t }; }
  else { if (!text.length || text.length > t.maxLength || /[\u0000-\u001f\u007f]/.test(text)) return { ok: false, why: 'value', t }; v = text; }
  rec.settings = rec.settings || {}; const group = t.perGroup && isGroup && jid;
  const bag = group ? ((rec.settings.groups = rec.settings.groups || {})[jid] = rec.settings.groups[jid] || {}) : (rec.settings.values = rec.settings.values || {});
  if (reset) delete bag[t.key]; else bag[t.key] = v;
  state.open().touch();
  return { ok: true, t, reset, group: !!group, value: settingsFor(id, jid)[t.key] };
}


// ---------------------------------------------------------------- anonymous statistics (opt-in)
const statsStatus = () => stats.status();
async function setStats(on, fetchImpl) {
  if (on) { stats.setOn(true); const t = setTimeout(() => reportStats(), 60000 + Math.floor(Math.random() * 540000)); if (t.unref) t.unref(); return stats.status(); }
  stats.setOn(false); await stats.forget(fetchImpl); return stats.status();
}
async function ratePlugin(id, stars, fetchImpl) {
  try {
    const rec = state.open().data.installed[id];
    if (!rec || !rec.store) return { ok: false, why: 'unknown' };
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, why: 'stars' };
    return await stats.rate(id, stars, fetchImpl);
  } catch (e) { return { ok: false, why: 'site' }; }
}
async function reportStats(fetchImpl) {
  try {
    if (!stats.status().on) return { ok: false, why: 'off' };
    const list = Object.entries(state.open().data.installed).filter(([, r]) => r.store).map(([id, r]) => ({ id, version: r.store.version, enabled: !!r.enabled }));
    return await stats.report(list, botVersion(), fetchImpl);
  } catch (e) { return { ok: false, why: 'site' }; }
}
let statsTimer = null;
function scheduleStats() {   // about once a day, never at the same minute for every bot
  if (statsTimer) return;
  const next = () => { statsTimer = setTimeout(async () => { statsTimer = null; try { const s = stats.status(); if (s.on && Date.now() - s.last > 20 * 3600 * 1000) await reportStats(); } catch (e) { /* ignore */ } next(); }, (6 + Math.random() * 6) * 3600 * 1000); if (statsTimer.unref) statsTimer.unref(); };
  const first = setTimeout(async () => { try { const s = stats.status(); if (s.on && Date.now() - s.last > 20 * 3600 * 1000) await reportStats(); } catch (e) { /* ignore */ } }, 120000 + Math.floor(Math.random() * 600000)); if (first.unref) first.unref();
  next();
}

// ---------------------------------------------------------------- update modes and rollback
const MODES = ['notify', 'automatic', 'manual'];
function tellOwner(text) { try { if (sock) Promise.resolve(sock.sendMessage(require('../../whatsapp/owner').ownerChat(sock), { text })).catch(() => {}); } catch (e) { /* never stops the bot */ } }
function setUpdateMode(id, mode) {
  const rec = state.open().data.installed[id]; mode = String(mode || '').toLowerCase();
  if (!rec || !rec.store) return { ok: false, why: 'nostore' };
  if (!MODES.includes(mode)) return { ok: false, why: 'mode' };
  rec.updateMode = mode; state.open().touch(); return { ok: true, mode };
}
// go back to the version the owner had before the last update. The old version was approved by the owner already, so nothing new is asked.
function rollback(id) {
  const d = state.open().data; const rec = d.installed[id];
  if (!rec || !rec.previous) return { ok: false, why: 'none' };
  const pv = rec.previous; const src = path.join(state.previousDir(id), pv.store.version);
  const v = manifestLib.validate(src, { botVersion: botVersion(), taken: builtinNames() });
  if (!v.ok || v.entrySha !== pv.sha) return { ok: false, why: 'changed' };
  const to = path.join(state.dir(), id); const from = rec.version; const failed = rec.store && rec.store.version;
  deactivate(id);
  try { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(src, to, { recursive: true }); } catch (e) { return { ok: false, why: 'changed' }; }
  d.installed[id] = { ...rec, version: pv.version, sha: pv.sha, grants: pv.grants.slice(), store: { version: pv.store.version }, enabled: true, reason: '', previous: null, skip: failed, installedAt: Date.now() };
  state.open().touch();
  if (isRunning()) { if (!activate(id, d.installed[id])) { d.installed[id].enabled = false; d.installed[id].reason = 'a command name is already used'; state.open().touch(); return { ok: false, why: 'changed' }; } startTimers(); }
  return { ok: true, from, to: pv.version, name: v.manifest.name };
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
// Notify (default): tell the owner once about each new version. Automatic: install it by itself, but only when it asks for the very same permissions and websites. Manual: say nothing.
async function checkUpdates() {
  try {
    if (!isRunning() || !registry.configured()) return;
    const mine = Object.entries(state.open().data.installed).filter(([, r]) => r.store && r.enabled && (r.updateMode || 'notify') !== 'manual'); if (!mine.length) return;
    const index = await registry.getIndex(true);
    for (const [id, rec] of mine) {
      const v = registry.latestOf(index, id);
      if (!v || registry.isRevoked(index, id, v) || registry.semverCmp(v, rec.store.version) <= 0) continue;
      const e = index.plugins[id].versions[v] || {}; const l = loaded.get(id); const name = l ? l.manifest.name : id;
      const same = sameSet(e.permissions || [], rec.grants || []) && sameSet(e.domains || [], (l && l.manifest.network && l.manifest.network.domains) || []);
      if ((rec.updateMode || 'notify') === 'automatic' && same && rec.skip !== v) {
        const from = rec.version; const f = await registry.fetchPlugin(id, v);
        if (f.ok) { const pr = prepare(id); if (pr.ok) { const c = confirm(pr.code); if (c.ok) { tellOwner(`🧩 *${name} was updated automatically.*\n▸ *Version:* ${from} → ${c.manifest.version}\n▸ *Go back with:* \`${prefixOf()}plugin rollback ${id}\``); continue; } } }
      }
      if (rec.notified === v) continue; rec.notified = v; state.open().touch();
      tellOwner(`🧩 *Update available for ${name}*\n▸ *Version:* ${rec.version} → ${v}\n${same ? '' : '▸ It asks for different permissions or websites, so only you can approve it.\n'}▸ *Update:* \`${prefixOf()}plugin update ${id}\``);
    }
  } catch (e) { /* offline or no store: nothing changes */ }
}
function setEnabled(id, on) {
  const d = state.open().data; const rec = d.installed[id]; if (!rec) return { ok: false, why: 'missing' };
  if (!on) { rec.enabled = false; rec.reason = ''; deactivate(id); state.open().touch(); return { ok: true }; }
  if (!isRunning()) return { ok: false, why: 'off' };
  if (rec.store && /withdrawn/.test(rec.reason || '')) return { ok: false, why: 'changed', reason: rec.reason };
  rec.enabled = true; delete rec.reason;
  if (!activate(id, rec)) return { ok: false, why: 'changed', reason: rec.reason };
  state.open().touch(); startTimers(); return { ok: true };
}
function remove(id) {
  const d = state.open().data; if (!d.installed[id]) return false;
  deactivate(id); delete d.installed[id];
  d.removed = d.removed || {}; d.removed[id] = Date.now();   // its saved notes are kept for 30 days in case the owner installs it again
  state.open().touch(); stores.delete(id); logs.delete(id); return true;
}
const KEEP_DAYS = 30;
// after 30 days the saved notes of a removed plugin are erased (a plugin that was installed again keeps them)
function purgeOldNotes(now = Date.now()) {
  if (!state.used()) return 0;
  const d = state.open().data; let n = 0;
  for (const [id, at] of Object.entries(d.removed || {})) {
    if (d.installed[id]) { delete d.removed[id]; continue; }
    if (now - at < KEEP_DAYS * 86400000) continue;
    try { const st = stores.get(id) || state.dataStore(id); st.data.kv = {}; st.touch(); stores.delete(id); } catch (e) { continue; }
    delete d.removed[id]; n++;
  }
  if (n) state.open().touch();
  return n;
}
function groupRule(id, jid, mode) { // inside one group: allow, deny, only, all
  const rec = state.open().data.installed[id]; if (!rec) return false;
  rec.blocked = rec.blocked || [];
  if (mode === 'deny') { if (!rec.blocked.includes(jid)) rec.blocked.push(jid); if (Array.isArray(rec.allowOnly)) rec.allowOnly = rec.allowOnly.filter((x) => x !== jid); }
  else if (mode === 'allow') { rec.blocked = rec.blocked.filter((x) => x !== jid); if (Array.isArray(rec.allowOnly) && !rec.allowOnly.includes(jid)) rec.allowOnly.push(jid); }
  else if (mode === 'only') { rec.blocked = rec.blocked.filter((x) => x !== jid); rec.allowOnly = Array.isArray(rec.allowOnly) ? [...new Set([...rec.allowOnly, jid])] : [jid]; }
  else if (mode === 'all') { rec.allowOnly = null; rec.blocked = []; }
  else return false;
  state.open().touch(); return true;
}
function setOption(key, n) {
  const d = state.open().data;
  if (key === 'max') { if (!Number.isInteger(n) || n < 0 || n > 100) return false; d.max = n; } else if (key === 'guard') { if (!Number.isInteger(n) || n < 16 || n > 1024) return false; d.guardMb = n; } else return false;
  state.open().touch(); for (const h of hosts.values()) h.limits.memoryGuardMb = d.guardMb; return true;
}
function overview() {
  const d = state.used() ? state.open().data : { enabled: false, max: 8, guardMb: 96, installed: {} };
  return { status, enabled: d.enabled, max: d.max, guardMb: d.guardMb, installed: d.installed, loaded, running: hosts.size, logs, folders: available() };
}
const logOf = (id) => logs.get(id) || [];
module.exports = { prepareTest, ratePlugin, attach, start, stop, emit, prepareStore, storeList, storeInfo, updatesAvailable, checkWithdrawn, storeOpen: () => registry.configured(), turnOn, turnOff, isRunning, prepare, confirm, setEnabled, remove, purgeOldNotes, rollback, statsStatus, setStats, reportStats, setUpdateMode, settingsList, setSetting, settingsFor, checkUpdates, MODES, _onDisabled: (id, why) => onDisabled(id, why), groupRule, setOption, overview, logOf, MIN_NODE, _internals: { loaded, hosts, pending, plainCtx } };

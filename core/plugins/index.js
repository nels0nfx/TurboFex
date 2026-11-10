'use strict';
// Plugin manager: turns plugins on and off, installs the ones the owner approves, adds their commands to the bot and runs
// every call in a sealed sandbox (see host.js). Light on purpose: nothing heavy is loaded while plugins are off.
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifestLib = require('./manifest');
const state = require('./state');

const MIN_NODE = 22;
const CONFIRM_MS = 5 * 60 * 1000;
const botVersion = () => { try { return require('../../package.json').version; } catch (e) { return '0.0.0'; } };

let commands = null; let commandList = null; let sock = null;
let status = { state: 'off', reason: '' }; // off | unsupported | failed | ready
let selftested = false;
const loaded = new Map(); // plugin id -> { manifest, source, cmds: [command objects] }
const hosts = new Map();
const timers = new Map();
const logs = new Map();
const pending = new Map(); // confirm code -> { id, folder, sha, expires }
const stores = new Map();

function attach(cmds, list) { commands = cmds; commandList = list; }

const WHY = {
  timeout: 'took too long to answer', memory_guard: 'used too much memory', memory_limit: 'used too much memory', cpu_limit: 'used too much processing time',
  stack_limit: 'got stuck in itself', faults: 'kept failing', rules: 'tried things it was not allowed to do', worker_memory: 'used too much memory',
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
  startTimers();
  return status;
}
function stop() { for (const t of timers.values()) clearInterval(t); timers.clear(); for (const h of hosts.values()) h.stop(); hosts.clear(); }
async function turnOn() { state.open().data.enabled = true; state.open().touch(); return start(sock); }
function turnOff() {
  state.open().data.enabled = false; state.open().touch();
  stop(); for (const id of [...loaded.keys()]) deactivate(id);
  status = { state: 'off', reason: '' };
}
const isRunning = () => status.state === 'ready';

// ---------------------------------------------------------------- commands
function activate(id, rec) {
  const v = manifestLib.validate(findFolder(id) || '/nonexistent', { botVersion: botVersion(), taken: builtinNames() });
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
  const rec = state.open().data.installed[id]; const l = loaded.get(id); const name = l ? l.manifest.name : id;
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
      mentions, sender: { id: senderId, name: String(c.msg && c.msg.pushName || '').slice(0, 40), isAdmin: !!c.isAdmin, isOwner: !!c.isOwner } },
    extra: { send: (t) => c.reply(t), sendMedia: (m) => (c.sock || sock).sendMessage(c.jid, mediaMessage(m)), manage: c.isGroup ? makeManage(id, { s: c.sock || sock, jid: c.jid, people, actorOk: !!(c.isAdmin || c.isOwner) }) : null, groupInfo: meta ? { name: meta.subject, size: parts.length, admins: parts.filter((p) => p.admin).length } : null, ...(extra || {}) },
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
function makeManage(id, { s, jid, people, actorOk }) {
  const { BrokerError } = require('./broker');
  const meta = require('../../whatsapp/metadata');
  const { num, participantIds } = require('../../whatsapp/utils');
  return async (action, opaque) => {
    if (!actorOk) throw new BrokerError('not_allowed', 'only admins can use this');
    const md = await meta.getMeta(s, jid); const idx = meta.indexOf(md);
    const botIds = [s.user && s.user.id, s.user && s.user.lid].filter(Boolean).map(num);
    if (!botIds.some((b) => idx.admins.has(b))) throw new BrokerError('not_allowed', 'the bot is not an admin here');
    if (action === 'kick') {
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
      chat: { id: o(info.jid), isGroup: true, name: '' },
      sender: info.senderJid ? { id: seen(info.senderJid), name: String(info.pushName || '').slice(0, 40), isAdmin: false, isOwner: false } : null };
    const extra = { send: (x) => s.sendMessage(info.jid, { text: x }), sendMedia: (m) => s.sendMessage(info.jid, mediaMessage(m)), manage: makeManage(id, { s, jid: info.jid, people, actorOk: true }), groupInfo: null };
    Promise.resolve().then(() => getHost(id).call('event', event, ctx, extra)).catch((e) => log(id, 'event ' + event + ' failed: ' + (e.code || e.message))).finally(() => evPending.set(id, Math.max(0, (evPending.get(id) || 1) - 1)));
  }
}
function startTimers() {
  for (const [id, l] of loaded) {
    if (timers.has(id)) continue;
    const arr = l.manifest.schedules.map((s) => setInterval(async () => {
      const h = hosts.get(id);
      if (!isRunning() || (h && h.busy())) return;
      try { await getHost(id).call('schedule', s.id, { args: [], rest: '', prefix: prefixOf(), chat: null, sender: null }, {}); } catch (e) { log(id, 'schedule ' + s.id + ' failed: ' + (e.code || e.message)); }
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
const RISK = { 'chat.send': ['🟢', 'Send messages in the chat where it is used'], storage: ['🟢', 'Keep its own small saved notes'], 'group.read': ['🟢', 'See the group name and how many members and admins it has'], schedule: ['🟡', 'Run by itself on a timer'], 'owner.notify': ['🟡', 'Send you a short message now and then'], network: ['🟡', 'Connect to the internet'],
  'events.message': ['🟡', 'Read the text of messages sent in the groups where it is allowed'], 'events.members': ['🟡', 'Know when members join or leave a group (no phone numbers)'], 'media.send': ['🟢', 'Send pictures, stickers and files in the chat where it is used'],
  'group.manage': ['🔴', 'Remove members, and open or close the group (only where I am an admin; never the owner or an admin)'] };
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
  d.installed[p.id] = { version: v.manifest.version, sha: v.entrySha, enabled: true, grants: v.manifest.permissions.slice(), allowOnly: old ? old.allowOnly : null, blocked: old ? old.blocked : [], installedAt: Date.now() };
  state.open().touch();
  if (isRunning()) { if (!activate(p.id, d.installed[p.id])) return { ok: false, why: 'changed' }; startTimers(); }
  return { ok: true, manifest: v.manifest, update: !!old };
}
function setEnabled(id, on) {
  const d = state.open().data; const rec = d.installed[id]; if (!rec) return { ok: false, why: 'missing' };
  if (!on) { rec.enabled = false; rec.reason = ''; deactivate(id); state.open().touch(); return { ok: true }; }
  if (!isRunning()) return { ok: false, why: 'off' };
  rec.enabled = true; delete rec.reason;
  if (!activate(id, rec)) return { ok: false, why: 'changed', reason: rec.reason };
  state.open().touch(); startTimers(); return { ok: true };
}
function remove(id) {
  const d = state.open().data; if (!d.installed[id]) return false;
  deactivate(id); delete d.installed[id]; state.open().touch(); stores.delete(id); logs.delete(id); return true;
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
module.exports = { attach, start, stop, emit, turnOn, turnOff, isRunning, prepare, confirm, setEnabled, remove, groupRule, setOption, overview, logOf, MIN_NODE, _internals: { loaded, hosts, pending, plainCtx } };

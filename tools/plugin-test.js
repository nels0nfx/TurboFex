'use strict';
// Test a plugin on your own computer, in the SAME sandbox the bot uses, with a pretend chat. Nothing is sent anywhere.
//   node tools/plugin-test.js <plugin-folder>                      check the plugin files, then run every command, event and schedule once
//   node tools/plugin-test.js <plugin-folder> --command "hello Sam" run one command with these words after it
//   node tools/plugin-test.js <plugin-folder> --event message --text "hi there"
//   node tools/plugin-test.js <plugin-folder> --schedule <id>
//   options: --as owner|admin|member   who is using the command (default: the least needed)
//            --live-network            really download from the websites in the manifest (default: a pretend answer)
const fs = require('node:fs');
const path = require('node:path');
const manifestLib = require('../core/plugins/manifest');
const { PluginHost } = require('../core/plugins/host');

const botVersion = () => { try { return require('../package.json').version; } catch (e) { return '1.0.0'; } };
const defaults = (m) => Object.fromEntries((m.settings || []).map((s) => [s.key, s.default]));

async function runOne(m, source, what, opts) {
  const run = { what, sends: [], reactions: [], media: [], group: [], notices: [], logs: [], error: null };
  const live = opts.liveNetwork === true;
  const env = {
    storage: new Map(), persist: () => {}, log: (t) => run.logs.push(String(t)),
    isPublicHost: async (h) => (m.network && m.network.domains || []).includes(h) || live,
    fetch: async (url) => {
      if (!live) { run.notices.push('network (pretend): ' + url); return { status: 200, text: '{"pretend":"answer from ' + String(url).slice(0, 60) + '"}' }; }
      const r = await require('../core/safefetch').get(url, { timeout: 5000, maxBytes: 256 * 1024 }); return { status: r.status, text: r.body.toString('utf8') };
    },
    fetchBytes: async (url) => { if (!live) { run.notices.push('network (pretend, 4 bytes): ' + url); return { status: 200, bytes: Buffer.from('test') }; } const r = await require('../core/safefetch').get(url, { timeout: 5000, maxBytes: 1024 * 1024 + 1 }); return { status: r.status, bytes: r.body }; },
    notifyOwner: async (t) => { run.notices.push('message to the owner: ' + t); },
  };
  const host = new PluginHost({ id: m.id, manifest: m, source, grants: m.permissions.slice(), limits: {}, env, onDisabled: (why) => { run.error = 'the bot would switch this plugin off: ' + why; } });
  const who = opts.as || (what.who === 'owner' ? 'owner' : what.who === 'admin' ? 'admin' : 'member');
  const sender = what.kind === 'schedule' ? null : { id: 'person-1', name: 'Sam', isAdmin: who !== 'member', isOwner: who === 'owner' };
  const ctx = { args: what.args || [], rest: (what.args || []).join(' '), prefix: '.', chat: what.kind === 'schedule' ? null : { id: 'chat-1', isGroup: true, name: 'Test group' }, settings: defaults(m), mentions: [], sender };
  if (what.kind === 'event') { ctx.event = what.name; ctx.text = what.text || 'hello'; ctx.members = what.name === 'message' ? [] : ['person-2']; }
  const extra = what.kind === 'schedule' ? {} : {
    send: async (t) => { run.sends.push(String(t)); },
    react: async (e) => { run.reactions.push(String(e)); },
    sendMedia: async (x) => { run.media.push(x.kind + (x.fileName ? ' ' + x.fileName : '') + ' (' + (x.buffer ? x.buffer.length : 0) + ' bytes)'); },
    manage: async (action, who2) => { run.group.push('would ' + action + (who2 ? ' ' + who2 : '')); },
  };
  try { await host.call(what.kind, what.name, ctx, extra); } catch (e) { run.error = run.error || (e.code || 'error') + (e.message && e.message !== e.code ? ': ' + e.message : ''); }
  if (host.broker.violations.length && !run.error) run.error = 'the bot refused something the plugin tried (' + [...new Set(host.broker.violations)].join(', ') + '). Is every permission it uses in the manifest?';
  host.stop();
  return run;
}

async function test(folder, opts = {}) {
  const v = manifestLib.validate(folder, { botVersion: botVersion(), taken: new Set() });
  if (!v.ok) return { ok: false, errors: v.errors, runs: [] };
  const m = v.manifest, source = v.source, jobs = [];
  if (opts.command) { const parts = String(opts.command).trim().split(/\s+/); const c = m.commands.find((x) => x.name === parts[0] || (x.aliases || []).includes(parts[0])); if (!c) return { ok: false, errors: ['The plugin has no command called "' + parts[0] + '". Its commands: ' + (m.commands.map((x) => x.name).join(', ') || 'none')], runs: [] }; jobs.push({ kind: 'command', name: c.name, args: parts.slice(1), who: c.who, label: 'command ' + parts.join(' ') }); }
  else if (opts.event) { if (!m.events.includes(opts.event)) return { ok: false, errors: ['The plugin does not listen to "' + opts.event + '". It listens to: ' + (m.events.join(', ') || 'nothing')], runs: [] }; jobs.push({ kind: 'event', name: opts.event, text: opts.text, label: 'event ' + opts.event }); }
  else if (opts.schedule) { if (!m.schedules.some((s) => s.id === opts.schedule)) return { ok: false, errors: ['The plugin has no schedule "' + opts.schedule + '".'], runs: [] }; jobs.push({ kind: 'schedule', name: opts.schedule, label: 'schedule ' + opts.schedule }); }
  else {
    for (const c of m.commands) jobs.push({ kind: 'command', name: c.name, args: [], who: c.who, label: 'command ' + c.name });
    for (const e of m.events) jobs.push({ kind: 'event', name: e, text: 'hello', label: 'event ' + e });
    for (const s of m.schedules) jobs.push({ kind: 'schedule', name: s.id, label: 'schedule ' + s.id });
  }
  const runs = []; for (const j of jobs) { const r = await runOne(m, source, j, opts); r.label = j.label; runs.push(r); }
  return { ok: runs.every((r) => !r.error), errors: [], manifest: m, runs };
}

function show(rep) {
  const out = [];
  if (rep.errors.length) { out.push('⚠️ The plugin files have problems:'); for (const e of rep.errors) out.push('  - ' + e); return out.join('\n'); }
  const m = rep.manifest; out.push('✅ Files are fine: ' + m.name + ' ' + m.version + ' (asks for: ' + (m.permissions.join(', ') || 'nothing special') + ')');
  if (!rep.runs.length) out.push('Nothing to run: the plugin has no commands, events or schedules.');
  for (const r of rep.runs) {
    out.push('', (r.error ? '❌ ' : '▶ ') + r.label);
    for (const s of r.sends) out.push('  bot says: ' + s.replace(/\n/g, '\n            '));
    for (const s of r.reactions) out.push('  bot reacts: ' + s);
    for (const s of r.media) out.push('  bot sends: ' + s);
    for (const s of r.group) out.push('  group: ' + s);
    for (const s of r.notices) out.push('  ' + s);
    for (const s of r.logs) out.push('  log: ' + s);
    if (!r.sends.length && !r.reactions.length && !r.media.length && !r.group.length && !r.error) out.push('  (it ran and sent nothing)');
    if (r.error) out.push('  problem: ' + r.error);
  }
  out.push('', rep.ok ? '✅ Everything ran without a problem. This does not replace the owner review.' : '❌ Something went wrong, see above.');
  return out.join('\n');
}
module.exports = { test, show };

if (require.main === module) {
  const argv = process.argv.slice(2); const folder = argv[0];
  if (!folder || folder.startsWith('--')) { console.log('Usage: node tools/plugin-test.js <plugin-folder> [--command "name words"] [--event message --text "hi"] [--schedule id] [--as owner|admin|member] [--live-network]'); process.exit(1); }
  const opts = {}; for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a === '--command') opts.command = argv[++i]; else if (a === '--event') opts.event = argv[++i]; else if (a === '--text') opts.text = argv[++i]; else if (a === '--schedule') opts.schedule = argv[++i]; else if (a === '--as') opts.as = argv[++i]; else if (a === '--live-network') opts.liveNetwork = true; }
  if (!fs.existsSync(folder)) { console.error('⚠️ Folder not found: ' + folder); process.exit(1); }
  test(path.resolve(folder), opts).then((rep) => { console.log(show(rep)); process.exitCode = rep.ok ? 0 : 1; }).catch((e) => { console.error('⚠️ ' + e.message); process.exitCode = 1; });
}

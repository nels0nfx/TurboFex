'use strict';
// Before plugins are allowed to run, the bot checks that the sealed engine really works on THIS computer: a normal command
// runs, the plugin cannot see Node, an endless loop is stopped and a memory bomb is stopped. If any check fails, plugins stay off.
const { PluginHost } = require('./host');

const SOURCE = `
tfx.command('hello', async function (c) { await c.reply('hi ' + typeof process + typeof require + typeof globalThis.__hostSync); });
tfx.command('spin', function () { while (true) {} });
tfx.command('bomb', function () { var a = []; while (true) { a.push(new Array(100000).fill(1)); } });
`;
async function run() {
  const sent = [];
  const env = { send: async () => {}, log: () => {}, isPublicHost: async () => false, fetch: async () => ({ status: 0, text: '' }), notifyOwner: async () => {}, persist: () => {} };
  const mk = (extra) => new PluginHost({ id: 'selftest', manifest: { permissions: ['chat.send'] }, source: SOURCE, grants: ['chat.send'], env, limits: { cpuMs: 300, wallMs: 3000, memoryGuardMb: 48, crashLimit: 99, ...extra } });
  const ctx = { args: [], rest: '', prefix: '.', chat: { id: 'x', isGroup: false, name: '' }, sender: { id: 'y', name: '', isAdmin: false, isOwner: true } };
  let h = mk();
  try {
    await h.call('command', 'hello', ctx, { send: async (t) => { sent.push(t); } });
    if (sent[0] !== 'hi undefinedundefinedundefined') return { ok: false, reason: 'the sealed engine can see things it should not' };
    const stop = async (name) => { try { await h.call('command', name, ctx, { send: async () => {} }); return 'none'; } catch (e) { return e.code; } };
    if ((await stop('spin')) !== 'cpu_limit') return { ok: false, reason: 'an endless loop was not stopped' };
    const rss0 = process.memoryUsage.rss();
    const r = await stop('bomb');
    if (!['memory_limit', 'memory_guard', 'timeout', 'stack_limit'].includes(r)) return { ok: false, reason: 'a memory bomb was not stopped' };
    if (process.memoryUsage.rss() - rss0 > 220 * 1048576) return { ok: false, reason: 'memory use was not kept small enough' };
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: 'the sealed engine could not start (' + String(e && e.message || e).slice(0, 80) + ')' };
  } finally { h.stop(); }
}
module.exports = { run };

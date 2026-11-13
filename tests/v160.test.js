// v1.5.3: anonymous statistics (off by default, owner switch, only store plugins, only counts)
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const plugins = require('../core/plugins');
const state = require('../core/plugins/state');
const stats = require('../core/plugins/stats');

const calls = [];
const site = (over = {}) => async (url, o) => {
  const body = JSON.parse(o.body); calls.push({ url, auth: (o.headers || {}).authorization || '', body });
  if (url.endsWith('/bot/register')) return { ok: true, status: 200, json: async () => over.register || { botId: 'a'.repeat(16), secret: 'b'.repeat(32) } };
  if (url.endsWith('/bot/heartbeat')) return over.heartbeat ? over.heartbeat() : { ok: true, status: 200, json: async () => ({ ok: true }) };
  if (url.endsWith('/bot/forget')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

test('off by default: nothing is sent', async () => {
  const d = state.open().data; d.installed['st-one'] = { version: '1.0.0', enabled: true, grants: [], store: { version: '1.0.0' } }; d.installed['st-local'] = { version: '1.0.0', enabled: true, grants: [] };
  assert.strictEqual(plugins.statsStatus().on, false);
  assert.deepStrictEqual(await plugins.reportStats(site()), { ok: false, why: 'off' }); assert.strictEqual(calls.length, 0);
});

test('on: registers once, then sends only store plugins with version, on/off and failure counts, signed with the bot id and secret', async () => {
  await plugins.setStats(true);
  const r = await plugins.reportStats(site()); assert.strictEqual(r.ok, true); assert.strictEqual(r.sent, 1);
  assert.deepStrictEqual(calls.map((c) => c.url.split('/').slice(-2).join('/')), ['bot/register', 'bot/heartbeat']);
  const hb = calls[1]; assert.strictEqual(hb.auth, 'Bearer ' + 'a'.repeat(16) + '.' + 'b'.repeat(32));
  assert.deepStrictEqual(hb.body.plugins, [{ id: 'st-one', version: '1.0.0', enabled: true, errors: 0 }], 'the hand-copied plugin is not reported');
  assert.deepStrictEqual(Object.keys(hb.body).sort(), ['plugins', 'v'], 'nothing else is in the report');
  calls.length = 0; await plugins.reportStats(site()); assert.deepStrictEqual(calls.map((c) => c.url.split('/').pop()), ['heartbeat'], 'no second registration');
});

test('failures are counted and reset after a successful report; a failed report keeps them', async () => {
  calls.length = 0; stats.bumpError('st-one'); stats.bumpError('st-one');
  const bad = await plugins.reportStats(site({ heartbeat: () => ({ ok: false, status: 503, json: async () => ({}) }) })); assert.deepStrictEqual(bad, { ok: false, why: 'site' });
  await plugins.reportStats(site()); assert.strictEqual(calls[calls.length - 1].body.plugins[0].errors, 2);
  await plugins.reportStats(site()); assert.strictEqual(calls[calls.length - 1].body.plugins[0].errors, 0);
});

test('the site forgot this bot (401): it registers again next time', async () => {
  calls.length = 0; const r = await plugins.reportStats(site({ heartbeat: () => ({ ok: false, status: 401, json: async () => ({}) }) })); assert.deepStrictEqual(r, { ok: false, why: 'auth' });
  calls.length = 0; await plugins.reportStats(site({ register: { botId: 'c'.repeat(16), secret: 'd'.repeat(32) } })); assert.strictEqual(calls[0].url.split('/').pop(), 'register'); assert.match(calls[1].auth, /^Bearer c{16}\.d{32}$/);
});

test('a bad answer from the site while registering is not trusted', async () => {
  await plugins.setStats(false, site()); await plugins.setStats(true); calls.length = 0;
  assert.deepStrictEqual(await plugins.reportStats(site({ register: { botId: 'nope', secret: 'x' } })), { ok: false, why: 'register' });
  assert.strictEqual(calls.length, 1);
});

test('off again: the site is asked to delete this bot and the id is forgotten', async () => {
  await plugins.reportStats(site()); calls.length = 0;
  const st = await plugins.setStats(false, site()); assert.strictEqual(st.on, false); assert.strictEqual(st.registered, false);
  assert.deepStrictEqual(calls.map((c) => c.url.split('/').pop()), ['forget']); assert.match(calls[0].auth, /^Bearer a{16}|c{16}|[0-9a-f]{16}\./);
  calls.length = 0; assert.deepStrictEqual(await plugins.reportStats(site()), { ok: false, why: 'off' }); assert.strictEqual(calls.length, 0);
});

test('the owner command', async () => {
  const pluginCmd = require('../commands/plugin'); const run = async (a) => { const r = []; await pluginCmd.run({ args: ['stats', ...a], rest: '', reply: async (t) => { r.push(t); }, prefix: '.', jid: 'x@s.whatsapp.net', isGroup: false }); return r.join('\n'); };
  await pluginCmd.run({ args: ['on'], rest: '', reply: async () => {}, prefix: '.', jid: 'x@s.whatsapp.net', isGroup: false });
  assert.match(await run([]), /Anonymous statistics: off/); assert.match(await run(['on']), /are on[\s\S]*Never sent/); assert.match(await run([]), /statistics: on/); assert.match(await run(['off']), /are off/);
  plugins.stop();
});

// v1.4.8: storage list/delete and chat.react
const { dir } = require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const { Broker } = require('../core/plugins/broker');
const manifestLib = require('../core/plugins/manifest');
const env = { isPublicHost: async () => true, log() {}, fetch: async () => ({}), notifyOwner: async () => {} };
const mk = (perm, e = env) => new Broker({ manifest: { permissions: perm }, grants: perm, env: e });
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };

test('the manifest accepts chat.react and the site list in step', () => {
  assert.ok(manifestLib.PERMISSIONS.includes('chat.react'));
});

test('storage.list and storage.delete: same permission as storage, keys checked, deletion persisted', async () => {
  let saved = null; const e = { ...env, persist: (m) => { saved = [...m.keys()]; } };
  const b = mk(['storage'], e); const st = b.newCall({ chat: { id: 'x' } }, {});
  await b.handle('storage.set', JSON.stringify({ key: 'b', value: '2' }), st); await b.handle('storage.set', JSON.stringify({ key: 'a', value: '1' }), st);
  assert.deepStrictEqual(JSON.parse(await b.handle('storage.list', '{}', st)), ['a', 'b']);
  await b.handle('storage.delete', JSON.stringify({ key: 'a' }), st);
  assert.deepStrictEqual(JSON.parse(await b.handle('storage.list', '{}', st)), ['b']); assert.deepStrictEqual(saved, ['b']);
  assert.strictEqual(await code(b.handle('storage.delete', JSON.stringify({ key: 'nope' }), st)), 'ok', 'deleting a missing key is fine');
  assert.strictEqual(await code(b.handle('storage.delete', JSON.stringify({ key: '../x' }), st)), 'bad_args');
  const n = mk(['chat.send']);
  assert.strictEqual(await code(n.handle('storage.list', '{}', n.newCall({}, {}))), 'not_declared');
  assert.strictEqual(await code(n.handle('storage.delete', JSON.stringify({ key: 'a' }), n.newCall({}, {}))), 'not_declared');
});

test('chat.react: needs the permission, one emoji only, goes to the triggering message only, rate limited', async () => {
  const sent = []; const b = mk(['chat.react']); const st = b.newCall({ chat: { id: 'x' } }, { react: async (e) => { sent.push(e); } });
  assert.strictEqual(await code(b.handle('chat.react', JSON.stringify({ emoji: '👍' }), st)), 'ok');
  assert.strictEqual(await code(b.handle('chat.react', JSON.stringify({ emoji: '🎉' }), st)), 'rate_limited', 'one per call');
  assert.deepStrictEqual(sent, ['👍']);
  for (const bad of ['a', 'hi', '👍👍', '<b>', '1', '', ' 👍']) {
    if (bad === '') continue;
    const s2 = b.newCall({ chat: { id: 'x' } }, { react: async () => { sent.push('BAD'); } });
    assert.strictEqual(await code(b.handle('chat.react', JSON.stringify({ emoji: bad }), s2)), 'bad_args', JSON.stringify(bad));
  }
  assert.ok(!sent.includes('BAD'));
  const ok2 = b.newCall({ chat: { id: 'x' } }, { react: async (e) => { sent.push(e); } });
  assert.strictEqual(await code(b.handle('chat.react', JSON.stringify({ emoji: '' }), ok2)), 'ok', 'empty = remove the reaction');
  const noMsg = b.newCall({ chat: { id: 'x' } }, {}); assert.strictEqual(await code(b.handle('chat.react', JSON.stringify({ emoji: '👍' }), noMsg)), 'not_allowed');
  const n = mk(['chat.send']); assert.strictEqual(await code(n.handle('chat.react', JSON.stringify({ emoji: '👍' }), n.newCall({ chat: { id: 'x' } }, { react: async () => {} }))), 'not_declared');
  // 10 a minute across calls
  const f = mk(['chat.react']); const r = []; for (let i = 0; i < 12; i++) r.push(await code(f.handle('chat.react', JSON.stringify({ emoji: '😀' }), f.newCall({ chat: { id: 'x' } }, { react: async () => {} }))));
  assert.deepStrictEqual(r, [...Array(10).fill('ok'), 'rate_limited', 'rate_limited']);
});

// v1.5.9: private test install with a one-time code
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const plugins = require('../core/plugins');
const state = require('../core/plugins/state');
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');

const MAN = JSON.stringify({ manifestVersion: 1, id: 'tc-plugin', version: '0.1.0', apiVersion: 1, name: 'TC', description: 'Unfinished', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: 'tcpl', who: 'everyone', description: 'x' }] });
const SRC = "tfx.command('tcpl', async (c) => { await c.reply('hi'); });";
const site = (over = {}) => async (url) => {
  if (!/code=TFX-ABCD2345$/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ id: 'tc-plugin', developer: 'alice', manifestRaw: MAN, entrySource: SRC, manifestSha: sha(MAN), entrySha: sha(SRC), ...over }) };
};

test('a valid code puts the folder in place, marked as a test copy, and shows the normal permission screen', async () => {
  const r = await plugins.prepareTest('tfx-abcd2345', site());
  assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(r.test, true); assert.strictEqual(r.developer, 'alice'); assert.ok(r.code);
  assert.ok(fs.existsSync(path.join(state.dir(), 'tc-plugin', '.from-test')));
  assert.ok(!fs.existsSync(path.join(state.dir(), 'tc-plugin', '.from-store')), 'never looks like a store plugin');
  const c = plugins.confirm(r.code); assert.strictEqual(c.ok, true);
  assert.strictEqual(state.open().data.installed['tc-plugin'].store, undefined);
});
test('wrong shape, unknown code, changed files and a name clash are refused', async () => {
  assert.strictEqual((await plugins.prepareTest('nope', site())).why, 'badcode');
  assert.strictEqual((await plugins.prepareTest('TFX-ZZZZ9999', site())).why, 'badcode');
  assert.strictEqual((await plugins.prepareTest('TFX-ABCD2345', site({ entrySource: SRC + ' ' }))).why, 'tampered');
  const dir = path.join(state.dir(), 'tc-other'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'turbofex-plugin.json'), MAN.replace('tc-plugin', 'tc-other')); fs.writeFileSync(path.join(dir, 'index.js'), SRC);
  const man2 = JSON.stringify({ ...JSON.parse(MAN), id: 'tc-other', commands: [{ name: 'tcother', who: 'everyone', description: 'x' }] });
  assert.strictEqual((await plugins.prepareTest('TFX-ABCD2345', site({ manifestRaw: man2, manifestSha: sha(man2) }))).why, 'conflict', 'a hand-copied plugin of that name is never overwritten');
  assert.strictEqual((await plugins.prepareTest('TFX-ABCD2345', async () => { throw new Error('offline'); })).why, 'unreachable');
});

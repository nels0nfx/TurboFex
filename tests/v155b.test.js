// plugin ratings by bot owners: need stats on + one report sent + a store plugin
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const plugins = require('../core/plugins');
const state = require('../core/plugins/state');

test('rating: refused until stats are on and a report was sent; then sent with the bot secret; only store plugins; 1-5 only', async () => {
  const d = state.open().data; d.installed['rt-one'] = { version: '1.0.0', enabled: true, grants: [], store: { version: '1.0.0' } }; d.installed['rt-local'] = { version: '1.0.0', enabled: true, grants: [] };
  const calls = [];
  const site = async (url, o) => { const b = JSON.parse(o.body); calls.push({ u: url.split('/').pop(), b, a: (o.headers || {}).authorization || '' });
    if (url.endsWith('/register')) return { ok: true, status: 200, json: async () => ({ botId: 'c'.repeat(16), secret: 'd'.repeat(32) }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  assert.strictEqual((await plugins.ratePlugin('rt-one', 5, site)).why, 'off');
  await plugins.setStats(true);
  assert.strictEqual((await plugins.ratePlugin('rt-one', 5, site)).why, 'notyet');
  assert.strictEqual((await plugins.ratePlugin('rt-local', 5, site)).why, 'unknown');
  assert.strictEqual((await plugins.ratePlugin('rt-one', 6, site)).why, 'stars');
  await plugins.reportStats(site);
  calls.length = 0;
  assert.strictEqual((await plugins.ratePlugin('rt-one', 4, site)).ok, true);
  assert.deepStrictEqual(calls, [{ u: 'rate', b: { plugin: 'rt-one', stars: 4 }, a: 'Bearer ' + 'c'.repeat(16) + '.' + 'd'.repeat(32) }]);
  await plugins.setStats(false);
});

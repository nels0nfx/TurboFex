// v1.4.7: the saved notes of a removed plugin are kept 30 days, then erased
const { dir } = require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const plugins = require('../core/plugins');
const state = require('../core/plugins/state');

test('removed plugin: notes kept for 30 days, then erased; installing again keeps them', () => {
  const d = state.open().data;
  d.installed['keep-me'] = { version: '1.0.0', enabled: false, grants: [] }; d.installed['drop-me'] = { version: '1.0.0', enabled: false, grants: [] };
  state.dataStore('keep-me').data.kv = { a: '1' }; state.dataStore('drop-me').data.kv = { b: '2' };
  assert.strictEqual(plugins.remove('keep-me'), true); assert.strictEqual(plugins.remove('drop-me'), true);
  assert.ok(d.removed['keep-me'] && d.removed['drop-me']);
  const t0 = d.removed['drop-me'];
  assert.strictEqual(plugins.purgeOldNotes(t0 + 29 * 86400000), 0, 'day 29: still kept');
  assert.deepStrictEqual(state.dataStore('drop-me').data.kv, { b: '2' });
  d.installed['keep-me'] = { version: '1.0.0', enabled: false, grants: [] };   // installed again
  assert.strictEqual(plugins.purgeOldNotes(t0 + 31 * 86400000), 1, 'day 31: only the plugin that stayed removed');
  assert.deepStrictEqual(state.dataStore('drop-me').data.kv, {});
  assert.deepStrictEqual(state.dataStore('keep-me').data.kv, { a: '1' });
  assert.ok(!d.removed['keep-me'] && !d.removed['drop-me']);
  assert.strictEqual(plugins.purgeOldNotes(t0 + 99 * 86400000), 0);
});

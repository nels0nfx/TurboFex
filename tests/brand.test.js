require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const { smallcaps, bold } = require('../core/fonts');
const integrity = require('../core/integrity');
const brand = require('../core/brand');
const { groupByCategory, info } = require('../whatsapp/categories');

test('the bot name matches its integrity check and cannot be changed at run time', () => {
  assert.ok(integrity.ok());
  assert.ok(Object.isFrozen(brand));
});
test('fonts', () => {
  assert.strictEqual(smallcaps('ping'), 'ᴘɪɴɢ');
  assert.strictEqual(bold('Menu'), '𝗠𝗲𝗻𝘂');
});
test('categories are listed alphabetically and commands inside them too', () => {
  const list = ['zeta', 'alpha', 'beta'].map((n, i) => ({ name: n, category: ['group', 'general', 'audio'][i], description: '' }));
  const out = groupByCategory(list, true);
  assert.deepStrictEqual(out.map((s) => s.meta.title), ['AUDIO', 'GENERAL', 'GROUP']);
  const titles = Object.values(info).map((m) => m.title);
  assert.deepStrictEqual([...titles].sort((a, b) => a.localeCompare(b)).length, titles.length);
});
test('owner-only commands are hidden from everybody else', () => {
  const list = [{ name: 'a', category: 'owner', ownerOnly: true }, { name: 'b', category: 'general' }];
  assert.strictEqual(groupByCategory(list, false).flatMap((s) => s.cmds).length, 1);
});

require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const { format, mode } = require('../whatsapp/format');

const isCmd = (n) => ['mode', 'afk', 'endgame', 'base64', 'rate'].includes(n);
const f = (t, level = 'full') => format(t, isCmd, '.', level);

test('a title, labels and bullets are formatted', () => {
  assert.strictEqual(f('⚙️ Settings saved\n- Mode: Private\n- Prefix: .'), '*⚙️ Settings saved*\n▸ *Mode:* Private\n▸ *Prefix:* .');
});
test('real commands go in monospace, unknown words do not', () => {
  assert.strictEqual(f('Use .mode public to change it.'), 'Use `.mode` public to change it.');
  assert.strictEqual(f('Save it as file.txt and .notacommand'), 'Save it as file.txt and .notacommand');
});
test('examples and usage lines', () => {
  assert.strictEqual(f('Ask a question.\nExample: .rate my cooking'), '_Ask a question._\n*Example:* `.rate my cooking`');
  assert.strictEqual(f('Use:\n.base64 encode hello'), '*Use:*\n`.base64 encode hello`');
});
test('a single status sentence is bold', () => {
  assert.strictEqual(f('⚠️ I will not block that one.'), '⚠️ *I will not block that one.*');
});
test('text that is already formatted is never touched', () => {
  const t = '✅ Prefix is now *!*\nUse !menu';
  assert.strictEqual(f(t), t);
});
test('content commands only get their own system messages formatted', () => {
  assert.strictEqual(f('Note: this is my joke', 'system'), 'Note: this is my joke');
  assert.strictEqual(f('😂 Why did the chicken cross the road?', 'system'), '😂 Why did the chicken cross the road?');
  assert.strictEqual(f('Type some text.', 'system'), '_Type some text._');
});
test('modes', () => {
  assert.strictEqual(mode({ name: 'menu' }), 'full');
  assert.strictEqual(mode({ name: 'joke' }), 'system');
  assert.strictEqual(mode({ name: 'x', format: false }), false);
});
test('empty and huge texts are returned as they are', () => {
  assert.strictEqual(f(''), '');
  const big = 'a'.repeat(4000);
  assert.strictEqual(f(big), big);
});

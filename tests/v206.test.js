// v2.0.6: languages, plugin commands.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang11-'));
const i18n = require('../core/i18n');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same plugin messages, changing parts and code marks', () => {
  const keys = Object.keys(require('../core/lang/plugin-fr'));
  assert.ok(keys.length > 150);
  for (const code of CODES) {
    const lang = require(`../core/lang/plugin-${code}`);
    assert.deepStrictEqual(Object.keys(lang), keys, `${code} must list the same messages in the same order`);
    for (const k of keys) {
      assert.strictEqual(count(lang[k], '{}'), count(k, '{}'), `${code}: "${k}" must keep every {}`);
      assert.strictEqual(count(lang[k], '`'), count(k, '`'), `${code}: "${k}" must keep the \` marks`);
      assert.ok(lang[k].trim().length > 0, `${code}: "${k}" is empty`);
    }
  }
});

test('the English texts are still written like that in the bot', () => {
  const dir = path.join(ROOT, 'commands');
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    .replace(/\\`/g, '`').replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\{a\}|\{b\}/g, '{}');
  const missing = [];
  for (const k of Object.keys(require('../core/lang/plugin-fr'))) {
    for (const part of k.split('{}')) {
      const p = part.replace(/^[:\s]+/, '').split('\n')[0].trim();
      if (p.length > 3 && !src.includes(p)) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], 'the bot no longer says: ' + missing.slice(0, 5).join(' | '));
});

test('plugin replies are translated', () => {
  assert.strictEqual(i18n.translate('🧩 *Plugin store*', 'fr'), '🧩 *Boutique de plugins*');
  assert.strictEqual(i18n.translate('🧩 *Plugin store*', 'pt'), '🧩 *Loja de plugins*');
  assert.strictEqual(i18n.translate('🧩 *Plugin store*', 'en'), '🧩 *Plugin store*');
  assert.ok(i18n.translate('▸ _See the names with_ {}', 'es').includes('{}'));
});

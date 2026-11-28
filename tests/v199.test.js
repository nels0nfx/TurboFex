// v1.9.9: languages, tools commands.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang5-'));
const i18n = require('../core/i18n');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same tools messages, changing parts and code marks', () => {
  const keys = Object.keys(require('../core/lang/tools-fr'));
  assert.ok(keys.length > 150);
  for (const code of CODES) {
    const lang = require(`../core/lang/tools-${code}`);
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
  for (const k of Object.keys(require('../core/lang/tools-fr'))) {
    for (const part of k.split('{}')) {
      const p = part.replace(/^[:\s]+/, '').split('\n')[0].trim();
      if (p.length > 3 && !src.includes(p)) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], 'the bot no longer says: ' + missing.slice(0, 5).join(' | '));
});

test('tool replies are translated and the command stays in code marks', () => {
  assert.strictEqual(i18n.translate('✅ *Note 3 saved.*', 'fr'), '✅ *Note 3 enregistrée.*');
  assert.strictEqual(i18n.translate('Example: .note add buy bread', 'es'), 'Ejemplo: .note add comprar pan');
  assert.strictEqual(i18n.translate('✅ *Note 3 saved.*', 'en'), '✅ *Note 3 saved.*');
  assert.ok(i18n.translate('*Usage:* `.crypto btc`', 'pt').startsWith('*Uso:*'));
  assert.ok(i18n.translate('🔥 *Streak:* 3 days', 'es').includes('3 días'));
});

test('words that are not messages stay as they are', () => {
  for (const code of CODES) assert.strictEqual(i18n.translate('audio/ogg; codecs=opus', code), 'audio/ogg; codecs=opus');
});

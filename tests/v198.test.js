// v1.9.8: languages, games and fun commands.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang4-'));
const i18n = require('../core/i18n');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same fun and games messages, changing parts and code marks', () => {
  const keys = Object.keys(require('../core/lang/fun-fr'));
  assert.ok(keys.length > 150);
  for (const code of CODES) {
    const lang = require(`../core/lang/fun-${code}`);
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
  for (const k of Object.keys(require('../core/lang/fun-fr'))) {
    for (const part of k.split('{}')) {
      const p = part.replace(/^[:\s]+/, '').split('\n')[0].trim();
      if (p.length > 3 && !src.includes(p)) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], 'the bot no longer says: ' + missing.slice(0, 5).join(' | '));
});

test('a hug with two names is translated and the names stay', () => {
  assert.strictEqual(i18n.translate('@2349138567333 gives @2348012345678 a big warm hug 🤗', 'fr'), '@2349138567333 fait un gros câlin tout chaud à @2348012345678 🤗');
  assert.strictEqual(i18n.translate('@1 gives @2 a big warm hug 🤗', 'en'), '@1 gives @2 a big warm hug 🤗');
});

test('a pet reply keeps the command in the code marks', () => {
  assert.strictEqual(i18n.translate('Adopt one: `.pet adopt <name>`', 'es'), 'Adopta uno: `.pet adopt <nombre>`');
  assert.ok(i18n.translate('⏳ *Rex needs a moment.* Try again in 2 minutes.', 'pt').includes('2 minutos'));
});

test('jokes and pick-up lines stay in English', () => {
  const j = 'What do you call a fake noodle? An impasta.';
  for (const code of CODES) assert.strictEqual(i18n.translate(j, code), j);
});

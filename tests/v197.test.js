// v1.9.7: languages, the rest of the group commands (statuses, online list, new members, birthdays, rank, rules, stats and more).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang3-'));
const i18n = require('../core/i18n');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same messages, changing parts and code marks (group commands, part 2)', () => {
  const keys = Object.keys(require('../core/lang/groups2-fr'));
  assert.ok(keys.length > 250);
  for (const code of CODES) {
    const lang = require(`../core/lang/groups2-${code}`);
    assert.deepStrictEqual(Object.keys(lang), keys, `${code} must list the same messages in the same order`);
    for (const k of keys) {
      assert.strictEqual(count(lang[k], '{}'), count(k, '{}'), `${code}: "${k}" must keep every {}`);
      assert.strictEqual(count(lang[k], '`'), count(k, '`'), `${code}: "${k}" must keep the \` marks`);
      assert.ok(k === 's' || lang[k].trim().length > 0, `${code}: "${k}" is empty`);
    }
  }
});

test('the English texts are still written like that in the bot', () => {
  const dir = path.join(ROOT, 'commands');
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    .replace(/\\`/g, '`').replace(/\\'/g, "'").replace(/\\n/g, '\n');
  const missing = [];
  for (const k of Object.keys(require('../core/lang/groups2-fr'))) {
    if (k.length < 4) continue;
    for (const part of k.split('{}')) {
      const p = part.replace(/^[:\s]+/, '').split('\n')[0].trim();
      if (p.length > 3 && !src.includes(p)) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], 'the bot no longer says: ' + missing.slice(0, 5).join(' | '));
});

test('a plural "s" inside a sentence is kept in French/Spanish/Portuguese and dropped in Arabic/Indonesian', () => {
  const t = (n, code) => i18n.translate(`📊 *Group stats* _(last ${n} day${n > 1 ? 's' : ''})_`, code);
  assert.ok(t(7, 'es').includes('7 días'));
  assert.ok(t(7, 'fr').includes('derniers jours'));
  assert.ok(!t(7, 'id').includes('hari' + 's'));
  assert.ok(!t(7, 'ar').includes('s)'));
  assert.ok(t(1, 'fr').includes('1 derniers jour)'));
});

test('group extras are translated and unknown text stays', () => {
  const fr = require('../core/lang/groups2-fr');
  assert.strictEqual(i18n.translate('Anti group status', 'fr'), fr['Anti group status']);
  assert.strictEqual(i18n.translate('Something nobody translated', 'fr'), 'Something nobody translated');
  assert.strictEqual(i18n.translate('Anti group status', 'en'), 'Anti group status');
});

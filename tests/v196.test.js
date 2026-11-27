// v1.9.6: languages, phase 2: group management and protection messages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang2-'));
const i18n = require('../core/i18n');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same group messages, with the same changing parts and code marks', () => {
  const base = require('../core/lang/groups-fr');
  const keys = Object.keys(base);
  assert.ok(keys.length > 300);
  for (const code of CODES) {
    const lang = require(`../core/lang/groups-${code}`);
    assert.deepStrictEqual(Object.keys(lang), keys, `${code} must list the same messages in the same order`);
    for (const k of keys) {
      assert.strictEqual(count(lang[k], '{}'), count(k, '{}'), `${code}: "${k}" must keep every {}`);
      assert.strictEqual(count(lang[k], '`'), count(k, '`'), `${code}: "${k}" must keep the \` marks`);
      assert.ok(lang[k].trim().length > 0, `${code}: "${k}" is empty`);
    }
  }
});

test('phase 2 does not repeat or clash with a phase 1 message', () => {
  const one = new Set(Object.keys(require('../core/lang/fr')));
  for (const k of Object.keys(require('../core/lang/groups-fr'))) assert.ok(!one.has(k), `already in phase 1: ${k}`);
});

test('the English texts of the group messages are still written like that in the bot', () => {
  const dir = path.join(ROOT, 'commands');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
  for (const f of ['moderation.js', 'protect.js', 'adminguard.js', 'captcha.js', 'welcomedm.js']) files.push(path.join(ROOT, 'whatsapp', f));
  const src = files.filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n').replace(/\\`/g, '`').replace(/\\'/g, "'").replace(/\\n/g, '\n');
  let missing = [];
  for (const k of Object.keys(require('../core/lang/groups-fr'))) {
    if (/^[A-Za-z ]+$/.test(k) || /^(ON|OFF|WARN|DELETE|KICK)\b/.test(k)) continue; // single words are filled in by the code
    for (const part of k.split('{}')) {
      const p = part.replace(/^[:\s]+/, '').trim();
      if (p.length > 3 && !src.includes(p.split('\n')[0].trim())) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], 'the bot no longer says: ' + missing.slice(0, 5).join(' | '));
});

test('group replies are translated, and names, numbers and links stay as they are', () => {
  assert.strictEqual(i18n.translate('Nothing to see here', 'fr'), 'Nothing to see here');
  const fr = require('../core/lang/groups-fr');
  const k = Object.keys(fr).find((x) => x.includes('{}') && !x.includes('\n') && count(x, '{}') === 1 && x.length > 20);
  const filled = k.replace('{}', '@2349138567333');
  assert.strictEqual(i18n.translate(filled, 'fr'), fr[k].replace('{}', '@2349138567333'));
  assert.strictEqual(i18n.translate(filled, 'en'), filled);
});

test('a word that changes (ON, OFF, WARN...) is translated inside a sentence', () => {
  const fr = require('../core/lang/groups-fr');
  assert.strictEqual(fr.ON, 'ACTIVÉ');
  assert.strictEqual(require('../core/lang/groups-ar').OFF, 'متوقف');
  assert.strictEqual(i18n.translate('ON', 'es'), 'ACTIVADO');
  assert.strictEqual(i18n.translate('OFF', 'id'), 'NONAKTIF');
});

test('a command description is translated in the menu, in .list and in menu <command>', () => {
  const fr = require('../core/lang/groups-fr');
  const d = Object.keys(fr).find((x) => /^[A-Z][a-z].*[a-z.]$/.test(x) && !x.includes('{}') && x.length > 25 && !x.includes('\n'));
  assert.ok(d, 'a description key exists');
  assert.strictEqual(i18n.translate(`┃    _${d}_`, 'fr'), `┃    _${fr[d]}_`);
  assert.strictEqual(i18n.translate(`│    _${d}_`, 'fr'), `│    _${fr[d]}_`);
  assert.strictEqual(i18n.translate(`_${d}_`, 'fr'), `_${fr[d]}_`);
});

test('code blocks stay in English in every language', () => {
  const fr = require('../core/lang/groups-fr');
  const k = Object.keys(fr).find((x) => !x.includes('{}') && !x.includes('\n') && x.length > 15);
  const text = '```\n' + k + '\n```';
  for (const code of CODES) assert.strictEqual(i18n.translate(text, code), text);
});

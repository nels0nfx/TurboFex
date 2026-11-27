// v1.9.5: languages (English, French, Spanish, Portuguese, Arabic, Indonesian), phase 1: menu, help and the common messages.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TURBOFEX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-lang-'));
const i18n = require('../core/i18n');
const store = require('../whatsapp/store');

const ROOT = path.join(__dirname, '..');
const CODES = ['fr', 'es', 'pt', 'ar', 'id'];
const count = (s, ch) => s.split(ch).length - 1;

test('every language has the same messages, with the same changing parts and the same code marks', () => {
  const base = require('../core/lang/fr');
  const keys = Object.keys(base);
  assert.ok(keys.length > 80);
  for (const code of CODES) {
    const lang = require(`../core/lang/${code}`);
    assert.deepStrictEqual(Object.keys(lang), keys, `${code} must list the same messages in the same order`);
    for (const k of keys) {
      assert.strictEqual(count(lang[k], '{}'), count(k, '{}'), `${code}: "${k}" must keep every {}`);
      assert.strictEqual(count(lang[k], '`'), count(k, '`'), `${code}: "${k}" must keep the \` marks`);
      assert.ok(lang[k].trim().length > 0, `${code}: "${k}" is empty`);
    }
  }
});

test('every English text in the language files is still written like that in the bot (so a changed wording is noticed)', () => {
  const src = ['commands/menu.js', 'commands/help.js', 'commands/language.js', 'whatsapp/handler.js', 'core/capacity.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
    .replace(/\\`/g, '`');
  for (const k of Object.keys(require('../core/lang/fr'))) {
    if (k.startsWith('┃ ◈ ') || k.startsWith('▸ The bot is *') || /^[A-Za-z ]+$/.test(k)) continue; // these are built in pieces (the help test checks them instead)
    for (const part of k.split('{}')) {
      if (part.trim()) assert.ok(src.includes(part), `the bot no longer says: ${part}`);
    }
  }
});

test('the language follows the country code of the bot number', () => {
  assert.strictEqual(i18n.detect('2349138567333'), 'en');
  assert.strictEqual(i18n.detect('33612345678'), 'fr');
  assert.strictEqual(i18n.detect('221771234567'), 'fr');
  assert.strictEqual(i18n.detect('34612345678'), 'es');
  assert.strictEqual(i18n.detect('5215512345678'), 'es');
  assert.strictEqual(i18n.detect('351912345678'), 'pt');
  assert.strictEqual(i18n.detect('5511987654321'), 'pt');
  assert.strictEqual(i18n.detect('966501234567'), 'ar');
  assert.strictEqual(i18n.detect('201012345678'), 'ar');
  assert.strictEqual(i18n.detect('628123456789'), 'id');
  assert.strictEqual(i18n.detect('14155550123'), 'en');
  assert.strictEqual(i18n.detect(''), 'en');
  assert.strictEqual(i18n.detect(null), 'en');
});

test('words for a language are understood', () => {
  assert.strictEqual(i18n.parse('fr'), 'fr');
  assert.strictEqual(i18n.parse('Français'), 'fr');
  assert.strictEqual(i18n.parse('FRENCH'), 'fr');
  assert.strictEqual(i18n.parse('español'), 'es');
  assert.strictEqual(i18n.parse('Portuguese'), 'pt');
  assert.strictEqual(i18n.parse('arabic'), 'ar');
  assert.strictEqual(i18n.parse('العربية'), 'ar');
  assert.strictEqual(i18n.parse('Bahasa Indonesia'), 'id');
  assert.strictEqual(i18n.parse('klingon'), null);
  assert.strictEqual(i18n.parse(''), null);
});

test('translate: lines are matched whole, the changing part is kept, the rest stays English', () => {
  assert.strictEqual(i18n.translate('▸ `.status` shows the health of the bot.', 'fr'), '▸ `.status` affiche l’état de santé du bot.');
  assert.strictEqual(i18n.translate('┃ ◈ User: Group admin', 'es'), '┃ ◈ Usuario: Admin del grupo');
  assert.strictEqual(i18n.translate('┃ ◈ Owner: Nelson', 'pt'), '┃ ◈ Dono: Nelson'); // a name stays as it is
  assert.strictEqual(i18n.translate('⏳ *Slow down.* Please wait 7 seconds before using more commands.', 'id'), '⏳ *Pelan-pelan.* Tunggu 7 detik sebelum memakai perintah lagi.');
  assert.strictEqual(i18n.translate('A line nobody translated yet', 'fr'), 'A line nobody translated yet');
  assert.strictEqual(i18n.translate('▸ `.status` shows the health of the bot.', 'en'), '▸ `.status` shows the health of the bot.');
  // somebody's own words that only contain a known sentence are not touched
  assert.strictEqual(i18n.translate('He said: Please try again in a moment.', 'fr'), 'He said: Please try again in a moment.');
  // a monospace block is left alone
  const block = '```\nUse    .ping\nWho    Everyone\n```';
  assert.strictEqual(i18n.translate(block, 'fr'), block);
  assert.strictEqual(i18n.translate('Everyone', 'ar'), 'الجميع');
  assert.strictEqual(i18n.t('Who', 'fr'), 'Qui');
  assert.strictEqual(i18n.t('Who', 'en'), 'Who');
});

const capture = async (cmd, ctx) => {
  const out = [];
  await cmd.run({ reply: async (t) => out.push(t), prefix: '.', args: [], commandList: [], isOwner: false, isRealOwner: false, isAdmin: false, isGroup: false, ...ctx });
  return out.join('\n');
};

test('help is fully translated in every language, for members, admins and the owner', async () => {
  const help = require('../commands/help');
  const roles = [{}, { isAdmin: true }, { isOwner: true, isRealOwner: true, isAdmin: true }];
  for (const role of roles) {
    const english = await capture(help, role);
    for (const code of CODES) {
      const lines = english.split('\n');
      const out = i18n.translate(english, code).split('\n');
      lines.forEach((l, i) => {
        if (l.trim()) assert.notStrictEqual(out[i], l, `${code}: not translated: ${l}`);
      });
    }
  }
  const noPrefix = await capture(help, { prefix: '' });
  assert.ok(i18n.translate(noPrefix, 'fr').includes('Écrivez simplement'));
  const ask = await capture(help, { args: ['ask'] });
  assert.ok(i18n.translate(ask, 'es').includes('Pregúntame sobre el bot'));
});

test('the messages of the server checks are translated', () => {
  const capacity = require('../core/capacity');
  for (const why of ['missing', 'cooldown', 'busy', 'memory', 'overloaded', 'other']) {
    const english = capacity.refusal({ why, waitSeconds: 9, detail: 'x' }, false);
    for (const code of CODES) assert.notStrictEqual(i18n.translate(english, code), english, `${code} ${why}`);
  }
});

test('the language command: show, choose, automatic, unknown', async () => {
  const cmd = require('../commands/language');
  assert.strictEqual(cmd.ownerOnly, true);
  const before = await capture(cmd, { isOwner: true });
  assert.ok(before.includes('Chosen automatically') && before.includes('fr (Français)'));
  assert.ok((await capture(cmd, { args: ['French'] })).includes('Français'));
  assert.strictEqual(store.getAuto('language'), 'fr');
  assert.strictEqual(i18n.current(), 'fr');
  assert.ok(!(await capture(cmd, {})).includes('Chosen automatically'));
  assert.ok((await capture(cmd, { args: ['klingon'] })).includes('do not know'));
  assert.strictEqual(store.getAuto('language'), 'fr'); // a wrong word changes nothing
  assert.ok((await capture(cmd, { args: ['auto'] })).includes('automatic'));
  assert.strictEqual(i18n.chosen(), null);
  assert.strictEqual(i18n.current(), 'en'); // no number known in the test
  i18n.noteBot({ user: { id: '5511987654321:12@s.whatsapp.net' } });
  assert.strictEqual(i18n.current(), 'pt'); // chosen from the number
  await capture(cmd, { args: ['es'] });
  assert.strictEqual(i18n.current(), 'es'); // the owner's choice wins over the number
});

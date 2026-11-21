require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const menu = require('../commands/menu');
const fs = require('fs');
const path = require('path');

baileys.setForTests({});
console.log = () => {};

const commandList = [].concat(...fs.readdirSync(path.join(__dirname, '..', 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(path.join(__dirname, '..', 'commands', f))));
const run = async (opts = {}) => {
  let out = '';
  const media = [];
  await menu.run({ reply: async (t) => { out = t; }, commandList, prefix: '.', args: [], isOwner: false, isAdmin: false, timing: { receivedAt: Date.now() }, sock: { sendMessage: async (j, c) => media.push(c) }, jid: 'a@s.whatsapp.net', msg: { key: {} }, ...opts });
  return { out, media };
};

test('v1.7.8 menu header: the framed box with the name in the top bar, one ◈ line per detail, and the closing line', async () => {
  store.setAuto('menu', {});
  const { out, media } = await run();
  const lines = out.split('\n');
  assert.strictEqual(lines[0], '┏━━─『 TURBOFEX 』─━━');
  const close = lines.indexOf('┗━━━━━━━━━━━━─···');
  assert.ok(close > 5, 'the box is closed');
  assert.deepStrictEqual(lines.slice(close - 2, close), ['┃', '┃'], 'two empty lines before the closing line, as in the design');
  for (const l of lines.slice(1, close - 2)) assert.match(l, /^┃ ◈ [A-Za-z]+: \S/, `a detail line: ${l}`);
  assert.strictEqual(lines[close + 1], '', 'then a gap, then the categories');
  assert.match(lines[close + 2], /^┏ ❏ [A-Z ]+ ❏$/);
  assert.strictEqual(media.length, 0, 'no sticker, picture or video: only the text');
});

test('v1.7.8 menu header: the details are in our own words', async () => {
  const { out } = await run();
  const head = out.split('┗━')[0];
  assert.match(head, /┃ ◈ User: Member\n┃ ◈ Prefix: \[ \. \]\n┃ ◈ Mode: (Private|Public)\n┃ ◈ Commands: \d+\n┃ ◈ Version: \[ \d+\.\d+\.\d+ \]\n┃ ◈ Speed: \d+ ms\n┃ ◈ Uptime: /);
  assert.ok(!/Platform|Usage|RAM/.test(head), 'platform and memory are for the owner only');
  const owner = (await run({ isOwner: true, isAdmin: true })).out.split('┗━')[0];
  assert.match(owner, /┃ ◈ Platform: .+\n┃ ◈ Usage: .+\n┃ ◈ RAM: \[[█░]{10}\] \d+%\n┃\n┃\n$/);
});

test('v1.7.8 menu header: the title and the subtitle the owner chose are used', async () => {
  store.setAuto('menu', { title: 'my bot', subtitle: 'Fast and friendly' });
  const lines = (await run()).out.split('\n');
  assert.strictEqual(lines[0], '┏━━─『 MY BOT 』─━━');
  assert.strictEqual(lines[1], '┃ ◈ Fast and friendly');
  store.setAuto('menu', {});
});

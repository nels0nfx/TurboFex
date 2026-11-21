require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const autotag = require('../whatsapp/autotag');

baileys.setForTests({});
console.log = () => {};

const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const OTHER = '27822222222@s.whatsapp.net';
const GROUP = '120363000000000174@g.us';
const BOT = '27899999999@s.whatsapp.net';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ id: GROUP, subject: 'G', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }, { id: OTHER }] }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {},
};
let n = 0;
const gm = (who, text) => ({ key: { remoteJid: GROUP, participant: who, id: `T${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 80)); };
const tags = () => sent.filter((s) => s.c.text === autotag.INVISIBLE);

test('v1.7.5 autotag: it is OFF until the owner switches it on', async () => {
  sent.length = 0;
  await handler.handleMessage(sock, gm(MEMBER, 'hello everyone'));
  await settle();
  assert.strictEqual(tags().length, 0);
});

test('v1.7.5 autotag: only the owner can switch it on', async () => {
  sent.length = 0;
  const p = store.effectivePrefix();
  await handler.handleMessage(sock, gm(MEMBER, `${p}autotag on`));
  await settle();
  assert.strictEqual(autotag.isOn(GROUP), false, 'a member cannot switch it on');
});

test('v1.7.5 autotag: the owner switches it on, then every message tags everybody silently', async () => {
  sent.length = 0;
  const p = store.effectivePrefix();
  await handler.handleMessage(sock, gm(OWNER, `${p}autotag on`));
  await settle();
  assert.strictEqual(autotag.isOn(GROUP), true);
  assert.ok(sent.some((s) => s.c.text && /Auto tag is ON/.test(s.c.text)));
  assert.strictEqual(tags().length, 0, 'switching it on does not tag anybody');

  sent.length = 0;
  await handler.handleMessage(sock, gm(MEMBER, 'good morning'));
  await settle();
  assert.strictEqual(tags().length, 1, 'one silent tag for the message');
  const t = tags()[0];
  assert.strictEqual(t.j, GROUP);
  assert.deepStrictEqual([...t.c.mentions].map((m) => m.split('@')[0]).sort(), ['27800000001', '27811111111', '27822222222', '27899999999'], 'everybody in the group is tagged');
  assert.ok(!t.o || !t.o.quoted, 'the tag does not quote the message');
  assert.ok(!sent.some((s) => s.c.react), 'no reaction is sent');
  assert.strictEqual(sent.length, 1, 'nothing else is sent');
});

test('v1.7.5 autotag: reactions, private chats and the switch command itself never tag', async () => {
  assert.strictEqual(autotag.isOn(GROUP), true);
  const base = { sock, jid: GROUP, isGroup: true, prefix: '.' };
  sent.length = 0;
  assert.strictEqual(await autotag.maybe({ ...base, msg: { key: { id: 'R1' }, message: { reactionMessage: { text: '👍' } } }, text: '' }), false, 'a reaction is nobody writing');
  assert.strictEqual(await autotag.maybe({ ...base, msg: { key: { id: 'R2' }, message: { protocolMessage: { type: 0 } } }, text: '' }), false);
  assert.strictEqual(await autotag.maybe({ ...base, isGroup: false, jid: OWNER, msg: { key: { id: 'R3' }, message: { conversation: 'hi' } }, text: 'hi' }), false, 'private chat');
  assert.strictEqual(await autotag.maybe({ ...base, msg: { key: { id: 'R4' }, message: { conversation: '.autotag off' } }, text: '.autotag off' }), false, 'the switch command');
  assert.strictEqual(await autotag.maybe({ ...base, msg: { key: { id: 'R5' }, message: { imageMessage: {} } }, text: '' }), true, 'a picture is a message');
  assert.strictEqual(tags().length, 1);
});

test('v1.7.5 autotag: switched off again, and it is remembered per group', async () => {
  const other = '120363000000000999@g.us';
  assert.strictEqual(autotag.isOn(other), false, 'another group is not affected');
  const p = store.effectivePrefix();
  sent.length = 0;
  await handler.handleMessage(sock, gm(OWNER, `${p}autotag off`));
  await settle();
  assert.strictEqual(autotag.isOn(GROUP), false);
  assert.strictEqual(tags().length, 0, 'the off command itself did not tag');
  await handler.handleMessage(sock, gm(MEMBER, 'anyone here?'));
  await settle();
  assert.strictEqual(tags().length, 0);
});

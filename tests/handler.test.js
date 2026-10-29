require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const cache = require('../whatsapp/msgcache');
const handler = require('../whatsapp/handler');

baileys.setForTests({});

const OWNER = '27800000001@s.whatsapp.net';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [] }),
};
let n = 0;
const msg = (from, text, extra = {}) => ({ key: { remoteJid: from, id: `M${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };

test('private mode (the default): a stranger gets no reply at all, the owner does', async () => {
  store.setCmdReact('off');
  await handler.handleMessage(sock, msg('27811111111@s.whatsapp.net', '.menu'));
  await settle();
  assert.strictEqual(sent.length, 0);
  await handler.handleMessage(sock, msg(OWNER, '.menu'));
  await settle();
  assert.ok(texts()[0].includes('ᴘɪɴɢ') && !texts()[0].includes('.ping'));
});
test('the menu lists categories alphabetically without emojis', async () => {
  const menu = texts()[0];
  const heads = [...menu.matchAll(/┌─ \*([A-Z]+)\*/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, [...heads].sort());
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(menu));
});
test('public mode: everybody can use commands', async () => {
  store.setMode('public');
  sent.length = 0;
  await handler.handleMessage(sock, msg('27811111111@s.whatsapp.net', '.ping'));
  await settle();
  assert.ok(texts().some((t) => t.includes('Pong')));
  store.setMode('private');
});
test('AFK tells each person once and stays on when the owner writes', async () => {
  sent.length = 0;
  await handler.handleMessage(sock, msg(OWNER, '.afk lunch'));
  await settle();
  sent.length = 0;
  const people = ['27811111111', '27811111111', '27822222222', '27811111111'];
  for (const p of people) await handler.handleMessage(sock, msg(`${p}@s.whatsapp.net`, 'hello'));
  assert.strictEqual(texts().filter((t) => t.includes('AFK')).length, 2);
  await handler.handleMessage(sock, { ...msg(OWNER, 'back soon'), key: { remoteJid: OWNER, id: 'OWN1', fromMe: true } });
  await handler.handleMessage(sock, msg('27833333333@s.whatsapp.net', 'hi'));
  assert.strictEqual(texts().filter((t) => t.includes('AFK')).length, 3);
  await handler.handleMessage(sock, msg(OWNER, '.afk off'));
  await settle();
});
test('anti-edit: an edit wrapped in an envelope is shown with before and after', async () => {
  store.updateWatch('edit', (w) => { w.mode = 'all'; });
  sent.length = 0;
  await handler.handleMessage(sock, msg('27844444444@s.whatsapp.net', 'old text', { key: { remoteJid: '27844444444@s.whatsapp.net', id: 'ORIG', fromMe: false } }));
  await handler.handleMessage(sock, { key: { remoteJid: '27844444444@s.whatsapp.net', id: 'ORIG', fromMe: false }, message: { editedMessage: { message: { protocolMessage: { type: 14, key: { id: 'ORIG' }, editedMessage: { conversation: 'new text' } } } } } });
  await settle();
  const t = texts().find((x) => x.includes('Before'));
  assert.ok(t && t.includes('old text') && t.includes('new text'));
  assert.ok(cache.get('ORIG'));
});
test('a message without content is NOT reported to the owner by default (group events, undecryptable messages, ...)', async () => {
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  delete process.env.EMPTY_NOTICE;
  sent.length = 0;
  for (let i = 0; i < 3; i++) await handler.handleMessage(sock, { key: { remoteJid: '27855555555@s.whatsapp.net', id: `E${i}`, fromMe: false }, messageStubType: 2 });
  await settle();
  assert.strictEqual(texts().filter((t) => t.includes('no content')).length, 0);
});
test('with EMPTY_NOTICE=1 a message without content is reported once (never for stub events)', async () => {
  process.env.EMPTY_NOTICE = '1';
  try {
    sent.length = 0;
    await handler.handleMessage(sock, { key: { remoteJid: '27855555555@s.whatsapp.net', id: 'S1', fromMe: false }, messageStubType: 2 });
    for (let i = 0; i < 3; i++) await handler.handleMessage(sock, { key: { remoteJid: '27855555555@s.whatsapp.net', id: `N${i}`, fromMe: false } });
    await settle();
    assert.strictEqual(texts().filter((t) => t.includes('no content')).length, 1);
  } finally {
    delete process.env.EMPTY_NOTICE;
  }
});

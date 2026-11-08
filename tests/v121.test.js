// v1.2.1: the introduction waits for the verification, and the verification time can be set in seconds, minutes or hours.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const store = require('../whatsapp/store');
const captcha = require('../whatsapp/captcha');
const events = require('../whatsapp/events');

const GROUP = '120363000000000121@g.us';
const BOT = '27800000099@s.whatsapp.net';
let n = 0;

function makeSock() {
  const sent = [];
  return {
    sent,
    user: { id: BOT },
    sendMessage: async (jid, content) => { sent.push(content); return {}; },
    groupParticipantsUpdate: async () => [],
    groupMetadata: async () => ({ id: GROUP, subject: 'Test Group', participants: [{ id: BOT }, { id: '27811110001@s.whatsapp.net' }] }),
  };
}
const texts = (sock) => sock.sent.map((c) => c.text || c.caption || '');
const settle = () => new Promise((r) => setTimeout(r, 60));

test('captcha time: seconds, minutes and hours are understood, 30 seconds to 1 hour', () => {
  assert.strictEqual(captcha.parseSeconds('90'), 90);
  assert.strictEqual(captcha.parseSeconds('90s'), 90);
  assert.strictEqual(captcha.parseSeconds('5m'), 300);
  assert.strictEqual(captcha.parseSeconds('2m30s'), 150);
  assert.strictEqual(captcha.parseSeconds('1h'), 3600);
  assert.strictEqual(captcha.parseSeconds('29'), null);
  assert.strictEqual(captcha.parseSeconds('2h'), null);
  assert.strictEqual(captcha.parseSeconds('abc'), null);
  assert.strictEqual(captcha.parseSeconds(''), null);
  assert.strictEqual(captcha.words(90), '90 seconds');
  assert.strictEqual(captcha.words(300), '5 minutes');
  assert.strictEqual(captcha.words(3600), '1 hour');
  assert.strictEqual(captcha.words(150), '2 minutes 30 seconds');
});

test('verification ON: the introduction is held back until the sum is answered', async () => {
  store.update(GROUP, (g) => { g.captcha = true; g.captchaSeconds = 300; g.welcome = false; g.intro.on = true; g.intro.text = 'Hello @user, tell us about you in {time}'; g.intro.timeMs = 3600000; });
  const sock = makeSock();
  const newbie = '27811110001@s.whatsapp.net';
  await events.handleParticipants(sock, { id: GROUP, action: 'add', participants: [newbie], author: null });
  await settle();
  const first = texts(sock);
  assert.ok(first.some((t) => /Quick puzzle/.test(t)), 'the question is asked');
  assert.ok(first.some((t) => /5 minutes/.test(t)), 'the time is shown in words');
  assert.ok(!first.some((t) => /tell us about you/.test(t)), 'no introduction yet');

  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(first.find((t) => /Quick puzzle/.test(t)));
  const msg = (text) => ({ key: { remoteJid: GROUP, participant: newbie, id: `V${++n}` }, message: { conversation: text } });
  const wrong = String(Number(a) + Number(b) + 1);
  captcha.check(sock, msg(wrong), GROUP, wrong, []);
  await settle();
  assert.ok(!texts(sock).some((t) => /tell us about you/.test(t)), 'a wrong answer does not release the introduction');

  const right = String(Number(a) + Number(b));
  assert.strictEqual(captcha.check(sock, msg(right), GROUP, right, []), true);
  await settle();
  const all = texts(sock);
  const iVerified = all.findIndex((t) => /solved the puzzle/.test(t));
  const iIntro = all.findIndex((t) => /tell us about you in 1 hour/.test(t));
  assert.ok(iVerified >= 0 && iIntro > iVerified, 'the introduction follows the verified message');
  assert.strictEqual(captcha.pending.size, 0);
});

test('verification ON: a member who fails never gets the introduction', async () => {
  const sock = makeSock();
  const newbie = '27811110002@s.whatsapp.net';
  await events.handleParticipants(sock, { id: GROUP, action: 'add', participants: [newbie], author: null });
  await settle();
  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(texts(sock).find((t) => /Quick puzzle/.test(t)));
  const wrong = String(Number(a) + Number(b) + 1);
  const msg = () => ({ key: { remoteJid: GROUP, participant: newbie, id: `W${++n}` }, message: { conversation: wrong } });
  for (let i = 0; i < 3; i++) captcha.check(sock, msg(), GROUP, wrong, []);
  await settle();
  assert.ok(texts(sock).some((t) => /was removed/.test(t)));
  assert.ok(!texts(sock).some((t) => /tell us about you/.test(t)));
});

test('verification OFF: the introduction is sent at once, as before', async () => {
  store.update(GROUP, (g) => { g.captcha = false; });
  const sock = makeSock();
  await events.handleParticipants(sock, { id: GROUP, action: 'add', participants: ['27811110003@s.whatsapp.net'], author: null });
  await settle();
  assert.ok(texts(sock).some((t) => /tell us about you/.test(t)));
});

test('the Empire of Fex is gone: no files, no commands, no bets', () => {
  const fs = require('fs');
  const path = require('path');
  assert.ok(!fs.existsSync(path.join(__dirname, '../core/realm')));
  for (const f of ['careers', 'estates', 'god', 'government', 'inventory', 'market', 'realm', 'society', 'trade']) assert.ok(!fs.existsSync(path.join(__dirname, `../commands/${f}.js`)), f);
  const handler = require('../whatsapp/handler');
  for (const c of ['purse', 'daily', 'realm', 'fish', 'career', 'work', 'guild', 'dungeon', 'auction', 'election', 'god']) assert.ok(!handler.resolveCommand(c), `${c} is removed`);
  const duel = require('../whatsapp/play/duel');
  assert.ok(!('settle' in duel));
});

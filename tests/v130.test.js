require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const captcha = require('../whatsapp/captcha');

const G = '120363000000000130@g.us';
const make = () => {
  const sent = [];
  const removed = [];
  return {
    sent, removed,
    sendMessage: async (jid, c) => { sent.push(c); return {}; },
    groupParticipantsUpdate: async (g, ids, act) => { removed.push([act, ...ids]); return []; },
  };
};

test('v1.3.0: the verification message says what it is, why, and what happens if it is ignored', async () => {
  const sock = make();
  await captcha.onJoin(sock, G, ['27833000001@s.whatsapp.net'], { captcha: true, captchaSeconds: 300 });
  const q = sock.sent.at(-1).text;
  assert.match(q, /What is this\?[\s\S]*real person[\s\S]*spam bot/);
  assert.match(q, /What to do/);
  assert.match(q, /5 minutes/);
  assert.match(q, /removed from the group/);
  for (const v of captcha.pending.values()) { clearTimeout(v.timer); v.reminders.forEach(clearTimeout); }
  captcha.pending.clear();
});

test('v1.3.0: reminder times depend on the time the admins set', () => {
  assert.deepStrictEqual(captcha.reminderPoints(60), [30]);
  assert.deepStrictEqual(captcha.reminderPoints(300), [150, 240]);
  assert.deepStrictEqual(captcha.reminderPoints(3600), [1800, 3540]);
});

test('v1.3.0: reminders on the way, then the person is tagged and gets 1 extra minute, then is removed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sock = make();
  const jid = '27833000002@s.whatsapp.net';
  await captcha.onJoin(sock, G, [jid], { captcha: true, captchaSeconds: 300 });
  const key = [...captcha.pending.keys()].find((k) => k.endsWith(jid.split('@')[0]) || captcha.pending.get(k).jid === jid);
  assert.ok(key);
  assert.strictEqual(sock.sent.length, 1);

  t.mock.timers.tick(150 * 1000); // halfway
  assert.strictEqual(sock.sent.length, 2);
  assert.match(sock.sent[1].text, /Reminder[\s\S]*2 minutes 30 seconds left[\s\S]* = \?/);
  assert.deepStrictEqual(sock.sent[1].mentions, [jid]);

  t.mock.timers.tick(90 * 1000); // 1 minute left
  assert.strictEqual(sock.sent.length, 3);
  assert.match(sock.sent[2].text, /Reminder[\s\S]*60 seconds left/);

  t.mock.timers.tick(60 * 1000); // time is up: tag + 1 extra minute, nobody removed yet
  assert.strictEqual(sock.sent.length, 4);
  assert.match(sock.sent[3].text, /Time is up[\s\S]*1 extra minute/);
  assert.deepStrictEqual(sock.sent[3].mentions, [jid]);
  assert.strictEqual(sock.removed.length, 0);
  assert.ok(captcha.pending.has(key), 'still open during the extra minute');

  t.mock.timers.tick(59 * 1000);
  assert.strictEqual(sock.removed.length, 0, 'the extra minute is a full minute');
  t.mock.timers.tick(2 * 1000);
  await Promise.resolve(); await Promise.resolve();
  assert.deepStrictEqual(sock.removed.at(-1), ['remove', jid]);
  assert.ok(!captcha.pending.has(key));
});

test('v1.3.0: a right answer during the extra minute still verifies the person', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const sock = make();
  const jid = '27833000003@s.whatsapp.net';
  await captcha.onJoin(sock, G, [jid], { captcha: true, captchaSeconds: 60 });
  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(sock.sent[0].text);
  t.mock.timers.tick(61 * 1000);
  assert.match(sock.sent.at(-1).text, /Time is up/);
  const answer = String(Number(a) + Number(b));
  const msg = { key: { remoteJid: G, participant: jid, id: 'X130' }, message: { conversation: answer } };
  assert.strictEqual(captcha.check(sock, msg, G, answer, []), true);
  assert.match(sock.sent.at(-1).text, /Yay, you did it/);
  t.mock.timers.tick(120 * 1000);
  assert.strictEqual(sock.removed.length, 0, 'verified people are never removed');
});

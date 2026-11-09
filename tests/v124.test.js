// v1.2.4: no more "Finished syncing" notices from automatic placeholder resend requests.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const placeholder = require('../core/placeholder');

test('the library is told every message was already asked for (nothing reaches the phone)', async () => {
  assert.strictEqual(await placeholder.cache.get('ABC123'), true);
  placeholder.cache.set('ABC123', { a: 1 }); // the library tries to remember it: ignored
  assert.strictEqual(await placeholder.cache.get('ABC123'), true);
});

test('the view-once watcher may ask a few times per hour, then the limit says no', async () => {
  const before = placeholder.used();
  const granted = [];
  for (let i = 0; i < placeholder.PER_HOUR + 3; i++) granted.push(placeholder.allow(`VO${i}`));
  assert.strictEqual(granted.filter(Boolean).length, Math.max(0, placeholder.PER_HOUR - before));
  const ok = `VO0`;
  if (granted[0]) {
    assert.strictEqual(await placeholder.cache.get(ok), undefined, 'the allowed message really goes to the phone');
    placeholder.cache.set(ok, { a: 1 });
    assert.deepStrictEqual(await placeholder.cache.get(ok), { a: 1 }, 'and the library can follow it');
    placeholder.cache.del(ok);
    assert.strictEqual(await placeholder.cache.get(ok), true);
  }
});

test('the socket is created with that cache', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../whatsapp/connection.js'), 'utf8');
  assert.match(src, /placeholderResendCache: placeholder\.cache/);
});

test('phone notifications: the bot goes offline after typing, and phonepush fix turns the culprits off', async () => {
  const store = require('../whatsapp/store');
  const presence = require('../whatsapp/presence');
  const sent = [];
  const sock = { sendPresenceUpdate: async (kind) => { sent.push(kind); }, presenceSubscribe: async () => {} };
  presence.timing.pause = presence.timing.step = presence.timing.tail = 1;
  store.setAuto('online', false);
  await presence.indicate(sock, '27811110000@s.whatsapp.net', 'composing', { hold: 5 });
  assert.strictEqual(sent.at(-1), 'unavailable');
  sent.length = 0;
  store.setAuto('online', true);
  await presence.indicate(sock, '27811110000@s.whatsapp.net', 'composing', { hold: 5 });
  assert.notStrictEqual(sent.at(-1), 'unavailable', 'always online stays online');

  const cmd = require('../commands/automation').find((c) => c.name === 'phonepush');
  store.setAuto('read', true);
  const out = [];
  await cmd.run({ args: [], reply: async (t) => out.push(t), prefix: '.', sock });
  assert.match(out[0], /Always online:\* ON/);
  assert.match(out[0], /Auto read:\* ON/);
  await cmd.run({ args: ['fix'], reply: async (t) => out.push(t), prefix: '.', sock });
  assert.strictEqual(store.getAuto('online'), false);
  assert.strictEqual(store.getAuto('read'), false);
  assert.ok(sent.includes('unavailable'));
});

test('delcmd: the command message in a group is deleted after the answer', async () => {
  const store = require('../whatsapp/store');
  const cleanup = require('../whatsapp/cmdcleanup');
  cleanup.timing.wait = 1;
  const deleted = [];
  const sock = { sendMessage: async (jid, c) => { if (c.delete) deleted.push(c.delete); return {}; } };
  const G = '120363000000000140@g.us';
  const wait = () => new Promise((r) => setTimeout(r, 30));
  store.setAuto('delcmd', 'own');
  assert.strictEqual(cleanup.afterCommand(sock, { key: { remoteJid: G, id: 'A1', fromMe: true } }, {}), true);
  assert.strictEqual(cleanup.afterCommand(sock, { key: { remoteJid: G, id: 'A2', fromMe: false, participant: '2781@s.whatsapp.net' } }, { isBotAdmin: true }), false, 'members are left alone in "own"');
  store.setAuto('delcmd', 'all');
  assert.strictEqual(cleanup.afterCommand(sock, { key: { remoteJid: G, id: 'A3', fromMe: false, participant: '2781@s.whatsapp.net' } }, { isBotAdmin: true }), true);
  assert.strictEqual(cleanup.afterCommand(sock, { key: { remoteJid: G, id: 'A4', fromMe: false, participant: '2781@s.whatsapp.net' } }, { isBotAdmin: false }), false, 'a bot that is no admin cannot');
  store.setAuto('delcmd', 'off');
  assert.strictEqual(cleanup.afterCommand(sock, { key: { remoteJid: G, id: 'A5', fromMe: true } }, {}), false);
  await wait();
  assert.deepStrictEqual(deleted.map((k) => k.id), ['A1', 'A3']);
  assert.strictEqual(deleted[1].participant, '2781@s.whatsapp.net');
  store.setAuto('delcmd', 'own');
});

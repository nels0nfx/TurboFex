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

test('the version is 1.2.7', () => {
  assert.strictEqual(require('../package.json').version, '1.2.7');
});

test('delcmd: the command and the bot answers are deleted after the answer, games never', async () => {
  const store = require('../whatsapp/store');
  const cleanup = require('../whatsapp/cmdcleanup');
  cleanup.timing.wait = 1;
  store.setAuto('delcmdTime', 5);
  const deleted = [];
  const sock = { sendMessage: async (jid, c) => { if (c.delete) deleted.push(c.delete); return {}; } };
  const G = '120363000000000140@g.us';
  const own = (id) => ({ key: { remoteJid: G, id, fromMe: true } });
  const member = (id) => ({ key: { remoteJid: G, id, fromMe: false, participant: '2781@s.whatsapp.net' } });
  const cmd = { name: 'sticker', category: 'media' };
  store.setAuto('delcmd', 'own');
  store.setAuto('delcmdReply', true);
  assert.strictEqual(cleanup.afterCommand(sock, own('A1'), { cmd, replies: [{ id: 'R1' }, { id: 'R2' }] }), true);
  assert.strictEqual(cleanup.afterCommand(sock, member('A2'), { cmd, isBotAdmin: true, replies: [{ id: 'R3' }] }), false, 'members are left alone in "own"');
  assert.strictEqual(cleanup.afterCommand(sock, own('A3'), { cmd: { name: 'tictactoe', category: 'games' }, replies: [{ id: 'R4' }] }), false, 'games are left alone');
  assert.strictEqual(cleanup.afterCommand(sock, own('A4'), { cmd: { name: 'pet', category: 'fun' }, replies: [{ id: 'R5' }] }), false);
  store.setAuto('delcmd', 'all');
  assert.strictEqual(cleanup.afterCommand(sock, member('A5'), { cmd, isBotAdmin: true, replies: [{ id: 'R6' }] }), true);
  assert.strictEqual(cleanup.afterCommand(sock, member('A6'), { cmd, isBotAdmin: false, replies: [] }), false, 'a bot that is no admin cannot delete a member message');
  store.setAuto('delcmdReply', false);
  assert.strictEqual(cleanup.afterCommand(sock, own('A7'), { cmd, replies: [{ id: 'R7' }] }), true);
  store.setAuto('delcmd', 'off');
  assert.strictEqual(cleanup.afterCommand(sock, own('A8'), { cmd, replies: [] }), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(deleted.map((k) => k.id).sort(), ['A1', 'A5', 'A7'], 'the commands go first');
  await new Promise((r) => setTimeout(r, 5200));
  assert.deepStrictEqual(deleted.map((k) => k.id).sort(), ['A1', 'A5', 'A7', 'R1', 'R2', 'R6'], 'the answers follow after the set time (R7: answers are kept)');
  assert.ok(deleted.filter((k) => /^R/.test(k.id)).every((k) => k.fromMe === true));
  store.setAuto('delcmd', 'own');
  store.setAuto('delcmdReply', true);
  store.setAuto('delcmdTime', 60);
});

test('delcmd time: seconds, minutes and hours, 5 seconds to 1 hour; polls stay', () => {
  const cleanup = require('../whatsapp/cmdcleanup');
  assert.strictEqual(cleanup.parseTime('30'), 30);
  assert.strictEqual(cleanup.parseTime('2m'), 120);
  assert.strictEqual(cleanup.parseTime('1h'), 3600);
  assert.strictEqual(cleanup.parseTime('4'), null);
  assert.strictEqual(cleanup.parseTime('2h'), null);
  assert.strictEqual(cleanup.parseTime('soon'), null);
  assert.strictEqual(cleanup.keeps({ poll: {} }), true);
  assert.strictEqual(cleanup.keeps({ text: 'hi' }), false);
});

test('delcmd: the command works', async () => {
  const store = require('../whatsapp/store');
  const cmd = require('../commands/automation').find((c) => c.name === 'delcmd');
  const out = [];
  const run = (rest) => cmd.run({ args: rest.split(' '), reply: async (t) => out.push(t), prefix: '.' });
  await run('time 2m');
  assert.strictEqual(store.getAuto('delcmdTime'), 120);
  await run('time 1');
  assert.match(out.at(-1), /5 seconds to 1 hour/);
  await run('reply off');
  assert.strictEqual(store.getAuto('delcmdReply'), false);
  await run('reply on');
  await run('all');
  assert.strictEqual(store.getAuto('delcmd'), 'all');
  await run('own');
  store.setAuto('delcmdTime', 60);
});

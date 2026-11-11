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

test('the version is 1.4.1', () => {
  assert.strictEqual(require('../package.json').version, '1.4.1');
});

test('delcmd: the command and the bot answers are deleted after the answer, games never', async () => {
  const store = require('../whatsapp/store');
  const cleanup = require('../whatsapp/cmdcleanup');
  cleanup.timing.wait = 1;
  store.setAuto('delcmdTime', 2);
  const deleted = [];
  const sock = { sendMessage: async (jid, c) => { if (c.delete) deleted.push(c.delete); return {}; } };
  const G = '120363000000000140@g.us';
  const own = (id) => ({ key: { remoteJid: G, id, fromMe: true } });
  const member = (id) => ({ key: { remoteJid: G, id, fromMe: false, participant: '2781@s.whatsapp.net' } });
  const cmd = { name: 'antilink', category: 'group' };
  store.setAuto('delcmd', 'own');
  store.setAuto('delcmdReply', true);
  assert.strictEqual(cleanup.afterCommand(sock, own('A1'), { cmd, hasArgs: true, replies: [{ id: 'R1' }, { id: 'R2' }] }), true);
  assert.strictEqual(cleanup.afterCommand(sock, member('A2'), { cmd, hasArgs: true, isBotAdmin: true, replies: [{ id: 'R3' }] }), false, 'members are left alone in "own"');
  assert.strictEqual(cleanup.afterCommand(sock, own('A3'), { cmd: { name: 'tictactoe', category: 'games' }, replies: [{ id: 'R4' }] }), false, 'games are left alone');
  assert.strictEqual(cleanup.afterCommand(sock, own('A4'), { cmd: { name: 'pet', category: 'fun' }, replies: [{ id: 'R5' }] }), false);
  store.setAuto('delcmd', 'all');
  assert.strictEqual(cleanup.afterCommand(sock, member('A5'), { cmd, hasArgs: true, isBotAdmin: true, replies: [{ id: 'R6' }] }), true);
  assert.strictEqual(cleanup.afterCommand(sock, member('A6'), { cmd, hasArgs: true, isBotAdmin: false, replies: [] }), false, 'a bot that is no admin cannot delete a member message');
  store.setAuto('delcmdReply', false);
  assert.strictEqual(cleanup.afterCommand(sock, own('A7'), { cmd, hasArgs: true, replies: [{ id: 'R7' }] }), true);
  store.setAuto('delcmd', 'off');
  assert.strictEqual(cleanup.afterCommand(sock, own('A8'), { cmd, hasArgs: true, replies: [] }), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(deleted.map((k) => k.id).sort(), ['A1', 'A5', 'A7'], 'the commands go first');
  await new Promise((r) => setTimeout(r, 2300));
  assert.deepStrictEqual(deleted.map((k) => k.id).sort(), ['A1', 'A5', 'A7', 'R1', 'R2', 'R6'], 'the answers follow after the set time (R7: answers are kept)');
  assert.ok(deleted.filter((k) => /^R/.test(k.id)).every((k) => k.fromMe === true));
  store.setAuto('delcmd', 'own');
  store.setAuto('delcmdReply', true);
  store.setAuto('delcmdTime', 1);
});

test('delcmd time: seconds, minutes and hours, 1 second to 1 hour; polls stay', () => {
  const cleanup = require('../whatsapp/cmdcleanup');
  assert.strictEqual(cleanup.parseTime('30'), 30);
  assert.strictEqual(cleanup.parseTime('2m'), 120);
  assert.strictEqual(cleanup.parseTime('1h'), 3600);
  assert.strictEqual(cleanup.parseTime('1'), 1);
  assert.strictEqual(cleanup.parseTime('0'), null);
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
  await run('time 0');
  assert.match(out.at(-1), /1 second to 1 hour/);
  assert.strictEqual(store.getAuto('delcmdTime'), 120);
  await run('time 1');
  assert.strictEqual(store.getAuto('delcmdTime'), 1);
  await run('reply off');
  assert.strictEqual(store.getAuto('delcmdReply'), false);
  await run('off');
  await run('all');
  assert.strictEqual(store.getAuto('delcmdReply'), true, 'turning the clean-up on also turns the answers on');
  assert.strictEqual(store.getAuto('delcmd'), 'all');
  await run('own');
  assert.strictEqual(require('../whatsapp/cmdcleanup').DEFAULT_TIME, 1, 'as soon as possible by default');
  store.setAuto('delcmdTime', 1);
});

test('delcmd: only settings commands are cleaned, not menu, ping, rules or a panel', () => {
  const cleanup = require('../whatsapp/cmdcleanup');
  const c = (name, category = 'group') => ({ name, category });
  for (const n of ['menu', 'ping', 'rules', 'rank', 'tagall', 'hidetag', 'sticker', 'play', 'groupinfo', 'kick', 'warn', 'status', 'stats']) assert.strictEqual(cleanup.isCleaned(c(n), true), false, `${n} stays`);
  for (const n of ['antilink', 'setrules', 'captcha', 'welcome', 'setwelcome', 'intro', 'slowmode', 'autoread', 'delcmd', 'setapi']) {
    assert.strictEqual(cleanup.isCleaned(c(n), true), true, `${n} with text is cleaned`);
    assert.strictEqual(cleanup.isCleaned(c(n), false), false, `${n} alone shows a panel: it stays`);
  }
  for (const n of ['open', 'close', 'lock', 'unlock', 'lockdown']) assert.strictEqual(cleanup.isCleaned(c(n), false), true, `${n} is a switch`);
  assert.strictEqual(cleanup.isCleaned(c('tictactoe', 'games'), true), false);
});

test('delcmd list / add / remove: the owner can adjust what is cleaned', async () => {
  const store = require('../whatsapp/store');
  const cleanup = require('../whatsapp/cmdcleanup');
  const cmds = require('fs').readdirSync(require('path').join(__dirname, '../commands')).filter((f) => f.endsWith('.js')).flatMap((f) => require(`../commands/${f}`));
  const cmd = cmds.find((c) => c.name === 'delcmd');
  const out = [];
  const run = (rest) => cmd.run({ args: rest.split(' '), reply: async (t) => out.push(t), prefix: '.', commandList: cmds });
  await run('add tagall');
  assert.strictEqual(cleanup.isCleaned({ name: 'tagall', category: 'group' }, false), true);
  await run('remove captcha');
  assert.strictEqual(cleanup.isCleaned({ name: 'captcha', category: 'group' }, true), false);
  await run('add tictactoe');
  assert.match(out.at(-1), /Games are never cleaned/);
  await run('list');
  assert.match(out.at(-1), /Added by you[\s\S]*tagall/);
  assert.match(out.at(-1), /Left alone by you[\s\S]*captcha/);
  await run('remove tagall');
  await run('add captcha');
  assert.strictEqual(cleanup.isCleaned({ name: 'captcha', category: 'group' }, true), true);
  store.setAuto('delcmdAdd', []);
  store.setAuto('delcmdSkip', []);
});

test('v1.3.0: the seen list spaces its writes by the cost of the last save, and is always written on stop', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'whatsapp', 'seen.js'), 'utf8');
  assert.match(src, /nextAt/);
  assert.match(src, /onFlushSync\(saveNow\)/, 'a stop writes it at once, whatever the spacing');
  const seen = require('../whatsapp/seen');
  assert.strictEqual(seen.check('a@g.us', 'v130-1'), false);
  assert.strictEqual(seen.check('a@g.us', 'v130-1'), true);
  seen.saveNow();
  assert.ok(require('fs').readFileSync(require('path').join(process.env.TURBOFEX_DATA, 'seen.json'), 'utf8').includes('v130-1'));
});

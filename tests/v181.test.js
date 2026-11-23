require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const ignored = require('../whatsapp/ignored');
const warm = require('../whatsapp/warm');
const pairing = require('../core/pairing');
const accounts = require('../core/accounts');

baileys.setForTests({});
console.log = () => {};
console.error = () => {};

const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const BOT = '27899999999@s.whatsapp.net';
const G = '120363000000000174@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async (j) => ({ id: j, subject: 'Football Fans', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }] }),
  groupFetchAllParticipating: async () => ({ [G]: { id: G, subject: 'Football Fans', participants: [] } }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {},
};
let n = 0;
const now = () => Math.floor(Date.now() / 1000);
const dm = (who, t) => ({ key: { remoteJid: who, id: `D${++n}`, fromMe: false }, message: { conversation: t }, messageTimestamp: now() });
const gm = (who, t) => ({ key: { remoteJid: G, participant: who, id: `G${++n}`, fromMe: false }, message: { conversation: t }, messageTimestamp: now() });
const say = async (msg) => {
  sent.length = 0;
  await handler.handleMessage(sock, msg);
  await handler.idle();
  await new Promise((r) => setTimeout(r, 40));
  return sent.filter((x) => x.c.text).map((x) => x.c.text.split('\n')[0]);
};
const P = () => store.effectivePrefix();

// ------------------------------------------------------------------ ignore a chat
test('v1.8.1 ignore: in an ignored group nobody but the owner gets anything', async () => {
  store.setMode('public');
  ignored.set(G, false);
  assert.match((await say(gm(MEMBER, `${P()}ping`)))[0], /Checking|Pong/, 'before: the bot answers a member');

  assert.match((await say(gm(OWNER, `${P()}ignore on`)))[0], /now ignored/);
  assert.strictEqual(ignored.isIgnored(G), true);

  assert.deepStrictEqual(await say(gm(MEMBER, `${P()}ping`)), [], 'a member\'s command: nothing');
  assert.deepStrictEqual(await say(gm(MEMBER, 'hello everyone')), [], 'a member\'s message: nothing');
  assert.match((await say(gm(OWNER, `${P()}ping`)))[0], /Checking|Pong/, 'the owner\'s commands still work');
});

test('v1.8.1 ignore: repeating it says so, and "off" brings the bot back', async () => {
  assert.match((await say(gm(OWNER, `${P()}ignore on`)))[0], /already ignored/);
  assert.match((await say(gm(OWNER, `${P()}ignore off`)))[0], /no longer ignored/);
  assert.match((await say(gm(OWNER, `${P()}ignore off`)))[0], /not ignored/);
  assert.match((await say(gm(MEMBER, `${P()}ping`)))[0], /Checking|Pong/, 'the bot works again for members');
});

test('v1.8.1 ignore: only the owner can use it', async () => {
  await say(gm(MEMBER, `${P()}ignore on`));
  assert.strictEqual(ignored.isIgnored(G), false);
});

test('v1.8.1 ignore: from a private chat a group (number or name) or a phone number can be chosen, and "list" shows them', async () => {
  assert.match((await say(dm(OWNER, `${P()}ignore on 1`)))[0], /Football Fans is now ignored/);
  assert.strictEqual(ignored.isIgnored(G), true);
  assert.match((await say(dm(OWNER, `${P()}ignore on 27822222222`)))[0], /27822222222 is now ignored/);
  assert.strictEqual(ignored.isIgnored('27822222222@s.whatsapp.net'), true);
  const list = (await say(dm(OWNER, `${P()}ignore list`))).join(' ');
  assert.match(list, /Ignored chats \(2\)/);
  assert.deepStrictEqual(await say(dm('27822222222@s.whatsapp.net', `${P()}ping`)), [], 'that person gets nothing in private either');
  assert.match((await say(dm(OWNER, `${P()}ignore off Football`)))[0], /no longer ignored/);
  await say(dm(OWNER, `${P()}ignore off 27822222222`));
  assert.deepStrictEqual(ignored.list(), []);
  assert.match((await say(dm(OWNER, `${P()}ignore on 99`)))[0], /could not find/);
});

test('v1.8.1 ignore: a private chat is the same chat in both of WhatsApp\'s addresses', () => {
  const idmap = require('../whatsapp/idmap');
  idmap.learnKey({ remoteJid: '555666777888@lid', remoteJidAlt: '27833333333@s.whatsapp.net' });
  assert.strictEqual(ignored.keyOf('555666777888@lid'), ignored.keyOf('27833333333@s.whatsapp.net'));
});

// ------------------------------------------------------------------ the first ping after a break (keep warm)
test('v1.8.1 warm: only the chats in use are refreshed, newest first, at most 8, groups with all their members', async () => {
  for (let i = 0; i < 12; i++) warm.touch(`2780000${String(1000 + i)}@s.whatsapp.net`);
  warm.touch(G);
  const calls = [];
  const fake = { user: { id: '27899999999:1@s.whatsapp.net' }, getUSyncDevices: async (ids, useCache, ignoreZero) => { calls.push({ ids, useCache, ignoreZero }); } };
  await require('../whatsapp/metadata').getMeta(sock, G); // the group's members are known
  await warm.tick(fake, 0);
  assert.strictEqual(calls.length, warm.MAX_CHATS, 'at most 8 chats');
  assert.ok(calls.every((c) => c.useCache === false), 'it asks WhatsApp, it does not read its own memory');
  const group = calls.find((c) => c.ids.length > 2);
  assert.ok(group && group.ids.includes(OWNER) && group.ids.includes(MEMBER), 'a group is refreshed with its members');
  const priv = calls.find((c) => c.ids.length === 2);
  assert.ok(priv.ids.includes('27899999999:1@s.whatsapp.net'), 'a private chat: the person and my own devices');
});

test('v1.8.1 warm: a failing or missing library call never breaks anything', async () => {
  const bad = { user: { id: BOT }, getUSyncDevices: async () => { throw new Error('boom'); } };
  warm.touch('27800009999@s.whatsapp.net');
  await warm.tick(bad, 0);
  assert.ok(warm.stats.failed >= 1);
  const none = { user: { id: BOT } };
  await warm.tick(none, 0);
  assert.strictEqual(warm.stats.unsupported, true);
});

test('v1.8.1 warm: commands and the owner mark a chat as in use, and the timer starts and stops', async () => {
  await say(gm(OWNER, `${P()}ping`));
  assert.ok(warm.chats().includes(G));
  warm.start({ user: { id: BOT } });
  warm.stop();
});

test('v1.8.1 warm: the device list is remembered for 3 hours and kept fresh every 15 minutes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp', 'connection.js'), 'utf8');
  assert.match(src, /userDevicesCache: makeCache\(3 \* 3600 \* 1000\)/);
  assert.match(src, /require\('\.\/warm'\)\.start\(sock\)/);
  assert.strictEqual(warm.EVERY_MS, 15 * 60 * 1000);
});

// ------------------------------------------------------------------ pair for somebody else
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pair181-'));
const readAccounts = (root) => JSON.parse(fs.readFileSync(path.join(root, 'accounts.json'), 'utf8'));

test('v1.8.1 pair: a new number becomes an account that links itself with a code, and the main bot stays', () => {
  const root = tmpRoot();
  const r = pairing.start(root, '27811111111', '27899999999');
  assert.deepStrictEqual({ s: r.status, name: r.name, once: r.restartsOnce }, { s: 'started', name: 'p27811111111', once: true });
  assert.deepStrictEqual(readAccounts(root).accounts, [{ name: 'main' }, { name: 'p27811111111', number: '27811111111', link: 'code' }]);
  // the same number again: it is waiting, not added twice
  const again = pairing.start(root, '27811111111', '27899999999');
  assert.strictEqual(again.status, 'waiting');
  assert.strictEqual(readAccounts(root).accounts.length, 2);
  // the bot's own number is refused
  assert.strictEqual(pairing.start(root, '27899999999', '27899999999').status, 'own');
});

test('v1.8.1 pair: an existing accounts.json is kept and added to (and a damaged one is not touched)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify({ accounts: [{ name: 'main' }, { name: 'shop', prefix: '!' }] }));
  const r = pairing.start(root, '27822222222', '');
  assert.strictEqual(r.restartsOnce, false, 'several accounts already: no restart');
  assert.deepStrictEqual(readAccounts(root).accounts.map((a) => a.name), ['main', 'shop', 'p27822222222']);
  assert.strictEqual(readAccounts(root).accounts[1].prefix, '!');
  const bad = tmpRoot();
  fs.writeFileSync(path.join(bad, 'accounts.json'), '{ not json');
  assert.strictEqual(pairing.start(bad, '27833333333', '').status, 'broken');
  assert.strictEqual(fs.readFileSync(path.join(bad, 'accounts.json'), 'utf8'), '{ not json');
});

test('v1.8.1 pair: the new account is started to link with a pairing code for its number, and owns itself', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify({ accounts: [{ name: 'main' }, { name: 'p27811111111', number: '27811111111', link: 'code' }] }));
  const plan = accounts.load(root, {});
  const acc = plan.accounts.find((a) => a.name === 'p27811111111');
  assert.strictEqual(acc.link, 'code');
  const env = accounts.envFor(acc, 1, {});
  assert.strictEqual(env.CONSOLE_LINK, '1');
  assert.strictEqual(env.PAIR_METHOD, 'code');
  assert.strictEqual(env.NUMBER, '27811111111');
  assert.strictEqual(env.OWNER_NUMBER, '', 'the person becomes the owner of their own bot');
  const main = accounts.envFor(plan.accounts.find((a) => a.main), 0, {});
  assert.ok(!main.CONSOLE_LINK, 'the main bot is not changed');
});

test('v1.8.1 pair: the code, then "linked", reach the owner\'s private chat (and only there)', async () => {
  const root = tmpRoot();
  const name = 'p27811111111';
  const dataDir = path.join(root, 'accounts', name, 'data');
  const pairflow = require('../whatsapp/pairflow');
  sent.length = 0;
  const done = pairflow.begin(sock, name, '27811111111', { root, intervalMs: 15, maxMs: 4000 });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(sent.length, 0, 'nothing before the account has a code');
  pairing.note(dataDir, 'code', { code: 'ABCD-EFGH', number: '27811111111' }); // what the new account writes
  await new Promise((r) => setTimeout(r, 120));
  const codeMsg = sent.find((x) => /ABCD-EFGH/.test(x.c.text || ''));
  assert.ok(codeMsg, 'the owner gets the code');
  assert.ok(!String(codeMsg.j).endsWith('@g.us'), 'never to a group');
  assert.match(codeMsg.c.text, /Link with phone number instead/);
  // the person enters the code: the login is saved
  fs.mkdirSync(path.join(root, 'accounts', name, 'session'), { recursive: true });
  fs.writeFileSync(path.join(root, 'accounts', name, 'session', 'creds.json'), JSON.stringify({ registered: true }));
  assert.strictEqual(await done, 'linked');
  assert.ok(sent.some((x) => /is linked/.test(x.c.text || '')));
});

test('v1.8.1 pair: a refused code and a code nobody entered are told to the owner', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const r1 = tmpRoot();
  pairing.note(path.join(r1, 'accounts', 'p27811111112', 'data'), 'refused', { number: '27811111112' });
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, 'p27811111112', '27811111112', { root: r1, intervalMs: 10, maxMs: 500 }), 'refused');
  assert.ok(sent.some((x) => /refused the pairing code/.test(x.c.text || '')));
  const r2 = tmpRoot();
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, 'p27811111113', '27811111113', { root: r2, intervalMs: 10, maxMs: 120 }), 'timeout');
  assert.ok(sent.some((x) => /not linked yet/.test(x.c.text || '')));
});

test('v1.8.1 pair: the new account reports its code, and "linked" when it comes online', () => {
  const dir = tmpRoot();
  pairing.note(dir, 'code', { code: 'WXYZ-1234' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pairing-status.json'), 'utf8')).code, 'WXYZ-1234');
  pairing.noteOnline(dir, '27811111111');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pairing-status.json'), 'utf8')).state, 'linked');
  const none = tmpRoot();
  pairing.noteOnline(none, '27800000000'); // an ordinary start: no status file is made
  assert.strictEqual(fs.existsSync(path.join(none, 'pairing-status.json')), false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp', 'connection.js'), 'utf8');
  assert.match(src, /pairing'\)\.note\(DATA, 'code'/);
  assert.match(src, /pairing'\)\.noteOnline\(DATA/);
});

test('v1.8.1 pair: the command checks the number and answers the owner (nothing is really created)', async () => {
  const calls = [];
  pairing.start = (root, number, own) => { calls.push(number); return { status: number === '27811111111' ? 'started' : number === '27822222222' ? 'linked' : 'waiting', name: `p${number}`, restartsOnce: true }; };
  const pairflow = require('../whatsapp/pairflow');
  pairflow.begin = () => Promise.resolve('stubbed');
  delete require.cache[require.resolve('../commands/pair')];
  const cmd = require('../commands/pair');
  const run = async (rest) => { let out = ''; await cmd.run({ sock, rest, reply: async (t) => { out = t; }, prefix: '.' }); return out; };
  assert.match(await run(''), /Pair a number for somebody else/);
  assert.match(await run('hello'), /Pair a number/);
  assert.match(await run('123'), /Pair a number/);
  assert.deepStrictEqual(calls, [], 'a wrong number never reaches the account list');
  assert.match(await run('+27 81 111 1111'), /Linking \+27811111111/);
  assert.match(await run('27822222222'), /already linked/);
  assert.match(await run('27833333333'), /waiting to be linked/);
  assert.ok(cmd.ownerOnly);
});

test('v1.8.1 pair: only the owner can use it', async () => {
  const before = pairing.start;
  let called = false;
  pairing.start = () => { called = true; return { status: 'started', name: 'x' }; };
  await say(dm(MEMBER, `${P()}pair 27844444444`));
  pairing.start = before;
  assert.strictEqual(called, false);
});

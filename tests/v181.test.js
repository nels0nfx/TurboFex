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
const sessionid = require('../core/sessionid');
const EventEmitter = require('events');

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

// ------------------------------------------------------------------ ignore: the help says how to name a chat from anywhere
test('v1.8.2 ignore: the description and the help explain how to name a chat from anywhere', async () => {
  const cmd = require('../commands/ignore');
  const sentence = 'From anywhere: you can name a group by its number from gjids, its id or part of its name, or a phone number, e.g. ignore on 3 or ignore on 27821234567';
  assert.ok(cmd.description.includes(sentence), 'the description (menu and help) says it');
  const out = (await say(dm(OWNER, `${P()}ignore`))).join(' ') + ' ' + sent.map((x) => x.c.text || '').join(' ');
  assert.match(out, /From anywhere:/);
  assert.match(out, /ignore on 3/);
  assert.match(out, /ignore on 27821234567/);
  assert.match(out, /number from .*gjids/);
});

// ------------------------------------------------------------------ session IDs that carry the login
const CREDS = { me: { id: '27811111111:12@s.whatsapp.net', name: '~' }, registered: true, noiseKey: { private: { type: 'Buffer', data: 'AAAA' }, public: { type: 'Buffer', data: 'BBBB' } }, advSecretKey: 'abc123' };
const tmp = (p = 'v182-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('v1.8.2 session ID: the login goes into the ID and comes out unchanged', () => {
  const id = sessionid.encode(CREDS);
  assert.ok(id.startsWith('TFXS.') && id.length < 2000, `a short ID of letters only (${id.length})`);
  assert.match(id, /^TFXS\.[A-Za-z0-9_-]+$/);
  assert.deepStrictEqual(sessionid.decode(id), CREDS);
  assert.strictEqual(sessionid.isSelfContained(id), true);
  assert.strictEqual(sessionid.isSelfContained('TFX-ABCD-EFGH-JKLM'), false);
  assert.strictEqual(sessionid.decode('TFXS.not-a-login'), null);
});

test('v1.8.2 session ID: the bot logs in with it (no pairing site), once, and refuses a damaged one', async () => {
  const dir = tmp();
  const config = { sessionId: sessionid.encode(CREDS), sessionDir: path.join(dir, 'session'), sessionIdFile: path.join(dir, 'none.txt'), pairSiteUrl: 'https://nowhere.invalid' };
  const logs = [];
  const fetchFn = async () => { throw new Error('the site must not be asked'); };
  assert.strictEqual(await sessionid.restore(config, (t) => logs.push(t), fetchFn), 'restored');
  const saved = JSON.parse(fs.readFileSync(path.join(config.sessionDir, 'creds.json'), 'utf8'));
  assert.strictEqual(saved.me.id, CREDS.me.id);
  assert.strictEqual(saved.registered, true);
  assert.strictEqual(await sessionid.restore(config, () => {}, fetchFn), 'skipped', 'the same ID on the next start changes nothing');
  const bad = { ...config, sessionDir: path.join(dir, 'other'), sessionId: sessionid.encode(CREDS).slice(0, 60) };
  assert.strictEqual(await sessionid.restore(bad, (t) => logs.push(t), fetchFn), 'failed');
  assert.ok(logs.some((l) => /not complete or was damaged/.test(l)));
  assert.strictEqual(fs.existsSync(path.join(dir, 'other', 'creds.json')), false, 'nothing was saved from a damaged ID');
});

test('v1.8.2 session ID: it can be pasted in session_id.txt too, and is never shown to the AI chat', () => {
  const dir = tmp();
  const file = path.join(dir, 'session_id.txt');
  const id = sessionid.encode(CREDS);
  fs.writeFileSync(file, `# note\nSESSION_ID=${id}\n`);
  assert.strictEqual(sessionid.readFile(file), id);
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp', 'botknowledge.js'), 'utf8');
  assert.match(src, /TFXS\\\.\[A-Za-z0-9_-\]\{20,\}/, 'the secret filter knows the new ID');
});

// ------------------------------------------------------------------ pair: a session ID for THEIR host
const fakeChild = () => {
  const c = new EventEmitter();
  c.exitCode = null;
  c.killed = false;
  c.signals = [];
  c.kill = (sig) => { c.killed = true; c.exitCode = 0; c.signals.push(sig); setImmediate(() => c.emit('exit', 0)); return true; };
  return c;
};
function fakeSpawn(log) {
  return (exe, args, opts) => { const child = fakeChild(); log.push({ exe, args, opts, child }); return child; };
}
const writeStatus = (folder, state, extra = {}) => pairing.note(path.join(folder, 'data'), state, extra);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('v1.8.2 pair: the linking runs in its own folder with its own settings, and never touches accounts or the real bot', () => {
  const root = tmp('root-');
  const base = tmp('data-');
  const calls = [];
  const env = { SESSION_ID: 'TFX-REAL-REAL-REAL', NUMBER: '27800000001', OWNER_NUMBER: '27800000001', BOT_PREFIX: '!', PORT: '3000' };
  const run = pairing.startLinker({ root, base, number: '27811111111', spawnFn: fakeSpawn(calls), execPath: '/usr/bin/node', env });
  const { opts } = calls[0];
  assert.strictEqual(opts.env.TURBOFEX_PAIR_ONLY, '1');
  assert.strictEqual(opts.env.TURBOFEX_ISOLATED, '1');
  assert.strictEqual(opts.env.TURBOFEX_NO_UPDATE, '1');
  assert.strictEqual(opts.env.SESSION_ID, '', 'the real login is not passed on');
  assert.strictEqual(opts.env.OWNER_NUMBER, '', 'and neither is the real owner');
  assert.strictEqual(opts.env.NUMBER, '27811111111');
  assert.strictEqual(opts.env.PAIR_METHOD, 'code');
  for (const k of ['TURBOFEX_DATA', 'SESSION_DIR', 'SESSION_ID_FILE']) assert.ok(opts.env[k].startsWith(run.folder), `${k} is inside the temporary folder`);
  assert.ok(run.folder.startsWith(base));
  assert.strictEqual(fs.existsSync(path.join(root, 'accounts.json')), false, 'accounts.json is never made');
  assert.deepStrictEqual(fs.readdirSync(root), [], 'nothing was written in the program folder');
});

// the person's own account (the temporary process), as a fake: it records what it sends
const personSock = (number) => { const out = []; return { out, user: { id: `${number}:12@s.whatsapp.net` }, sendMessage: async (to, c) => { out.push({ to, text: c.text }); return { key: { id: 'P' } }; } }; };

test('v1.8.2 pair: the owner gets the CODE; the session ID goes to the PERSON\'s own chat, never to the owner', async () => {
  const base = tmp('data-');
  const calls = [];
  const pairflow = require('../whatsapp/pairflow');
  const pairdeliver = require('../core/pairdeliver');
  sent.length = 0;
  const done = pairflow.begin(sock, '27811111111', { root: tmp('root-'), base, spawnFn: fakeSpawn(calls), intervalMs: 15, maxMs: 5000, deliverMs: 4000 });
  const folder = pairing.folderFor(base, '27811111111');
  await wait(60);
  assert.strictEqual(sent.length, 0, 'nothing before there is a code');

  writeStatus(folder, 'code', { code: 'ABCD-EFGH', number: '27811111111' }); // what the temporary process writes
  await wait(100);
  const codeMsg = sent.find((x) => /ABCD-EFGH/.test(x.c.text || ''));
  assert.ok(codeMsg && !String(codeMsg.j).endsWith('@g.us'), 'the code goes to the owner\'s private chat');
  assert.match(codeMsg.c.text, /Link with phone number instead/);
  assert.match(codeMsg.c.text, /THEIR OWN WhatsApp, not here/);

  // the person enters the code: the temporary process is online, saves the login and sends it to its own chat
  fs.writeFileSync(path.join(folder, 'session', 'creds.json'), JSON.stringify(CREDS));
  writeStatus(folder, 'linked', { number: '27811111111' });
  await wait(80);
  assert.ok(sent.some((x) => /is linked/.test(x.c.text || '') && /their own WhatsApp/.test(x.c.text)), 'the owner is told it is linked');
  const person = personSock('27811111111');
  await pairdeliver.deliver({ sock: person, sessionDir: path.join(folder, 'session'), dataDir: path.join(folder, 'data'), settleMs: 5, gapMs: 5 });
  assert.strictEqual(await done, 'delivered');

  // what the PERSON got: in their own chat, the steps and then the ID alone
  assert.strictEqual(person.out.length, 2);
  assert.ok(person.out.every((m) => m.to === '27811111111@s.whatsapp.net'), 'to their own number (the chat with themselves)');
  assert.match(person.out[0].text, /session ID/);
  assert.match(person.out[0].text, /SESSION_ID/);
  assert.match(person.out[0].text, /never share it/);
  assert.match(person.out[0].text, /ONE place only/);
  assert.deepStrictEqual(sessionid.decode(person.out[1].text).me, CREDS.me, 'the second message is their login, as a session ID');

  // what the OWNER got: never the ID
  const ownerTexts = sent.map((x) => x.c.text || '');
  assert.ok(!ownerTexts.some((t) => /TFXS\./.test(t)), 'the owner never receives the session ID');
  assert.ok(ownerTexts.some((t) => /Delivered to \+27811111111/.test(t)), 'only that it was delivered');
  assert.ok(sent.every((x) => !String(x.j).endsWith('@g.us')));
  assert.ok(calls[0].child.signals.includes('SIGTERM'), 'the temporary process was stopped');
  assert.strictEqual(fs.existsSync(folder), false, 'the temporary folder, with the login, is deleted');
});

test('v1.8.2 pair: the delivery sends exactly once, even if the process comes online twice', async () => {
  const dir = tmp('folder-');
  fs.mkdirSync(path.join(dir, 'session'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'session', 'creds.json'), JSON.stringify(CREDS));
  const person = personSock('27811111111');
  const args = { sock: person, sessionDir: path.join(dir, 'session'), dataDir: path.join(dir, 'data'), settleMs: 1, gapMs: 1 };
  const pairdeliver = require('../core/pairdeliver');
  await Promise.all([pairdeliver.deliver(args), pairdeliver.deliver(args)]);
  await pairdeliver.deliver(args);
  assert.strictEqual(person.out.length, 2, 'two messages, once');
  assert.strictEqual(pairing.statusOf(dir).state, 'delivered');
  pairing.noteOnline(path.join(dir, 'data'), '27811111111'); // a reconnect later
  assert.strictEqual(pairing.statusOf(dir).state, 'delivered', 'a reconnect does not undo it');
});

test('v1.8.2 pair: when the ID cannot be sent, the owner is told what to do (and never gets the ID instead)', async () => {
  const pairdeliver = require('../core/pairdeliver');
  const pairflow = require('../whatsapp/pairflow');
  const base = tmp('data-');
  const folder = pairing.folderFor(base, '27811111114');
  sent.length = 0;
  const done = pairflow.begin(sock, '27811111114', { root: tmp('root-'), base, spawnFn: fakeSpawn([]), intervalMs: 10, maxMs: 2000, deliverMs: 2000 });
  writeStatus(folder, 'linked', { number: '27811111114' });
  const broken = { user: { id: '27811111114:1@s.whatsapp.net' }, sendMessage: async () => { throw new Error('not connected'); } };
  fs.writeFileSync(path.join(folder, 'session', 'creds.json'), JSON.stringify(CREDS));
  await pairdeliver.deliver({ sock: broken, sessionDir: path.join(folder, 'session'), dataDir: path.join(folder, 'data'), settleMs: 1, gapMs: 1 });
  assert.strictEqual(await done, 'failed');
  const texts = sent.map((x) => x.c.text || '');
  assert.ok(texts.some((t) => /could not send them their session ID \(not connected\)/.test(t)));
  assert.ok(texts.some((t) => /Log out/.test(t)), 'it says what to do');
  assert.ok(!texts.some((t) => /TFXS\./.test(t)));

  // no login saved at all
  const empty = tmp('folder-');
  const person = personSock('27811111115');
  await pairdeliver.deliver({ sock: person, sessionDir: path.join(empty, 'session'), dataDir: path.join(empty, 'data'), settleMs: 1, tries: 2, gapMs: 1 });
  assert.strictEqual(pairing.statusOf(empty).state, 'failed');
  assert.strictEqual(person.out.length, 0, 'nothing is sent without a login');
});

test('v1.8.2 pair: a refused code and a code nobody entered are told, and the process and folder are cleaned up', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const b1 = tmp('data-');
  const c1 = [];
  sent.length = 0;
  const p1 = pairflow.begin(sock, '27811111112', { root: tmp('root-'), base: b1, spawnFn: fakeSpawn(c1), intervalMs: 10, maxMs: 1000 });
  writeStatus(pairing.folderFor(b1, '27811111112'), 'refused', { number: '27811111112' });
  assert.strictEqual(await p1, 'refused');
  assert.ok(sent.some((x) => /refused the pairing code/.test(x.c.text || '')));
  assert.strictEqual(fs.existsSync(pairing.folderFor(b1, '27811111112')), false);
  assert.ok(c1[0].child.killed);

  const b2 = tmp('data-');
  const c2 = [];
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, '27811111113', { root: tmp('root-'), base: b2, spawnFn: fakeSpawn(c2), intervalMs: 10, maxMs: 120 }), 'timeout');
  assert.ok(sent.some((x) => /is not linked/.test(x.c.text || '')));
  assert.strictEqual(fs.existsSync(pairing.folderFor(b2, '27811111113')), false);
  assert.ok(c2[0].child.killed);
});

test('v1.8.2 pair: linked but no confirmation of the delivery is told to the owner', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const base = tmp('data-');
  const calls = [];
  sent.length = 0;
  const done = pairflow.begin(sock, '27811111116', { root: tmp('root-'), base, spawnFn: fakeSpawn(calls), intervalMs: 10, maxMs: 1000, deliverMs: 120 });
  writeStatus(pairing.folderFor(base, '27811111116'), 'linked', { number: '27811111116' });
  assert.strictEqual(await done, 'timeout');
  assert.ok(sent.some((x) => /could not confirm that their session ID arrived/.test(x.c.text || '')));
  assert.ok(calls[0].child.killed);
  assert.strictEqual(fs.existsSync(pairing.folderFor(base, '27811111116')), false);
});

test('v1.8.2 pair: the linking process only links (no messages read, nothing started), and reports its code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp', 'connection.js'), 'utf8');
  const guard = src.indexOf("process.env.TURBOFEX_PAIR_ONLY === '1') {");
  assert.ok(guard > 0 && guard < src.indexOf("sock.ev.on('messages.upsert'"), 'the guard comes before the message handler is attached');
  assert.match(src, /TURBOFEX_PAIR_ONLY === '1'\) \{[\s\S]{0,260}pairdeliver'\)\.deliver\(/, '"online" only delivers the session ID to the person\'s own chat');
  assert.match(src, /pairing'\)\.note\(DATA, 'code'/);
  assert.match(src, /pairing'\)\.noteOnline\(DATA/);
  assert.ok(!/pairflow/.test(src), 'no restart handling: the bot is not restarted any more');
  // accounts are untouched
  const acc = accounts.envFor({ name: 'shop', main: false, dataDir: '/d', sessionDir: '/s', sessionIdFile: '/f', number: '27811111111', sessionId: '', prefix: '', timezone: '' }, 1, {});
  assert.ok(!acc.CONSOLE_LINK && !acc.PAIR_METHOD && !acc.TURBOFEX_PAIR_ONLY);
});

test('v1.8.2 pair: the command checks the number, refuses the bot\'s own, and starts exactly one linking', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const starts = [];
  pairflow.begin = (_s, number) => { starts.push(number); return Promise.resolve('stubbed'); };
  delete require.cache[require.resolve('../commands/pair')];
  const cmd = require('../commands/pair');
  const run = async (rest) => { let out = ''; await cmd.run({ sock, rest, reply: async (t) => { out = t; }, prefix: '.' }); return out; };
  assert.match(await run(''), /Pair a number for somebody else/);
  assert.match(await run(''), /THEIR OWN WhatsApp, not to you/);
  assert.match(await run(''), /like on the pairing site/);
  assert.match(await run('hello'), /Pair a number/);
  assert.match(await run('123'), /Pair a number/);
  assert.deepStrictEqual(starts, [], 'a wrong number starts nothing');
  const ownNumber = require('../config').number;
  if (ownNumber) assert.match(await run(ownNumber), /bot's own number/);
  const ok = await run('+27 81 111 1111');
  assert.match(ok, /Linking \+27811111111/);
  assert.match(ok, /private chat/);
  assert.match(ok, /THEIR OWN WhatsApp, not to you/);
  assert.match(ok, /nothing of this bot is changed/);
  assert.deepStrictEqual(starts, ['27811111111']);
  assert.ok(cmd.ownerOnly);
});

test('v1.8.2 pair: only the owner can use it', async () => {
  const pairflow = require('../whatsapp/pairflow');
  let called = false;
  pairflow.begin = () => { called = true; return Promise.resolve(); };
  await say(dm(MEMBER, `${P()}pair 27844444444`));
  assert.strictEqual(called, false);
});

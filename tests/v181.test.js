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
const pairsite = require('../core/pairsite');
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ------------------------------------------------------------------ pair: the pairing SITE does the linking
const SECRET_ID = 'TFX-K7M2-9QXA-4BNP';
const json = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
// a stand-in for the site: it answers /api/pair, /api/job/<id> (one answer per question, the last one repeats) and /api/cancel/<id>
function fakeSite({ start = () => json(200, { job: 'JOB-1' }), steps = [], network = false } = {}) {
  const calls = [];
  let polls = 0;
  const fetchFn = async (url, o = {}) => {
    if (network) throw new Error('offline');
    const pathname = new URL(url).pathname;
    calls.push({ method: o.method, pathname, host: new URL(url).host, body: o.body ? JSON.parse(o.body) : null });
    if (pathname === '/api/pair') return start();
    if (pathname.startsWith('/api/job/')) { const step = steps[Math.min(polls, steps.length - 1)]; polls += 1; return step.status ? json(step.status, step.data || {}) : json(200, step); }
    if (pathname.startsWith('/api/cancel/')) return json(200, { ok: true });
    return json(404, {});
  };
  return { fetchFn, calls };
}
const owner = () => sent.map((x) => x.c.text || '');
const quick = { intervalMs: 5, maxMs: 1500, dmWaitMs: 150 };

test('v1.8.4 pair: the site is asked for a pairing code for the number, nothing else', async () => {
  const site = fakeSite({ steps: [{ state: 'linked', dm: true }] });
  const r = await pairsite.start('2348125658151', { url: 'https://pair.example.com/', fetchFn: site.fetchFn });
  assert.deepStrictEqual(r, { ok: true, job: 'JOB-1' });
  assert.deepStrictEqual(site.calls[0], { method: 'POST', pathname: '/api/pair', host: 'pair.example.com', body: { method: 'code', number: '+2348125658151' } });
});

test('v1.8.4 pair: the session ID in the site\'s report is removed at once and never kept', async () => {
  const site = fakeSite({ steps: [{ state: 'linked', dm: true, sessionId: SECRET_ID, idSecondsLeft: 290, code: null }] });
  const p = await pairsite.progress('JOB-1', { url: 'https://pair.example.com', fetchFn: site.fetchFn });
  assert.strictEqual(p.state, 'linked');
  assert.ok(!JSON.stringify(p).includes('TFX-') && !('sessionId' in p));
  const raw = { state: 'linked', sessionId: SECRET_ID, idSecondsLeft: 5 };
  assert.deepStrictEqual(pairsite.strip(raw), { state: 'linked' });
});

test('v1.8.4 pair: the owner gets the CODE; the session ID goes to the person from the site, and the owner never sees it', async () => {
  const site = fakeSite({ steps: [
    { state: 'starting' },
    { state: 'code', code: 'ABCD-EFGH' },
    { state: 'code', code: 'ABCD-EFGH' },
    { state: 'linking' },
    { state: 'linked', dm: null, sessionId: SECRET_ID },
    { state: 'linked', dm: true, sessionId: SECRET_ID },
  ] });
  const pairflow = require('../whatsapp/pairflow');
  sent.length = 0;
  const result = await pairflow.begin(sock, '2348125658151', { ...quick, url: 'https://pair.example.com', fetchFn: site.fetchFn });
  assert.strictEqual(result, 'delivered');
  const texts = owner();
  const codeMsg = texts.filter((t) => /ABCD-EFGH/.test(t));
  assert.strictEqual(codeMsg.length, 1, 'the code is sent once');
  assert.match(codeMsg[0], /Link with phone number instead/);
  assert.match(codeMsg[0], /THEIR OWN WhatsApp, not to you/);
  assert.ok(texts.some((t) => /entered the code/.test(t)), 'the owner is told when they enter it');
  assert.ok(texts.some((t) => /is linked/.test(t) && /sent their session ID to their own WhatsApp/.test(t) && /You do not see it/.test(t)));
  assert.ok(!texts.some((t) => /TFX-|K7M2/.test(t)), 'the session ID never reaches the owner');
  assert.ok(sent.every((x) => !String(x.j).endsWith('@g.us')), 'only the private chat');
  assert.ok(!site.calls.some((c) => c.pathname.startsWith('/api/session')), 'the bot never uses up the ID');
  assert.ok(!site.calls.some((c) => c.pathname.startsWith('/api/cancel')), 'a linked pairing is not cancelled');
});

test('v1.8.4 pair: linked but the site could not message them: the owner is told what to do', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const a = fakeSite({ steps: [{ state: 'code', code: 'QQQQ-WWWW' }, { state: 'linked', dm: false, sessionId: SECRET_ID }] });
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, '2348125658152', { ...quick, url: 'https://p.example.com', fetchFn: a.fetchFn }), 'linked-no-dm');
  assert.ok(owner().some((t) => /could not message them their session ID/.test(t) && /Log out/.test(t)));
  assert.ok(!owner().some((t) => /TFX-/.test(t)));
  // the site never says whether the message went out
  const b = fakeSite({ steps: [{ state: 'linked', dm: null }] });
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, '2348125658153', { ...quick, url: 'https://p.example.com', fetchFn: b.fetchFn }), 'linked-no-dm');
});

test('v1.8.4 pair: a refusal, a failed link, an unreachable site and a lost pairing are each told in plain words', async () => {
  const pairflow = require('../whatsapp/pairflow');
  // the site refuses to start
  sent.length = 0;
  const limited = fakeSite({ start: () => json(429, { error: 'Too many tries. Please wait a few minutes.' }) });
  assert.strictEqual(await pairflow.begin(sock, '2348125658154', { ...quick, url: 'https://p.example.com', fetchFn: limited.fetchFn }), 'refused');
  assert.ok(owner().some((t) => /Could not start the pairing/.test(t) && /Too many tries/.test(t)));
  // a number the site finds invalid
  sent.length = 0;
  const bad = fakeSite({ start: () => json(400, { error: 'That number is not valid for the selected country.' }) });
  await pairflow.begin(sock, '2348125658155', { ...quick, url: 'https://p.example.com', fetchFn: bad.fetchFn });
  assert.ok(owner().some((t) => /not valid for the selected country/.test(t)));
  // the site cannot be reached
  sent.length = 0;
  const down = fakeSite({ network: true });
  assert.strictEqual(await pairflow.begin(sock, '2348125658156', { ...quick, url: 'https://p.example.com', fetchFn: down.fetchFn }), 'refused');
  assert.ok(owner().some((t) => /could not reach the pairing site \(p\.example\.com\)/.test(t) && /PAIR_SITE_URL/.test(t)));
  // WhatsApp or the site fails the link
  sent.length = 0;
  const failed = fakeSite({ steps: [{ state: 'code', code: 'AAAA-BBBB' }, { state: 'failed', error: 'WhatsApp did not accept the code.' }] });
  assert.strictEqual(await pairflow.begin(sock, '2348125658157', { ...quick, url: 'https://p.example.com', fetchFn: failed.fetchFn }), 'failed');
  assert.ok(owner().some((t) => /did not work/.test(t) && /WhatsApp did not accept the code/.test(t)));
  // the site forgets the pairing: it is cancelled
  sent.length = 0;
  const lost = fakeSite({ steps: [{ state: 'code', code: 'CCCC-DDDD' }, { status: 404, data: { error: 'Not found. Start again.' } }] });
  assert.strictEqual(await pairflow.begin(sock, '2348125658158', { ...quick, url: 'https://p.example.com', fetchFn: lost.fetchFn }), 'lost');
  assert.ok(owner().some((t) => /lost the pairing/.test(t)));
});

test('v1.8.4 pair: a code nobody enters ends with a message, and the site is told to stop that pairing', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const site = fakeSite({ steps: [{ state: 'code', code: 'EEEE-FFFF' }] });
  sent.length = 0;
  assert.strictEqual(await pairflow.begin(sock, '2348125658159', { intervalMs: 5, maxMs: 120, url: 'https://p.example.com', fetchFn: site.fetchFn }), 'timeout');
  assert.ok(owner().some((t) => /is not linked/.test(t) && /Send `\.pair 2348125658159` again/.test(t)));
  await wait(30);
  assert.ok(site.calls.some((c) => c.pathname.startsWith('/api/cancel/')), 'the unfinished pairing is cancelled on the site');
});

test('v1.8.4 pair: the command checks the number, refuses the bot\'s own, and starts exactly one pairing', async () => {
  const pairflow = require('../whatsapp/pairflow');
  const starts = [];
  pairflow.begin = (_s, number) => { starts.push(number); return Promise.resolve('stubbed'); };
  delete require.cache[require.resolve('../commands/pair')];
  const cmd = require('../commands/pair');
  const run = async (rest) => { let out = ''; await cmd.run({ sock, rest, reply: async (t) => { out = t; }, prefix: '.' }); return out; };
  const help = await run('');
  assert.match(help, /works like the pairing site/);
  assert.match(help, /THEIR OWN WhatsApp, not to you/);
  assert.match(await run('hello'), /Pair a number/);
  assert.match(await run('123'), /Pair a number/);
  assert.deepStrictEqual(starts, [], 'a wrong number starts nothing');
  assert.match(await run('27899999999'), /bot's own number/, 'the number the bot is logged in with (from its connection, not from a setting)');
  const ok = await run('+27 81 111 1111');
  assert.match(ok, /Linking \+27811111111 on the pairing site/);
  assert.match(ok, /private chat/);
  assert.match(ok, /THEIR OWN WhatsApp, not to you/);
  assert.deepStrictEqual(starts, ['27811111111']);
  assert.ok(cmd.ownerOnly);
});

test('v1.8.4 pair: only the owner can use it', async () => {
  const pairflow = require('../whatsapp/pairflow');
  let called = false;
  pairflow.begin = () => { called = true; return Promise.resolve(); };
  await say(dm(MEMBER, `${P()}pair 27844444444`));
  assert.strictEqual(called, false);
});

test('v1.8.4 pair: nothing is linked or changed inside the bot (no accounts, no launcher, no own session format)', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['core/accounts.js', 'core/sessionid.js', 'whatsapp/botknowledge.js']) {
    assert.ok(!/TFXS|PAIR_ONLY|pairdeliver/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f} has no leftovers of the old way`);
  }
  const conn = fs.readFileSync(path.join(root, 'whatsapp', 'connection.js'), 'utf8');
  assert.ok(!/TURBOFEX_PAIR_ONLY|core\/pairing'|pairdeliver|pairflow/.test(conn), 'the connection has no pairing hooks');
  assert.ok(!fs.existsSync(path.join(root, 'core', 'pairing.js')) && !fs.existsSync(path.join(root, 'core', 'pairdeliver.js')));
  const acc = accounts.envFor({ name: 'shop', main: false, dataDir: '/d', sessionDir: '/s', sessionIdFile: '/f', number: '27811111111', sessionId: '', prefix: '', timezone: '' }, 1, {});
  assert.ok(!acc.CONSOLE_LINK && !acc.PAIR_METHOD);
});

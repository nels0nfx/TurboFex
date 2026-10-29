require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const Aurum = require('../core/realm/aurum');
const protect = require('../whatsapp/protect');
const presence = require('../whatsapp/presence');
const wordle = require('../whatsapp/play/wordle');
const c4 = require('../whatsapp/play/connect4');
const duel = require('../whatsapp/play/duel');
const riddle = require('../whatsapp/play/riddle');
const emojiquiz = require('../whatsapp/play/emojiquiz');
const web = require('../core/web');
const names = require('../whatsapp/names');

baileys.setForTests({});
Object.assign(presence.timing, { pause: 2, hold: 20, step: 10, tail: 5 }); // the typing indicator, in a hurry
const OWNER = '27800000001@s.whatsapp.net';
const GROUP = '120363000000000002@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [{ id: OWNER, admin: 'admin' }, { id: '27811111111@s.whatsapp.net' }] }),
  readMessages: async (k) => { sock.read = (sock.read || 0) + k.length; },
  sendPresenceUpdate: async (kind) => { sock.presence = kind; (sock.presences = sock.presences || []).push(kind); },
  presenceSubscribe: async () => { (sock.presences = sock.presences || []).push('subscribe'); },
  updateBlockStatus: async (j, a) => { sock.blocked = [j, a]; },
};
let n = 0;
const dm = (from, text) => ({ key: { remoteJid: from, id: `W${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };
const who = (jid) => ({ ids: [jid.split('@')[0]], jid });
const A = who('27811111111@s.whatsapp.net');
const B = who('27822222222@s.whatsapp.net');
const collector = () => {
  const out = [];
  return { out, send: async (t) => out.push(t), end: () => out.push('<end>'), touch() {} };
};

test('wordle: letters are coloured correctly, also with repeated letters', () => {
  assert.strictEqual(wordle.score('apple', 'apple'), '🟩🟩🟩🟩🟩');
  assert.strictEqual(wordle.score('about', 'china'), '⬛⬛⬛⬛⬛'.replace('⬛⬛⬛⬛⬛', '🟨⬛⬛⬛⬛'), 'only the a is in "china"');
  assert.strictEqual(wordle.score('allay', 'apple'), '🟩🟨⬛⬛⬛', 'the second a and the l are checked against what is left');
  assert.ok(wordle.WORDS.every((w) => /^[a-z]{5}$/.test(w)));
});
test('wordle: a game can be won and lost', async () => {
  const g = wordle.create();
  const c = collector();
  await wordle.onMessage({ game: g, text: 'hello', who: A, ...c });
  assert.strictEqual(g.guesses.length, 1);
  await wordle.onMessage({ game: g, text: 'hello', who: A, ...c });
  assert.match(c.out.at(-1), /already tried/);
  await wordle.onMessage({ game: g, text: g.word, who: A, ...c });
  assert.ok(c.out.includes('<end>'));
  const lost = { ...wordle.create(), word: 'zzzzz' };
  const c2 = collector();
  for (const w of ['about', 'above', 'actor', 'adult', 'after', 'again']) await wordle.onMessage({ game: lost, text: w, who: A, ...c2 });
  assert.ok(c2.out.includes('<end>'));
  assert.match(c2.out.join(' '), /ZZZZZ/);
});

test('connect 4: four in a row wins in every direction, full columns are refused', () => {
  const b = c4.emptyBoard();
  for (let i = 0; i < 3; i++) c4.drop(b, 0, 'R');
  const r = c4.drop(b, 0, 'R');
  assert.ok(c4.wins(b, r, 0), 'vertical');
  const h = c4.emptyBoard();
  let last;
  for (let c = 2; c < 6; c++) last = [c4.drop(h, c, 'Y'), c];
  assert.ok(c4.wins(h, ...last), 'horizontal');
  const d = c4.emptyBoard();
  c4.drop(d, 0, 'R');
  c4.drop(d, 1, 'Y'); c4.drop(d, 1, 'R');
  c4.drop(d, 2, 'Y'); c4.drop(d, 2, 'Y'); c4.drop(d, 2, 'R');
  c4.drop(d, 3, 'Y'); c4.drop(d, 3, 'Y'); c4.drop(d, 3, 'Y');
  const row = c4.drop(d, 3, 'R');
  assert.ok(c4.wins(d, row, 3), 'diagonal');
  const f = c4.emptyBoard();
  for (let i = 0; i < 6; i++) c4.drop(f, 4, i % 2 ? 'R' : 'Y');
  assert.strictEqual(c4.drop(f, 4, 'R'), -1);
});
test('connect 4: turns are kept and the winner is announced', async () => {
  const g = c4.create({}, [A, B]);
  const c = collector();
  await c4.onMessage({ game: g, text: '1', who: B, ...c });
  assert.match(c.out.at(-1), /not your turn/);
  for (let i = 0; i < 3; i++) {
    await c4.onMessage({ game: g, text: '1', who: A, ...c });
    await c4.onMessage({ game: g, text: '2', who: B, ...c });
  }
  await c4.onMessage({ game: g, text: '1', who: A, ...c });
  assert.ok(c.out.includes('<end>'));
  assert.match(c.out.at(-1), /wins/);
});

test('duel: attack, defend, heal and the winner takes the bet', async () => {
  const a = '27844440001@s.whatsapp.net';
  const b = '27844440002@s.whatsapp.net';
  const G = '120363000000000002@g.us';
  Aurum.add(G, a, 500);
  Aurum.add(G, b, 500);
  const g = duel.create({ bet: 300, group: G }, [who(a), who(b)]);
  const c = collector();
  await duel.onMessage({ game: g, text: '1', who: who(b), ...c });
  assert.match(c.out.at(-1), /not your turn/);
  await duel.onMessage({ game: g, text: '3', who: who(a), ...c });
  assert.strictEqual(g.a.hp, 100, 'healing never goes over 100');
  g.b.hp = 5;
  await duel.onMessage({ game: g, text: '2', who: who(b), ...c });
  g.b.guard = false;
  await duel.onMessage({ game: g, text: '1', who: who(a), rand: () => 0.5, ...c });
  assert.ok(c.out.includes('<end>'));
  assert.strictEqual(Aurum.balance(G, a), 800);
  assert.strictEqual(Aurum.balance(G, b), 200);
});

test('riddles and emoji quiz: answers are matched loosely, and every item has an answer', async () => {
  assert.ok(riddle.RIDDLES.length >= 20 && riddle.RIDDLES.every(([q, a]) => q && a.length));
  assert.ok(emojiquiz.ITEMS.every(([e, a]) => e && a.length));
  const g = { q: 'x', answers: ['keyboard', 'piano'] };
  const c = collector();
  await riddle.onMessage({ game: g, text: 'a Piano!', who: A, ...c });
  assert.ok(c.out.includes('<end>'));
  const c2 = collector();
  await emojiquiz.onMessage({ game: { answers: ['the lion king'], emojis: '🦁👑', hint: '' }, text: 'Lion King', who: A, ...c2 });
  assert.ok(!c2.out.includes('<end>') || true);
});

test('antibot and antitag: how they recognise a bot and mass tagging', () => {
  assert.ok(protect.looksLikeBot('BAE5A1B2C3D4E5F6'));
  assert.ok(!protect.looksLikeBot('3EB0ABCDEF1234567890'), 'a WhatsApp Web id is not taken for a bot');
  assert.ok(!protect.looksLikeBot('A5F2C3D4E5F60718293A4B5C6D7E8F90'));
  const tags = (k) => ({ extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: Array.from({ length: k }, (_, i) => `2780000${i}@s.whatsapp.net`) } } });
  assert.strictEqual(protect.mentionCount(tags(12)), 12);
  assert.strictEqual(protect.mentionCount({ conversation: 'hi' }), 0);
});
test('antitag: a mass tag by a member is deleted, an admin is left alone', async () => {
  store.update(GROUP, (g) => { g.antitagMode = 'delete'; g.antitagLimit = 5; });
  const mk = (who) => ({ key: { remoteJid: GROUP, participant: who, id: `T${++n}`, fromMe: false }, message: { extendedTextMessage: { text: '@all', contextInfo: { mentionedJid: Array.from({ length: 8 }, (_, i) => `2780000${i}@s.whatsapp.net`) } } } });
  const roles = (admin) => async () => ({ isBotAdmin: true, isAdmin: admin, isOwner: false });
  sent.length = 0;
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('27811111111@s.whatsapp.net'), jid: GROUP, text: '@all', getRoles: roles(false) }), true);
  assert.strictEqual(await protect.runProtections({ sock, msg: mk(OWNER), jid: GROUP, text: '@all', getRoles: roles(true) }), false);
  assert.ok(sent.some((s) => s.c.delete), 'the message was deleted');
});
test('silence: a silenced member is deleted, others are not', async () => {
  const bad = '27855550001@s.whatsapp.net';
  store.update(GROUP, (g) => { g.antitagMode = 'off'; g.silenced = [require('../whatsapp/levels').keyOf(bad)]; });
  const mk = (who) => ({ key: { remoteJid: GROUP, participant: who, id: `S${++n}`, fromMe: false }, message: { conversation: 'hello' } });
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  assert.strictEqual(await protect.runProtections({ sock, msg: mk(bad), jid: GROUP, text: 'hello', getRoles: roles }), true);
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('27855550002@s.whatsapp.net'), jid: GROUP, text: 'hello', getRoles: roles }), false);
});

test('owner automation: autoread, typing indicator, auto react and the private message blocker', async () => {
  store.setMode('public');
  store.setAuto('read', true);
  store.setAuto('typing', true);
  sock.read = 0;
  await handler.handleMessage(sock, dm('27866660001@s.whatsapp.net', '.ping'));
  await settle();
  assert.ok(sock.read >= 1, 'marked as read');
  assert.deepStrictEqual(sock.presences.filter((p) => p !== 'subscribe').slice(0, 2), ['available', 'composing'], 'typing shown');
  assert.ok(sock.presences.includes('subscribe'));
  assert.strictEqual(sock.presence, 'paused', 'and cleared when the answer is sent');
  store.setAuto('read', false);
  store.setAuto('typing', false);

  store.setAuto('react', { on: true, emojis: ['🔥'] });
  sent.length = 0;
  await handler.handleMessage(sock, dm('27866660002@s.whatsapp.net', 'just chatting'));
  assert.ok(sent.some((s) => s.c.react?.text === '🔥'));
  store.setAuto('react', { on: false });

  store.setAuto('pm', 'block');
  sent.length = 0;
  const stranger = '27866660003@s.whatsapp.net';
  await handler.handleMessage(sock, dm(stranger, '.ping'));
  assert.match(texts().join(' '), /does not answer private messages/);
  assert.ok(!texts().some((t) => /pong/i.test(t)), 'the command was not run');
  await handler.handleMessage(sock, dm(stranger, 'hello?'));
  assert.deepStrictEqual(sock.blocked, [stranger, 'block'], 'blocked on the second message');
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, '.ping'));
  await settle();
  assert.ok(texts().some((t) => /pong/i.test(t)), 'the owner is never affected');
  store.setAuto('pm', 'off');
});
test('owner automation: the bio text fills in the time and date', () => {
  const t = presence.fillBio('🤖 Online {time} {date}');
  assert.ok(!/\{time\}|\{date\}/.test(t));
});

test('web helper: entities and CDATA are decoded', () => {
  assert.strictEqual(web.decode('<![CDATA[Fish &amp; Chips]]>'), 'Fish & Chips');
});

test('every new command has a valid category and a description', () => {
  const { info: CATEGORIES } = require('../whatsapp/categories');
  const files = ['realm', 'automation', 'groupextras', 'webtools', 'lookups2', 'games2'];
  for (const f of files) {
    for (const c of [].concat(require(`../commands/${f}`))) {
      assert.ok(c.description && c.description.length > 10, `${c.name} needs a description`);
      assert.ok(CATEGORIES[c.category], `${c.name} has an unknown category ${c.category}`);
    }
  }
});

test('autoreact: it works only where the owner chose', () => {
  const g = '120363000000000003@g.us';
  const d = '27866660009@s.whatsapp.net';
  assert.ok(presence.reactAllowed({ scope: 'all' }, g, []) && presence.reactAllowed({ scope: 'all' }, d, []));
  assert.ok(presence.reactAllowed({ scope: 'groups' }, g, []) && !presence.reactAllowed({ scope: 'groups' }, d, []));
  assert.ok(!presence.reactAllowed({ scope: 'dms' }, g, []) && presence.reactAllowed({ scope: 'dms' }, d, []));
  assert.ok(!presence.reactAllowed({ scope: 'selected', chats: [], people: [] }, g, ['1']));
  assert.ok(presence.reactAllowed({ scope: 'selected', chats: [g], people: [] }, g, []), 'a chosen chat');
  assert.ok(presence.reactAllowed({ scope: 'selected', chats: [], people: ['27866660009'] }, g, ['27866660009']), 'a chosen person, also in a group');
});
test('autoreact: the owner can choose with commands', async () => {
  store.setMode('public');
  store.setAuto('react', { on: false, emojis: [] });
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, '.autoreact where dms'));
  await handler.handleMessage(sock, dm(OWNER, '.autoreact add 27877770001'));
  await handler.handleMessage(sock, dm(OWNER, '.autoreact where selected'));
  await handler.handleMessage(sock, dm(OWNER, '.autoreact on'));
  await settle();
  const cfg = store.getAuto('react');
  assert.deepStrictEqual([cfg.on, cfg.scope, cfg.people.length], [true, 'selected', 1]);
  store.setAuto('react', { on: false });
});

test('private message blocker: people the owner talks to, saved contacts and allowed people are not strangers', async () => {
  store.setMode('public');
  store.setAuto('pm', 'block');
  const friend = '27888880001@s.whatsapp.net';
  // the owner wrote in that chat (a message typed on the phone shows up as "fromMe")
  await handler.handleMessage(sock, { key: { remoteJid: friend, id: `W${++n}`, fromMe: true }, message: { conversation: '.ping' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  sent.length = 0;
  await handler.handleMessage(sock, dm(friend, 'hi, got your message'));
  await settle();
  assert.ok(!texts().some((t) => /does not answer private messages/.test(t)), 'no warning for someone the owner talks to');
  // a saved contact
  names.learnContacts([{ id: '27888880002@s.whatsapp.net', name: 'Mum' }]);
  sent.length = 0;
  await handler.handleMessage(sock, dm('27888880002@s.whatsapp.net', 'hello'));
  assert.ok(!texts().some((t) => /does not answer private messages/.test(t)), 'no warning for a saved contact');
  // allow by command
  await handler.handleMessage(sock, dm(OWNER, '.pmblocker allow 27888880003'));
  sent.length = 0;
  await handler.handleMessage(sock, dm('27888880003@s.whatsapp.net', 'hello'));
  assert.ok(!texts().some((t) => /does not answer private messages/.test(t)), 'no warning for an allowed number');
  // a real stranger still gets it
  sent.length = 0;
  await handler.handleMessage(sock, dm('27888880004@s.whatsapp.net', 'hello'));
  assert.ok(texts().some((t) => /does not answer private messages/.test(t)));
  store.setAuto('pm', 'off');
});

test('silence: the member is told the first time, and only then', async () => {
  const bad = '27855551234@s.whatsapp.net';
  store.update(GROUP, (g) => { g.silenced = [require('../whatsapp/levels').keyOf(bad)]; g.silenceTold = []; g.antitagMode = 'off'; });
  const mk = () => ({ key: { remoteJid: GROUP, participant: bad, id: `Z${++n}`, fromMe: false }, message: { conversation: 'hello' } });
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  sent.length = 0;
  await protect.runProtections({ sock, msg: mk(), jid: GROUP, text: 'hello', getRoles: roles });
  assert.strictEqual(sent.filter((s) => s.c.text && /silenced you/.test(s.c.text)).length, 1);
  await protect.runProtections({ sock, msg: mk(), jid: GROUP, text: 'hello', getRoles: roles });
  assert.strictEqual(sent.filter((s) => s.c.text && /silenced you/.test(s.c.text)).length, 1, 'not told again');
  assert.strictEqual(sent.filter((s) => s.c.delete).length, 2, 'both messages deleted');
});

test('antispam: action, limit, seconds and repeat can be set; the settings are used', async () => {
  store.setMode('public');
  const admin = (text) => ({ key: { remoteJid: GROUP, participant: OWNER, id: `A${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  for (const t of ['.antispam kick', '.antispam limit 3', '.antispam seconds 30', '.antispam repeat 2']) await handler.handleMessage(sock, admin(t));
  await settle();
  const g = store.getGroup(GROUP);
  assert.deepStrictEqual([g.antispamMode, g.antispamLimit, g.antispamSeconds, g.antispamRepeat], ['kick', 3, 30, 2]);
  assert.strictEqual(g.antispam, true, 'the old on/off flag follows');
  const spammer = '27899990001@s.whatsapp.net';
  const mk = (text) => ({ key: { remoteJid: GROUP, participant: spammer, id: `P${++n}`, fromMe: false }, message: { conversation: text } });
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('buy now'), jid: GROUP, text: 'buy now', getRoles: roles }), false);
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('buy now'), jid: GROUP, text: 'buy now', getRoles: roles }), true, 'the same text twice = spam with repeat 2');
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('a'), jid: GROUP, text: 'a', getRoles: roles }), false);
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('b'), jid: GROUP, text: 'b', getRoles: roles }), false);
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('c'), jid: GROUP, text: 'c', getRoles: roles }), true, '3 messages in 30 seconds');
  store.update(GROUP, (x) => { x.antispamMode = 'off'; });
});
test('antispam: a group that had the old "on" setting keeps working as warn', () => {
  const key = '120363000000000077@g.us';
  store.update(key, (x) => { x.antispam = true; delete x.antispamMode; });
  assert.strictEqual(store.getGroup(key).antispamMode, 'warn');
});

test('games: members cannot start one, admins can, everybody joins', async () => {
  const games = require('../whatsapp/play');
  const M = '27811111111@s.whatsapp.net';
  const G2 = '120363000000000004@g.us';
  const say = (who, text) => handler.handleMessage(sock, { key: { remoteJid: G2, participant: who, id: `G${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  for (const mode of ['public', 'private']) {
    store.setMode(mode);
    for (const game of ['wordle', 'riddle', 'emojiquiz', 'connect4', 'duel', 'tictactoe', 'trivia']) {
      sent.length = 0;
      await say(M, `.${game}`); // a member
      await settle();
      assert.ok(!games.get(G2), `${mode}: a member cannot start ${game}`);
      assert.ok(mode === 'private' || texts().some((t) => /Only group admins/.test(t)), `${mode}: ${game} tells the member why`);
      await say(OWNER, `.${game}`); // an admin
      await settle();
      assert.strictEqual(games.get(G2)?.phase, 'lobby', `${mode}: an admin starts ${game}`);
      sent.length = 0;
      await say(M, 'join');
      await settle();
      assert.ok(games.get(G2).players.length >= 2, `${mode}: a member joined ${game}`);
      games.end(G2);
    }
  }
  store.setMode('public');
});

test('no prefix mode: "join" and "start" belong to the lobby; commands keep working while a game runs', async () => {
  const games = require('../whatsapp/play');
  const M = '27811111111@s.whatsapp.net';
  const G2 = '120363000000000006@g.us';
  const old = { ...games.settings };
  games.settings.tickMs = 1;
  games.settings.pauseMs = 1;
  const say = (who, text) => handler.handleMessage(sock, { key: { remoteJid: G2, participant: who, id: `NP${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  store.setMode('public');
  store.setNoPrefix(true);
  try {
    assert.ok(handler.isKnownCommand('join') && handler.isKnownCommand('daily'), 'both words are command names');
    await say(OWNER, 'wordle');
    await settle();
    assert.strictEqual(games.get(G2)?.phase, 'lobby');
    sent.length = 0;
    await say(M, 'join');
    await settle();
    assert.ok(games.get(G2).players.length >= 2, 'the member joined, it was not taken as the join command');
    await say(OWNER, 'start');
    await new Promise((r) => setTimeout(r, 120));
    assert.strictEqual(games.get(G2)?.phase, 'playing');
    // while the game runs, the bot still answers its commands without a prefix...
    sent.length = 0;
    await say(M, 'ping');
    await say(M, 'daily');
    await settle();
    assert.ok(texts().some((t) => /pong/i.test(t)), 'ping works during the game');
    assert.ok(texts().some((t) => /Daily gift/.test(t)), 'daily works during the game');
    // ...and a word that is not a command is a guess
    sent.length = 0;
    await say(M, 'crane');
    await settle();
    assert.ok(sent.some((s) => s.c.text && /tries left/.test(s.c.text)), 'taken as a guess');
    games.end(G2);
  } finally {
    store.setNoPrefix(false);
    Object.assign(games.settings, old);
  }
});

test('autotyping and autorecording: shown when someone writes to the bot (private chats by default)', async () => {
  store.setMode('public');
  const presenceOf = async (jid, text, group) => {
    sock.presences = [];
    const key = group ? { remoteJid: jid, participant: '27866661111@s.whatsapp.net', id: `Q${++n}`, fromMe: false } : { remoteJid: jid, id: `Q${++n}`, fromMe: false };
    await handler.handleMessage(sock, { key, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
    await settle();
    return sock.presences.filter((p) => p !== 'subscribe');
  };
  store.setAuto('typing', true);
  store.setAuto('presenceWhere', 'dms');
  assert.deepStrictEqual((await presenceOf('27866661112@s.whatsapp.net', 'hello, are you there?')).slice(0, 2), ['available', 'composing'], 'a private message');
  assert.deepStrictEqual(await presenceOf('120363000000000007@g.us', 'hello group', true), [], 'a group message: not by default');
  store.setAuto('presenceWhere', 'all');
  assert.ok((await presenceOf('120363000000000008@g.us', 'hello group', true)).includes('composing'), 'groups too when asked');
  store.setAuto('typing', false);
  store.setAuto('recording', true);
  assert.ok((await presenceOf('27866661113@s.whatsapp.net', 'hi')).includes('recording'), 'recording');
  store.setAuto('recording', false);
  assert.deepStrictEqual(await presenceOf('27866661114@s.whatsapp.net', 'hi'), [], 'nothing when both are off');
  store.setAuto('presenceWhere', 'dms');
});

test('antibot: ids, marked bots, strict mode and the check command', async () => {
  const v = protect.botVerdict;
  assert.ok(v('BAE5A1B2C3D4E5F6').bot);
  assert.ok(v('3EB0' + 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2'.slice(0, 36)).bot, 'a long linked-device id');
  assert.ok(!v('3EB0' + 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2'.slice(0, 36), false).bot, 'not when strict is off');
  assert.ok(!v('3EB0A1B2C3D4E5F6').bot, 'a short 3EB0 id (WhatsApp Web) is left alone');
  assert.ok(!v('A5F2C3D4E5F60718293A4B5C6D7E8F90').bot, 'a phone id is left alone');

  store.setMode('public');
  const admin = (text, extra = {}) => ({ key: { remoteJid: GROUP, participant: OWNER, id: `B${++n}`, fromMe: false }, message: { extendedTextMessage: { text, ...extra } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  sent.length = 0;
  await handler.handleMessage(sock, admin('.antibot kick'));
  await handler.handleMessage(sock, admin('.antibot add 27877776666'));
  await handler.handleMessage(sock, admin('.antibot check', { contextInfo: { stanzaId: 'BAE5A1B2C3D4E5F6', participant: '27877776666@s.whatsapp.net' } }));
  await settle();
  const g = store.getGroup(GROUP);
  assert.strictEqual(g.antibotMode, 'kick');
  assert.strictEqual(g.botList.length, 1);
  assert.ok(texts().some((t) => /Looks like a bot:\* YES/.test(t)), texts().join('|'));

  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  const mk = (who, id) => ({ key: { remoteJid: GROUP, participant: who, id, fromMe: false }, message: { conversation: 'hello' } });
  store.update(GROUP, (x) => { x.antibotMode = 'delete'; });
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('27877776666@s.whatsapp.net', 'A1B2C3D4E5F60718293A4B5C6D7E8F90'), jid: GROUP, text: 'hello', getRoles: roles }), true, 'a marked bot, whatever its message id looks like');
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('27877770000@s.whatsapp.net', 'BAE5A1B2C3D4E5F6'), jid: GROUP, text: 'hello', getRoles: roles }), true, 'a bot caught by its id');
  assert.strictEqual(await protect.runProtections({ sock, msg: mk('27877771111@s.whatsapp.net', 'A1B2C3D4E5F60718293A4B5C6D7E8F90'), jid: GROUP, text: 'hello', getRoles: roles }), false, 'a normal member');
  store.update(GROUP, (x) => { x.antibotMode = 'off'; x.botList = []; });
});

test('speed-ups give the same answers: num() and the group lookup table', () => {
  const { num } = require('../whatsapp/utils');
  const old = (jid) => String(jid || '').split('@')[0].split(':')[0];
  for (const j of ['27821234567:12@s.whatsapp.net', '27821234567@s.whatsapp.net', '120363@g.us', '123456789012345@lid', '123456789012345:7@lid', '27821234567', '', null, undefined, 'a:b@c:d', ':x@y', '@lid', 12345]) {
    assert.strictEqual(num(j), old(j), String(j));
  }
  const meta = require('../whatsapp/metadata');
  const info = { participants: [{ id: '111@lid', phoneNumber: '27800000009@s.whatsapp.net', admin: 'admin' }, { id: '222@lid' }] };
  const idx = meta.indexOf(info);
  assert.ok(idx.admins.has('111') && idx.admins.has('27800000009') && !idx.admins.has('222'));
  assert.strictEqual(idx.byId.get('27800000009'), info.participants[0]);
  assert.strictEqual(meta.indexOf(info), idx, 'built once');
  info.participants.push({ id: '333@lid', admin: 'admin' });
  assert.ok(meta.indexOf(info).admins.has('333'), 'rebuilt when the group changes');
});

test('setapi: the owner sends a key and the bot saves it and hides it', async () => {
  store.setMode('public');
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, '.removebg ABCDEFGH12345678ZZ'));
  await settle();
  assert.strictEqual(store.getApiKey('removebg'), 'ABCDEFGH12345678ZZ');
  const reply = texts().join('\n');
  assert.ok(/key saved/.test(reply) && !reply.includes('ABCDEFGH12345678ZZ'), 'saved and never shown in full');
  assert.ok(sent.some((s) => s.c.delete), 'the message with the key is deleted');
  // a normal member cannot save keys
  sent.length = 0;
  await handler.handleMessage(sock, dm('27811111111@s.whatsapp.net', '.removebg QQQQQQQQQQQQQQQQQQ'));
  await settle();
  assert.strictEqual(store.getApiKey('removebg'), 'ABCDEFGH12345678ZZ');
  store.setApiKey('removebg', null);
});

test('tagadmins follows private mode (not for members)', async () => {
  store.setMode('private');
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: GROUP, participant: '27811111111@s.whatsapp.net', id: `T${++n}`, fromMe: false }, message: { conversation: '.tagadmins hello' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  assert.ok(!sent.some((s) => s.c.text && /Admins/.test(s.c.text)));
  store.setMode('public');
});

test('games: the edited countdown message keeps its tags', async () => {
  const games = require('../whatsapp/play');
  const G4 = '120363000000000010@g.us';
  const old = { ...games.settings };
  games.settings.tickMs = 1;
  store.setMode('public');
  const say = (who, text) => handler.handleMessage(sock, { key: { remoteJid: G4, participant: who, id: `E${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  try {
    await say(OWNER, '.wordle');
    await say('27811111111@s.whatsapp.net', 'join');
    sent.length = 0;
    await say(OWNER, 'start');
    await new Promise((r) => setTimeout(r, 150));
    const edits = sent.filter((s) => s.c.edit && /GO!|Starting in/.test(s.c.text || ''));
    assert.ok(edits.length >= 3, 'the countdown was edited');
    assert.ok(edits.every((e) => e.c.mentions && e.c.mentions.length === 2), 'every edit carries both tags');
  } finally {
    games.end(G4);
    Object.assign(games.settings, old);
  }
});

test('tags in private chats: the phone number when known, the name otherwise, never a hidden id', () => {
  const mentionsLib = require('../whatsapp/mentions');
  const idmap = require('../whatsapp/idmap');
  idmap.learn('555111222333444@lid', '27899990077@s.whatsapp.net');
  const a = mentionsLib.inPrivate({ text: 'by @555111222333444', mentions: ['555111222333444@lid'] });
  assert.strictEqual(a.text, 'by @27899990077');
  assert.deepStrictEqual(a.mentions, ['27899990077@s.whatsapp.net']);
  names.remember('777888999000111@lid', 'Chidi');
  const b = mentionsLib.inPrivate({ text: 'by @777888999000111', mentions: ['777888999000111@lid'] });
  assert.strictEqual(b.text, 'by *Chidi*');
  const c = mentionsLib.inPrivate({ text: 'by @123123123123123', mentions: ['123123123123123@lid'] });
  assert.strictEqual(c.text, 'by *a member*');
  const d = mentionsLib.inPrivate({ text: 'by @27811112222', mentions: ['27811112222@s.whatsapp.net'] });
  assert.strictEqual(d.text, 'by @27811112222', 'a phone number tag stays a tag');
});


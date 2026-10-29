require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const Aurum = require('../core/realm/aurum');
const captcha = require('../whatsapp/captcha');
const chatbot = require('../whatsapp/chatbot');
const ai = require('../core/ai');
const bj = require('../whatsapp/play/blackjack');
const mines = require('../whatsapp/play/mines');
const hl = require('../whatsapp/play/higherlower');
const bingo = require('../whatsapp/play/bingo');
const flags = require('../whatsapp/play/flags');
const capitals = require('../whatsapp/play/capitals');
const typerace = require('../whatsapp/play/typerace');
const presence = require('../whatsapp/presence');
const { info: CATEGORIES } = require('../whatsapp/categories');

baileys.setForTests({});
Object.assign(presence.timing, { pause: 2, hold: 20, step: 10, tail: 5 });
const OWNER = '27800000001@s.whatsapp.net';
const GROUP = '120363000000000020@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [{ id: OWNER, admin: 'admin' }, { id: '27899999999@s.whatsapp.net', admin: 'admin' }, { id: '27811111111@s.whatsapp.net' }] }),
  groupParticipantsUpdate: async (g, ids, a) => { (sock.updates = sock.updates || []).push([a, ...ids]); },
  groupSettingUpdate: async (g, s) => { sock.setting = s; },
  sendPresenceUpdate: async (k) => { (sock.presences = sock.presences || []).push(k); },
  presenceSubscribe: async () => {},
};
let n = 0;
const dm = (from, text) => ({ key: { remoteJid: from, id: `Z${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const gm = (who, text) => ({ key: { remoteJid: GROUP, participant: who, id: `Z${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };
const who = (jid) => ({ ids: [jid.split('@')[0]], jid });
const A = who('27811111111@s.whatsapp.net');
const B = who('27822222222@s.whatsapp.net');
const collector = () => {
  const out = [];
  return { out, send: async (t) => out.push(t), end: (w) => out.push('<end>'), touch() {}, later: (ms, fn) => out.push({ later: ms, fn }) };
};

test('blackjack: hand values, naturals, dealer and bets', async () => {
  const c = (r, s = '♠') => ({ r, s });
  assert.strictEqual(bj.value([c('A'), c('K')]), 21);
  assert.strictEqual(bj.value([c('A'), c('A'), c('9')]), 21, 'aces drop from 11 to 1');
  assert.strictEqual(bj.value([c('K'), c('Q'), c('5')]), 25);
  assert.ok(bj.natural([c('A'), c('10')]) && !bj.natural([c('5'), c('6'), c('10')]));
  const p = '27844441111@s.whatsapp.net';
  const q = '27844442222@s.whatsapp.net';
  const G = '120363000000000001@g.us';
  Aurum.add(G, p, 1000);
  Aurum.add(G, q, 1000);
  const g = bj.create({ bet: 100, group: G }, [who(p), who(q)]);
  g.players = [who(p), who(q)]; // the game framework sets this
  g.hands = [[c('K'), c('9')], [c('K'), c('5'), c('9')]]; // 19 and a bust (24)
  g.dealer = [c('10'), c('8')]; // 18
  g.cards = [];
  const text = bj.results(g);
  assert.match(text, /wins/);
  assert.match(text, /bust/);
  assert.strictEqual(Aurum.balance(G, p), 1100);
  assert.strictEqual(Aurum.balance(G, q), 900);
  // turns
  const g2 = bj.create({}, [A, B]);
  g2.players = [A, B];
  g2.hands = [[c('5'), c('6')], [c('5'), c('6')]];
  g2.cards = [c('2'), c('3'), c('4'), c('K'), c('K'), c('K')];
  const col = collector();
  await bj.onMessage({ game: g2, text: 'hit', who: B, ...col });
  assert.match(col.out.at(-1), /not your turn/);
  await bj.onMessage({ game: g2, text: 'stand', who: A, ...col });
  assert.strictEqual(g2.idx, 1);
  await bj.onMessage({ game: g2, text: 'stand', who: B, ...col });
  assert.ok(col.out.includes('<end>'), 'the game ends after the last player');
});

test('mines: a mine knocks a player out, the last player standing wins', async () => {
  const g = mines.create({}, [A, B]);
  g.players = [A, B];
  g.mines = new Set([1, 2, 3, 4, 5]);
  const col = collector();
  await mines.onMessage({ game: g, text: '10', who: B, ...col });
  assert.match(col.out.at(-1), /not your turn/);
  await mines.onMessage({ game: g, text: '10', who: A, ...col }); // safe
  assert.strictEqual(g.score['27811111111'], 1);
  await mines.onMessage({ game: g, text: '1', who: B, ...col }); // mine: B is out, A is the last one
  assert.ok(col.out.includes('<end>'));
  assert.match(col.out.join(' '), /Winner/);
});

test('higher or lower: wrong players are out, the last one wins', async () => {
  const g = hl.create({}, [A, B]);
  g.players = [A, B];
  g.n = 50;
  const col = collector();
  await hl.onStart({ game: g, ...col });
  assert.ok(col.out.some((x) => x.later), 'a round is planned');
  g.round = 1;
  g.token = 1;
  g.n = 50;
  g.answers = {};
  await hl.onMessage({ game: g, text: 'higher', who: A, ...col });
  await hl.onMessage({ game: g, text: 'higher', who: A, ...col }); // a second answer does not count
  const rand = Math.random;
  Math.random = () => 0.1; // next number 11: lower
  try {
    await hl.onMessage({ game: g, text: 'lower', who: B, ...col }); // everybody answered: the round is resolved
  } finally {
    Math.random = rand;
  }
  assert.ok(col.out.includes('<end>'));
  assert.match(col.out.join(' '), /Winner/);
});

test('bingo: numbers are drawn and the first complete card wins', async () => {
  const g = bingo.create({}, [A, B]);
  g.players = [A, B];
  g.cards = [[1, 2, 3], [4, 5, 6]];
  g.pool = [3, 2, 1, 9, 8]; // popped from the end: 8, 9, 1, 2, 3
  const col = collector();
  await bingo.onStart({ game: g, ...col });
  const step = () => col.out.filter((x) => x.later).at(-1).fn();
  for (let i = 0; i < 5 && !col.out.includes('<end>'); i++) step();
  assert.ok(col.out.includes('<end>'));
  assert.match(col.out.join(' '), /BINGO/);
  assert.strictEqual(g.drawn.at(-1), 3);
});

test('flags, capitals and typing race: data is sound and answers are matched', async () => {
  assert.strictEqual(flags.flag('NG'), '🇳🇬');
  assert.ok(flags.COUNTRIES.every(([iso, name]) => /^[A-Z]{2}$/.test(iso) && name));
  assert.ok(capitals.CAPITALS.every(([country, capital]) => country && capital));
  const g = { answers: ['United States', 'usa'], name: 'United States', flag: '🇺🇸' };
  const col = collector();
  await flags.onMessage({ game: g, text: 'USA', who: A, ...col });
  assert.ok(col.out.includes('<end>'));
  const col2 = collector();
  await capitals.onMessage({ game: { country: 'Nigeria', capital: 'Abuja', answers: ['Abuja'] }, text: 'abuja!', who: A, ...col2 });
  assert.ok(col2.out.includes('<end>'));
  const col3 = collector();
  const tg = { sentence: 'Slow and steady wins the race', startedAt: Date.now() - 4000 };
  await typerace.onMessage({ game: tg, text: 'slow and steady wins the race.', who: A, ...col3 });
  assert.ok(col3.out.includes('<end>'));
  assert.match(col3.out.join(' '), /words per minute/);
});

test('new games: admins start, members cannot, members join (also when the bot is private)', async () => {
  const games = require('../whatsapp/play');
  const M = '27811111111@s.whatsapp.net';
  const G5 = '120363000000000022@g.us';
  const say = (w, text) => handler.handleMessage(sock, { key: { remoteJid: G5, participant: w, id: `Y${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  for (const mode of ['public', 'private']) {
    store.setMode(mode);
    for (const game of ['blackjack', 'higherlower', 'mines', 'typerace', 'flags', 'capitals', 'bingo']) {
      await say(M, `.${game}`);
      await settle();
      assert.ok(!games.get(G5), `${mode}: a member cannot start ${game}`);
      await say(OWNER, `.${game}`);
      await settle();
      assert.strictEqual(games.get(G5)?.phase, 'lobby', `${mode}: ${game} opens a lobby`);
      await say(M, 'join');
      await settle();
      assert.ok(games.get(G5).players.length >= 2, `${mode}: a member joined ${game}`);
      games.end(G5);
    }
  }
  store.setMode('public');
});

test('disable and enable: a command can be turned off in one group', async () => {
  store.setMode('public');
  const say = (w, text) => handler.handleMessage(sock, gm(w, text));
  sent.length = 0;
  await say(OWNER, '.disable roast');
  await say('27811111111@s.whatsapp.net', '.roast');
  await settle();
  assert.ok(store.getGroup(GROUP).disabled.includes('roast'));
  assert.ok(texts().some((t) => /turned off in this group/.test(t)));
  await say(OWNER, '.disable disable');
  assert.ok(!store.getGroup(GROUP).disabled.includes('disable'), 'disable cannot turn itself off');
  sent.length = 0;
  await say(OWNER, '.roast'); // the owner is never blocked
  await say(OWNER, '.enable roast');
  await say('27811111111@s.whatsapp.net', '.roast');
  await settle();
  assert.ok(texts().some((t) => /no hard feelings/i.test(t)), 'works again');
  assert.ok(!store.getGroup(GROUP).disabled.includes('roast'));
});

test('maintenance: only the owner can use the bot, others are told once', async () => {
  store.setMode('public');
  const m = '27855557777@s.whatsapp.net';
  await handler.handleMessage(sock, dm(OWNER, '.maintenance on'));
  sent.length = 0;
  await handler.handleMessage(sock, dm(m, '.ping'));
  await handler.handleMessage(sock, dm(m, '.ping'));
  await handler.handleMessage(sock, dm(OWNER, '.ping'));
  await settle();
  assert.strictEqual(texts().filter((t) => /maintenance/.test(t)).length, 1, 'told once');
  assert.strictEqual(texts().filter((t) => /pong/i.test(t)).length, 1, 'only the owner got an answer');
  await handler.handleMessage(sock, dm(OWNER, '.maintenance off'));
  await settle();
  assert.strictEqual(store.getAuto('maintenance'), false);
});

test('captcha: a new member answers the sum, or is removed after wrong answers', async () => {
  const g = { captcha: true, captchaSeconds: 60 };
  const newbie = '27866662222@s.whatsapp.net';
  sent.length = 0;
  sock.updates = [];
  await captcha.onJoin(sock, GROUP, [newbie], g);
  const q = texts().find((t) => /Verification/.test(t));
  const [, a, b] = /\*(\d+) \+ (\d+) = \?\*/.exec(q);
  const msg = (text) => ({ key: { remoteJid: GROUP, participant: newbie, id: `C${++n}` }, message: { conversation: text } });
  assert.strictEqual(captcha.check(sock, msg('hello everyone'), GROUP, 'hello everyone', []), false, 'normal chat is not an answer');
  const wrong1 = String(Number(a) + Number(b) + 1); // always wrong
  assert.strictEqual(captcha.check(sock, msg(wrong1), GROUP, wrong1, []), true, 'a wrong answer');
  assert.ok(texts().some((t) => /Wrong answer/.test(t)));
  assert.strictEqual(captcha.check(sock, msg(String(Number(a) + Number(b))), GROUP, String(Number(a) + Number(b)), []), true);
  assert.ok(texts().some((t) => /is verified/.test(t)));
  assert.strictEqual(captcha.pending.size, 0);
  // three wrong answers: removed
  sent.length = 0;
  await captcha.onJoin(sock, GROUP, [newbie], g);
  const [, a2, b2] = /\*(\d+) \+ (\d+) = \?\*/.exec(texts().find((t) => /Verification/.test(t)));
  const wrong2 = String(Number(a2) + Number(b2) + 1);
  for (let i = 0; i < 3; i++) captcha.check(sock, msg(wrong2), GROUP, wrong2, []);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(sock.updates.at(-1), ['remove', newbie]);
});

test('antiraid: a burst of joins locks the group (and can remove the new members)', async () => {
  const g = { antiraid: 'kick', antiraidJoins: 3, antiraidSeconds: 60 };
  const R = '120363000000000023@g.us';
  sock.updates = [];
  sock.setting = null;
  assert.strictEqual(await captcha.onRaid(sock, R, ['1@s.whatsapp.net', '2@s.whatsapp.net'], g, 1000), false);
  assert.strictEqual(await captcha.onRaid(sock, R, ['3@s.whatsapp.net'], g, 2000), true);
  assert.strictEqual(sock.setting, 'announcement');
  assert.deepStrictEqual(sock.updates.at(-1), ['remove', '1@s.whatsapp.net', '2@s.whatsapp.net', '3@s.whatsapp.net']);
  assert.strictEqual(await captcha.onRaid(sock, '120363000000000024@g.us', ['4@s.whatsapp.net', '5@s.whatsapp.net', '6@s.whatsapp.net'], { ...g, antiraid: 'off' }, 1000), false);
});

test('pin and unpin send the pin message for the replied message', async () => {
  store.setMode('public');
  sent.length = 0;
  const reply = (text) => ({ key: { remoteJid: GROUP, participant: OWNER, id: `P${++n}` }, message: { extendedTextMessage: { text, contextInfo: { stanzaId: 'ABC123', participant: '27811111111@s.whatsapp.net', quotedMessage: { conversation: 'x' } } } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await handler.handleMessage(sock, reply('.pin 7d'));
  await handler.handleMessage(sock, reply('.unpin'));
  await settle();
  const pins = sent.filter((s) => s.c.pin);
  assert.deepStrictEqual([pins[0].c.type, pins[0].c.time, pins[0].c.pin.id], [1, 604800, 'ABC123']);
  assert.strictEqual(pins[1].c.type, 2);
});

test('NelsonFx chatbot: answers in private chats, in groups only when addressed, never when off', async () => {
  const real = ai.chat;
  const asked = [];
  ai.chat = async (messages) => { asked.push(messages.at(-1).content); return 'Hello, I am NelsonFx!'; };
  try {
    assert.strictEqual(ai.NAME, 'NelsonFx');
    chatbot.save({ on: false, scope: 'dms', chats: [] });
    const dmMsg = (text) => ({ key: { remoteJid: '27877778888@s.whatsapp.net', id: `B${++n}`, fromMe: false }, message: { conversation: text }, pushName: 'Sam' });
    sent.length = 0;
    await chatbot.maybeReply({ sock, msg: dmMsg('hi'), jid: '27877778888@s.whatsapp.net', text: 'hi', botIds: ['27899999999'] });
    assert.strictEqual(asked.length, 0, 'off: no answer');
    chatbot.save({ on: true });
    await chatbot.maybeReply({ sock, msg: dmMsg('what is your name?'), jid: '27877778888@s.whatsapp.net', text: 'what is your name?', botIds: ['27899999999'] });
    assert.strictEqual(asked.length, 1);
    assert.ok(sent.some((s) => s.c.text === 'Hello, I am NelsonFx!'));
    // groups: only the "dms" scope is on, so no answer there
    const gmsg = (text, extra) => ({ key: { remoteJid: GROUP, participant: '27811111111@s.whatsapp.net', id: `B${++n}` }, message: { extendedTextMessage: { text, contextInfo: extra } }, pushName: 'Sam' });
    await chatbot.maybeReply({ sock, msg: gmsg('NelsonFx hello'), jid: GROUP, text: 'NelsonFx hello', botIds: ['27899999999'] });
    assert.strictEqual(asked.length, 1);
    chatbot.save({ scope: 'groups' });
    await new Promise((r) => setTimeout(r, 3100)); // the gap between two answers in one chat is different per chat: a new chat here
    const before = asked.length;
    await chatbot.maybeReply({ sock, msg: gmsg('just chatting with friends'), jid: GROUP, text: 'just chatting with friends', botIds: ['27899999999'] });
    assert.strictEqual(asked.length, before, 'not addressed: silent');
    await chatbot.maybeReply({ sock, msg: gmsg('hey NelsonFx, what time is it?'), jid: GROUP, text: 'hey NelsonFx, what time is it?', botIds: ['27899999999'] });
    assert.strictEqual(asked.length, before + 1, 'addressed by name');
    assert.match(asked.at(-1), /Sam: what time is it\?/);
    assert.strictEqual(chatbot.addressed(gmsg('hello', { mentionedJid: ['27899999999@s.whatsapp.net'] }), 'hello', ['27899999999']), true, 'tagged');
    assert.strictEqual(chatbot.addressed(gmsg('thanks', { participant: '27899999999@s.whatsapp.net' }), 'thanks', ['27899999999']), true, 'a reply to the bot');
  } finally {
    ai.chat = real;
    chatbot.save({ on: false, scope: 'dms' });
  }
});

test('typing and recording: not while the owner runs commands, only when someone writes', async () => {
  store.setMode('public');
  store.setAuto('typing', true);
  store.setAuto('presenceWhere', 'dms');
  sock.presences = [];
  await handler.handleMessage(sock, dm(OWNER, '.ping')); // the owner's own message
  await settle();
  assert.deepStrictEqual(sock.presences, [], 'nothing for the owner');
  await handler.handleMessage(sock, dm('27866664444@s.whatsapp.net', 'hello'));
  await settle();
  assert.ok(sock.presences.includes('composing'));
  store.setAuto('typing', false);
});

test('tools: morse, binary, bmi and split', async () => {
  store.setMode('public');
  sent.length = 0;
  const me = '27888881111@s.whatsapp.net';
  for (const t of ['.morse sos', '.morse ... --- ...', '.binary hi', '.binary 01101000 01101001', '.bmi 70 175', '.split 5000 4 10', '.timein Tokyo']) await handler.handleMessage(sock, dm(me, t));
  await settle();
  const all = texts().join('\n');
  assert.match(all, /\.\.\. --- \.\.\./);
  assert.match(all, /\*Text\*\nsos/);
  assert.match(all, /01101000 01101001/);
  assert.match(all, /\*Text\*\nhi/);
  assert.match(all, /\*Value:\* 22\.9/);
  assert.match(all, /Each of 4:\* \*1,375\*/);
  assert.match(all, /Asia\/Tokyo/);
});

test('setmenu changes the menu heading', async () => {
  store.setMode('public');
  await handler.handleMessage(sock, dm(OWNER, '.setmenu title NelsonFx Bot'));
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, '.menu'));
  await settle();
  assert.match(texts().join('\n'), /N E L S O N F X/);
  await handler.handleMessage(sock, dm(OWNER, '.setmenu reset'));
});

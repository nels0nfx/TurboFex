require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const repeat = require('../core/repeat');
const songmatch = require('../core/songmatch');
const capacity = require('../core/capacity');
const mentions = require('../whatsapp/mentions');
const levels = require('../whatsapp/levels');
const idmap = require('../whatsapp/idmap');
const names = require('../whatsapp/names');
const { isCommandText } = require('../whatsapp/utils');
const region = require('../commands/region');
const { groupByCategory } = require('../whatsapp/categories');

baileys.setForTests({});
const OWNER = '27800000001@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [{ id: '555000111@lid', phoneNumber: '27811111111@s.whatsapp.net' }, { id: OWNER }] }),
};
let n = 0;
const msg = (from, text, extra = {}) => ({ key: { remoteJid: from, id: `V${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra });
const gmsg = (who, text, extra = {}) => ({ key: { remoteJid: GROUP, participant: who, id: `V${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };

test('menu: no numbers beside the categories, no Community category', () => {
  const sections = groupByCategory([{ name: 'rank', category: 'group' }, { name: 'ping', category: 'general' }], true);
  assert.ok(!sections.some((s) => s.key === 'community'));
  const menu = require('../commands/menu');
  assert.ok(!/_\d+_/.test(String(menu.run)), 'menu code has no counter next to the category');
});
test('group commands live in the group category (rank, top, rules, report, birthday, giveaway)', () => {
  const all = [].concat(...require('fs').readdirSync('./commands').map((f) => require(`../commands/${f}`)));
  for (const name of ['rank', 'top', 'rules', 'setrules', 'report', 'birthday', 'setbirthday', 'giveaway']) {
    assert.strictEqual(all.find((c) => c.name === name).category, 'group', name);
  }
  assert.ok(!all.some((c) => c.category === 'community'));
});

test('schedule lines: every kind of repeat is understood', () => {
  assert.deepStrictEqual(repeat.parse('18:30 Dinner'), { repeat: { kind: 'daily' }, time: '18:30', text: 'Dinner' });
  assert.strictEqual(repeat.parse('once 7:05 Hi').repeat.kind, 'once');
  assert.deepStrictEqual(repeat.parse('weekly mon,thu 19:00 Train').repeat, { kind: 'weekly', days: ['mon', 'thu'] });
  assert.deepStrictEqual(repeat.parse('fri 20:00 Friday').repeat.days, ['fri']);
  assert.deepStrictEqual(repeat.parse('monthly 31 09:00 Rent').repeat, { kind: 'monthly', dom: 31 });
  assert.deepStrictEqual(repeat.parse('every 2h Water').repeat, { kind: 'interval', everyMin: 120 });
  assert.strictEqual(repeat.parse('every 1m x').error, 'tooOften');
  assert.strictEqual(repeat.parse('25:99 x').error, 'time');
  assert.strictEqual(repeat.parse('18:30').error, 'text');
  assert.strictEqual(repeat.parse('18:30 line one\nline two').text, 'line one\nline two');
});
test('schedule: when an item is due', () => {
  const mon = { hhmm: '07:30', dow: 'mon', dom: 5, y: 2026, mo: 10 };
  const sat = { ...mon, dow: 'sat' };
  assert.ok(repeat.isDue({ time: '07:30', repeat: { kind: 'daily' } }, mon));
  assert.ok(repeat.isDue({ time: '07:30', repeat: { kind: 'weekdays' } }, mon));
  assert.ok(!repeat.isDue({ time: '07:30', repeat: { kind: 'weekdays' } }, sat));
  assert.ok(repeat.isDue({ time: '07:30', repeat: { kind: 'weekends' } }, sat));
  assert.ok(!repeat.isDue({ time: '07:30', repeat: { kind: 'weekly', days: ['tue'] } }, mon));
  assert.ok(repeat.isDue({ time: '07:30' }, mon), 'old items (no repeat field) are daily');
  // the 31st in a 30-day month runs on the 30th
  assert.ok(repeat.isDue({ time: '07:30', repeat: { kind: 'monthly', dom: 31 } }, { ...mon, dom: 30, mo: 11 }));
  assert.ok(!repeat.isDue({ time: '07:30', repeat: { kind: 'monthly', dom: 31 } }, { ...mon, dom: 30, mo: 10 }));
  const it = { repeat: { kind: 'interval', everyMin: 10 } };
  assert.strictEqual(repeat.dueInterval(it, 1000), false);
  assert.strictEqual(repeat.dueInterval(it, 1000 + 9 * 60000), false);
  assert.strictEqual(repeat.dueInterval(it, 1000 + 10 * 60000), true);
  assert.strictEqual(repeat.dueInterval(it, 1000 + 10 * 60000 + 5), false, 'and it waits again');
});
test('schedule: a scheduled bot command is run by the scheduler', async () => {
  store.setMode('private');
  sent.length = 0;
  await handler.runText(sock, GROUP, '.ping');
  await settle();
  assert.ok(texts().some((t) => /pong/i.test(t)), 'the command ran');
});
test('schedule: only the owner can schedule a command, admins can schedule text', async () => {
  store.setMode('public');
  sent.length = 0;
  await handler.handleMessage(sock, msg('27811111111@s.whatsapp.net', '.schedule daily 07:00 run ping'));
  await settle();
  assert.ok(texts().some((t) => /Only the bot owner can schedule a command/.test(t)));
  const before = store.schedules().length;
  await handler.handleMessage(sock, msg(OWNER, '.schedule weekdays 07:00 run ping'));
  await settle();
  assert.strictEqual(store.schedules().length, before + 1);
  const item = store.schedules().at(-1);
  assert.strictEqual(item.cmd, 'ping');
  assert.deepStrictEqual(item.repeat, { kind: 'weekdays' });
  store.setMode('private');
});

test('no prefix mode: commands work without a symbol, the old prefix does NOT work, normal chat is left alone', async () => {
  assert.ok(!isCommandText('ping', ''));
  const known = (w) => w === 'ping';
  assert.ok(isCommandText('ping', '', known));
  assert.ok(isCommandText('Ping now', '', known));
  assert.ok(!isCommandText('pinging you', '', known));
  assert.ok(!isCommandText('hello ping', '', known));
  store.setNoPrefix(true);
  try {
    assert.strictEqual(store.effectivePrefix(), '');
    sent.length = 0;
    await handler.handleMessage(sock, msg(OWNER, 'ping'));
    await handler.handleMessage(sock, msg(OWNER, '.ping'));
    await handler.handleMessage(sock, msg(OWNER, 'just chatting here'));
    await settle();
    assert.strictEqual(texts().filter((t) => /pong/i.test(t)).length, 1, 'only the version without the prefix answered');
  } finally {
    store.setNoPrefix(false);
  }
  assert.strictEqual(store.effectivePrefix(), '.');
});

test('private mode: members can still use the member group commands (rank, rules...), not the rest', async () => {
  store.setMode('private');
  store.update(GROUP, (g) => { g.rank = true; });
  sent.length = 0;
  await handler.handleMessage(sock, gmsg('27811111111@s.whatsapp.net', '.rank'));
  await handler.handleMessage(sock, gmsg('27811111111@s.whatsapp.net', '.joke'));
  await settle();
  assert.ok(texts().some((t) => /XP|Rank/i.test(t)), 'rank answered');
  assert.ok(!texts().some((t) => /joke/i.test(t)), 'other commands are still owner only');
});

test('rank: chatting earns XP, also for messages typed on the bot account itself, and the rank command finds it', async () => {
  store.setMode('public');
  store.update(GROUP, (g) => { g.rank = true; });
  sent.length = 0;
  // a message typed on the bot's own account (fromMe) in the group
  await handler.handleMessage(sock, { key: { remoteJid: GROUP, fromMe: true, id: `V${++n}` }, message: { conversation: 'hello everyone' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await handler.handleMessage(sock, { key: { remoteJid: GROUP, fromMe: true, id: `V${++n}` }, message: { conversation: '.rank' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  assert.ok(!texts().some((t) => /has no XP yet/.test(t)), texts().join(' | '));
  assert.ok(texts().some((t) => /Level:/.test(t)));
});
test('rank: the same person as a phone number and as a hidden id is ONE entry', () => {
  idmap.learn('777111222@lid', '27822222222@s.whatsapp.net');
  const g = '120363000000000099@g.us';
  levels.award(g, '777111222@lid');
  const s = levels.statsOf(g, '27822222222@s.whatsapp.net');
  assert.ok(s.position, 'found by phone number');
  assert.strictEqual(levels.board(g).length, 1);
});

test('server guard: a high load average on a shared server alone is not "overloaded"', async () => {
  const os = require('os');
  const real = os.loadavg;
  os.loadavg = () => [10.79, 9, 8]; // the case from the report: 10.79 on 4 CPU, delay 1 ms
  try {
    const cmd = { name: 'x', capacity: { needs: [], weight: 'heavy' } };
    const r = await capacity.enter(cmd, null);
    assert.ok(r.ok, JSON.stringify(r));
    r.release();
  } finally {
    os.loadavg = real;
  }
});

test('tags: in a group they use the id the group uses (so WhatsApp shows the name)', async () => {
  const content = { text: 'hi @27811111111', mentions: ['27811111111@s.whatsapp.net'] };
  const out = await mentions.fix(sock, GROUP, content);
  assert.deepStrictEqual(out.mentions, ['555000111@lid']);
  assert.strictEqual(out.text, 'hi @555000111');
});
test('tags: in a private chat a hidden id is written as the name, never as a number', () => {
  names.remember('987654321012345@lid', 'Chidi');
  const out = mentions.inPrivate({ text: 'by @987654321012345', mentions: ['987654321012345@lid'] });
  assert.strictEqual(out.text, 'by *Chidi*');
  assert.deepStrictEqual(out.mentions, []);
});

test('region: countries, cities and zone names are understood', () => {
  assert.strictEqual(region.find('Nigeria'), 'Africa/Lagos');
  assert.strictEqual(region.find('africa/lagos'), 'Africa/Lagos');
  assert.strictEqual(region.find('UTC+2'), 'Etc/GMT-2');
  assert.strictEqual(region.find('nowhere land'), null);
  store.setRegion('Africa/Lagos');
  assert.strictEqual(require('../core/clock').zone(), 'Africa/Lagos');
  store.setRegion(null);
});

test('notes accept more than 500 characters', async () => {
  store.setMode('public');
  sent.length = 0;
  await handler.handleMessage(sock, msg('27811111111@s.whatsapp.net', `.note add ${'a'.repeat(1500)}`));
  await settle();
  assert.ok(texts().some((t) => /saved/i.test(t)), texts().join('|'));
});

test('play: the right song wins over covers, remixes and long mixes', () => {
  const items = [
    { id: 1, title: 'Calm Down (Remix) - Rema ft Selena Gomez', channel: 'DJ Mix', duration: 200 },
    { id: 2, title: 'Rema - Calm Down (slowed + reverb)', channel: 'chill', duration: 180 },
    { id: 3, title: 'Calm Down', channel: 'Rema - Topic', duration: 239 },
    { id: 4, title: 'Rema Calm Down 1 HOUR', channel: 'x', duration: 3600 },
    { id: 5, title: 'How to calm down fast', channel: 'Therapy', duration: 300 },
  ];
  const ranked = songmatch.rank(items, 'calm down rema');
  assert.strictEqual(ranked[0].id, 3);
  assert.ok(ranked.findIndex((r) => r.id === 4) > ranked.findIndex((r) => r.id === 1));
  assert.ok(songmatch.isClose(ranked[0]));
  assert.ok(!songmatch.isClose(ranked.find((r) => r.id === 5)), 'a different song is not accepted from the backup sources');
  // the person asked for a remix: then it is fine
  assert.strictEqual(songmatch.rank(items, 'calm down remix')[0].id, 1);
});

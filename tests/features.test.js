require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const store = require('../whatsapp/store');
const ratelimit = require('../whatsapp/ratelimit');
const levels = require('../whatsapp/levels');
const birthdays = require('../whatsapp/birthdays');
const lookup = require('../core/lookup');
const meta = require('../whatsapp/metadata');
const adminguard = require('../whatsapp/adminguard');
const { mediaKindOf } = require('../whatsapp/protect');
const notes = require('../commands/notes');
const attp = require('../commands/attp');

const capture = () => {
  const out = [];
  return { out, reply: async (t, extra) => out.push({ t, extra }) };
};

test('rate limit: the limit blocks for a while, the notice is given once, off means no limit', () => {
  store.updateRate((r) => { r.on = true; r.limit = 3; });
  ratelimit.reset();
  assert.ok([1, 2, 3].every(() => ratelimit.check('alice').ok));
  const fourth = ratelimit.check('alice');
  assert.ok(!fourth.ok && fourth.notify === true && fourth.seconds === 30);
  const fifth = ratelimit.check('alice');
  assert.ok(!fifth.ok && fifth.notify === false);
  assert.ok(ratelimit.check('bob').ok); // other people are not affected
  store.updateRate((r) => { r.on = false; });
  assert.ok(ratelimit.check('alice').ok);
});

test('ranks: levels, XP only once in a while, the board and the bar', () => {
  assert.strictEqual(levels.level(24), 0);
  assert.strictEqual(levels.level(25), 1);
  assert.strictEqual(levels.xpFor(2), 100);
  const first = levels.award('g@g.us', '111@lid');
  assert.ok(first && first.xp >= 5 && first.xp <= 12);
  assert.strictEqual(levels.award('g@g.us', '111@lid'), null); // too soon
  levels.award('g@g.us', '222@lid');
  assert.strictEqual(levels.board('g@g.us').length, 2);
  const s = levels.statsOf('g@g.us', '111@lid');
  assert.ok(s.position >= 1 && s.total === 2);
  assert.strictEqual(levels.bar(5, 10), '▰▰▰▰▰▱▱▱▱▱');
});

test('birthdays: dates are understood, days are counted', () => {
  assert.deepStrictEqual(birthdays.parse('25-12'), { d: 25, m: 12 });
  assert.deepStrictEqual(birthdays.parse('25 Dec'), { d: 25, m: 12 });
  assert.deepStrictEqual(birthdays.parse('December 3rd'), { d: 3, m: 12 });
  assert.deepStrictEqual(birthdays.parse('29/2/1996'), { d: 29, m: 2 });
  assert.strictEqual(birthdays.parse('31-4'), null);
  assert.strictEqual(birthdays.parse('hello'), null);
  const now = new Date('2026-12-24T10:00:00Z');
  assert.deepStrictEqual(birthdays.today(now), { d: 24, m: 12 });
  assert.strictEqual(birthdays.daysUntil({ d: 25, m: 12 }, now), 1);
  assert.strictEqual(birthdays.daysUntil({ d: 24, m: 12 }, now), 0);
  assert.strictEqual(birthdays.daysUntil({ d: 1, m: 1 }, new Date('2026-12-26T10:00:00Z')), 6);
});

test('birthdays: saved per person, found in a group by any of their ids', () => {
  birthdays.save(['2348000'], '2348000@s.whatsapp.net', { d: 5, m: 5 });
  const group = { participants: [{ id: '999@lid', lid: '999@lid', phoneNumber: '2348000@s.whatsapp.net' }, { id: '123@lid' }] };
  const found = birthdays.inGroup(group);
  assert.strictEqual(found.length, 1);
  assert.deepStrictEqual([found[0].bd.d, found[0].bd.m], [5, 5]);
  assert.ok(birthdays.remove(['2348000']));
  assert.strictEqual(birthdays.inGroup(group).length, 0);
});

test('lookup helpers: weather text, currencies, languages', () => {
  const text = lookup.weatherMessage('Lagos, Nigeria', {
    current: { temperature_2m: 28.4, apparent_temperature: 31, relative_humidity_2m: 78, wind_speed_10m: 12.2, precipitation: 0, weather_code: 2 },
    daily: { time: ['2026-10-23', '2026-10-24', '2026-10-25'], temperature_2m_min: [24, 25, 24], temperature_2m_max: [31, 32, 30], weather_code: [2, 61, 95], precipitation_probability_max: [10, 60, null] },
  });
  assert.ok(text.includes('*Weather in Lagos, Nigeria*') && text.includes('28°C') && text.includes('Partly cloudy') && text.includes('Sat: 25–32°C, Light rain, rain chance 60%'));
  assert.deepStrictEqual(lookup.parseConvert('100 usd ngn'), { amount: 100, from: 'USD', to: 'NGN' });
  assert.deepStrictEqual(lookup.parseConvert('1,500 eur to usd'), { amount: 1500, from: 'EUR', to: 'USD' });
  assert.deepStrictEqual(lookup.parseConvert('usd zar'), { amount: 1, from: 'USD', to: 'ZAR' });
  assert.strictEqual(lookup.parseConvert('hello'), null);
  assert.strictEqual(lookup.langCode('French'), 'fr');
  assert.strictEqual(lookup.langCode('yo'), 'yo');
  assert.strictEqual(lookup.langCode('klingon'), null);
  assert.strictEqual(lookup.money(1234.5678), '1,234.57');
});

test('anti-promote: an unauthorised promotion is undone, trusted people and the creator are left alone', async () => {
  const group = '120363@g.us';
  store.update(group, (g) => { g.antipromote = true; });
  meta.prime({ [group]: { id: group, participants: [{ id: '777@lid', admin: 'superadmin' }, { id: '888@lid', admin: 'admin' }] } });
  const calls = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, groupParticipantsUpdate: async (...a) => calls.push(a), sendMessage: async () => ({}) };
  await adminguard.guardAdmins(sock, group, 'promote', ['555@lid'], '888@lid'); // an ordinary admin
  assert.deepStrictEqual(calls[0], [group, ['555@lid'], 'demote']);
  calls.length = 0;
  await adminguard.guardAdmins(sock, group, 'promote', ['555@lid'], '777@lid'); // the creator
  await adminguard.guardAdmins(sock, group, 'promote', ['555@lid'], '27800000001@s.whatsapp.net'); // the bot owner
  await adminguard.guardAdmins(sock, group, 'demote', ['555@lid'], '888@lid'); // antidemote is off
  assert.strictEqual(calls.length, 0);
});

test('anti-media: the kind of a message is found', () => {
  assert.strictEqual(mediaKindOf({ stickerMessage: {} }), 'sticker');
  assert.strictEqual(mediaKindOf({ ephemeralMessage: { message: { imageMessage: {} } } }), 'image');
  assert.strictEqual(mediaKindOf({ viewOnceMessageV2: { message: { videoMessage: {} } } }), 'video');
  assert.strictEqual(mediaKindOf({ conversation: 'hi' }), null);
});

test('notes and to-do: private chat only, add, list, done, delete', async () => {
  const [note, todo] = notes;
  const base = { myIds: ['4444'], prefix: '.', isGroup: false, cmdName: 'note' };
  let c = capture();
  await note.run({ ...base, ...c, args: ['add', 'buy', 'bread'], rest: 'add buy bread' });
  await note.run({ ...base, ...c, args: [], rest: '' });
  assert.ok(c.out[0].t.includes('Note 1 saved') && c.out[1].t.includes('1. buy bread'));
  c = capture();
  await note.run({ ...base, ...c, isGroup: true, args: [], rest: '' });
  assert.ok(c.out[0].t.includes('private'));
  c = capture();
  const t = { ...base, cmdName: 'todo', ...c };
  await todo.run({ ...t, args: ['add', 'call', 'mum'], rest: 'add call mum' });
  await todo.run({ ...t, args: ['done', '1'], rest: 'done 1' });
  await todo.run({ ...t, args: [], rest: '' });
  assert.ok(c.out[1].t.includes('Done') && c.out[2].t.includes('☑ 1. ~call mum~'));
});

test('text stickers: the picture is valid SVG and the text is escaped', () => {
  const svg = attp.svg('Tom & <Jerry>');
  assert.ok(svg.startsWith('<svg') && svg.includes('Tom &amp;') && !svg.includes('<Jerry>'));
});

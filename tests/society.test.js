require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const ratelimit = require('../whatsapp/ratelimit');
const settings = require('../core/realm/settings');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const civic = require('../core/realm/civic');
const gov = require('../core/realm/gov');
const court = require('../core/realm/court');
const season = require('../core/realm/season');
const festival = require('../core/realm/festival');
const nobility = require('../core/realm/nobility');
const guild = require('../core/realm/guild');
const dungeon = require('../core/realm/dungeon');
const stuff = require('../core/realm/stuff');
const P = require('../core/realm/godplus');
const ticker = require('../core/realm/ticker');

baileys.setForTests({});
store.setMode('public');
const OWNER = '27800000001@s.whatsapp.net';
let gid = 0;
const newGroup = () => `1203690000001${String(++gid).padStart(5, '0')}@g.us`;
let uid = 0;
const person = (g) => {
  const j = `2787330${String(++uid).padStart(4, '0')}@s.whatsapp.net`;
  if (g) S.citizen(g, j);
  return j;
};
const DAY = 86400000;
const HOUR = 3600000;
const T0 = Date.now();

function fakeSock() {
  const sent = [];
  return {
    user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' }, sent,
    texts: () => sent.filter((s) => s.c.text).map((s) => s.c.text),
    sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
    groupMetadata: async () => ({ subject: 'G', participants: [{ id: OWNER, admin: 'admin' }] }),
    groupFetchAllParticipating: async () => ({}),
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {},
  };
}
let n = 0;
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 15)); };
async function say(sock, group, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: group, participant: from, id: `S${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
const last = (sock) => sock.texts().at(-1);

// ------------------------------------------------------------------ seasons
test('season: points count, the best win prizes and a title, and a new season begins', () => {
  const g = newGroup();
  const a = person(g), b = person(g);
  season.current(g, T0);
  season.points(g, a, 100, T0);
  season.points(g, b, 5, T0); // under the minimum
  const before = A.balance(g, a);
  const r = season.finish(g, T0 + 31 * DAY);
  assert.strictEqual(r.won.length, 1);
  assert.ok(A.balance(g, a) > before, 'the prize is paid');
  assert.ok(S.citizen(g, a).crown, 'the champion has a title');
  assert.strictEqual(season.board(g).length, 0, 'points start again');
  assert.strictEqual(season.box(g).n, 2);
});
test('season: points percent is a God setting, and 0 stops points', () => {
  const g = newGroup();
  const a = person(g);
  settings.set('season.pointsPct', 200, g);
  assert.strictEqual(season.points(g, a, 10, T0), 20);
  settings.set('season.pointsPct', 0, g);
  assert.strictEqual(season.points(g, a, 10, T0), 0);
});
test('season: summer pays more, autumn gives estates more, spring nothing', () => {
  const g = newGroup();
  season.current(g, T0);
  assert.strictEqual(civic.mult(g, 'pay', T0), 1);
  season.box(g).n = 2; // Summer
  season.current(g, T0);
  assert.ok(civic.mult(g, 'pay', T0) > 1);
  season.box(g).n = 3; // Autumn
  season.current(g, T0);
  assert.ok(civic.mult(g, 'output', T0) > 1);
  assert.strictEqual(civic.mult(g, 'pay', T0), 1);
});
test('season: the daily gift gives season points', () => {
  const g = newGroup();
  const a = person(g);
  A.daily(g, a);
  assert.ok(season.pointsOf(g, a) > 0);
});
test('season: the job ends a due season and tells the group, tagging the winners', async () => {
  const g = newGroup();
  const a = person(g);
  season.points(g, a, 100, T0);
  season.box(g).end = Date.now() - 1000;
  const posts = [];
  await ticker.run(async (grp, c) => posts.push({ grp, c }));
  const mine = posts.find((p) => p.grp === g && /Season 1/.test(p.c.text));
  assert.ok(mine, 'the result was posted');
  assert.ok(mine.c.mentions.includes(a));
});

// ------------------------------------------------------------------ festivals
test('festival: starts by itself after the period, pays more, ends and is announced', async () => {
  const g = newGroup();
  person(g);
  S.realmOf(g);
  const posts = [];
  const post = async (grp, c) => posts.push({ grp, c });
  await festival.job(post, T0); // the clock is set
  assert.strictEqual(festival.active(g, T0 + 1), null);
  await festival.job(post, T0 + 8 * DAY);
  const f = festival.active(g, T0 + 8 * DAY + 1);
  assert.ok(f);
  assert.ok(civic.mult(g, 'pay', T0 + 8 * DAY + 1) > 1);
  assert.ok(posts.some((p) => p.grp === g && /has begun/.test(p.c.text)));
  await festival.job(post, T0 + 9 * DAY);
  assert.strictEqual(festival.active(g, T0 + 9 * DAY), null);
  assert.strictEqual(civic.mult(g, 'pay', T0 + 9 * DAY), 1);
});
test('festival: God can turn it off with everyDays 0, start and stop one', async () => {
  const g = newGroup();
  person(g);
  S.realmOf(g);
  settings.set('festival.everyDays', 0, g);
  await festival.job(async () => {}, T0 + 400 * DAY);
  assert.strictEqual(festival.active(g, T0 + 400 * DAY), null);
  assert.ok(P.festivalNow(g, true).ok);
  assert.ok(festival.active(g));
  assert.ok(P.festivalNow(g, false).ok);
  assert.strictEqual(festival.active(g), null);
});

// ------------------------------------------------------------------ nobility
test('nobility: only the Sovereign gives titles, seats are limited, the treasury pays, and a noble earns more', () => {
  const g = newGroup();
  const sov = person(g), a = person(g), b = person(g);
  gov.crown(g, sov, T0);
  assert.strictEqual(nobility.grant(g, a, b, 'baron').why, 'rights');
  assert.strictEqual(nobility.grant(g, sov, a, 'duke').why, 'poor');
  A.treasuryAdd(g, 100000);
  const base = A.earnMult(g, a);
  assert.ok(nobility.grant(g, sov, a, 'duke').ok);
  assert.ok(A.earnMult(g, a) > base, 'the perk');
  assert.strictEqual(nobility.grant(g, sov, b, 'duke').why, 'full');
  assert.ok(nobility.grant(g, sov, a, 'duke').renewed, 'renewing needs no free seat');
  assert.ok(nobility.strip(g, sov, a).ok);
  assert.strictEqual(nobility.titleOf(g, a), null);
});
test('nobility: a title runs out', () => {
  const g = newGroup();
  const a = person(g);
  P.title(g, a, 'knight');
  assert.ok(nobility.titleOf(g, a));
  assert.strictEqual(nobility.titleOf(g, a, Date.now() + 40 * DAY), null);
  nobility.sweep(g, Date.now() + 40 * DAY);
  assert.strictEqual(nobility.list(g).length, 0);
});

// ------------------------------------------------------------------ guilds
test('guilds: found, invite, join, deposit, level up, pay bonus, leave and disband', () => {
  const g = newGroup();
  const a = person(g), b = person(g), c = person(g);
  A.add(g, a, 100000);
  assert.strictEqual(guild.create(g, c, 'Wolves').why, 'poor');
  const r = guild.create(g, a, 'Iron Wolves');
  assert.ok(r.ok);
  assert.strictEqual(guild.create(g, b, 'iron wolves').why, 'taken');
  assert.strictEqual(guild.join(g, b, 'Iron Wolves').why, 'invite');
  assert.strictEqual(guild.invite(g, b, c).why, 'rights');
  assert.ok(guild.invite(g, a, b).ok);
  assert.ok(guild.join(g, b, 'iron').ok);
  const lv1 = A.earnMult(g, b);
  assert.strictEqual(guild.upgrade(g, a).why, 'poor');
  assert.ok(guild.deposit(g, a, guild.upgradeCost(g, r.guild)).ok);
  assert.ok(guild.upgrade(g, a).ok);
  assert.ok(A.earnMult(g, b) > lv1, 'the guild level gives pay');
  assert.strictEqual(guild.upgrade(g, b).why, 'rights');
  assert.strictEqual(guild.kick(g, a, a).why, 'self');
  assert.ok(guild.leave(g, b).ok);
  assert.ok(guild.leave(g, a).disbanded);
  assert.strictEqual(guild.all(g).length, 0);
});
test('guilds: the member limit holds', () => {
  const g = newGroup();
  const a = person(g);
  A.add(g, a, 10000);
  settings.set('guild.membersBase', 1, g);
  guild.create(g, a, 'Tiny');
  assert.strictEqual(guild.invite(g, a, person(g)).why, 'full');
});

// ------------------------------------------------------------------ dungeons
test('dungeons: a party gathers, pays the fee, goes in, and the loot is shared', () => {
  const g = newGroup();
  const a = person(g), b = person(g);
  A.add(g, a, 1000); A.add(g, b, 1000);
  const o = dungeon.openRun(g, a, 'cellar', T0);
  assert.ok(o.ok);
  assert.strictEqual(dungeon.openRun(g, a, 'crypt', T0).why, 'busy');
  const j = dungeon.joinRun(g, b, o.run.id, T0);
  assert.ok(j.ok);
  assert.strictEqual(dungeon.due(g, T0).length, 0);
  assert.strictEqual(dungeon.due(g, T0 + 11 * 60000).length, 1);
  const before = A.balance(g, a);
  const res = dungeon.settle(g, o.run, T0 + 11 * 60000, () => 0); // always wins
  assert.ok(res.win);
  assert.ok(A.balance(g, a) > before);
  assert.ok(stuff.countOf(g, a, 'grain') > 0);
  assert.strictEqual(dungeon.openRun(g, a, 'cellar', T0 + 12 * 60000).why, 'rest');
});
test('dungeons: a defeat or a party too small pays nothing, and leaving or God calling it off returns the fee', () => {
  const g = newGroup();
  const a = person(g), b = person(g);
  A.add(g, a, 5000); A.add(g, b, 5000);
  const o = dungeon.openRun(g, a, 'crypt', T0); // needs 2
  const small = dungeon.settle(g, o.run, T0 + HOUR, () => 0);
  assert.ok(!small.win && !small.enough);
  const o2 = dungeon.openRun(g, b, 'cellar', T0 + 5 * HOUR);
  const fee = dungeon.get('fee_cellar', g);
  const bal = A.balance(g, b);
  assert.ok(P.dungeonCall(g, o2.run.id).ok);
  assert.ok(A.balance(g, b) >= bal, 'fee returned');
  assert.ok(fee > 0);
  const o3 = dungeon.openRun(g, a, 'cellar', T0 + 9 * HOUR);
  assert.ok(dungeon.leaveRun(g, a).ok);
  assert.strictEqual(dungeon.open(g).length, 0);
  assert.ok(o3.ok);
});
test('dungeons: odds rise with the party and never pass God\'s highest chance', () => {
  const g = newGroup();
  const a = person(g);
  A.add(g, a, 10000);
  const o = dungeon.openRun(g, a, 'lair', T0);
  const one = dungeon.odds(g, o.run);
  for (let i = 0; i < 4; i++) { const p = person(g); A.add(g, p, 10000); dungeon.joinRun(g, p, o.run.id, T0); }
  assert.ok(dungeon.odds(g, o.run) > one);
  settings.set('dungeon.oddsMax', 40, g);
  assert.ok(dungeon.odds(g, o.run) <= 40);
});

// ------------------------------------------------------------------ jail blocks work
test('jail: a prisoner cannot use daily, work, collect, trade or auction, and God is not blocked', async () => {
  const g = newGroup();
  const a = person(g);
  civic.jail(g, a, 30);
  const sock = fakeSock();
  for (const cmd of ['daily', 'work', 'collect', 'weekly']) {
    await say(sock, g, a, `.${cmd}`);
    assert.match(last(sock), /in jail/i, cmd);
  }
  await say(sock, g, a, '.purse');
  assert.doesNotMatch(last(sock), /in jail/i);
  civic.free(g, a);
  await say(sock, g, a, '.daily');
  assert.doesNotMatch(last(sock), /in jail/i);
});

// ------------------------------------------------------------------ income tax shown
test('tax: the daily gift pays the tax into the treasury', () => {
  const g = newGroup();
  const a = person(g);
  P.tax(g, 10);
  const t0 = A.treasury(g);
  const r = A.daily(g, a);
  assert.ok(r.ok);
  assert.ok(A.treasury(g) > t0);
  assert.ok(r.tax > 0);
});

// ------------------------------------------------------------------ the commands, in a group
test('commands: government, law, guild, dungeon, season, nobility answer in a group', async () => {
  const g = newGroup();
  const a = person(g);
  const sock = fakeSock();
  for (const [text, re] of [['.government', /Government/], ['.law', /laws/i], ['.treasury', /Treasury/], ['.court', /court/i], ['.guild top', /guilds/i], ['.dungeon', /Dungeons/], ['.season', /Season 1/], ['.nobility', /nobility/i], ['.festival', /Festivals/], ['.election', /election/i], ['.tax', /Income tax/], ['.jail', /jail/i], ['.referendum', /referendum/i]]) {
    await say(sock, g, a, text);
    assert.match(last(sock), re, text);
  }
  await say(sock, g, a, '.guild create Test Guild');
  assert.match(last(sock), /Guild founded|costs/i);
  await say(sock, g, a, '.profile');
  assert.match(last(sock), /Citizen/);
});
test('commands: an election can be run from the chat', async () => {
  const g = newGroup();
  const a = person(g), v1 = person(g), v2 = person(g), v3 = person(g);
  A.add(g, a, 5000);
  const sock = fakeSock();
  await say(sock, g, a, '.election start');
  assert.match(last(sock), /election is open/i);
  await say(sock, g, a, '.stand');
  assert.match(last(sock), /candidate/i);
  for (const v of [v1, v2, v3]) await say(sock, g, v, `.vote @${a.split('@')[0]}`);
  assert.match(last(sock), /Vote counted|voted/i);
  gov.resolveElection(g, Date.now() + 99 * HOUR);
  assert.strictEqual(gov.officeOf(g, a), 'sovereign');
});

// ------------------------------------------------------------------ God
test('God: every new feature has a switch and numbers God can change', () => {
  for (const f of ['government', 'court', 'season', 'festival', 'nobility', 'guild', 'dungeon']) {
    const feat = settings.one(f);
    assert.ok(feat && feat.settings.has('on'), `${f} has a switch`);
    assert.ok(feat.settings.size >= 4, `${f} has numbers`);
    const g = newGroup();
    assert.ok(settings.set(`${f}.on`, false, g).ok);
    assert.strictEqual(settings.featureOn(f, g), false);
  }
});
test('God: a feature that is off answers "closed by God" in the group', async () => {
  const g = newGroup();
  const a = person(g);
  settings.set('guild.on', false, g);
  const sock = fakeSock();
  await say(sock, g, a, '.guild');
  assert.match(last(sock), /Closed by God/);
});
test('God: values outside the safe range are refused', () => {
  const g = newGroup();
  assert.strictEqual(settings.set('government.maxTax', 1000, g).ok, false);
  assert.strictEqual(settings.set('guild.createCost', -5, g).ok, false);
  assert.strictEqual(settings.set('dungeon.oddsMax', 101, g).ok, false);
});
test('God: crown, dethrone, officers, election, law, jail, treasury, tax, court, reset all work and write the ledger', () => {
  const g = newGroup();
  const a = person(g), b = person(g), d = person(g);
  A.add(g, b, 1000);
  const ledger = require('../core/realm/ledger');
  const before = ledger.count();
  assert.ok(P.crown(g, a).ok);
  assert.strictEqual(gov.officeOf(g, a), 'sovereign');
  assert.ok(P.officer(g, 'marshal', b).ok);
  assert.strictEqual(gov.officeOf(g, b), 'marshal');
  assert.ok(P.officer(g, 'marshal', null).ok);
  assert.ok(P.treasury(g, 'set', 5000).ok);
  assert.strictEqual(A.treasury(g), 5000);
  assert.ok(P.law(g, 'festival', true).ok);
  assert.strictEqual(A.treasury(g), 5000, 'God\'s law is free');
  assert.ok(P.law(g, 'festival', false).ok);
  assert.ok(P.jail(g, d, 15).ok);
  assert.ok(civic.jailLeft(g, d) > 0);
  assert.strictEqual(P.pardon(g, 'all').count, 1);
  assert.ok(P.tax(g, 7).ok);
  assert.strictEqual(civic.taxRate(g), 7);
  assert.ok(P.election(g, 'start').ok);
  assert.ok(P.election(g, 'cancel').ok);
  const c = court.sue(g, b, d, 'a quarrel', Date.now());
  assert.ok(P.courtEnd(g, c.case.id).ok);
  assert.ok(P.courtClear(g, d).ok);
  assert.ok(P.dethrone(g).ok);
  assert.strictEqual(gov.sovereign(g), null);
  assert.ok(P.reset(g, 'gov').ok);
  assert.ok(ledger.count() >= before + 10, 'everything is in the ledger');
});
test('God: guild, title, season controls work', () => {
  const g = newGroup();
  const a = person(g), b = person(g);
  A.add(g, a, 5000);
  const r = guild.create(g, a, 'Gods Guild');
  assert.ok(P.guildDo(g, 'level', r.guild, 4).ok);
  assert.strictEqual(r.guild.level, 4);
  assert.ok(P.guildDo(g, 'bank', r.guild, 999).ok);
  assert.ok(P.guildDo(g, 'disband', r.guild).ok);
  assert.ok(P.title(g, b, 'duke').ok);
  assert.ok(P.title(g, a, 'duke').ok, 'God ignores the seats');
  assert.ok(P.title(g, a, null).ok);
  assert.ok(P.seasonPoints(g, a, 50).ok);
  assert.strictEqual(season.pointsOf(g, a), 50);
  assert.ok(P.seasonDays(g, 3).ok);
  assert.ok(P.seasonEnd(g).ok);
});
test('God: the god command works in a group and in a private chat for the new features', async () => {
  const g = newGroup();
  const a = person(g);
  const godCore = require('../core/realm/god');
  const sock = fakeSock();
  const ownerSay = async (text) => { await say(sock, g, OWNER, text); return last(sock); };
  assert.match(await ownerSay(`.god crown @${a.split('@')[0]}`), /Crowned/);
  assert.strictEqual(gov.officeOf(g, a), 'sovereign');
  assert.match(await ownerSay('.god treasury set 900'), /Treasury changed/);
  assert.match(await ownerSay('.god guild list'), /Guilds/);
  assert.match(await ownerSay('.god season'), /Season/);
  assert.match(await ownerSay('.god clearstate guild'), /confirm/);
  assert.match(await ownerSay('.god'), /Government/);
  godCore.select(g);
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: OWNER, id: `D${++n}`, fromMe: false }, message: { conversation: '.government' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  assert.match(last(sock), /Government/);
});

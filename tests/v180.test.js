require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const songmatch = require('../core/songmatch');

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
  groupMetadata: async (j) => ({ id: j, subject: 'G', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }] }),
  groupFetchAllParticipating: async () => ({ [G]: { id: G, subject: 'G', participants: [] } }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {}, updateProfileStatus: async () => {},
};
let n = 0;
const now = () => Math.floor(Date.now() / 1000);
const dm = (t) => ({ key: { remoteJid: OWNER, id: `D${++n}`, fromMe: false }, message: { conversation: t }, messageTimestamp: now() });
const gm = (t, who = OWNER) => ({ key: { remoteJid: G, participant: who, id: `G${++n}`, fromMe: false }, message: { conversation: t }, messageTimestamp: now() });
const say = async (mk, t) => {
  sent.length = 0;
  await handler.handleMessage(sock, mk(t));
  await handler.idle();
  await new Promise((r) => setTimeout(r, 30));
  return sent.filter((x) => x.c.text).map((x) => x.c.text.split('\n')[0]);
};
const P = () => store.effectivePrefix();

// ------------------------------------------------------------------ repeating a switch
const SWITCHES = [
  [dm, 'autolikestatus on', /Auto like status is already ON/],
  [dm, 'autoviewstatus on', /Auto view status is already ON/],
  [dm, 'autosavestatus on', /Auto save status is already ON/],
  [dm, 'autocorrect off', /Autocorrect is already OFF/],
  [dm, 'maintenance on', /Maintenance is already ON/],
  [dm, 'linkpreview off', /Link previews are already OFF/],
  [dm, 'autoupdate on', /Auto update is already ON/],
  [dm, 'autotag on', /Auto tag is already ON/],
  [dm, 'antidelete all', /Anti-delete is already set to ALL/],
  [gm, 'welcome on', /Welcome message is already ON in this group/],
  [gm, 'goodbye on', /Goodbye message is already ON in this group/],
  [gm, 'antilink delete', /Anti-link is already set to DELETE in this group/],
  [gm, 'antispam warn', /Anti-spam is already set to WARN in this group/],
  [gm, 'antidemote on', /Anti-demote is already ON in this group/],
  [gm, 'autosticker on', /Autosticker is already ON in this group/],
  [gm, 'captcha on', /Verification is already ON in this group/],
  [gm, 'weeklyrecap on', /weekly recap is already ON/],
  [gm, 'catchup on', /Catchup is already ON in this group/],
  [gm, 'welcomedm on', /Welcome DM is already ON in this group/],
];
for (const [mk, cmd, already] of SWITCHES) {
  test(`v1.8.0 repeating "${cmd}" says it is already done`, async () => {
    const first = await say(mk, `${P()}${cmd}`);
    assert.ok(!/already/i.test(first.join(' ')), `the first time it is done: ${first[0]}`);
    const second = await say(mk, `${P()}${cmd}`);
    assert.match(second.join(' '), already, `the second time it says so: ${second[0]}`);
    assert.ok(!/✅/.test(second[0]), 'and it does not claim that something was done');
  });
}

test('v1.8.0 a real change is never called "already": on, off, on, off in a row all say they were done', async () => {
  await say(dm, `${P()}autolikestatus off`); // a known start
  const out = [];
  for (const w of ['on', 'off', 'on', 'off']) out.push((await say(dm, `${P()}autolikestatus ${w}`))[0]);
  for (const line of out) assert.ok(/✅/.test(line) && !/already/i.test(line), line);
});

test('v1.8.0 changing a mode is a change, repeating it is not', async () => {
  const a = (await say(gm, `${P()}antilink kick`))[0];
  const b = (await say(gm, `${P()}antilink warn`))[0];
  const c = (await say(gm, `${P()}antilink warn`))[0];
  assert.match(a, /now \*KICK\*/);
  assert.match(b, /now \*WARN\*/);
  assert.match(c, /already set to WARN/);
});

test('v1.8.0 a refusal is shown as it is, never turned into "already"', async () => {
  const out = await say((t) => gm(t, MEMBER), `${P()}welcome on`); // a member: not allowed
  assert.ok(!/already/i.test(out.join(' ')));
});

test('v1.8.0 enable and disable say it when the command is already in that state', async () => {
  const a = (await say(gm, `${P()}disable ping`))[0];
  const b = (await say(gm, `${P()}disable ping`))[0];
  const c = (await say(gm, `${P()}enable ping`))[0];
  const d = (await say(gm, `${P()}enable ping`))[0];
  assert.match(a, /now turned off/);
  assert.match(b, /already turned off/);
  assert.match(c, /on again/);
  assert.match(d, /already on/);
});

test('v1.8.0 commands that are not a single switch word are untouched', async () => {
  const toggles = require('../core/toggles');
  const cmd = { name: 'welcome' };
  assert.strictEqual(toggles.wordOf(cmd, ['on']), 'on');
  assert.strictEqual(toggles.wordOf(cmd, ['on', 'extra']), null, 'more than one word: the command decides');
  assert.strictEqual(toggles.wordOf(cmd, []), null);
  assert.strictEqual(toggles.wordOf(cmd, ['all']), null, '"all" is only a place for the view-once, delete and edit commands');
  assert.strictEqual(toggles.wordOf({ name: 'antidelete' }, ['all']), 'all');
});

// ------------------------------------------------------------------ the clock
test('v1.8.0 the clock makes each date formatter once, not on every message', () => {
  const clock = require('../core/clock');
  clock.parts(new Date());
  const Real = Intl.DateTimeFormat;
  let made = 0;
  Intl.DateTimeFormat = function (...a) { made += 1; return new Real(...a); };
  try {
    for (let i = 0; i < 500; i++) { clock.parts(new Date(1.7e12 + i * 1e6)); clock.stamp(1.7e12 + i); clock.monthOf(1.7e12 + i); }
  } finally {
    Intl.DateTimeFormat = Real;
  }
  assert.ok(made <= 2, `500 rounds made ${made} new formatters`);
  const p = clock.parts(new Date(Date.UTC(2026, 10, 21, 10, 5)));
  assert.ok(p.time && p.day && p.date && /^\d{2}:\d{2}$/.test(p.hhmm), 'it still gives the same kind of answers');
});

// ------------------------------------------------------------------ song matching
const R = (id, title, channel, duration) => ({ id, title, channel, duration, url: `https://www.youtube.com/watch?v=${id}` });

test('v1.8.0 matching: the real song beats covers, mixes and half matches', () => {
  const ranked = songmatch.rank([
    R('a1', 'Calm Down - Piano Cover', 'Pianist', '3:10'),
    R('a2', 'Relaxing Music to Calm Down and Sleep 1 Hour', 'Relax', '1:00:00'),
    R('a3', 'Rema - Calm Down (Official Music Video)', 'Rema', '3:59'),
    R('a4', 'Selena Gomez - Calm Down (Remix)', 'Rema', '3:40'),
  ], 'rema calm down');
  assert.strictEqual(ranked[0].id, 'a3');
  assert.ok(songmatch.isRight(ranked[0]));
  assert.ok(!songmatch.isRight(ranked.find((r) => r.id === 'a2')), 'a sleep mix is not the song');
});

test('v1.8.0 matching: one matching word out of two is NOT the song (it used to be)', () => {
  const [best] = songmatch.rank([R('b1', 'Selena Gomez - Calm', 'Selena', '3:00'), R('b2', 'Down Under - Men at Work', 'Men at Work', '3:40')], 'calm down');
  assert.ok(!songmatch.isRight(best), `${best.title} has ${best.matched} of ${best.wanted} words`);
});

test('v1.8.0 matching: the number of words needed (all up to 3, three quarters after)', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 8].map(songmatch.neededWords), [1, 2, 3, 3, 4, 5, 6]);
});

test('v1.8.0 matching: small typing mistakes are forgiven, other words are not', () => {
  assert.ok(songmatch.same('donw', 'down'), 'two swapped letters');
  assert.ok(songmatch.same('rihanna', 'rihana'), 'a missing letter');
  assert.ok(songmatch.same('asake', 'asaka'), 'one wrong letter');
  assert.ok(!songmatch.same('calm', 'call'), 'a different 4 letter word');
  assert.ok(!songmatch.same('rema', 'remi'));
  const [best] = songmatch.rank([R('c1', 'Rema - Calm Down (Official Audio)', 'Rema', '3:59')], 'rema calm donw');
  assert.ok(songmatch.isRight(best));
});

test('v1.8.0 matching: every script has words (Hindi, Korean, Thai, Greek...)', () => {
  assert.deepStrictEqual(songmatch.tokens('बेबी सॉन्ग'), ['बेबी', 'सॉन्ग']);
  assert.deepStrictEqual(songmatch.tokens('아이유 좋은날'), ['아이유', '좋은날']);
  assert.ok(songmatch.tokens('เพลง ไทย').length >= 2);
  const [best] = songmatch.rank([R('d1', '아이유 - 좋은날 (Good Day)', 'IU', '4:12'), R('d2', '다른 노래', 'Other', '3:00')], '아이유 좋은날');
  assert.strictEqual(best.id, 'd1');
  assert.ok(songmatch.isRight(best));
});

test('v1.8.0 matching: the asked words in order count extra (the song, not a mix of the same words)', () => {
  const [best] = songmatch.rank([R('e1', 'Last Burna Boy Last Mix', 'DJ', '3:30'), R('e2', 'Burna Boy - Last Last (Official Video)', 'Burna Boy', '3:20')], 'burna boy last last');
  assert.strictEqual(best.id, 'e2');
  assert.strictEqual(best.exact, true);
});

// ------------------------------------------------------------------ play
function loadPlay({ results, flat = [] }) {
  const ytdlp = require('../core/ytdlp');
  const ytsearch = require('../core/ytsearch');
  const piped = require('../core/piped');
  const audius = require('../core/audius');
  const log = { downloads: [] };
  ytsearch.search = async () => results;
  ytdlp.searchFlat = async () => flat;
  ytdlp.downloadAudio = async (url) => { log.downloads.push(url); return { buffer: Buffer.from('x'), mimetype: 'audio/mp4', title: 'T', artist: 'A', duration: '3:00', url }; };
  piped.getAudio = async () => { throw new Error('no piped in tests'); };
  audius.search = async () => [];
  delete require.cache[require.resolve('../commands/play')];
  return { play: require('../commands/play'), log };
}
const playCtx = (text) => {
  const out = { sent: [], replies: [] };
  out.args = { sock: { sendMessage: async (j, c) => { out.sent.push(c); return { key: { id: 'K' } }; } }, jid: OWNER, msg: { key: {} }, rest: text, reply: async (t) => { out.replies.push(t); }, prefix: '.', isOwner: true };
  return out;
};

test('v1.8.0 play: the asked song is downloaded, not another one from the results', async () => {
  const { play, log } = loadPlay({ results: [
    R('p1', 'Calm Down - Piano Cover', 'Pianist', '3:10'),
    R('p2', 'Relaxing Music to Calm Down 1 Hour', 'Relax', '1:00:00'),
    R('p3', 'Rema - Calm Down (Official Music Video)', 'Rema', '3:59'),
  ] });
  const c = playCtx('rema calm down');
  await play.run(c.args);
  assert.deepStrictEqual(log.downloads, ['https://www.youtube.com/watch?v=p3']);
  assert.ok(c.sent.some((m) => m.audio));
});

test('v1.8.0 play: when nothing is the asked song, NOTHING is downloaded and the closest results are shown', async () => {
  const { play, log } = loadPlay({ results: [
    R('q1', 'Burna Boy - City Boys', 'Burna Boy', '3:00'),
    R('q2', 'Burna Boy - Ye', 'Burna Boy', '3:50'),
    R('q3', 'Last Last (Cover)', 'Someone', '3:20'),
  ] });
  const c = playCtx('burna boy last last remix extended');
  await play.run(c.args);
  assert.deepStrictEqual(log.downloads, [], 'no wrong song was sent');
  assert.ok(!c.sent.some((m) => m.audio));
  const text = c.replies.join('\n');
  assert.match(text, /could not find that exact song/);
  assert.match(text, /Closest I found/);
  assert.match(text, /watch\?v=q1/);
});

test('v1.8.0 play: a typing mistake in the name still finds the song', async () => {
  const { play, log } = loadPlay({ results: [R('t1', 'Rema - Calm Down (Official Audio)', 'Rema', '3:59'), R('t2', 'Other Song', 'Other', '3:00')] });
  await play.run(playCtx('rema calm donw').args);
  assert.deepStrictEqual(log.downloads, ['https://www.youtube.com/watch?v=t1']);
});

test('v1.8.0 play: a link is still downloaded exactly as given', async () => {
  const { play, log } = loadPlay({ results: [] });
  await play.run(playCtx('https://youtu.be/abc12345678').args);
  assert.deepStrictEqual(log.downloads, ['https://youtu.be/abc12345678']);
});

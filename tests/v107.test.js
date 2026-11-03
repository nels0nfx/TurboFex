// v1.0.7: 60 new commands. No real service is called: the web, the AI and WhatsApp are fakes.
require('./_setup');
process.env.TURBOFEX_FAST = '1';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// the downloader is replaced BEFORE the commands load (each test file runs in its own process)
const ytdlp = require('../core/ytdlp');
const fetched = [];
ytdlp.downloadVideo = async (target) => { fetched.push(['video', target]); if (/fail/.test(target)) throw Object.assign(new Error('No video could be found'), { code: 'X' }); return { buffer: Buffer.from('vid'), ext: '.mp4', mimetype: 'video/mp4', title: 'A pin' }; };
ytdlp.downloadAudio = async (target, opts) => { fetched.push(['audio', target, opts?.source]); return { buffer: Buffer.from('aud'), mimetype: 'audio/mpeg', title: 'Song', artist: 'Singer', duration: '3:00', url: 'https://sc/x' }; };

const store = require('../whatsapp/store');
const stats = require('../whatsapp/groupstats');
const welcomedm = require('../whatsapp/welcomedm');
const persona = require('../whatsapp/persona');
const media = require('../whatsapp/media');
const safefetch = require('../core/safefetch');
const ai = require('../core/ai');
const games = require('../whatsapp/play');
const knowledge = require('../whatsapp/botknowledge');
const A = require('../core/realm/aurum');
const sharp = require('sharp');

const all = [].concat(...fs.readdirSync(path.join(__dirname, '..', 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(`../commands/${f}`)));
const cmd = (n) => all.find((c) => c.name === n);

const NEW = {
  group: ['lockdown', 'votekick', 'groupstats', 'catchup', 'topwarned', 'swearjar', 'announce', 'quiettime', 'welcomedm', 'weeklyrecap'],
  ai: ['explain', 'rewrite', 'describe', 'solve', 'caption', 'story', 'poem', 'brainstorm', 'persona', 'quizme'],
  media: ['spotify', 'facebook', 'twitter', 'pinterest', 'soundcloud', 'ytthumb', 'emojimix', 'tovideo', 'collage', 'resize'],
  tools: ['calendar', 'dateadd', 'loan', 'interest', 'fuelcost', 'teams', 'shuffle', 'habit', 'shoplist', 'gradecalc'],
  lookup: ['movie', 'tvshow', 'rhyme', 'synonym', 'wordofday', 'namemeaning', 'dialcode', 'postcode', 'hadith', 'emojimeaning'],
  fun: ['neverhaveiever', 'twotruths', 'hotseat', 'wordchain', 'storychain', 'spinwheel', 'memorygame', 'pet', 'fish', 'battleship'],
};
const CATEGORY = { group: 'group', ai: 'ai', media: ['download', 'media'], tools: 'tools', lookup: 'lookup', fun: ['fun', 'games', 'economy'] };

// ---------------------------------------------------------------- fakes
const M = (i) => `2781111${String(i).padStart(4, '0')}@s.whatsapp.net`;
const [A1, B1, C1, D1, E1, F1] = [1, 2, 3, 4, 5, 6].map(M);
let gid = 0;
const newGroup = () => `1203670000001${String(++gid).padStart(5, '0')}@g.us`;

function mk(over = {}) {
  const sent = [];
  const out = [];
  const extra = [];
  const calls = [];
  const sock = {
    sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}`, remoteJid: j } }; },
    groupSettingUpdate: async (j, m) => { calls.push(['setting', j, m]); },
    groupParticipantsUpdate: async (j, ids, act) => { calls.push(['participants', j, ids, act]); return ids.map(() => ({ status: '200' })); },
    profilePictureUrl: async () => null,
  };
  const members = [A1, B1, C1, D1, E1, F1, M(7), M(8), M(9), M(10)].map((id, i) => ({ id, admin: i === 0 ? 'admin' : null }));
  const jid = over.jid || newGroup();
  const ctx = {
    sock, jid, msg: { key: { remoteJid: jid, id: 'M1', participant: A1, fromMe: false }, message: { conversation: 'x' } },
    args: [], rest: '', prefix: '.', reply: async (t, e) => { out.push(t); extra.push(e || {}); },
    isGroup: true, isAdmin: true, isOwner: false, isRealOwner: false, isBotAdmin: true, botIds: ['27800000000'],
    myJid: A1, myIds: ['27811110001'], groupMetadata: { subject: 'Test Group', participants: members }, commandList: all,
    ...over,
  };
  return { ctx, sent, out, extra, calls, sock };
}
// runs a command with a text after its name
async function run(name, text = '', over = {}) {
  const m = mk(over);
  m.ctx.rest = text;
  m.ctx.args = text.split(/\s+/).filter(Boolean);
  await cmd(name).run(m.ctx);
  return m;
}
const mention = (m, ...jids) => { m.ctx.msg.message = { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: jids } } }; return m; };
const last = (m) => m.out[m.out.length - 1] || '';

const FAKE_KEY = 'AIza-test-key-0000000000';
const setKeys = (keys) => { for (const k of ['gemini', 'groq', 'pollinations']) store.setApiKey(k, keys[k] || null); };
const gemini = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const json = (obj) => new Response(JSON.stringify(obj));
async function withFetch(handlerFn, fn) {
  const keep = global.fetch;
  const log = [];
  global.fetch = async (url, opts) => { log.push({ url: String(url), body: String(opts?.body || '') }); return handlerFn(String(url), opts); };
  try { return await fn(log); } finally { global.fetch = keep; }
}
const sysText = (entry) => JSON.parse(entry.body).systemInstruction.parts[0].text;
const userText = (entry) => JSON.parse(entry.body).contents.map((c) => c.parts.map((p) => p.text || '').join('')).join('\n');
const png = (w = 80, h = 40) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).png().toBuffer();

// ---------------------------------------------------------------- all sixty
test('all 60 new commands exist once, in the right category, with a description, and the AI knows them', () => {
  const names = Object.values(NEW).flat();
  assert.strictEqual(names.length, 60);
  for (const [area, list] of Object.entries(NEW)) {
    for (const n of list) {
      const c = cmd(n);
      assert.ok(c, `${n} exists`);
      assert.ok([].concat(CATEGORY[area]).includes(c.category), `${n} is in ${c.category}`);
      assert.ok(c.description && c.description.length >= 15 && c.description.length <= 200, `${n} has a good description`);
      assert.ok(!c.ownerOnly && !c.realOwnerOnly, `${n} is for members`);
    }
  }
  const seen = new Map();
  for (const c of all) for (const n of [c.name, ...(c.aliases || [])]) { assert.ok(!seen.has(n), `${n} is used twice`); seen.set(n, c.name); }
  const text = knowledge.forQuestion({ question: 'how do I use lockdown and persona and wordchain', commandList: all, isOwner: false });
  for (const n of ['lockdown', 'persona', 'wordchain']) assert.match(text, new RegExp(`\\.${n}\\b`));
});

// ---------------------------------------------------------------- group
test('lockdown closes the group and turns protections on, lockdown off puts everything back', async () => {
  const jid = newGroup();
  store.update(jid, (g) => { g.antilinkMode = 'off'; g.antispamMode = 'warn'; });
  let m = await run('lockdown', '', { jid });
  assert.deepStrictEqual(m.calls[0], ['setting', jid, 'announcement']);
  assert.strictEqual(store.getGroup(jid).antilinkMode, 'delete');
  assert.strictEqual(store.getGroup(jid).antispamMode, 'warn', 'a stronger setting is kept');
  assert.match(last(m), /LOCKDOWN/);
  m = await run('lockdown', '', { jid });
  assert.match(last(m), /already on/);
  m = await run('lockdown', 'off', { jid });
  assert.deepStrictEqual(m.calls[0], ['setting', jid, 'not_announcement']);
  assert.strictEqual(store.getGroup(jid).antilinkMode, 'off');
  assert.strictEqual(store.getGroup(jid).antispamMode, 'warn');
  assert.ok(!store.getGroup(jid).lockdown);
  assert.match(last(await run('lockdown', 'off', { jid })), /No lockdown/);
  assert.ok(cmd('lockdown').adminOnly && cmd('lockdown').botAdminRequired);
});

test('votekick: a vote, no double votes, no admins, and the removal at the needed number', async () => {
  const jid = newGroup();
  const target = M(9);
  let m = mention(mk({ jid }), target);
  await cmd('votekick').run({ ...m.ctx, args: [], rest: '' });
  assert.match(last(m), /VOTE: remove @27811110009/);
  assert.match(last(m), /1\/3/); // 10 members: 15% = 2, at least 3
  // the same person again, and a second vote started
  m = await run('votekick', 'yes', { jid });
  assert.match(last(m), /already voted/);
  m = mention(mk({ jid, myJid: B1 }), target);
  await cmd('votekick').run(m.ctx);
  assert.match(last(m), /already running/);
  m = await run('votekick', 'yes', { jid, myJid: B1 });
  assert.match(last(m), /2\/3/);
  m = await run('votekick', 'yes', { jid, myJid: C1 });
  assert.deepStrictEqual(m.calls[0], ['participants', jid, [target], 'remove']);
  assert.match(last(m), /voted/);
  assert.match(last(await run('votekick', 'yes', { jid, myJid: D1 })), /Vote to remove a member/, 'the vote is over');
  // admins cannot be voted out, nobody can vote on their own removal, and the bot must be admin
  const j2 = newGroup();
  m = mention(mk({ jid: j2 }), A1);
  await cmd('votekick').run({ ...m.ctx, myJid: B1 });
  assert.match(last(m), /Admins cannot be voted out/);
  m = mention(mk({ jid: j2, isBotAdmin: false }), target);
  await cmd('votekick').run(m.ctx);
  assert.match(last(m), /must be a group admin/);
  m = mention(mk({ jid: j2, myJid: E1 }), E1);
  await cmd('votekick').run(m.ctx);
  assert.match(last(m), /yourself/);
  // cancel
  m = mention(mk({ jid: j2, myJid: C1 }), target);
  await cmd('votekick').run(m.ctx);
  assert.match(last(await run('votekick', 'cancel', { jid: j2, myJid: C1, isAdmin: false })), /cancelled/);
});

test('groupstats and weeklyrecap read the counters; weeklyrecap on / off uses the scheduler', async () => {
  const jid = newGroup();
  assert.match(last(await run('groupstats', '', { jid })), /No messages counted yet/);
  const now = Date.now();
  for (let i = 0; i < 30; i++) stats.count(jid, A1, now - 3600 * 1000 * (i % 3));
  for (let i = 0; i < 10; i++) stats.count(jid, B1, now);
  for (let i = 0; i < 5; i++) stats.count(jid, C1, now - 3 * 86400000);
  for (let i = 0; i < 4; i++) stats.count(jid, C1, now - 9 * 86400000); // the week before
  const m = await run('groupstats', '7', { jid });
  const t = last(m);
  assert.match(t, /Messages:\* 45/);
  assert.match(t, /Active members:\* 3 of 10/);
  assert.match(t, /🥇 @27811110001 - 30/);
  assert.match(t, /Busiest hour/);
  assert.match(t, /Counting since/);
  assert.ok(m.extra[0].mentions.length >= 3);
  const week = await run('weeklyrecap', '', { jid });
  assert.match(last(week), /Weekly recap/);
  assert.match(last(week), /Messages:\* 45 \(\+/, 'compared with the week before (4 messages)');
  // on / off
  const before = store.schedules().length;
  await run('weeklyrecap', 'on', { jid });
  const item = store.schedules().find((s) => s.jid === jid && s.cmd === 'weeklyrecap');
  assert.ok(item && item.time === '20:00' && item.repeat.kind === 'weekly' && item.repeat.days[0] === 'sun');
  await run('weeklyrecap', 'on', { jid });
  assert.strictEqual(store.schedules().filter((s) => s.jid === jid).length, 1, 'no second item');
  assert.strictEqual(await (async () => { const m2 = await run('weeklyrecap', 'on', { jid, isAdmin: false }); return m2.out.length; })(), 0, 'members: silence');
  await run('weeklyrecap', 'off', { jid });
  assert.strictEqual(store.schedules().length, before);
});

test('the counters keep only numbers on disk, and only 35 days', () => {
  const jid = newGroup();
  const now = Date.now();
  for (let d = 0; d < 40; d++) stats.count(jid, A1, now - d * 86400000);
  assert.ok(Object.keys(JSON.parse(JSON.stringify(require('../core/jsonstore').open('groupstats', {}).data.groups[jid].days))).length <= 35);
  stats.setCatchup(jid, true);
  stats.onMessage(jid, A1, 'a secret sentence', { name: 'Ann' });
  assert.ok(!JSON.stringify(require('../core/jsonstore').open('groupstats', {}).data).includes('secret sentence'), 'message text is never in the saved data');
});

test('catchup: opt in by an admin, memory only, the AI summarises it', async () => {
  const jid = newGroup();
  assert.match(last(await run('catchup', '', { jid })), /Catchup is off/);
  assert.strictEqual((await run('catchup', 'on', { jid, isAdmin: false })).out.length, 0, 'members cannot switch it on');
  assert.match(last(await run('catchup', 'on', { jid })), /Catchup is ON/);
  assert.match(last(await run('catchup', '', { jid })), /not much to catch up/);
  for (let i = 0; i < 8; i++) stats.onMessage(jid, i % 2 ? A1 : B1, `message number ${i} about the football match`, { name: i % 2 ? 'Ann' : 'Ben' });
  stats.onMessage(jid, A1, '.help', { name: 'Ann', isCommand: true });
  setKeys({ gemini: FAKE_KEY });
  try {
    await withFetch(() => gemini('• Ann and Ben talked about football'), async (log) => {
      const m = await run('catchup', '', { jid });
      assert.match(last(m), /While you were away[\s\S]*football/);
      const sys = sysText(log[0]);
      assert.match(sys, /\] Ben: message number 0 about the football match/);
      assert.ok(!/\.help/.test(sys), 'commands are not part of it');
    });
    assert.match(last(await run('catchup', 'off', { jid })), /OFF/);
    assert.match(last(await run('catchup', '', { jid })), /Catchup is off/);
    stats.setCatchup(jid, true);
    assert.match(last(await run('catchup', '', { jid })), /not much to catch up/, 'the old messages were deleted');
  } finally { setKeys({}); }
});

test('topwarned and swearjar', async () => {
  const jid = newGroup();
  assert.match(last(await run('topwarned', '', { jid })), /Nobody has a warning/);
  store.addWarning(jid, B1); store.addWarning(jid, B1); store.addWarning(jid, C1);
  const t = last(await run('topwarned', '', { jid }));
  assert.ok(t.indexOf('27811110002') >= 0 && t.indexOf('27811110002') < t.indexOf('27811110003'));
  assert.match(t, /- 2\//);
  // the jar
  assert.match(last(await run('swearjar', '', { jid })), /jar is off/);
  assert.strictEqual((await run('swearjar', 'on', { jid, isAdmin: false })).out.length, 0);
  await run('swearjar', 'on', { jid });
  stats.onMessage(jid, B1, 'what the fuck is this shit', { name: 'Ben' });
  stats.onMessage(jid, B1, 'this is a BULLSHIT, damn, crap, piss', { name: 'Ben' }); // at most 3 for one message
  stats.onMessage(jid, C1, 'banana is a banned word here', { extraWords: ['banana'] });
  stats.onMessage(jid, A1, 'a clean message');
  stats.onMessage(jid, A1, 'fuck', { isCommand: true });
  const j = await run('swearjar', '', { jid });
  assert.match(last(j), /🥇 @27811110002 - 5/);
  assert.match(last(j), /@27811110003 - 1/);
  assert.match(last(j), /6 words/);
  await run('swearjar', 'reset', { jid });
  assert.match(last(await run('swearjar', '', { jid })), /jar is empty/);
  await run('swearjar', 'off', { jid });
  stats.onMessage(jid, B1, 'shit');
  assert.strictEqual(stats.jarTotal(jid), 0);
});

test('announce tags everybody quietly, quiettime sets and clears the night times', async () => {
  const m = await run('announce', 'Meeting tonight at 8pm');
  assert.match(m.sent[0].c.text, /ANNOUNCEMENT[\s\S]*Meeting tonight at 8pm/);
  assert.strictEqual(m.sent[0].c.mentions.length, 10 + 0, 'all members (the sender is a member)');
  assert.ok(!/@27811110005/.test(m.sent[0].c.text), 'no long list of names');
  assert.match(last(await run('announce', '')), /Usage/);
  assert.match(last(await run('announce', 'x'.repeat(1001))), /too long/);

  const jid = newGroup();
  assert.match(last(await run('quiettime', '', { jid })), /OFF/);
  assert.match(last(await run('quiettime', '22:00 06:00', { jid })), /closes at \*22:00\* and opens at \*06:00\*/);
  assert.deepStrictEqual([store.getGroup(jid).autoMute.mute, store.getGroup(jid).autoMute.unmute], ['22:00', '06:00']);
  assert.match(last(await run('quiettime', '', { jid })), /closed from \*22:00\* to \*06:00\*/);
  assert.match(last(await run('quiettime', '25:00 06:00', { jid })), /Usage|Set it/);
  await run('quiettime', 'off', { jid });
  assert.deepStrictEqual([store.getGroup(jid).autoMute.mute, store.getGroup(jid).autoMute.unmute], [null, null]);
});

test('welcomedm: settings, a test message, and the private welcome with the rules (limited)', async () => {
  const jid = newGroup();
  store.update(jid, (g) => { g.rules = 'Be kind.'; });
  assert.match(last(await run('welcomedm', 'on', { jid })), /Private welcome is ON/);
  assert.match(last(await run('welcomedm', 'set Hello! Welcome to {group}. {rules}', { jid })), /saved/);
  const t = await run('welcomedm', 'test', { jid });
  assert.strictEqual(t.sent[0].j, A1);
  assert.match(t.sent[0].c.text, /Hello! Welcome to .*\*Group rules\*\nBe kind\./s);
  assert.match(last(await run('welcomedm', 'set ' + 'x'.repeat(601), { jid })), /too long/);
  // the join event
  welcomedm.settings.gapMs = 0;
  const dms = [];
  const sock = { sendMessage: async (j, c) => { dms.push([j, c.text]); }, groupMetadata: async () => ({ subject: 'Fun Group', participants: [] }) };
  assert.strictEqual(await welcomedm.send(sock, jid, [B1, '120363@g.us', C1]), 2, 'only people, not groups');
  assert.match(dms[0][1], /Hello! Welcome to Fun Group\./);
  await run('welcomedm', 'off', { jid });
  assert.strictEqual(await welcomedm.send(sock, jid, [D1]), 0);
  await run('welcomedm', 'on', { jid });
  const ids = Array.from({ length: 40 }, (_, i) => M(100 + i));
  assert.strictEqual(await welcomedm.send(sock, jid, ids), 18, 'at most 20 an hour for one group (2 were already used)');
});

// ---------------------------------------------------------------- AI
test('explain, rewrite, story, poem, brainstorm send the right instruction and say when the AI is down', async () => {
  setKeys({ gemini: FAKE_KEY });
  try {
    await withFetch(() => gemini('An answer.'), async (log) => {
      let m = await run('explain', 'black holes');
      assert.match(last(m), /^💡 An answer\./);
      assert.match(userText(log[0]), /Explain this in very simple words[\s\S]*black holes/);
      m = await run('rewrite', 'polite Send me the money now');
      assert.match(userText(log[1]), /in a polite tone[\s\S]*Send me the money now/);
      m = await run('rewrite', 'just make it clearer');
      assert.match(userText(log[2]), /clearer and better written[\s\S]*just make it clearer/);
      await run('story', 'a dragon afraid of fire');
      assert.match(userText(log[3]), /about 150 words[\s\S]*a dragon afraid of fire/);
      await run('poem', 'haiku the ocean');
      assert.match(userText(log[4]), /a haiku about: the ocean/);
      await run('poem', 'my mother');
      assert.match(userText(log[5]), /short poem[\s\S]*my mother/);
      await run('brainstorm', 'names for a bakery');
      assert.match(userText(log[6]), /8 different[\s\S]*names for a bakery/);
      // replying to a message gives the text
      const r = mk();
      r.ctx.msg.message = { extendedTextMessage: { text: 'explain', contextInfo: { quotedMessage: { conversation: 'quantum stuff' } } } };
      await cmd('explain').run(r.ctx);
      assert.match(userText(log[7]), /quantum stuff/);
    });
    for (const n of ['explain', 'rewrite', 'story', 'poem', 'brainstorm', 'quizme']) assert.match(last(await run(n, '')), /Usage/, `${n} shows how to use it`);
    await withFetch(() => new Response('{"error":{"message":"busy"}}', { status: 500 }), async () => {
      const m = await run('story', 'a cat');
      assert.match(last(m), /not answering right now/);
      assert.ok(!/busy|500/.test(last(m)), 'members never see the reason');
      assert.match(last(await run('story', 'a cat', { isOwner: true })), /Reason/);
    });
  } finally { setKeys({}); }
});

test('persona: a style per chat, admins only in a group, used by the ai command and the chatbot knowledge', async () => {
  const jid = newGroup();
  assert.match(last(await run('persona', '', { jid })), /style:\* normal/);
  assert.strictEqual((await run('persona', 'pirate', { jid, isAdmin: false })).out.length, 0, 'members: silence');
  assert.match(last(await run('persona', 'pirate', { jid })), /pirate style/);
  assert.match(last(await run('persona', 'dragon', { jid })), /do not know the style/);
  assert.match(knowledge.forQuestion({ question: 'hello', commandList: all, jid }), /STYLE FOR THIS CHAT[^\n]*pirate/);
  setKeys({ gemini: FAKE_KEY });
  try {
    await withFetch(() => gemini('Arr!'), async (log) => {
      await run('ai', 'hello there', { jid });
      assert.match(sysText(log[0]), /friendly pirate/);
      await run('persona', 'off', { jid });
      await run('ai', 'hello there', { jid });
      assert.ok(!/friendly pirate/.test(sysText(log[1])));
    });
  } finally { setKeys({}); }
  // a private chat: anybody may set it
  const dm = '27855550107@s.whatsapp.net';
  assert.match(last(await run('persona', 'zen', { jid: dm, isGroup: false, isAdmin: false })), /zen style/);
  assert.strictEqual(persona.get(dm), 'zen');
  assert.ok(!/ignore/i.test(persona.styleFor(dm)) && /only how you write/.test(persona.styleFor(dm)), 'a style never changes what the AI may do');
});

test('quizme: five questions, the answers are kept back until quizme answers', async () => {
  setKeys({ gemini: FAKE_KEY });
  const jid = newGroup();
  try {
    await withFetch(() => gemini('Q1. Largest planet?\nA) Mars B) Jupiter C) Venus D) Earth\nQ2. Closest star?\nA) Sirius B) Sun C) Mars D) Moon\nANSWERS: 1B 2B'), async () => {
      const m = await run('quizme', 'the solar system', { jid });
      assert.match(last(m), /Quiz: the solar system[\s\S]*Q1\. Largest planet\?/);
      assert.ok(!/ANSWERS|1B 2B/.test(last(m)), 'the answers are not shown');
      assert.match(last(await run('quizme', 'answers', { jid })), /Answers\*\n1B 2B/);
      assert.match(last(await run('quizme', 'answers', { jid })), /no quiz to answer/);
    });
  } finally { setKeys({}); }
});

test('ai.see sends the picture to Gemini (inline data) and then to Groq; describe, solve and caption use it', async () => {
  const pic = await png(120, 60);
  const realHandle = media.handle;
  media.handle = async (ctx, kinds, usage, worker) => worker({ kind: 'image', animated: false }, pic);
  setKeys({ gemini: FAKE_KEY });
  try {
    await withFetch(() => gemini('A blue rectangle.'), async (log) => {
      let m = await run('describe', '');
      assert.match(last(m), /^🖼️ A blue rectangle\./);
      const body = JSON.parse(log[0].body);
      const parts = body.contents[0].parts;
      assert.strictEqual(parts[0].inlineData.mimeType, 'image/jpeg');
      assert.ok(Buffer.from(parts[0].inlineData.data, 'base64').length > 100);
      assert.match(parts[1].text, /Describe this picture/);
      await run('describe', 'what colour is it?');
      assert.strictEqual(JSON.parse(log[1].body).contents[0].parts[1].text, 'what colour is it?');
      m = await run('solve', '');
      assert.match(JSON.parse(log[2].body).contents[0].parts[1].text, /step by step[\s\S]*Answer:/);
      assert.match(last(m), /^🧮/);
      m = await run('caption', '');
      assert.match(JSON.parse(log[3].body).contents[0].parts[1].text, /3 different short captions/);
      assert.match(last(m), /^📝/);
      // text instead of a picture
      await run('solve', '12 x 8 + 5');
      assert.match(userText(log[4]), /12 x 8 \+ 5/);
      await run('caption', 'sunset at the beach');
      assert.match(userText(log[5]), /sunset at the beach/);
    });
    // Gemini is down: the Groq vision model gets the picture
    setKeys({ gemini: FAKE_KEY, groq: 'gsk_test_key_0000000000000' });
    await withFetch((url) => (url.includes('groq') ? json({ choices: [{ message: { content: 'From Groq.' } }] }) : new Response('{"error":{"message":"overloaded"}}', { status: 503 })), async (log) => {
      const m = await run('describe', '');
      assert.match(last(m), /From Groq\./);
      const groq = log.find((l) => l.url.includes('groq'));
      assert.match(groq.body, /image_url/);
      assert.match(groq.body, /data:image\/jpeg;base64,/);
      assert.match(groq.body, /llama-4-scout/);
    });
    // no key at all: a clear message (owner and member)
    setKeys({});
    assert.match(last(await run('describe', '', { isOwner: true })), /needs an AI key[\s\S]*setapi gemini/);
    assert.match(last(await run('describe', '')), /cannot look at pictures/);
  } finally { media.handle = realHandle; setKeys({}); }
});

// ---------------------------------------------------------------- downloads and media
test('facebook, twitter, spotify, soundcloud, pinterest, ytthumb: links are checked and handed on', async () => {
  const dl = cmd('dl');
  const realDl = dl.run;
  const play = cmd('play');
  const realPlay = play.run;
  const handed = [];
  dl.run = async (ctx) => handed.push(['dl', ctx.rest]);
  play.run = async (ctx) => handed.push(['play', ctx.rest]);
  const realGet = safefetch.get;
  try {
    assert.match(last(await run('facebook', '')), /Send a link/);
    assert.match(last(await run('facebook', 'https://example.com/video')), /not a facebook link/);
    await run('facebook', 'https://fb.watch/abc123/');
    await run('twitter', 'check this https://x.com/user/status/12345');
    assert.match(last(await run('twitter', 'https://facebook.com/x')), /not a twitter link/);
    assert.deepStrictEqual(handed, [['dl', 'https://fb.watch/abc123/'], ['dl', 'https://x.com/user/status/12345']]);
    // a link to an evil look-alike host is refused
    assert.match(last(await run('facebook', 'https://notfacebook.com.evil.io/x')), /not a facebook link/);

    // spotify: the name and the artist come from the page
    safefetch.get = async (url) => ({ status: 200, url: 'https://open.spotify.com/track/abc', body: Buffer.from('<html><head><meta property="og:title" content="Calm Down"/><meta property="og:description" content="Rema · Calm Down · 2022"/></head></html>') });
    let m = await run('spotify', 'https://open.spotify.com/track/abc?si=xyz');
    assert.deepStrictEqual(handed[2], ['play', 'Rema Calm Down']);
    assert.match(m.out[0], /Calm Down.*Rema/s);
    await run('spotify', 'burna boy last last');
    assert.deepStrictEqual(handed[3], ['play', 'burna boy last last']);
    safefetch.get = async () => ({ status: 200, url: 'https://open.spotify.com/album/zzz', body: Buffer.from('<html></html>') });
    assert.match(last(await run('spotify', 'https://open.spotify.com/album/zzz')), /link of one song/);
    assert.match(last(await run('spotify', 'https://example.com/a')), /not a Spotify link/);
    assert.match(last(await run('spotify', '')), /Send a Spotify song link/);
  } finally { dl.run = realDl; play.run = realPlay; safefetch.get = realGet; }

  // soundcloud: a name is searched on SoundCloud
  let m = await run('soundcloud', 'burna boy last last');
  assert.deepStrictEqual(fetched.find((f) => f[0] === 'audio'), ['audio', 'burna boy last last', 'soundcloud']);
  assert.match(m.sent[0].c.text, /Song[\s\S]*Singer/);
  assert.ok(Buffer.isBuffer(m.sent[1].c.audio));
  assert.match(last(await run('soundcloud', 'https://youtube.com/watch?v=1')), /not a SoundCloud link/);

  // pinterest: a video, or the picture of the page when there is no video
  m = await run('pinterest', 'https://pin.it/abc');
  assert.ok(m.sent[0].c.video, 'a video pin');
  safefetch.get = async () => ({ status: 200, url: 'https://pinterest.com/pin/1', body: Buffer.from('<meta property="og:image" content="https://i.pinimg.com/564x/aa/bb/cc.jpg"><meta property="og:title" content="Nice pic">') });
  try {
    await withFetch(() => new Response(Buffer.from('JPEGDATA')), async (log) => {
      m = await run('pinterest', 'https://pinterest.com/pin/fail');
      assert.ok(m.sent[0].c.image, 'a picture pin');
      assert.match(m.sent[0].c.caption, /Nice pic/);
      assert.ok(log[0].url.includes('/originals/'), 'the full size');
    });
  } finally { safefetch.get = realGet; }
  assert.match(last(await run('pinterest', 'https://example.com/pin')), /not a Pinterest link/);

  // ytthumb: the biggest picture that exists
  await withFetch((url) => (url.includes('maxresdefault') ? new Response('', { status: 404 }) : new Response(Buffer.from('IMG'))), async (log) => {
    m = await run('ytthumb', 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(Buffer.isBuffer(m.sent[0].c.image));
    assert.ok(log[0].url.includes('/dQw4w9WgXcQ/maxresdefault') && log[1].url.includes('sddefault'));
  });
  assert.match(last(await run('ytthumb', 'hello')), /Send a YouTube link/);
});

test('emojimix makes a sticker from two emojis, resize and collage and tovideo work with real pictures', async () => {
  // emojimix
  const pic = await png(64, 64);
  await withFetch(() => new Response(pic), async (log) => {
    const m = await run('emojimix', '😀 😎');
    assert.ok(Buffer.isBuffer(m.sent[0].c.sticker));
    assert.strictEqual((await sharp(m.sent[0].c.sticker).metadata()).format, 'webp');
    assert.ok(log[0].url.includes(encodeURIComponent('😀') + '_' + encodeURIComponent('😎')));
  });
  assert.match(last(await run('emojimix', '😀')), /Usage/);
  await withFetch(() => new Response('no', { status: 404 }), async () => {
    assert.match(last(await run('emojimix', '😀 🫠')), /do not mix/);
  });

  const realHandle = media.handle;
  try {
    // resize
    const big = await png(400, 200);
    media.handle = async (ctx, kinds, usage, worker) => worker({ kind: 'image' }, big);
    let m = await run('resize', '50%');
    assert.deepStrictEqual([(await sharp(m.sent[0].c.image).metadata()).width, (await sharp(m.sent[0].c.image).metadata()).height], [200, 100]);
    assert.match(m.sent[0].c.caption, /200x100 .*was 400x200/);
    m = await run('resize', '100');
    assert.strictEqual((await sharp(m.sent[0].c.image).metadata()).width, 100);
    m = await run('resize', '300x300 file');
    assert.ok(m.sent[0].c.document && m.sent[0].c.fileName === 'resized.png');
    assert.strictEqual((await sharp(m.sent[0].c.document).metadata()).width, 300, 'fits inside, keeps the shape');
    assert.match(last(await run('resize', '900%')), /between 5% and 400%/);
    assert.match(last(await run('resize', '5')), /between 16 and 4096/);
    assert.match(last(await run('resize', '')), /Resize a picture/);

    // tovideo (a still sticker becomes a 3 second video; needs ffmpeg)
    const webp = await sharp(await png(64, 64)).webp().toBuffer();
    media.handle = async (ctx, kinds, usage, worker) => worker({ kind: 'sticker', animated: false }, webp);
    m = await run('tovideo', '');
    if (media.ffmpegBinary()) {
      assert.ok(m.sent[0].c.video.length > 500, 'a real mp4');
      assert.strictEqual(m.sent[0].c.mimetype, 'video/mp4');
    }
  } finally { media.handle = realHandle; }

  // collage: the profile pictures of the members in a grid
  const small = await png(50, 50);
  const g = mk();
  g.sock.profilePictureUrl = async (id) => (id === C1 || id === D1 || id === E1 || id === F1 ? `https://pps.whatsapp.net/${id}.jpg` : null);
  await withFetch(() => new Response(small), async () => { await cmd('collage').run(g.ctx); });
  const meta = await sharp(g.sent[0].c.image).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [480, 480], '4 pictures make a 2 by 2 grid');
  assert.match(g.sent[0].c.caption, /Test Group.*4 members/);
  const none = mk();
  await cmd('collage').run(none.ctx);
  assert.match(last(none), /Not enough profile pictures/);
});

// ---------------------------------------------------------------- tools
test('calendar, dateadd', async () => {
  const c = last(await run('calendar', '2 2028'));
  assert.match(c, /February 2028/);
  assert.match(c, /Mo Tu We Th Fr Sa Su\n {4}1  2  3  4  5/, 'the 1st of Feb 2028 is a Tuesday');
  assert.match(c, /28 29/, 'leap year');
  assert.match(last(await run('calendar', 'dec 2026 sun')), /Su Mo Tu We Th Fr Sa\n {7}1  2  3  4  5/);
  assert.match(last(await run('calendar', '2026-03')), /March 2026/);
  assert.match(last(await run('calendar', '13 2026')), /2026/); // 13 is not a month: ignored
  assert.match(last(await run('calendar', '')), /Today is/);

  assert.match(last(await run('dateadd', '2026-12-25 +10 days')), /Friday 25 Dec 2026[\s\S]*Monday 4 Jan 2027/);
  assert.match(last(await run('dateadd', '2026-01-31 +1 month')), /Saturday 28 Feb 2026/);
  assert.match(last(await run('dateadd', '2024-01-31 1m')), /Thursday 29 Feb 2024/);
  assert.match(last(await run('dateadd', '25/12/2026 -2 weeks')), /Friday 11 Dec 2026/);
  assert.match(last(await run('dateadd', '2026-12-25 +1 year')), /Saturday 25 Dec 2027/);
  assert.match(last(await run('dateadd', '+45 days')), /\+ 45 days/);
  assert.match(last(await run('dateadd', '2026-02-30 +1')), /could not read that date/);
  assert.match(last(await run('dateadd', 'banana')), /Usage/);
});

test('loan, interest, fuelcost, gradecalc give the right numbers', async () => {
  // 10000 at 12% for 2 years: 470.73 a month
  let t = last(await run('loan', '10000 12 2'));
  assert.match(t, /Monthly payment:\* 470\.73/);
  assert.match(t, /Total paid back:\* 11,297\.63/);
  assert.match(last(await run('loan', '5000 0 10m')), /Monthly payment:\* 500\.00/);
  assert.match(last(await run('loan', '-5 12 2')), /Usage/);
  assert.match(last(await run('loan', '1000 12 80')), /too big/);
  // 1000 at 12% for 1 year, monthly: 1126.83
  t = last(await run('interest', '1000 12 1'));
  assert.match(t, /You will have:\* 1,126\.83/);
  t = last(await run('interest', '0 0 1 add 100'));
  assert.match(t, /You will have:\* 1,200\.00/);
  assert.match(last(await run('interest', 'abc')), /Usage/);
  t = last(await run('fuelcost', '120 8 1.5 return'));
  assert.match(t, /240 km/);
  assert.match(t, /19\.2 litres/);
  assert.match(t, /Total:\* 28\.80/);
  assert.match(last(await run('fuelcost', '120')), /Usage/);
  // grades
  assert.match(last(await run('gradecalc', '70 80 90')), /Average:\* 80%/);
  assert.match(last(await run('gradecalc', '70x50 90x50')), /Final grade:\* 80%/);
  assert.match(last(await run('gradecalc', '60x50 need 80')), /You need 100%/);
  assert.match(last(await run('gradecalc', '60x50 need 90')), /not possible any more/);
  assert.match(last(await run('gradecalc', '90x50 need 40')), /nothing more/);
  assert.match(last(await run('gradecalc', '90x50 need 70')), /You need 50% on the rest/);
  assert.match(last(await run('gradecalc', '70x30 80')), /weight for every mark/);
  assert.match(last(await run('gradecalc', '')), /Usage/);
});

test('teams, shuffle', async () => {
  let t = last(await run('teams', '2 Ann Ben Cara Dan Eve'));
  const names = [...t.matchAll(/\b(Ann|Ben|Cara|Dan|Eve)\b/g)].map((x) => x[1]);
  assert.deepStrictEqual(names.sort(), ['Ann', 'Ben', 'Cara', 'Dan', 'Eve']);
  assert.match(t, /Team 1/);
  assert.match(t, /Team 2/);
  const g = await run('teams', '3');
  assert.strictEqual(g.extra[0].mentions.length, 10, 'in a group it splits the members');
  assert.match(last(await run('teams', '3 Ann Ben')), /at least 3 names/);
  assert.match(last(await run('teams', '2', { isGroup: false })), /Write the names/);
  assert.match(last(await run('teams', 'x')), /Usage/);
  t = last(await run('shuffle', 'a, b, c, d'));
  assert.deepStrictEqual([...t.matchAll(/\*\d\.\* (\w)/g)].map((x) => x[1]).sort(), ['a', 'b', 'c', 'd']);
  assert.match(last(await run('shuffle', 'only')), /Usage/);
});

test('habit keeps a streak across days, shoplist is shared by the chat', async () => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  try {
    const user = { myJid: M(60) };
    assert.match(last(await run('habit', '', user)), /No habits yet/);
    assert.match(last(await run('habit', 'add drink water', user)), /Habit added/);
    assert.match(last(await run('habit', 'add drink water', user)), /already have/);
    assert.match(last(await run('habit', 'done', user)), /streak:\* 1 day/i);
    assert.match(last(await run('habit', 'done 1', user)), /already done today/);
    now += 86400000;
    assert.match(last(await run('habit', 'done water', user)), /Streak:\* 2 days \(your best!\)/);
    now += 86400000;
    assert.match(last(await run('habit', '', user)), /🔥 2/, 'alive until the end of the next day');
    now += 2 * 86400000;
    assert.match(last(await run('habit', '', user)), /🔥 0 _\(best 2\)/, 'the streak is over');
    assert.match(last(await run('habit', 'done 1', user)), /Streak:\* 1 day/);
    assert.match(last(await run('habit', 'remove 1', user)), /Removed/);
    assert.match(last(await run('habit', 'remove 1', user)), /Usage/);
  } finally { Date.now = real; }

  const jid = newGroup();
  assert.match(last(await run('shoplist', '', { jid })), /list is empty/);
  assert.match(last(await run('shoplist', 'add milk, eggs, bread', { jid })), /Added 3 items[\s\S]*1\.\* milk[\s\S]*3\.\* bread/);
  assert.match(last(await run('shoplist', 'done 2', { jid, myJid: B1 })), /2\.\* ✅ ~eggs~/, 'everybody in the chat can use it');
  assert.match(last(await run('shoplist', 'remove 1', { jid })), /1\.\* ✅ ~eggs~[\s\S]*2\.\* bread/);
  assert.strictEqual((await run('shoplist', 'clear', { jid, isAdmin: false })).out.length, 0, 'members cannot clear it');
  assert.match(last(await run('shoplist', 'clear', { jid })), /cleared/);
  assert.match(last(await run('shoplist', 'add ' + Array.from({ length: 51 }, (_, i) => `item${i}`).join(','), { jid })), /hold 50/);
  assert.match(last(await run('shoplist', 'add one', { jid: newGroup() })), /Added 1 item\b/, 'another chat has its own list');
});

// ---------------------------------------------------------------- lookups
test('lookups: movie, tvshow, rhyme, synonym, wordofday, dialcode, postcode, hadith', async () => {
  const routes = (url) => {
    if (url.includes('itunes.apple.com')) return json({ results: [{ trackName: 'Black Panther', artistName: 'Ryan Coogler', releaseDate: '2018-02-16T08:00:00Z', primaryGenreName: 'Action', trackTimeMillis: 8040000, contentAdvisoryRating: 'PG-13', longDescription: 'A king returns home.', trackViewUrl: 'https://tv.apple.com/x', artworkUrl100: 'https://img/100x100bb.jpg' }] });
    if (url.includes('tvmaze.com')) return url.includes('nothing') ? new Response('', { status: 404 }) : json({ name: 'Money Heist', premiered: '2017-05-02', genres: ['Crime'], rating: { average: 8.2 }, status: 'Ended', network: { name: 'Antena 3' }, runtime: 70, language: 'Spanish', summary: '<p>A <b>heist</b> story.</p>', url: 'https://tvmaze.com/s', image: { original: 'https://img/s.jpg' } });
    if (url.includes('rel_rhy')) return json([{ word: 'light' }, { word: 'fight' }, { word: 'right' }, { word: 'sight' }]);
    if (url.includes('rel_syn')) return json([{ word: 'joyful' }, { word: 'glad' }]);
    if (url.includes('rel_ant')) return json([{ word: 'sad' }]);
    if (url.includes('dictionaryapi.dev')) return json([{ word: 'x', phonetic: '/x/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fine thing.', example: 'What a fine thing.' }] }] }]);
    if (url.includes('zippopotam.us')) return url.includes('00000') ? new Response('{}', { status: 404 }) : json({ 'post code': '90210', country: 'United States', places: [{ 'place name': 'Beverly Hills', state: 'California' }] });
    if (url.includes('hadith-api')) return url.includes('/9999.json') ? new Response('', { status: 404 }) : json({ hadiths: [{ hadithnumber: 1, text: 'Actions are judged by intentions.' }] });
    return new Response('?', { status: 500 });
  };
  await withFetch(routes, async (log) => {
    let m = await run('movie', 'Black Panther');
    assert.ok(Buffer.isBuffer(m.sent[0]?.c.image) || /Black Panther/.test(last(m)));
    const text = m.sent[0]?.c.caption || last(m);
    assert.match(text, /Black Panther\* \(2018\)[\s\S]*Action[\s\S]*Ryan Coogler[\s\S]*134 min[\s\S]*PG-13/);
    assert.ok(log.some((l) => l.url.includes('600x600bb')), 'a big poster is asked for');
    m = await run('tvshow', 'Money Heist');
    assert.match(m.sent[0]?.c.caption || last(m), /Money Heist\* \(2017\)[\s\S]*8\.2\/10[\s\S]*Antena 3[\s\S]*A heist story\./);
    assert.match(last(await run('tvshow', 'nothing')), /could not find a show/);
    assert.match(last(await run('rhyme', 'night')), /light, fight, right, sight/);
    assert.match(last(await run('synonym', 'happy')), /joyful, glad[\s\S]*Opposite:\* sad/);
    assert.match(last(await run('wordofday', '')), /Word of the day[\s\S]*A fine thing\./);
    assert.ok(!log.some((l) => l.url.includes('restcountries')), 'the dial codes need no website');
    assert.match(last(await run('postcode', 'us 90210')), /90210.*United States[\s\S]*Beverly Hills, California/);
    assert.match(last(await run('postcode', '90210')), /Beverly Hills/, 'a 5 digit code is a US zip');
    assert.match(last(await run('postcode', 'us 00000')), /could not find the postcode/);
    assert.match(last(await run('postcode', 'banana')), /Usage/);
    assert.match(last(await run('hadith', '1')), /Sahih al-Bukhari 1[\s\S]*intentions/);
    assert.match(last(await run('hadith', '')), /Sahih al-Bukhari/);
    assert.match(last(await run('hadith', '99999')), /Usage/);
  });
  // a service that is down says so, and a member sees no technical text
  await withFetch(() => new Response('x', { status: 500 }), async () => {
    for (const [n, t] of [['movie', 'Cars'], ['tvshow', 'Lost'], ['rhyme', 'cat'], ['synonym', 'big'], ['postcode', 'us 12345'], ['hadith', '5']]) {
      const text = last(await run(n, t));
      assert.match(text, /not answering right now/, n);
      assert.ok(!/500/.test(text), n);
    }
    assert.match(last(await run('wordofday', '')), /dictionary is not answering/);
  });
  // the word of the day is the same all day
  assert.strictEqual(last(await withFetch(routes, () => run('wordofday', ''))), last(await withFetch(routes, () => run('wordofday', ''))));
});

test('namemeaning and emojimeaning use the AI', async () => {
  setKeys({ gemini: FAKE_KEY });
  try {
    await withFetch(() => gemini('A name from Igbo.'), async (log) => {
      assert.match(last(await run('namemeaning', 'Amara')), /📛 \*Amara\*[\s\S]*Igbo/);
      assert.match(userText(log[0]), /first name "Amara"/);
      assert.match(last(await run('emojimeaning', 'what is 🫠')), /🫠 \*Emoji meaning\*[\s\S]*Igbo/);
      assert.match(userText(log[1]), /emoji 🫠/);
    });
    assert.match(last(await run('namemeaning', '')), /Usage/);
    assert.match(last(await run('emojimeaning', 'no emoji here')), /Usage/);
    await withFetch(() => new Response('{}', { status: 500 }), async () => {
      assert.match(last(await run('namemeaning', 'Amara')), /not answering/);
      assert.match(last(await run('emojimeaning', '😀')), /not answering/);
    });
  } finally { setKeys({}); }
});

// ---------------------------------------------------------------- fun
test('neverhaveiever does not repeat, hotseat picks a member, spinwheel announces a winner', async () => {
  const jid = newGroup();
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(last(await run('neverhaveiever', '', { jid })));
  assert.strictEqual(seen.size, 30, 'no repeats in 30 rounds');
  assert.match([...seen][0], /Never have I ever\.\.\./);

  let m = await run('hotseat', '');
  assert.match(last(m), /HOT SEAT[\s\S]*is in the hot seat/);
  assert.strictEqual(m.extra[0].mentions.length, 1);
  m = mention(mk(), D1);
  await cmd('hotseat').run(m.ctx);
  assert.deepStrictEqual(m.extra[0].mentions, [D1]);

  m = await run('spinwheel', 'pizza, burgers, sushi');
  const finals = m.sent.filter((s) => s.c.edit).map((s) => s.c.text);
  assert.ok(finals.length >= 4, 'it spins, then stops');
  assert.match(finals[finals.length - 1], /The wheel stopped![\s\S]*(pizza|burgers|sushi)/);
  assert.match(last(await run('spinwheel', 'only')), /Usage/);
  assert.match(last(await run('spinwheel', Array.from({ length: 21 }, (_, i) => `o${i}`).join(','))), /20 choices/);
});

test('twotruths: needs an admin bot, hides the message, mixes the statements, votes and reveal', async () => {
  const jid = newGroup();
  assert.match(last(await run('twotruths', '', { jid })), /Two truths and a lie/);
  assert.match(last(await run('twotruths', 'one | two', { jid })), /Two truths and a lie/);
  assert.match(last(await run('twotruths', 'a | b | c', { jid, isBotAdmin: false })), /must be a group admin/);
  let m = await run('twotruths', 'I can swim | I have a twin | I have been to Mars', { jid });
  assert.deepStrictEqual(m.sent[0].c.delete.id, 'M1', 'the message with the answer is deleted');
  const board = m.sent[1].c.text;
  assert.match(board, /\*1\.\*[\s\S]*\*2\.\*[\s\S]*\*3\.\*/);
  const lieAt = [...board.matchAll(/\*(\d)\.\* (.*)/g)].find((x) => x[2] === 'I have been to Mars')[1];
  assert.match(last(await run('twotruths', 'a | b | c', { jid })), /round is running/);
  assert.match(last(await run('twotruths', lieAt, { jid, myJid: A1 })), /cannot vote/, 'the writer cannot vote');
  await run('twotruths', lieAt, { jid, myJid: B1 });
  const wrong = ['1', '2', '3'].filter((x) => x !== lieAt);
  await run('twotruths', wrong[0], { jid, myJid: C1 });
  assert.match(last(await run('twotruths', wrong[1], { jid, myJid: D1 })), /3 votes/);
  assert.strictEqual((await run('twotruths', 'reveal', { jid, myJid: E1, isAdmin: false })).out.length, 0, 'only the writer or an admin');
  const r = last(await run('twotruths', 'reveal', { jid, myJid: A1 }));
  assert.match(r, new RegExp(`lie was number ${lieAt}[\\s\\S]*Mars`));
  assert.match(r, /1 of 3 guessed right \(33%\)/);
  // a message that cannot be deleted cancels the round
  const bad = mk({ jid: newGroup() });
  bad.sock.sendMessage = async () => { throw new Error('forbidden'); };
  bad.ctx.rest = 'a | b | c';
  await cmd('twotruths').run(bad.ctx);
  assert.match(last(bad), /could not hide your message/);
});

test('storychain: start, add, no two in a row, read, end', async () => {
  const jid = newGroup();
  assert.match(last(await run('storychain', '', { jid })), /No story is running/);
  assert.match(last(await run('storychain', 'start', { jid })), /first line/);
  assert.match(last(await run('storychain', 'start One night a taxi stopped.', { jid })), /new story begins/);
  assert.match(last(await run('storychain', 'start Another', { jid })), /already running/);
  assert.match(last(await run('storychain', 'The driver was a ghost.', { jid })), /let somebody else/i);
  assert.match(last(await run('storychain', 'The driver was a ghost.', { jid, myJid: B1 })), /sentence 2/);
  assert.match(last(await run('storychain', 'He wanted a free ride.', { jid, myJid: C1 })), /sentence 3/);
  assert.match(last(await run('storychain', 'read', { jid })), /One night a taxi stopped\. The driver was a ghost\. He wanted a free ride\./);
  assert.strictEqual((await run('storychain', 'end', { jid, myJid: D1, isAdmin: false })).out.length, 0, 'only the starter or an admin');
  assert.match(last(await run('storychain', 'end', { jid })), /THE END[\s\S]*3 sentences by 3 writers/);
  assert.match(last(await run('storychain', 'read', { jid })), /No story is running/);
});

test('pet: adopt, feed, play, sleep, waiting times, hunger and leaving', async () => {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  const me = { myJid: M(70) };
  try {
    assert.match(last(await run('pet', '', me)), /no pet yet/);
    assert.match(last(await run('pet', 'adopt', me)), /Name your pet/);
    const adopt = last(await run('pet', 'adopt Bruno', me));
    assert.match(adopt, /Welcome .* Bruno[\s\S]*Food[\s\S]*Fun[\s\S]*Energy/);
    assert.match(last(await run('pet', 'adopt Max', me)), /already have Bruno/);
    assert.match(last(await run('pet', 'feed', me)), /Yum[\s\S]*Food\s+▰{10} 100%/);
    assert.match(last(await run('pet', 'feed', me)), /is full|needs a moment/);
    assert.match(last(await run('pet', 'play', me)), /what fun/);
    assert.match(last(await run('pet', 'play', me)), /needs a moment\.\* Try again in 20 minutes/);
    now += 21 * 60000;
    assert.match(last(await run('pet', 'play', me)), /what fun/);
    assert.match(last(await run('pet', 'sleep', me)), /good nap/);
    now += 10 * 3600000; // ten hours away
    const later = last(await run('pet', '', me));
    assert.match(later, /Food\s+▰{6}▱{4} 5\d%/);
    now += 15 * 3600000;
    assert.match(last(await run('pet', '', me)), /very hungry/);
    now += 30 * 3600000; // hungry for more than a day
    assert.match(last(await run('pet', '', me)), /Bruno left|left\./);
    assert.match(last(await run('pet', '', me)), /no pet yet/, 'a new one can be adopted');
    assert.match(last(await run('pet', 'adopt Rex', me)), /Welcome/);
    // other people have their own pet
    assert.match(last(await run('pet', '', { myJid: M(71) })), /no pet yet/);
  } finally { Date.now = real; }
});

test('fish pays Aurum in the Empire, with a waiting time and the tax', async () => {
  const jid = newGroup();
  const me = M(80);
  const realRandom = Math.random;
  try {
    Math.random = () => 0.7; // a nice fish
    const before = A.balance(jid, me);
    const m = await run('fish', '', { jid, myJid: me });
    assert.match(last(m), /You went fishing[\s\S]*nice fish[\s\S]*Sold for:\* \+/);
    assert.ok(A.balance(jid, me) > before);
    assert.match(last(await run('fish', '', { jid, myJid: me })), /fish are hiding/i);
    Math.random = () => 0; // an old boot
    const m2 = await run('fish', '', { jid, myJid: M(81) });
    assert.match(last(m2), /old boot[\s\S]*nothing/);
  } finally { Math.random = realRandom; }
  // a closed realm: nothing happens
  const closed = newGroup();
  require('../core/realm/state').setOn(closed, false);
  assert.match(last(await run('fish', '', { jid: closed, myJid: me })), /realm is closed/i);
  assert.strictEqual(cmd('fish').category, 'economy');
});

// ---------------------------------------------------------------- the three new games
const fakeFor = (players, extra = {}) => {
  const sent = [];
  return { sent, ctx: { game: null, players, sock: { sendMessage: async (j, c) => { sent.push(c); return { key: { id: `E${sent.length}` } }; } }, jid: 'g', send: async (t, mentions = []) => { sent.push({ text: t, mentions }); return { key: { id: 'S' } }; }, end: async (w) => { sent.ended = w || true; }, later: (ms, fn) => setTimeout(fn, ms), touch() {}, ...extra } };
};
const P = (i) => ({ ids: [`2790000${i}`], jid: `2790000${i}@s.whatsapp.net` });
const say = (h, f, p, text) => h.onMessage({ ...f.ctx, text, who: p });

test('wordchain: turns, the first letter, no repeats, out when too slow, the last one wins', async () => {
  const h = games.wordchain;
  assert.deepStrictEqual(h.limits(), { min: 2, max: 10 });
  h.settings.turnMs = 60;
  const [p1, p2, p3] = [P(1), P(2), P(3)];
  const f = fakeFor([p1, p2, p3]);
  const g = Object.assign({ players: [p1, p2, p3], roundId: 1, phase: 'playing' }, h.create({}, [p1, p2, p3]));
  f.ctx.game = g;
  assert.match(h.intro(g), /@2790000 ?1|2790000/);
  await h.onStart(f.ctx);
  await say(h, f, p2, 'banana'); // not his turn: ignored
  assert.strictEqual(g.used.size, 0);
  await say(h, f, p1, 'hello there'); // not one word: chatting is ignored
  await say(h, f, p1, 'apple');
  assert.strictEqual(g.last, 'apple');
  await say(h, f, p2, 'banana'); // must start with E
  assert.match(f.sent[f.sent.length - 1].text, /must start with \*E\*/);
  await say(h, f, p3, 'eagle'); // not her turn: ignored
  assert.strictEqual(g.last, 'apple');
  await say(h, f, p2, 'eagle');
  await say(h, f, p3, 'egg');
  assert.strictEqual(g.last, 'egg');
  await say(h, f, p1, 'gate');
  await say(h, f, p2, 'eagle'); // used before
  assert.match(f.sent[f.sent.length - 1].text, /already used/);
  await say(h, f, p2, 'go'); // too short: ignored
  assert.strictEqual(g.last, 'gate');
  // nobody answers: p1 is out, then p2, and p3 wins
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(g.over, true);
  assert.strictEqual(f.sent.ended.jid, p1.jid, 'p2 and p3 ran out of time, p1 is the last one');
  assert.match(f.sent.map((s) => s.text || '').join('\n'), /ran out of time[\s\S]*Winner/);
  h.settings.turnMs = 25000;
  clearTimeout(g.turnTimer);
});

test('memorygame: the row is shown, hidden, and the first correct answer wins', async () => {
  const h = games.memorygame;
  h.settings.showMs = 5;
  h.settings.perEmojiMs = 1;
  const [p1, p2] = [P(4), P(5)];
  const f = fakeFor([p1, p2]);
  const g = Object.assign({ players: [p1, p2], roundId: 1, phase: 'playing', series: { round: 2, total: 6, scores: {} } }, h.create({}, [p1, p2]));
  f.ctx.game = g;
  await h.onStart(f.ctx);
  assert.strictEqual(g.sequence.length, 4, 'round 2 has 4 emojis');
  assert.ok(f.sent.some((s) => s.edit), 'the row was hidden by editing the message');
  assert.strictEqual(g.ready, true);
  await say(h, f, p1, '🍎🍎'); // wrong length: ignored
  assert.strictEqual(f.sent.ended, undefined);
  const wrong = g.sequence.map((e) => (e === '🍎' ? '🍌' : '🍎'));
  await say(h, f, p1, wrong.join(' '));
  assert.match(f.sent[f.sent.length - 1].text, /Not quite/);
  assert.strictEqual(f.sent.ended, undefined);
  await say(h, f, p2, g.sequence.join(' '));
  assert.strictEqual(f.sent.ended.jid, p2.jid);
  assert.strictEqual(g.ready, false);
  // before the row is hidden nothing counts
  const g2 = Object.assign({ players: [p1], sequence: ['🍎', '🍌'], ready: false }, {});
  const f2 = fakeFor([p1]);
  f2.ctx.game = g2;
  await say(h, f2, p1, '🍎🍌');
  assert.strictEqual(f2.sent.ended, undefined);
});

test('battleship: hits, misses, sinking, the end by victory and by running out of shots', async () => {
  const h = games.battleship;
  const [p1, p2] = [P(6), P(7)];
  const g = Object.assign({ players: [p1, p2] }, h.create({}, [p1, p2]));
  assert.strictEqual(g.ships.length, 3);
  assert.strictEqual(new Set(g.ships.flatMap((s) => s.cells)).size, 7, 'the ships never overlap');
  for (let i = 0; i < 30; i++) assert.ok(h.place().every((s) => s.cells.every((c) => c.split(',').every((n) => n >= 0 && n < 6))), 'inside the sea');
  g.ships = [{ name: 'Cruiser', cells: ['0,0', '1,0', '2,0'], hits: new Set() }, { name: 'Destroyer', cells: ['0,2', '0,3'], hits: new Set() }];
  const f = fakeFor([p1, p2]);
  f.ctx.game = g;
  await say(h, f, p1, 'hello'); // chatting is ignored
  assert.strictEqual(g.shots, 20);
  await say(h, f, p1, 'f6');
  assert.match(f.sent[f.sent.length - 1].text, /miss/);
  assert.strictEqual(g.shots, 19);
  await say(h, f, p2, 'F6');
  assert.match(f.sent[f.sent.length - 1].text, /already fired/);
  assert.strictEqual(g.shots, 19, 'a repeated square costs nothing');
  await say(h, f, p1, 'a1');
  assert.match(f.sent[f.sent.length - 1].text, /hit/);
  await say(h, f, p2, '1b'); // the other way round works too
  await say(h, f, p1, 'c1');
  assert.match(f.sent[f.sent.length - 1].text, /SANK the Cruiser/);
  await say(h, f, p2, 'a3');
  await say(h, f, p2, 'a4');
  const final = f.sent[f.sent.length - 1].text;
  assert.match(final, /whole fleet is sunk with \d+ shots to spare/);
  assert.match(final, /hits\)/);
  assert.ok(Array.isArray(f.sent.ended) && f.sent.ended.length === 2);
  // out of shots
  const g2 = Object.assign({ players: [p1] }, h.create({}, [p1]));
  g2.shots = 1;
  const f2 = fakeFor([p1]);
  f2.ctx.game = g2;
  const free = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((c) => [1, 2, 3, 4, 5, 6].map((r) => `${c}${r}`)).find((s) => !g2.ships.some((sh) => sh.cells.includes(`${'abcdef'.indexOf(s[0])},${Number(s[1]) - 1}`)));
  await say(h, f2, p1, free);
  assert.match(f2.sent[f2.sent.length - 1].text, /Out of shots[\s\S]*🚢/);
  assert.strictEqual(f2.sent.ended, true);
  assert.match(h.onTimeout(g2).text, /Time is up/);
});

test('the new games start through the engine and the admin starts them solo', async () => {
  for (const [name, type] of [['battleship', 'battleship'], ['wordchain', 'wordchain'], ['memorygame', 'memorygame']]) {
    const jid = newGroup();
    const m = mk({ jid });
    m.ctx.args = name === 'wordchain' ? [] : ['solo'];
    await cmd(name).run(m.ctx);
    const g = games.get(jid);
    assert.ok(g, `${name} opened`);
    assert.strictEqual(g.type, type);
    if (name === 'wordchain') {
      assert.strictEqual(g.phase, 'lobby', 'it needs 2 players: a lobby');
      assert.match(m.sent[0].c.text, /Word Chain[\s\S]*join/);
    } else {
      assert.strictEqual(g.phase, name === 'battleship' ? 'playing' : g.phase);
      assert.match(m.sent[0].c.text, name === 'battleship' ? /Battleship/ : /Memory/);
    }
    assert.ok(games.canEnd(g, m.ctx.myIds), 'the players may end it');
    games.end(jid);
  }
  assert.ok(['battleship', 'wordchain', 'memorygame'].every((n) => cmd(n).adminOnly && cmd(n).category === 'games'));
});

test('every new command that needs an argument says how to use it when it gets none', async () => {
  const needsText = ['explain', 'rewrite', 'story', 'poem', 'brainstorm', 'quizme', 'spotify', 'facebook', 'twitter', 'pinterest', 'soundcloud', 'ytthumb', 'emojimix', 'dateadd', 'loan', 'interest', 'fuelcost', 'teams', 'shuffle', 'gradecalc', 'movie', 'tvshow', 'rhyme', 'synonym', 'namemeaning', 'dialcode', 'postcode', 'emojimeaning', 'spinwheel', 'announce', 'resize'];
  for (const n of needsText) {
    const t = last(await run(n, ''));
    assert.ok(t && /usage|send a|write|example|resize|\bsend\b|\bname\b|\blink\b|\bemojis?\b|prefix|\.${n}/i.test(t) || t.includes(`.${n}`), `${n} explains itself: ${t.slice(0, 60)}`);
  }
});

test('dialcode works without any website: names, other names, codes and shared codes', async () => {
  const keep = global.fetch;
  global.fetch = async () => { throw new Error('no internet'); };
  try {
    assert.match(last(await run('dialcode', 'Kenya')), /🇰🇪 \*Kenya\*[\s\S]*\+254/);
    assert.match(last(await run('dialcode', 'kenya')), /\+254/);
    assert.match(last(await run('dialcode', 'UK')), /United Kingdom[\s\S]*\+44/);
    assert.match(last(await run('dialcode', 'ng')), /Nigeria[\s\S]*\+234/);
    assert.match(last(await run('dialcode', "Cote d'Ivoire")), /Ivory Coast[\s\S]*\+225/);
    assert.match(last(await run('dialcode', 'Jamaica')), /\+1 876/);
    assert.match(last(await run('dialcode', 'Atlantis')), /could not find a country/);
    assert.match(last(await run('dialcode', '+234')), /🇳🇬 Nigeria/);
    const uk = last(await run('dialcode', '44'));
    for (const n of ['United Kingdom', 'Jersey', 'Guernsey', 'Isle of Man']) assert.match(uk, new RegExp(n));
    const one = last(await run('dialcode', '+1'));
    assert.match(one, /United States/);
    assert.match(one, /Canada/);
    assert.match(one, /shared by many countries/);
    assert.match(last(await run('dialcode', '1876')), /Jamaica/);
    assert.match(last(await run('dialcode', '9999')), /do not know a country/);
    assert.match(last(await run('dialcode', '')), /Usage/);
  } finally { global.fetch = keep; }
  const dial = require('../core/dialcodes');
  assert.ok(dial.COUNTRIES.length >= 235);
  assert.strictEqual(new Set(dial.COUNTRIES.map((c) => c.iso)).size, dial.COUNTRIES.length, 'every country once');
  for (const c of dial.COUNTRIES) assert.match(c.code, /^\d{1,4}$/, c.name);
});

test('movie: iTunes first, Wikipedia when iTunes does not know the title, a clear message when both are down', async () => {
  const wiki = (url) => {
    if (url.includes('list=search')) return json({ query: { search: [{ title: 'Black Panther (film)', snippet: 'a 2018 film' }] } });
    if (url.includes('page/summary')) return json({ title: 'Black Panther (film)', description: '2018 Marvel film', extract: 'Black Panther is a 2018 superhero film.', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Black_Panther_(film)' } } });
    return null;
  };
  // iTunes answers with no results (or something else): Wikipedia is used
  for (const itunes of [{ resultCount: 0, results: [] }, { weird: true }]) {
    await withFetch((url) => (url.includes('itunes.apple.com') ? json(itunes) : url.includes('upload.wikimedia') ? new Response(Buffer.from('IMG')) : wiki(url)), async (log) => {
      const m = await run('movie', 'Black Panther');
      const text = m.sent[0]?.c.caption || last(m);
      assert.match(text, /Black Panther \(film\)[\s\S]*2018 Marvel film[\s\S]*superhero film[\s\S]*wikipedia\.org/);
      assert.ok(log[0].url.includes('itunes') && log.some((l) => l.url.includes('wikipedia')));
    });
  }
  // the best match of several iTunes results is taken, not simply the first
  await withFetch(() => json({ results: [{ trackName: 'Black Panther: Wakanda Forever', releaseDate: '2022-11-11T00:00:00Z' }, { trackName: 'Black Panther', releaseDate: '2018-02-16T00:00:00Z', primaryGenreName: 'Action' }] }), async () => {
    assert.match(last(await run('movie', 'Black Panther')), /Black Panther\* \(2018\)/);
  });
  // nothing anywhere
  await withFetch((url) => (url.includes('itunes') ? json({ results: [] }) : json({ query: { search: [] } })), async () => {
    assert.match(last(await run('movie', 'Zzzxqj')), /could not find a movie called \*Zzzxqj\*/);
  });
  // both services down
  await withFetch(() => new Response('x', { status: 503 }), async () => {
    const t = last(await run('movie', 'Cars'));
    assert.match(t, /not answering right now/);
    assert.ok(!/503/.test(t));
  });
});

test('emojimix: a second service and the right message when they are down or do not know the pair', async () => {
  const pic = await png(64, 64);
  // the first service is down, the second (Tenor) has it
  await withFetch((url) => {
    if (url.includes('emojik')) return new Response('down', { status: 503 });
    if (url.includes('tenor.googleapis.com')) return json({ results: [{ media_formats: { png_transparent: { url: 'https://media.tenor.com/mix.png' } } }] });
    return new Response(pic);
  }, async (log) => {
    const m = await run('emojimix', '😀 😎');
    assert.ok(Buffer.isBuffer(m.sent[0].c.sticker));
    assert.ok(log.some((l) => l.url.includes('tenor.googleapis.com') && l.url.includes('emoji_kitchen')));
    assert.ok(log.filter((l) => l.url.includes('emojik')).length === 2, 'both orders were tried');
  });
  // a page that is not a picture is not a mix
  await withFetch((url) => (url.includes('tenor') ? json({ results: [] }) : new Response('<html>not found</html>')), async () => {
    assert.match(last(await run('emojimix', '🫠 🦄')), /do not mix/);
  });
  // everything down: not "do not mix"
  await withFetch(() => new Response('x', { status: 500 }), async () => {
    const t = last(await run('emojimix', '😀 😎'));
    assert.match(t, /not answering right now/);
    assert.ok(!/do not mix/.test(t));
  });
});

test('menu header: every line name starts with a matching emoji, the bot name has none, categories stay plain', async () => {
  const sent = [];
  const m = mk();
  m.ctx.commandList = all;
  m.ctx.isOwner = false;
  m.ctx.args = [];
  await cmd('menu').run(m.ctx);
  const text = m.out[0];
  const header = text.split('┗✦')[0].split('\n');
  assert.match(header[0], /^┏✦ ◈ \*[A-Z ]+\* ◈$/, 'the bot name line has no emoji');
  const rows = header.slice(1).filter((l) => l.startsWith('┃'));
  assert.ok(rows.length >= 7);
  const want = { User: '👤', Prefix: '⌨️', Mode: /^(🔒|🌍)$/, Commands: '📋', Version: '🏷️', Speed: '⚡', Uptime: '⏱️' };
  const names = { ᴜꜱᴇʀ: 'User', ᴘʀᴇꜰɪx: 'Prefix', ᴍᴏᴅᴇ: 'Mode', ᴄᴏᴍᴍᴀɴᴅꜱ: 'Commands', ᴠᴇʀꜱɪᴏɴ: 'Version', ꜱᴘᴇᴇᴅ: 'Speed', ᴜᴘᴛɪᴍᴇ: 'Uptime' };
  for (const row of rows) {
    const [, icon, label] = /^┃ (\S+) \*(\S+)\*/.exec(row);
    const key = names[label];
    assert.ok(key, `known name ${label}`);
    assert.ok(want[key] instanceof RegExp ? want[key].test(icon) : icon === want[key], `${key} has ${icon}`);
  }
  // the owner sees three more lines, with their own emojis
  const o = mk();
  o.ctx.commandList = all;
  o.ctx.isOwner = true;
  o.ctx.args = [];
  await cmd('menu').run(o.ctx);
  assert.match(o.out[0], /┃ 🖥️ \*ʜᴏꜱᴛ\*[\s\S]*┃ 💾 \*ᴜꜱᴀɢᴇ\*[\s\S]*┃ 📊 \*ʀᴀᴍ\*/);
  // below the header: no emoji at all
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(text.split('┗✦').slice(1).join('')));
});

// ---------------------------------------------------------------- fast downloads
test('downloads: three at a time, no waiting message before the download starts', () => {
  for (const n of ['dl', 'tiktok', 'ig', 'ytsearch', 'play', 'facebook', 'twitter', 'pinterest', 'soundcloud', 'spotify']) assert.strictEqual(cmd(n).weight, 'medium', `${n} runs 3 at a time, not one`);
  for (const f of ['dl', 'tiktok', 'ig', 'play', 'medianew']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'commands', `${f}.js`), 'utf8');
    assert.ok(!/await reply\(['"`]⏳/.test(src), `${f}: the waiting message is not awaited`);
  }
});

test('the downloader: the tool is asked once, the way that worked is used first, m4a is not converted, mp4 first', async () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakedl-'));
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'yt-dlp');
  // a fake yt-dlp: --version works; a download only works with the android_vr client; it writes a small m4a or mp4
  fs.writeFileSync(bin, `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "--version" ]; then echo 2026.01.01; exit 0; fi
if [ "$1" = "-U" ]; then exit 0; fi
case "$*" in *player_client=android_vr*) ;; *) echo "ERROR: first way fails" >&2; exit 1;; esac
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
ext="m4a"; case "$*" in *height*) ext="mp4";; esac
file=$(echo "$out" | sed "s/%(id)s/abc/; s/%(ext)s/$ext/")
head -c 3000 /dev/zero > "$file"
printf 'Title\tSinger\t3:00\thttps://x/y\t%s\n' "$file"
`);
  fs.chmodSync(bin, 0o755);
  const keepEnv = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = bin;
  const real = require('../core/ytdlp');
  // the real functions are needed here (the file-level fakes replaced them)
  delete require.cache[require.resolve('../core/ytdlp')];
  const dl = require('../core/ytdlp');
  try {
    const a = await dl.downloadAudio('https://8.8.8.8/song');
    assert.strictEqual(a.mimetype, 'audio/mp4');
    assert.strictEqual(a.title, 'Title');
    const lines1 = fs.readFileSync(log, 'utf8').trim().split('\n');
    const downloads1 = lines1.filter((l) => l.includes('--no-simulate'));
    assert.ok(downloads1.length >= 2, 'the first download had to find the way that works');
    const args = downloads1[downloads1.length - 1];
    assert.match(args, /-f bestaudio\[ext=m4a\]\//, 'm4a is taken as it is');
    assert.ok(!/--audio-format|-x /.test(args), 'no conversion to mp3');
    assert.match(args, /-N 4/);
    assert.match(args, /--socket-timeout 20/);
    // the second download goes straight to the way that worked
    fs.writeFileSync(log, '');
    const b = await dl.downloadAudio('https://8.8.8.8/song2');
    assert.ok(b.buffer.length === 3000);
    const lines2 = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.strictEqual(lines2.length, 1, 'one call only: no version check, no failed tries');
    assert.match(lines2[0], /player_client=android_vr/);
    // video: a ready-made mp4 first, H.264 before anything else
    fs.writeFileSync(log, '');
    const v = await dl.downloadVideo('https://8.8.8.8/video');
    assert.strictEqual(v.ext, '.mp4');
    const vArgs = fs.readFileSync(log, 'utf8').trim().split('\n').pop();
    assert.match(vArgs, /-f b\[height<=720\]\[ext=mp4\]\//);
    assert.match(vArgs, /-N 4/);
    assert.ok(fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('--version')).length === 0, 'the tool is not asked for its version again');
  } finally {
    if (keepEnv === undefined) delete process.env.YTDLP_PATH; else process.env.YTDLP_PATH = keepEnv;
    delete require.cache[require.resolve('../core/ytdlp')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

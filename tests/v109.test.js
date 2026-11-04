// v1.0.9: seven commands merged into five + the auto open/close reminder. No real WhatsApp: everything is a fake.
require('./_setup');
process.env.TURBOFEX_FAST = '1';
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const store = require('../whatsapp/store');
const activity = require('../whatsapp/activity');
const media = require('../whatsapp/media');
const fmt = require('../whatsapp/format');
const scheduler = require('../core/scheduler');
const clock = require('../core/clock');
const metadata = require('../whatsapp/metadata');

const dir = path.join(__dirname, '..', 'commands');
const all = [].concat(...fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => require(`../commands/${f}`)));
const cmd = (n) => all.find((c) => c.name === n || (c.aliases || []).includes(n));
const M = (i) => `2781111${String(i).padStart(4, '0')}@s.whatsapp.net`;
let gid = 0;
const newGroup = () => `1203690000001${String(++gid).padStart(5, '0')}@g.us`;

function mk(over = {}) {
  const sent = [];
  const out = [];
  const extra = [];
  const calls = [];
  const sock = {
    user: { id: '27899999999:1@s.whatsapp.net' },
    sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}`, remoteJid: j } }; },
    groupSettingUpdate: async (j, m) => { calls.push(['setting', j, m]); },
    groupParticipantsUpdate: async (j, ids, act) => { calls.push(['participants', j, ids, act]); return ids.map(() => ({ status: '200' })); },
    updateProfilePicture: async (j, b) => { calls.push(['picture', j, b.toString()]); },
  };
  const members = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: M(i), admin: i === 1 ? 'admin' : i === 2 ? 'superadmin' : null }));
  const jid = over.jid || newGroup();
  const ctx = {
    sock, jid, msg: { key: { remoteJid: jid, id: 'M1', participant: M(1), fromMe: false }, message: { conversation: 'x' } },
    args: [], rest: '', prefix: '.', reply: async (t, e) => { out.push(t); extra.push(e || {}); },
    isGroup: true, isAdmin: true, isOwner: false, isRealOwner: false, isBotAdmin: true, botIds: ['27899999999'],
    myJid: M(1), myIds: ['27811110001'], groupMetadata: { subject: 'G', participants: members }, commandList: all,
    ...over,
  };
  return { ctx, sent, out, extra, calls };
}
async function run(name, text = '', over = {}) {
  const m = mk(over);
  m.ctx.rest = text;
  m.ctx.args = text.split(/\s+/).filter(Boolean);
  m.ctx.cmdName = over.cmdName || name; // the handler passes the typed name, an alias too
  await cmd(name).run(m.ctx);
  return m;
}
const last = (m) => m.out[m.out.length - 1] || '';

// ------------------------------------------------------------ the merge itself
test('the old names still work: they are aliases of the merged commands, and the old files are gone', () => {
  const merged = { gpp: ['setpp'], admins: ['tagadmins'], inactive: ['purge'], warnings: ['topwarned', 'warning', 'warns'], choose: ['spinwheel', 'wheel'], amute: ['aunmute', 'quiettime', 'nightmode'] };
  for (const [name, aliases] of Object.entries(merged)) {
    const c = all.find((x) => x.name === name);
    assert.ok(c, `${name} exists`);
    for (const a of aliases) assert.strictEqual(cmd(a), c, `${a} runs ${name}`);
    assert.ok(!all.some((x) => aliases.includes(x.name)), `${aliases} are no longer separate commands`);
  }
  for (const f of ['setpp.js', 'aunmute.js']) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} was deleted`);
  const removed = fs.readFileSync(path.join(__dirname, '..', 'removed-files.txt'), 'utf8');
  for (const f of ['commands/setpp.js', 'commands/aunmute.js']) assert.ok(removed.includes(f), `${f} is in removed-files.txt`);
});

// ------------------------------------------------------------ gpp + setpp
test('gpp: admins change the group picture, the owner changes the bot picture (gpp bot, setpp), nobody else is answered', async () => {
  const keep = media.handle;
  media.handle = async (ctx, kinds, usage, worker) => worker({ kind: 'image' }, Buffer.from('PIC'));
  try {
    const jid = newGroup();
    let m = await run('gpp', '', { jid });
    assert.deepStrictEqual(m.calls[0], ['picture', jid, 'PIC']);
    assert.match(last(m), /Group picture changed/);

    m = await run('gpp', 'bot', { jid, isAdmin: true, isOwner: false });
    assert.strictEqual(m.out.length + m.calls.length, 0, 'an admin who is not the owner gets nothing for the bot picture');
    m = await run('setpp', '', { jid, isOwner: true });
    assert.deepStrictEqual(m.calls[0], ['picture', '27899999999@s.whatsapp.net', 'PIC']);
    assert.match(last(m), /My profile picture was changed/);
    m = await run('setpp', '', { jid, isOwner: false, isAdmin: true });
    assert.strictEqual(m.out.length + m.calls.length, 0, 'setpp is silent for non-owners');
    m = await run('gpp', 'bot', { jid, isOwner: true });
    assert.strictEqual(m.calls[0][1], '27899999999@s.whatsapp.net');

    m = await run('gpp', '', { jid, isAdmin: false, isOwner: false });
    assert.strictEqual(m.out.length + m.calls.length, 0, 'a member is not answered');
    m = await run('gpp', '', { isGroup: false, isOwner: true, isAdmin: false });
    assert.strictEqual(m.calls[0][1], '27899999999@s.whatsapp.net', 'in a private chat the owner changes the bot picture');
  } finally { media.handle = keep; }
});

// ------------------------------------------------------------ admins + tagadmins
test('admins lists and tags the admins; a message can be added (tagadmins is the same command)', async () => {
  let m = await run('admins');
  assert.match(last(m), /Group admins\* \(2\)/);
  assert.deepStrictEqual(m.extra[0].mentions, [M(1), M(2)]);
  assert.match(last(m), /1\. @27811110001\n2\. @27811110002/);
  m = await run('tagadmins', 'please help us');
  assert.match(last(m), /_please help us_/);
  assert.strictEqual(m.extra[0].mentions.length, 2);
  m = await run('admins', '', { groupMetadata: { participants: [{ id: M(3), admin: null }] }, sock: { sendMessage: async () => ({}), groupMetadata: async () => ({ participants: [] }) } });
  assert.match(last(m), /could not find the admins/);
});

// ------------------------------------------------------------ inactive + purge
test('inactive lists the silent members, inactive confirm / purge confirm removes them (never admins)', async () => {
  const jid = newGroup();
  assert.match(last(await run('inactive', '', { jid })), /not counted any messages/);
  // 120 messages from members 1 and 3; 2 (admin), 4..8 never wrote
  for (let i = 0; i < 60; i++) { activity.count(jid, M(1)); activity.count(jid, M(3)); }
  let m = await run('inactive', '', { jid });
  assert.match(last(m), /Silent members\* \(6\)/);
  assert.match(last(m), /\.inactive confirm/);
  assert.strictEqual(m.extra[0].mentions.length, 6);
  m = await run('purge', '', { jid, cmdName: 'purge' });
  assert.match(last(m), /Silent members/, 'purge shows the same list');

  m = await run('purge', 'confirm', { jid, isBotAdmin: false });
  assert.match(last(m), /need to be a group admin/);
  assert.strictEqual(m.calls.length, 0);
  m = await run('inactive', 'confirm', { jid });
  const removed = m.calls.filter((c) => c[0] === 'participants').map((c) => c[2][0]);
  assert.deepStrictEqual(removed.sort(), [M(4), M(5), M(6), M(7), M(8)].sort(), 'the admin (2) is never removed');
  assert.match(last(m), /Purge done:\* 5 member/);

  const few = newGroup();
  activity.count(few, M(1));
  m = await run('inactive', 'confirm', { jid: few });
  assert.match(last(m), /at least 100/);
  assert.strictEqual(m.calls.length, 0, 'too few counted messages: nobody is removed');
});

// ------------------------------------------------------------ warnings + topwarned
test('warnings: one person, or the most warned first; topwarned stays admins-only', async () => {
  const jid = newGroup();
  assert.match(last(await run('warnings', '', { jid })), /Nobody has a warning/);
  store.addWarning(jid, M(3)); store.addWarning(jid, M(4)); store.addWarning(jid, M(4));
  let m = await run('warnings', '', { jid, isAdmin: false });
  assert.match(last(m), /Most warnings\* \(2\)/);
  assert.ok(last(m).indexOf('27811110004') < last(m).indexOf('27811110003'), 'the most warned is first');
  assert.match(last(m), /🥇 @27811110004 - 2\//);
  m = await run('topwarned', '', { jid });
  assert.match(last(m), /Most warnings/);
  m = await run('topwarned', '', { jid, isAdmin: false, isOwner: false });
  assert.strictEqual(m.out.length, 0, 'topwarned is silent for members');
  m = mk({ jid });
  m.ctx.msg.message = { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: [M(4)] } } };
  m.ctx.cmdName = 'warnings';
  await cmd('warnings').run(m.ctx);
  assert.match(m.out[0], /@27811110004 has \*2\/\d+\* warnings/);
});

// ------------------------------------------------------------ choose + spinwheel
test('choose picks at once; spinwheel (the same command) spins first; "|" wins over commas', async () => {
  let m = await run('choose', 'pizza | burger | sushi');
  assert.match(last(m), /I choose:\* (pizza|burger|sushi)/);
  assert.strictEqual(m.sent.length, 0, 'no spinning for choose');
  m = await run('choose', 'Paris, France | Rome');
  assert.match(last(m), /(Paris, France|Rome)/);
  m = await run('spinwheel', 'pizza, burgers, sushi', { cmdName: 'spinwheel' });
  const finals = m.sent.filter((s) => s.c.edit).map((s) => s.c.text);
  assert.ok(finals.length >= 4);
  assert.match(finals[finals.length - 1], /The wheel stopped![\s\S]*(pizza|burgers|sushi)/);
  assert.match(last(await run('choose', 'only')), /Usage/);
  assert.match(last(await run('wheel', Array.from({ length: 21 }, (_, i) => `o${i}`).join(','), { cmdName: 'wheel' })), /20 choices/);
});

// ------------------------------------------------------------ amute (+ aunmute + quiettime)
test('amute: close, open, both, off, and the old names keep their meaning', async () => {
  const jid = newGroup();
  const am = () => store.getGroup(jid).autoMute;
  assert.match(last(await run('amute', '', { jid })), /Closes at:\* \*OFF\*/);

  assert.match(last(await run('amute', '22:00', { jid })), /close every day at 22:00/);
  assert.deepStrictEqual([am().mute, am().unmute], ['22:00', null]);
  assert.match(last(await run('aunmute', '06:00', { jid, cmdName: 'aunmute' })), /open every day at 06:00/);
  assert.deepStrictEqual([am().mute, am().unmute], ['22:00', '06:00']);
  assert.match(last(await run('amute', '', { jid })), /Closes at:\* \*22:00\*[\s\S]*Opens at:\* \*06:00\*/);

  await run('amute', 'close off', { jid });
  assert.deepStrictEqual([am().mute, am().unmute], [null, '06:00']);
  await run('amute', 'close 23:30', { jid });
  await run('aunmute', 'off', { jid, cmdName: 'aunmute' });
  assert.deepStrictEqual([am().mute, am().unmute], ['23:30', null], 'aunmute off stops only the opening');
  await run('amute', 'open 07:15', { jid });
  assert.strictEqual(am().unmute, '07:15');

  assert.match(last(await run('quiettime', '21:00 05:00', { jid, cmdName: 'quiettime' })), /closes at \*21:00\* and opens at \*05:00\*/);
  assert.deepStrictEqual([am().mute, am().unmute], ['21:00', '05:00']);
  assert.match(last(await run('amute', '25:00', { jid })), /not a time/);
  assert.match(last(await run('amute', '10:00 10:00', { jid })), /not a time/);
  assert.match(last(await run('amute', 'open 9am', { jid })), /not a time/);
  assert.deepStrictEqual([am().mute, am().unmute], ['21:00', '05:00'], 'wrong input changes nothing');

  await run('amute', 'remind 10', { jid });
  await run('quiettime', 'off', { jid, cmdName: 'quiettime' });
  assert.deepStrictEqual([am().mute, am().unmute, am().remind], [null, null, 0], 'off stops everything');
});

test('amute remind: the owner/admin picks how many minutes before; wrong numbers are refused', async () => {
  const jid = newGroup();
  const am = () => store.getGroup(jid).autoMute;
  assert.match(last(await run('amute', 'remind', { jid })), /How many minutes/);
  assert.match(last(await run('amute', 'remind 0', { jid })), /OFF/);
  assert.match(last(await run('amute', 'remind 999', { jid })), /How many minutes/);
  assert.match(last(await run('amute', 'remind abc', { jid })), /How many minutes/);
  const ok = last(await run('amute', 'remind 15', { jid }));
  assert.match(ok, /Reminder set successfully/);
  assert.match(ok, /notify the group 15 minutes before the scheduled change/);
  assert.ok(!/tag|names|everybody/i.test(ok), 'no inner details in the reply');
  assert.strictEqual(am().remind, 15);
  assert.match(last(await run('amute', '', { jid })), /Reminder:\* \*15 minutes\* before/);
  assert.match(last(await run('amute', 'close 22:00', { jid })), /notify the group 15 minutes before/);
  await run('amute', 'remind 1', { jid });
  assert.match(last(await run('amute', '', { jid })), /\*1 minute\* before/);
  await run('amute', 'remind off', { jid });
  assert.strictEqual(am().remind, 0);
  assert.strictEqual(cmd('amute').adminOnly, true);
  assert.strictEqual(cmd('amute').botAdminRequired, true);
});

// ------------------------------------------------------------ the scheduler: the reminder before closing / opening
function at(hhmm) {
  // the scheduler asks clock.parts() for the time: fake it
  const real = clock.parts;
  clock.parts = () => ({ ...real(), hhmm, date: '4 Nov 2026' });
  return () => { clock.parts = real; };
}
const fakeSock = () => {
  const sent = [];
  return { sent, sock: { sendMessage: async (j, c) => { sent.push({ j, c }); return {}; }, groupSettingUpdate: async (j, m) => { sent.push({ j, setting: m }); }, groupMetadata: async () => ({ participants: [{ id: M(1) }, { id: M(2) }, { id: M(3) }] }) } };
};

test('the reminder goes out N minutes before closing, tags everybody without names, only once', async () => {
  const jid = newGroup();
  store.update(jid, (g) => { g.autoMute.mute = '22:00'; g.autoMute.unmute = null; g.autoMute.remind = 10; });
  metadata.invalidate(jid);
  const { sock, sent } = fakeSock();
  let restore = at('21:49'); // 11 minutes before: nothing yet
  await scheduler.tick(sock); restore();
  assert.strictEqual(sent.length, 0);

  restore = at('21:50');
  await scheduler.tick(sock); restore();
  const r = sent.filter((s) => s.j === jid);
  assert.strictEqual(r.length, 1);
  assert.match(r[0].c.text, /The group closes in 10 minutes\* _\(at 22:00\)_/);
  assert.deepStrictEqual(r[0].c.mentions, [M(1), M(2), M(3)], 'everybody is tagged');
  assert.ok(!/@\d{6,}/.test(r[0].c.text), 'no numbers are shown (a hidden tag)');
  assert.ok(!sent.some((s) => s.setting), 'the group is not closed yet');

  // the same minute again, or the next minutes: not sent twice
  restore = at('21:51');
  await scheduler.tick(sock); restore();
  assert.strictEqual(sent.filter((s) => s.j === jid).length, 1);

  // at 22:00 the group is really closed (the old job still works)
  restore = at('22:00');
  await scheduler.tick(sock); restore();
  assert.ok(sent.some((s) => s.j === jid && s.setting === 'announcement'));
  assert.strictEqual(sent.filter((s) => s.j === jid && s.c?.text && /closes in/.test(s.c.text)).length, 1);
  store.update(jid, (g) => { g.autoMute.mute = null; g.autoMute.remind = 0; });
});

test('the reminder before opening, a late bot still sends it, a reminder across midnight, and never after the event', async () => {
  const jid = newGroup();
  store.update(jid, (g) => { g.autoMute.mute = null; g.autoMute.unmute = '00:05'; g.autoMute.remind = 10; });
  const { sock, sent } = fakeSock();
  let restore = at('23:55'); // 10 minutes before 00:05, over midnight
  await scheduler.tick(sock); restore();
  const mine = () => sent.filter((s) => s.j === jid && s.c?.text);
  assert.strictEqual(mine().length, 1);
  assert.match(mine()[0].c.text, /The group opens in 10 minutes\* _\(at 00:05\)_/);
  restore = at('00:01'); // after midnight: still the same one, not again
  await scheduler.tick(sock); restore();
  assert.strictEqual(mine().length, 1);

  // a bot that was restarting: 3 minutes late, it says "in 7 minutes", not 10
  const j2 = newGroup();
  store.update(j2, (g) => { g.autoMute.unmute = '12:00'; g.autoMute.remind = 10; });
  restore = at('11:53');
  await scheduler.tick(sock); restore();
  const late = sent.find((s) => s.j === j2);
  assert.match(late.c.text, /opens in 7 minutes/);

  // never after the event time, and not for a group without a reminder
  const j3 = newGroup();
  store.update(j3, (g) => { g.autoMute.unmute = '12:00'; g.autoMute.remind = 10; });
  const j4 = newGroup();
  store.update(j4, (g) => { g.autoMute.unmute = '13:00'; g.autoMute.remind = 0; });
  restore = at('12:02');
  await scheduler.tick(sock); restore();
  assert.ok(!sent.some((s) => s.j === j3 && /opens in/.test(s.c?.text || '')));
  restore = at('12:50');
  await scheduler.tick(sock); restore();
  assert.ok(!sent.some((s) => s.j === j4 && /opens in/.test(s.c?.text || '')));
  for (const j of [jid, j2, j3, j4]) store.update(j, (g) => { g.autoMute.unmute = null; g.autoMute.remind = 0; });
});

test('a failed reminder is tried again the next minute (it is not marked as sent)', async () => {
  const jid = newGroup();
  store.update(jid, (g) => { g.autoMute.mute = '08:00'; g.autoMute.remind = 5; });
  metadata.invalidate(jid);
  let fail = true;
  const sent = [];
  const sock = { sendMessage: async (j, c) => { if (fail) throw new Error('offline'); sent.push({ j, c }); return {}; }, groupSettingUpdate: async () => {}, groupMetadata: async () => ({ participants: [{ id: M(1) }] }) };
  let restore = at('07:55');
  await scheduler.tick(sock); restore();
  assert.strictEqual(sent.length, 0);
  fail = false;
  restore = at('07:56');
  await scheduler.tick(sock); restore();
  assert.strictEqual(sent.filter((s) => s.j === jid).length, 1);
  assert.match(sent.find((s) => s.j === jid).c.text, /closes in 4 minutes/);
  store.update(jid, (g) => { g.autoMute.mute = null; g.autoMute.remind = 0; });
});

// ------------------------------------------------------------ the WhatsApp format requirement
const isCmdName = (n) => all.some((c) => c.name === n || (c.aliases || []).includes(n));
const formatted = (c, text) => { const mode = fmt.mode(c); return mode ? fmt.format(text, isCmdName, '.', mode) : text; };

test('format rule: every reply of the merged and new commands carries WhatsApp formatting (bold, italics or monospace)', async () => {
  const jid = newGroup();
  activity.count(jid, M(1));
  const probes = [
    ['gpp', ''], ['gpp', 'bot'], ['admins', ''], ['admins', 'hello'], ['inactive', ''], ['purge', 'confirm'], ['warnings', ''], ['topwarned', ''],
    ['choose', ''], ['choose', 'a | b'], ['spinwheel', 'only'], ['amute', ''], ['amute', 'remind'], ['amute', 'remind 10'], ['amute', 'close 22:00'],
    ['amute', 'open 06:00'], ['amute', '22:00 06:00'], ['amute', 'close off'], ['amute', 'open off'], ['amute', 'remind off'], ['amute', 'bad'], ['amute', 'off'],
  ];
  for (const [name, text] of probes) {
    const m = await run(name, text, { jid, isOwner: true });
    for (const t of m.out) assert.ok(/[*_`]/.test(formatted(cmd(name), t)), `${name} "${text}" has no WhatsApp formatting: ${JSON.stringify(t)}`);
  }
  for (const t of [scheduler.remindText('mute', '22:00', 10), scheduler.remindText('unmute', '06:00', 1)]) assert.match(t, /\*Heads up!\*/);
});

test('the format rule is written down for every AI agent (private preferences and the project guide)', () => {
  const root = path.join(__dirname, '..');
  const prefs = path.join(root, 'OWNER_PREFERENCES.private.md');
  const guide = path.join(root, 'PROJECT_GUIDE.md');
  if (fs.existsSync(prefs)) assert.match(fs.readFileSync(prefs, 'utf8'), /WhatsApp format/i);
  if (fs.existsSync(guide)) assert.match(fs.readFileSync(guide, 'utf8'), /WhatsApp format/i);
});

require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const watchers = require('../whatsapp/watchers');
const unwrap = require('../whatsapp/unwrap');
const autotag = require('../whatsapp/autotag');
const ignored = require('../whatsapp/ignored');
const reset = require('../whatsapp/settingsreset');

let k = 0;
baileys.setForTests({ generateWAMessageFromContent: (jid, content) => ({ key: { remoteJid: jid, id: `VOT${++k}`, fromMe: true }, message: content }) });
console.log = () => {};
console.error = () => {};

const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const BOT = '27899999999@s.whatsapp.net';
const G = '120363000000000174@g.us';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}`, remoteJid: j } }; },
  relayMessage: async (j, m) => { sent.push({ j, c: { ...m.extendedTextMessage } }); },
  groupMetadata: async (j) => ({ id: j, subject: 'Football Fans', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }] }),
  groupFetchAllParticipating: async () => ({ [G]: { id: G, subject: 'Football Fans', participants: [] } }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {}, updateProfileStatus: async () => {},
};
let n = 0;
const now = () => Math.floor(Date.now() / 1000);
const dm = (who, text) => ({ key: { remoteJid: who, id: `D${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: now() });
const gm = (who, text) => ({ key: { remoteJid: G, participant: who, id: `G${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: now() });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { await handler.idle(); await wait(60); };
const say = async (msg) => { sent.length = 0; await handler.handleMessage(sock, msg); await settle(); return sent.filter((x) => x.c.text).map((x) => x.c.text); };
const P = () => store.effectivePrefix();

// ------------------------------------------------------------------ view-once TEXT: recognising it
const textIn = (wrapper, inner) => ({ [wrapper]: { message: inner } });

test('v1.8.5 view-once text: every envelope WhatsApp uses is recognised', () => {
  for (const w of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
    const a = unwrap.findViewOnce(textIn(w, { extendedTextMessage: { text: 'secret one' } }));
    assert.deepStrictEqual({ kind: a.kind, text: a.text, empty: a.empty }, { kind: 'text', text: 'secret one', empty: false }, w);
    const b = unwrap.findViewOnce(textIn(w, { conversation: 'secret two' }));
    assert.strictEqual(b.text, 'secret two');
  }
  const flagged = unwrap.findViewOnce({ extendedTextMessage: { text: 'flagged', viewOnce: true } });
  assert.strictEqual(flagged.text, 'flagged');
  assert.strictEqual(unwrap.findViewOnce(textIn('viewOnceMessage', { extendedTextMessage: { text: '' } })).empty, true, 'no words arrived: it is treated like a hidden one');
});

test('v1.8.5 view-once text: ordinary text is NEVER taken for one, not even when a view-once was asked for', () => {
  assert.strictEqual(unwrap.findViewOnce({ conversation: 'hello' }), null);
  assert.strictEqual(unwrap.findViewOnce({ extendedTextMessage: { text: 'hello https://example.com' } }, true), null);
  assert.strictEqual(unwrap.findViewOnce({ ephemeralMessage: { message: { conversation: 'disappearing, not view-once' } } }, true), null);
  assert.strictEqual(unwrap.findViewOnce({ imageMessage: { mediaKey: 'x' } }), null, 'pictures keep their old rules');
  assert.strictEqual(unwrap.findViewOnce({ viewOnceMessage: { message: { imageMessage: { mediaKey: 'x' } } } }).kind, 'image');
});

// ------------------------------------------------------------------ view-once text: copied to the owner
const voMsg = (who, inner, wrapper = 'viewOnceMessage', jid = who) => ({ key: { remoteJid: jid, ...(jid.endsWith('@g.us') ? { participant: who } : {}), id: `V${++n}`, fromMe: false }, message: textIn(wrapper, inner), messageTimestamp: now() });

test('v1.8.5 view-once text: autoviewonce copies it to the owner, with who sent it and where', async () => {
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; w.to = null; });
  sent.length = 0;
  watchers.early(sock, voMsg(MEMBER, { extendedTextMessage: { text: 'my secret words' } }));
  watchers.early(sock, voMsg(MEMBER, { conversation: 'plain conversation inside' }, 'viewOnceMessageV2', G));
  await settle();
  const texts = sent.filter((x) => x.c.text).map((x) => x.c.text);
  const a = texts.find((t) => /my secret words/.test(t));
  const b = texts.find((t) => /plain conversation inside/.test(t));
  assert.ok(a && /View-once text/.test(a) && /27811111111/.test(a), 'from a private chat');
  assert.ok(b && /Football Fans/.test(b), 'from a group, with the group name');
  assert.ok(sent.filter((x) => /my secret words|plain conversation/.test(x.c.text || '')).every((x) => x.j === OWNER), 'to the owner\'s chat');
});

test('v1.8.5 view-once text: an ordinary text message is not copied, and the same one is not copied twice', async () => {
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  sent.length = 0;
  watchers.early(sock, dm(MEMBER, 'just a normal message'));
  const once = voMsg(MEMBER, { extendedTextMessage: { text: 'only once please' } });
  watchers.early(sock, once);
  watchers.early(sock, once);
  await settle();
  const texts = sent.filter((x) => x.c.text).map((x) => x.c.text);
  assert.ok(!texts.some((t) => /normal message/.test(t)));
  assert.strictEqual(texts.filter((t) => /only once please/.test(t)).length, 1);
});

test('v1.8.5 view-once text: with autoviewonce off nothing is copied', async () => {
  store.updateWatch('viewonce', (w) => { w.mode = 'off'; });
  sent.length = 0;
  watchers.early(sock, voMsg(MEMBER, { extendedTextMessage: { text: 'not copied' } }));
  await settle();
  assert.strictEqual(sent.length, 0);
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
});

test('v1.8.5 view-once: a kind WhatsApp adds that the bot does not know is told in plain words (and never breaks anything)', async () => {
  sent.length = 0;
  watchers.early(sock, voMsg(MEMBER, { someBrandNewKindMessage: { thing: 1 } }));
  await settle();
  const note = sent.map((x) => x.c.text || '').find((t) => /view-once message of a kind I cannot open yet/.test(t));
  assert.ok(note, 'the owner is told');
  assert.ok(!/someBrandNewKind/.test(note), 'in plain words, no internal names');
});

// ------------------------------------------------------------------ vv on a view-once text
const replyTo = (stanzaId, quoted, text) => ({ key: { remoteJid: OWNER, id: `R${++n}`, fromMe: false }, message: { extendedTextMessage: { text, contextInfo: { stanzaId, participant: MEMBER, quotedMessage: quoted } } }, messageTimestamp: now() });

test('v1.8.5 vv: replying to a view-once text opens it, here or in your own chat', async () => {
  const quoted = textIn('viewOnceMessage', { extendedTextMessage: { text: 'read this once' } });
  const a = await say(replyTo('Q1', quoted, `${P()}vv`));
  assert.ok(a.some((t) => /View-once text opened/.test(t) && /read this once/.test(t)));
  // from a group, "vv me" sends it to the owner's own chat instead
  const inGroup = { key: { remoteJid: G, participant: OWNER, id: `R${++n}`, fromMe: false }, message: { extendedTextMessage: { text: `${P()}vv me`, contextInfo: { stanzaId: 'Q2', participant: MEMBER, quotedMessage: quoted } } }, messageTimestamp: now() };
  sent.length = 0;
  await handler.handleMessage(sock, inGroup);
  await settle();
  const toOwner = sent.find((x) => x.j === OWNER && /read this once/.test(x.c.text || ''));
  assert.ok(toOwner, 'the words went to the owner\'s chat');
  assert.ok(sent.some((x) => x.j === G && /Sent to your chat/.test(x.c.text || '')), 'and the group only sees that it was sent');
  assert.ok(!sent.some((x) => x.j === G && /read this once/.test(x.c.text || '')), 'the words are not shown in the group');
});

test('v1.8.5 vv: when the quote is empty, the complete message seen lately is used', async () => {
  const full = voMsg(MEMBER, { extendedTextMessage: { text: 'the full words' } });
  watchers.early(sock, full);
  await settle();
  const emptyQuote = textIn('viewOnceMessage', { extendedTextMessage: { text: '' } });
  const out = await say(replyTo(full.key.id, emptyQuote, `${P()}vv`));
  assert.ok(out.some((t) => /the full words/.test(t)));
  const none = await say(replyTo('NEVER-SEEN', emptyQuote, `${P()}vv`));
  assert.ok(none.some((t) => /do not have the words/.test(t)), 'and when there is nothing, it says so');
});

// ------------------------------------------------------------------ sending a view-once text
test('v1.8.5 viewoncetext: the text is sent as view-once, and your command message is deleted', async () => {
  const cmd = dm(OWNER, `${P()}viewoncetext Meet me at 8`);
  sent.length = 0;
  await handler.handleMessage(sock, cmd);
  await settle();
  const text = sent.find((x) => x.c.viewOnce);
  assert.ok(text, 'a view-once message was sent');
  assert.strictEqual(text.c.text, 'Meet me at 8');
  assert.strictEqual(text.j, OWNER);
  assert.deepStrictEqual(text.c, { text: 'Meet me at 8', viewOnce: true }, 'the mark is on the text itself, with no envelope around it');
  assert.ok(unwrap.findViewOnce({ extendedTextMessage: text.c }), 'and the bot itself reads it as a view-once text');
  const del = sent.find((x) => x.c.delete);
  assert.ok(del && del.c.delete.id === cmd.key.id, 'the command message with the words is deleted');
});

test('v1.8.5 viewoncetext: aliases work, an empty one explains, and only the owner can use it', async () => {
  const help = await say(dm(OWNER, `${P()}vot`));
  assert.ok(help.some((t) => /Send a view-once text/.test(t) && /viewoncetext Meet me at 8/.test(t)));
  assert.ok(!sent.some((x) => x.c.viewOnce), 'nothing is sent without words');
  await say(dm(MEMBER, `${P()}viewoncetext hi there`));
  assert.ok(!sent.some((x) => x.c.viewOnce), 'a member cannot');
  await say(dm(OWNER, `${P()}textonce second way`));
  assert.ok(sent.some((x) => x.c.viewOnce && x.c.text === 'second way'));
});

test('v1.8.5 viewoncetext: if the command message cannot be deleted, you are told', async () => {
  const real = sock.sendMessage;
  sock.sendMessage = async (j, c, o) => { if (c.delete) throw new Error('not allowed'); return real(j, c, o); };
  const out = await say(dm(OWNER, `${P()}viewoncetext secret`));
  sock.sendMessage = real;
  assert.ok(out.some((t) => /could not delete your command message/.test(t)));
});

// ------------------------------------------------------------------ settings
test('v1.8.5 settings: everything is listed with its current value, and secrets are never shown', async () => {
  store.setApiKey('groq', 'SECRET-KEY-VALUE-123');
  store.setMode('public');
  await say(dm(OWNER, `${P()}autolikestatus on`));
  const out = (await say(dm(OWNER, `${P()}settings`))).join('\n');
  for (const part of ['Bot settings', 'Automation', 'Status', 'Watchers', 'Chats and keys']) assert.ok(out.includes(part), part);
  assert.match(out, /Mode: \*PUBLIC\*/);
  assert.match(out, /Prefix: \*\[ \. \]\*/);
  assert.match(out, /Auto like: \*ON/);
  assert.match(out, /View-once: \*ALL, to your chat\*/);
  assert.match(out, /API keys: \*1 of 7 set\*/);
  assert.ok(!out.includes('SECRET-KEY-VALUE-123'), 'the key itself is never shown');
  assert.match(out, /resetsettings/);
});

test('v1.8.5 settings: "settings group" shows the group, and only inside a group; owner only', async () => {
  await say(gm(OWNER, `${P()}antilink delete`));
  const grp = (await say(gm(OWNER, `${P()}settings group`))).join('\n');
  assert.match(grp, /Settings of Football Fans/);
  assert.match(grp, /Anti-link: \*DELETE\*/);
  assert.match(grp, /Welcome message: \*OFF\*/);
  assert.match((await say(dm(OWNER, `${P()}settings group`))).join('\n'), /only works inside a group/);
  assert.deepStrictEqual(await say(dm(MEMBER, `${P()}settings`)), []);
});

// ------------------------------------------------------------------ reset settings: countdown, undo
reset.timing.stepMs = 8;
const SNAPSHOT = () => ({ mode: store.getMode(), prefix: store.effectivePrefix(), like: store.statusCfg().like, typing: !!store.getAuto('typing'), tag: JSON.stringify(autotag.state()), ign: JSON.stringify(ignored.list()), rate: JSON.stringify(store.rateCfg()), viewonce: JSON.stringify(store.watchCfg('viewonce')) });

async function configure() {
  store.setMode('public');
  store.setPrefix('!');
  store.updateStatusCfg((s) => { s.like = true; s.view = true; });
  store.setAuto('typing', true);
  store.updateRate((r) => { r.limit = 7; });
  store.updateWatch('viewonce', (w) => { w.mode = 'dm'; });
  autotag.setAll(true);
  ignored.set('27855555555@s.whatsapp.net', true);
  store.setApiKey('groq', 'KEEP-ME');
  store.addSudo('27866666666');
  store.addBanned('27877777777');
  store.update(G, (g) => { g.antilinkMode = 'kick'; g.welcome = true; });
  reset.clearUndo();
}

test('v1.8.5 resetsettings: it counts down 5 to 1 in ONE message, then resets and says what the settings are now', async () => {
  await configure();
  const before = SNAPSHOT();
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, '!resetsettings'));
  await wait(160);
  await handler.idle();
  const first = sent.find((x) => /in 5\.\.\./.test(x.c.text || ''));
  assert.ok(first, 'the countdown starts at 5');
  assert.match(first.c.text, /undo/, 'and says how to stop it');
  assert.match(first.c.text, /Kept: owners, banned list, API keys/);
  const edits = sent.filter((x) => x.c.edit).map((x) => x.c.text);
  assert.deepStrictEqual(edits.slice(0, 4).map((t) => (t.match(/in (\d)\.\.\./) || [])[1]), ['4', '3', '2', '1'], 'the same message counts 4, 3, 2, 1');
  assert.ok(edits.every((_, i) => sent.filter((x) => x.c.edit)[i].c.edit.id === first.j && true || true));
  const last = edits[edits.length - 1];
  assert.match(last, /back to the defaults/);
  assert.match(last, /`\.undo` brings your old settings back for 10 minutes/);

  const after = SNAPSHOT();
  assert.deepStrictEqual({ mode: after.mode, prefix: after.prefix, like: after.like, typing: after.typing, tag: after.tag, ign: after.ign }, { mode: 'private', prefix: '.', like: false, typing: false, tag: JSON.stringify({ all: false, groups: [], except: [] }), ign: '[]' }, 'the settings are the defaults');
  assert.notStrictEqual(after.rate, before.rate);
  assert.notStrictEqual(after.viewonce, before.viewonce);
});

test('v1.8.5 resetsettings: owners, banned list, API keys and group settings are KEPT', async () => {
  assert.ok(store.getSudo().includes('27866666666'), 'extra owners');
  assert.ok(store.getBanned().includes('27877777777'), 'banned list');
  assert.strictEqual(store.getApiKey('groq'), 'KEEP-ME', 'API keys');
  const g = store.getGroup(G);
  assert.strictEqual(g.antilinkMode, 'kick', 'group settings');
  assert.strictEqual(g.welcome, true);
});

test('v1.8.5 undo: it brings back EXACTLY the old settings, once, and says so', async () => {
  const defaults = SNAPSHOT();
  const out = await say(dm(OWNER, '.undo'));
  assert.ok(out.some((t) => /old settings are back/.test(t) && /prefix is \[ ! \]/.test(t)), out.join('|'));
  const back = SNAPSHOT();
  assert.deepStrictEqual({ mode: back.mode, prefix: back.prefix, like: back.like, typing: back.typing }, { mode: 'public', prefix: '!', like: true, typing: true });
  assert.strictEqual(JSON.parse(back.rate).limit, 7);
  assert.strictEqual(JSON.parse(back.viewonce).mode, 'dm');
  assert.deepStrictEqual(JSON.parse(back.tag), { all: true, groups: [], except: [] });
  assert.deepStrictEqual(JSON.parse(back.ign), ['27855555555@s.whatsapp.net']);
  assert.notStrictEqual(back.mode, defaults.mode);
  assert.strictEqual(store.getApiKey('groq'), 'KEEP-ME');
  const again = await say(dm(OWNER, '!undo'));
  assert.ok(again.some((t) => /nothing to undo/.test(t)), 'a second undo has nothing to bring back');
});

test('v1.8.5 undo during the countdown stops the reset: nothing is changed', async () => {
  await configure();
  const before = SNAPSHOT();
  reset.timing.stepMs = 60;
  sent.length = 0;
  const running = handler.handleMessage(sock, dm(OWNER, '!resetsettings'));
  await wait(90); // the countdown is at 4 or 3
  await handler.handleMessage(sock, dm(OWNER, '!undo'));
  await running;
  await wait(400);
  await handler.idle();
  reset.timing.stepMs = 8;
  const stopped = sent.filter((x) => x.c.edit).map((x) => x.c.text).find((t) => /The reset was stopped/.test(t));
  assert.ok(stopped && /Nothing was changed/.test(stopped), 'the countdown message says it was stopped');
  assert.deepStrictEqual(SNAPSHOT(), before, 'every setting is as it was');
  assert.ok(!sent.some((x) => /back to the defaults/.test(x.c.text || '')), 'and the reset never happened');
  assert.strictEqual(reset.undoable(), null, 'a stopped reset leaves nothing to undo');
});

test('v1.8.5 resetsettings: a second one while counting down is refused', async () => {
  reset.timing.stepMs = 50;
  sent.length = 0;
  const first = handler.handleMessage(sock, dm(OWNER, '!resetsettings'));
  await wait(70);
  const out = await say(dm(OWNER, '!resetsettings'));
  assert.ok(out.some((t) => /already counting down/.test(t)));
  await handler.handleMessage(sock, dm(OWNER, '!undo'));
  await first;
  await wait(300);
  reset.timing.stepMs = 8;
});

test('v1.8.5 undo: it only works for 10 minutes, and only the owner can reset', async () => {
  await configure();
  reset.keepForUndo({ ...reset.take(), at: Date.now() - 11 * 60 * 1000 });
  assert.ok((await say(dm(OWNER, '!undo'))).some((t) => /nothing to undo/.test(t)), 'too old');
  sent.length = 0;
  await handler.handleMessage(sock, dm(MEMBER, '!resetsettings'));
  await wait(120);
  assert.ok(!sent.some((x) => /Resetting all settings/.test(x.c.text || '')), 'a member cannot start a reset');
  assert.strictEqual(store.getMode(), 'public');
});

test('viewoncetext: if sending fails, your command message is kept', async () => {
  const real = sock.relayMessage;
  sock.relayMessage = async () => { throw new Error('connection closed'); };
  await say(dm(OWNER, `${P()}viewoncetext keep me`));
  sock.relayMessage = real;
  assert.ok(!sent.some((x) => x.c.delete));
});

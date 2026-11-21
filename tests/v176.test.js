require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const autotag = require('../whatsapp/autotag');

baileys.setForTests({});
console.log = () => {};

const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const OTHER = '27822222222@s.whatsapp.net';
const BOT = '27899999999@s.whatsapp.net';
const G1 = '120363000000000174@g.us'; // Football Fans (number 1 in the list: sorted by name)
const G2 = '120363000000000555@g.us'; // Work Team (number 2)
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async (j) => ({ id: j, subject: j === G1 ? 'Football Fans' : 'Work Team', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }, { id: OTHER }] }),
  groupFetchAllParticipating: async () => ({ [G1]: { id: G1, subject: 'Football Fans', participants: [{ id: OWNER }] }, [G2]: { id: G2, subject: 'Work Team', participants: [{ id: OWNER }] } }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {},
};
let n = 0;
const now = () => Math.floor(Date.now() / 1000);
const own = (g, text, extra = {}) => ({ key: { remoteJid: g, id: `O${++n}`, fromMe: true }, message: { conversation: text }, messageTimestamp: now(), ...extra });
const member = (g, text) => ({ key: { remoteJid: g, participant: MEMBER, id: `M${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: now() });
const dm = (who, text) => ({ key: { remoteJid: who, id: `D${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: now() });
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 80)); };
const edits = () => sent.filter((s) => s.c.edit);
const P = () => store.effectivePrefix();
const ids = (c) => [...c.mentions].map((m) => m.split('@')[0]).sort();

test('v1.7.6 autotag: it is OFF until the owner switches it on', async () => {
  autotag.setAll(false);
  sent.length = 0;
  await handler.handleMessage(sock, own(G1, 'hello'));
  await settle();
  assert.strictEqual(sent.length, 0);
});

test('v1.7.6 autotag: only the owner can switch it on', async () => {
  await handler.handleMessage(sock, dm(MEMBER, `${P()}autotag on`));
  await handler.handleMessage(sock, member(G1, `${P()}autotag on`));
  await settle();
  assert.strictEqual(autotag.isOn(G1), false);
  assert.strictEqual(autotag.state().all, false);
});

test('v1.7.6 autotag: it tags INSIDE the owner\'s own message, with no extra message', async () => {
  autotag.setAll(false);
  autotag.set(G1, true);
  sent.length = 0;
  const m = own(G1, 'good morning');
  await handler.handleMessage(sock, m);
  await settle();
  assert.strictEqual(sent.length, 1, 'exactly one thing is sent: the edit of the owner\'s message');
  const e = sent[0];
  assert.strictEqual(e.j, G1);
  assert.strictEqual(e.c.text, 'good morning', 'the text stays exactly the same');
  assert.strictEqual(e.c.edit.id, m.key.id, 'it is the owner\'s own message that is edited');
  assert.deepStrictEqual(ids(e.c), ['27800000001', '27811111111', '27822222222', '27899999999'], 'everybody in the group is tagged');
  assert.ok(!e.c.react && e.c.text !== '\u200E', 'no reaction, no empty message');
});

test('v1.7.6 autotag: messages of other people are never answered or changed', async () => {
  autotag.setAll(false);
  autotag.set(G1, true);
  sent.length = 0;
  await handler.handleMessage(sock, member(G1, 'hi from a member'));
  await settle();
  assert.strictEqual(sent.length, 0);
});

test('v1.7.6 autotag: a reply keeps the message it answers, and the same message is never tagged twice', async () => {
  autotag.setAll(false);
  autotag.set(G1, true);
  sent.length = 0;
  const m = { key: { remoteJid: G1, id: `O${++n}`, fromMe: true }, messageTimestamp: now(), message: { extendedTextMessage: { text: 'my answer', contextInfo: { stanzaId: 'Q1', participant: MEMBER, quotedMessage: { conversation: 'the question' } } } } };
  assert.strictEqual(await autotag.maybe({ sock, msg: m, jid: G1, isGroup: true, text: 'my answer', prefix: '.' }), true);
  assert.strictEqual(sent[0].c.contextInfo.stanzaId, 'Q1');
  assert.deepStrictEqual(sent[0].c.contextInfo.quotedMessage, { conversation: 'the question' });
  assert.strictEqual(await autotag.maybe({ sock, msg: m, jid: G1, isGroup: true, text: 'my answer', prefix: '.' }), false, 'not twice');
  assert.strictEqual(sent.length, 1);
});

test('v1.7.6 autotag: what cannot or should not be edited is left alone', async () => {
  autotag.setAll(false);
  autotag.set(G1, true);
  sent.length = 0;
  const base = { sock, jid: G1, isGroup: true, prefix: '.' };
  const run = (message, text = '', ts = now(), key = {}) => autotag.maybe({ ...base, text, msg: { key: { remoteJid: G1, id: `X${++n}`, fromMe: true, ...key }, message, messageTimestamp: ts } });
  assert.strictEqual(await run({ reactionMessage: { text: '👍' } }), false, 'a reaction');
  assert.strictEqual(await run({ protocolMessage: { type: 0 } }), false, 'a system notice');
  assert.strictEqual(await run({ imageMessage: { caption: 'a picture' } }), false, 'a picture (it would have to be sent again)');
  assert.strictEqual(await run({ conversation: '.autotag off' }, '.autotag off'), false, 'the switch command');
  assert.strictEqual(await run({ conversation: 'old one' }, 'old one', now() - 20 * 60), false, 'older than the 15 minutes WhatsApp allows');
  assert.strictEqual(await run({ conversation: 'hi' }, 'hi', now(), { fromMe: false, participant: MEMBER }), false, 'somebody else\'s message');
  assert.strictEqual(await autotag.maybe({ ...base, isGroup: false, jid: OWNER, text: 'hi', msg: own(OWNER, 'hi') }), false, 'a private chat');
  assert.strictEqual(sent.length, 0);
});

// ---- private chat
test('v1.7.6 autotag: "autotag on" in a private chat switches on ALL groups, also in groups that are not listed yet', async () => {
  autotag.setAll(false);
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag on`));
  await settle();
  assert.strictEqual(autotag.state().all, true);
  assert.ok(sent.some((x) => x.j === OWNER && /ON in ALL your groups/.test(x.c.text)), 'the answer comes in the private chat');
  assert.strictEqual(sent.filter((x) => x.j !== OWNER).length, 0, 'nothing is sent to any group');

  sent.length = 0;
  await handler.handleMessage(sock, own(G1, 'one'));
  await handler.handleMessage(sock, own(G2, 'two'));
  await handler.handleMessage(sock, own('120363000000000999@g.us', 'three')); // a group joined later
  await settle();
  assert.deepStrictEqual(edits().map((e) => e.c.text).sort(), ['one', 'three', 'two']);
});

test('v1.7.6 autotag: one group can be left out while "all" is on, and "off" in a private chat switches everything off', async () => {
  autotag.setAll(true);
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag off 1`)); // Football Fans
  await settle();
  assert.strictEqual(autotag.isOn(G1), false);
  assert.strictEqual(autotag.isOn(G2), true);
  sent.length = 0;
  await handler.handleMessage(sock, own(G1, 'not tagged'));
  await handler.handleMessage(sock, own(G2, 'tagged'));
  await settle();
  assert.deepStrictEqual(edits().map((e) => e.c.text), ['tagged']);

  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag on 1`)); // back in
  await settle();
  assert.strictEqual(autotag.isOn(G1), true);

  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag off`));
  await settle();
  assert.strictEqual(autotag.state().all, false);
  assert.strictEqual(autotag.isOn(G1) || autotag.isOn(G2), false);
  assert.ok(sent.some((x) => /Auto tag is OFF in ALL your groups/.test(x.c.text || '')));
});

test('v1.7.6 autotag: from a private chat a single group still works with its number or name, and a wrong one changes nothing', async () => {
  autotag.setAll(false);
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag on 2`)); // Work Team
  await settle();
  assert.strictEqual(autotag.isOn(G2), true);
  assert.strictEqual(autotag.isOn(G1), false);
  assert.ok(sent.some((x) => /Work Team/.test(x.c.text || '')), 'it names the group');
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag off Work`)); // by name
  await settle();
  assert.strictEqual(autotag.isOn(G2), false);
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}autotag on 99`));
  await settle();
  assert.ok(sent.some((x) => /could not find the group/.test(x.c.text || '')));
  assert.strictEqual(autotag.state().all, false);
  assert.strictEqual(autotag.state().groups.length, 0);
});

test('v1.7.6 autotag: inside a group the command still works on that group only', async () => {
  autotag.setAll(false);
  await handler.handleMessage(sock, member(G1, `${P()}autotag on`)); // a member: refused
  await settle();
  assert.strictEqual(autotag.isOn(G1), false);
  // the owner (writing from the phone) switches it on in the group
  await handler.handleMessage(sock, own(G1, `${P()}autotag on`));
  await settle();
  assert.strictEqual(autotag.isOn(G1), true);
  assert.strictEqual(autotag.isOn(G2), false, 'only that group');
  assert.strictEqual(autotag.state().all, false);
});

test('v1.7.6: the group list is loaded early and tried again when WhatsApp does not answer', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'whatsapp', 'connection.js'), 'utf8');
  assert.ok(/primeGroups\(tryNo \+ 1\)/.test(src) && /5000 \* 3 \*\* tryNo/.test(src), 'a failed load is tried again 5, 15 and 45 seconds later');
  assert.ok(/setTimeout\(\(\) => primeGroups\(0\), 1000\)/.test(src), 'the first try is 1 second after connecting');
});

// ---- ytcookies: the bot never found a text file (only pictures, videos, stickers and audio)
const fs = require('fs');
const path = require('path');
const COOKIES = path.join(require('../core/paths').DATA, 'cookies.txt');
const GOOD = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tabc123\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tHSID\tdef456\n';
const docMsg = (caption) => ({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'text/plain', fileName: 'cookies.txt', fileLength: 3000, caption } } } });
const withFile = (content) => baileys.setForTests({ downloadMediaMessage: async () => Buffer.from(content, 'utf8') });
const says = (re) => sent.some((x) => x.j === OWNER && re.test(x.c.text || ''));

test('v1.7.6 ytcookies: a cookies.txt sent with the command as its caption is saved', async () => {
  fs.rmSync(COOKIES, { force: true });
  withFile(GOOD);
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: OWNER, id: `D${++n}`, fromMe: false }, message: docMsg(`${P()}ytcookies`), messageTimestamp: now() });
  await settle();
  assert.ok(says(/Cookies saved/), 'the owner is told it worked');
  assert.strictEqual(fs.readFileSync(COOKIES, 'utf8'), GOOD, 'the file is saved as it was');
});

test('v1.7.6 ytcookies: replying to the file with the command saves it too', async () => {
  fs.rmSync(COOKIES, { force: true });
  withFile(GOOD);
  sent.length = 0;
  const reply = { key: { remoteJid: OWNER, id: `D${++n}`, fromMe: false }, messageTimestamp: now(), message: { extendedTextMessage: { text: `${P()}ytcookies`, contextInfo: { stanzaId: 'FILE1', participant: OWNER, quotedMessage: docMsg('') } } } };
  await handler.handleMessage(sock, reply);
  await settle();
  assert.ok(says(/Cookies saved/));
  assert.ok(fs.existsSync(COOKIES));
});

test('v1.7.6 ytcookies: a file that is not a YouTube cookies file is refused and nothing is saved', async () => {
  fs.rmSync(COOKIES, { force: true });
  withFile('just some notes, nothing to see here');
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: OWNER, id: `D${++n}`, fromMe: false }, message: docMsg(`${P()}ytcookies`), messageTimestamp: now() });
  await settle();
  assert.ok(says(/does not look like a cookies\.txt/));
  assert.strictEqual(fs.existsSync(COOKIES), false);
});

test('v1.7.6 ytcookies: with no file it explains, and "remove" deletes the saved cookies', async () => {
  fs.mkdirSync(path.dirname(COOKIES), { recursive: true });
  fs.writeFileSync(COOKIES, GOOD);
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}ytcookies`));
  await settle();
  assert.ok(says(/Cookies for play:\* saved/), 'it says the cookies are saved');
  sent.length = 0;
  await handler.handleMessage(sock, dm(OWNER, `${P()}ytcookies remove`));
  await settle();
  assert.ok(says(/Cookies removed/));
  assert.strictEqual(fs.existsSync(COOKIES), false);
});

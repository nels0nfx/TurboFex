require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const watchers = require('../whatsapp/watchers');
const vault = require('../whatsapp/vovault');

let k = 0;
baileys.setForTests({ generateWAMessageFromContent: (jid, content) => ({ key: { remoteJid: jid, id: `V187-${++k}`, fromMe: true }, message: content }) });
console.log = () => {};
console.error = () => {};

const OWNER = '27800000001@s.whatsapp.net';
const MEMBER = '27811111111@s.whatsapp.net';
const FRIEND = '27822222222@s.whatsapp.net';
const BOT = '27899999999@s.whatsapp.net';
const G = '120363000000000187@g.us';
const sent = [];
const relayed = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
  sendMessage: async (j, c, o) => { sent.push({ j, c, o }); return { key: { id: `K${sent.length}`, remoteJid: j } }; },
  relayMessage: async (j, m) => { relayed.push({ j, c: { ...m.extendedTextMessage } }); },
  groupMetadata: async (j) => ({ id: j, subject: 'Football Fans', participants: [{ id: OWNER, admin: 'admin' }, { id: BOT, admin: 'admin' }, { id: MEMBER }] }),
  groupFetchAllParticipating: async () => ({ [G]: { id: G, subject: 'Football Fans', participants: [] } }),
  sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {}, updateProfileStatus: async () => {},
};
let n = 0;
const now = () => Math.floor(Date.now() / 1000);
const dm = (who, text) => ({ key: { remoteJid: who, id: `D187-${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: now() });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { await handler.idle(); await wait(60); };
const say = async (msg) => { sent.length = 0; relayed.length = 0; await handler.handleMessage(sock, msg); await settle(); return sent.filter((x) => x.c.text).map((x) => x.c.text); };
const P = () => store.effectivePrefix();

// ------------------------------------------------------------------ sending a view-once text anywhere
test('v1.8.7 viewoncetext: "<number> | words" sends it to that person, the words are deleted from the command chat', async () => {
  const cmd = dm(OWNER, `${P()}viewoncetext 27822222222 | Meet me at 8`);
  const out = await say(cmd);
  assert.ok(relayed.some((x) => x.j === FRIEND && x.c.text === 'Meet me at 8' && x.c.viewOnce), 'sent to the person as view-once');
  assert.ok(!relayed.some((x) => x.j === OWNER), 'and not in the chat the command was typed in');
  const del = sent.find((x) => x.c.delete);
  assert.ok(del && del.c.delete.id === cmd.key.id, 'the command message is deleted');
  assert.ok(out.some((t) => /View-once text sent/.test(t) && /27822222222/.test(t)), 'you are told where it went');
  assert.ok(!out.some((t) => /Meet me at 8/.test(t)), 'the confirmation never repeats the words');
});

test('v1.8.7 viewoncetext: a group by number, by id and by name; "me" is your own chat; "here |" is this chat', async () => {
  await say(dm(OWNER, `${P()}viewoncetext 1 | to the group`));
  assert.ok(relayed.some((x) => x.j === G && x.c.text === 'to the group'));
  await say(dm(OWNER, `${P()}vot ${G} | by id`));
  assert.ok(relayed.some((x) => x.j === G && x.c.text === 'by id'));
  await say(dm(OWNER, `${P()}vot football | by name`));
  assert.ok(relayed.some((x) => x.j === G && x.c.text === 'by name'));
  await say(dm(MEMBER, `${P()}vot me | nope`));
  assert.strictEqual(relayed.length, 0, 'only the owner can');
  await say(dm(OWNER, `${P()}vot here | right here`));
  assert.ok(relayed.some((x) => x.j === OWNER && x.c.text === 'right here'));
});

test('v1.8.7 viewoncetext: only the first | splits, plain text still goes to this chat, and a bad place is refused', async () => {
  await say(dm(OWNER, `${P()}vot 27822222222 | pick A | or B`));
  assert.ok(relayed.some((x) => x.j === FRIEND && x.c.text === 'pick A | or B'));
  await say(dm(OWNER, `${P()}vot 27822222222 is my number`));
  assert.ok(relayed.some((x) => x.j === OWNER && x.c.text === '27822222222 is my number'), 'without a | everything is the text, even a number');
  const bad = await say(dm(OWNER, `${P()}vot nowhere-at-all | hello`));
  assert.ok(bad.some((t) => /could not find that chat/.test(t)));
  assert.strictEqual(relayed.length, 0, 'nothing is sent to a place that was not found');
  const empty = await say(dm(OWNER, `${P()}vot 27822222222 |`));
  assert.ok(empty.some((t) => /Write the words/.test(t)));
  assert.strictEqual(relayed.length, 0);
});

test('v1.8.7 viewoncetext: if sending elsewhere fails you get a next step and your command message is kept', async () => {
  const real = sock.relayMessage;
  sock.relayMessage = async () => { throw new Error('boom'); };
  const out = await say(dm(OWNER, `${P()}vot 27822222222 | hi`));
  sock.relayMessage = real;
  assert.ok(out.some((t) => /could not send/.test(t) && /try again/.test(t)));
  assert.ok(!sent.some((x) => x.c.delete));
});

test('v1.8.7 viewoncetext: the help shows how to choose where', async () => {
  const out = await say(dm(OWNER, `${P()}vot`));
  assert.ok(out.some((t) => /27821234567 \| Meet me at 8/.test(t) && /gjids/.test(t)));
});

// ------------------------------------------------------------------ opening a view-once again
const voMsg = (from, content, id) => ({ key: { remoteJid: from, id, fromMe: false }, message: { viewOnceMessageV2: { message: content } }, messageTimestamp: now() });
const replyTo = (id, quotedMessage, text) => ({
  key: { remoteJid: OWNER, id: `R187-${++n}`, fromMe: false },
  message: { extendedTextMessage: { text, contextInfo: { stanzaId: id, participant: MEMBER, quotedMessage } } },
  messageTimestamp: now(),
});

test('v1.8.7 vv: a view-once text opens again and again, even when the quote is empty and the bot has forgotten it', async () => {
  const full = voMsg(MEMBER, { extendedTextMessage: { text: 'secret words' } }, 'VOT-A');
  watchers.early(sock, full);
  await settle();
  assert.ok(vault.has('VOT-A'), 'it was saved when it arrived');
  const emptyQuote = { viewOnceMessage: { message: { extendedTextMessage: { text: '' } } } };
  for (let i = 0; i < 3; i++) {
    const out = await say(replyTo('VOT-A', emptyQuote, `${P()}vv`));
    assert.ok(out.some((t) => /secret words/.test(t)), `opened time ${i + 1}`);
  }
});

test('v1.8.7 vv: a picture is saved on arrival and opens again after WhatsApp no longer gives the file', async () => {
  let downloads = 0;
  const media = require('../whatsapp/media');
  const realDownload = media.download;
  media.download = async () => { downloads++; if (downloads > 1) throw new Error('gone from the server'); return Buffer.from('PICTURE-BYTES'); };
  const imageNode = { mediaKey: Buffer.from('k'), directPath: '/x', url: 'https://x', mimetype: 'image/jpeg', caption: 'look', viewOnce: true };
  const full = voMsg(MEMBER, { imageMessage: imageNode }, 'VOI-A');
  watchers.early(sock, full);
  await settle();
  assert.strictEqual(downloads, 1, 'downloaded once, when it arrived');
  assert.ok(vault.has('VOI-A'));
  // opened on the phone: the quote has no file details any more, and the server refuses a second download
  const opened = { viewOnceMessage: { message: { imageMessage: { viewOnce: true } } } };
  for (let i = 0; i < 2; i++) {
    await say(replyTo('VOI-A', opened, `${P()}vv`));
    const img = sent.find((x) => x.c.image);
    assert.ok(img && Buffer.from(img.c.image).toString() === 'PICTURE-BYTES', `opened time ${i + 1}`);
    assert.ok(/look/.test(img.c.caption));
  }
  assert.strictEqual(downloads, 1, 'no second download was needed');
  media.download = realDownload;
});

test('v1.8.7 vv: a view-once text you sent yourself can be opened again too', async () => {
  await say(dm(OWNER, `${P()}vot 27822222222 | my own words`));
  const ownId = `V187-${k}`;
  assert.ok(vault.has(ownId));
  const out = await say(replyTo(ownId, { viewOnceMessage: { message: { extendedTextMessage: { text: '' } } } }, `${P()}vv`));
  assert.ok(out.some((t) => /my own words/.test(t)));
});

test('v1.8.7 vv: a view-once that was never saved says so plainly and gives a next step', async () => {
  const out = await say(replyTo('NEVER-SAVED', { viewOnceMessage: { message: { imageMessage: {} } } }, `${P()}vv`));
  assert.ok(out.some((t) => /could not open that view-once/.test(t) && /send it again/.test(t)));
});

test('v1.8.7 vault: old and surplus items are removed', () => {
  const fs = require('fs');
  const path = require('path');
  vault.keepText('OLD-ONE', 'old');
  const meta = path.join(vault.DIR, 'OLD-ONE.json');
  const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
  data.at = Date.now() - 15 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(meta, JSON.stringify(data));
  vault.prune(true);
  assert.ok(!vault.has('OLD-ONE'), 'older than two weeks: gone');
  assert.ok(vault.has('VOT-A'), 'recent ones stay');
});

// ------------------------------------------------------------------ the one-file launcher for the pair site
test('v1.8.8 deploy launcher: it is a valid file with ONE placeholder for the pair site and needs no packages', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'deploy-index.js'), 'utf8');
  assert.strictEqual(src.split('__TFX_SESSION_ID__').length - 1, 2, 'the placeholder is in the constant and in the note that explains it');
  assert.ok(/const SESSION_ID = '__TFX_SESSION_ID__';/.test(src), 'the pair site replaces exactly this line');
  const requires = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(requires.every((r) => ['fs', 'path', 'zlib', 'child_process'].includes(r)), `only Node's own modules: ${requires}`);
  new (require('vm').Script)(src.replace(/^#!.*\n/, '')); // compiles
});

// ------------------------------------------------------------------ hiding the code before a push
test('v1.9.1 obfuscate: hides the targeted files, keeps the excluded ones readable, and the whole thing reverts on --check', () => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const root = path.join(__dirname, '..');
  const before = fs.readFileSync(path.join(root, 'core', 'brand.js'), 'utf8');
  const out = execFileSync(process.execPath, [path.join(root, 'tools', 'obfuscate.private.js'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.ok(/Hid \d+ file\(s\)/.test(out), 'reports how many files it hid');
  assert.ok(/plain code was put back/.test(out), '--check changes nothing');
  assert.strictEqual(fs.readFileSync(path.join(root, 'core', 'brand.js'), 'utf8'), before, 'nothing on disk actually changed');
  const src = fs.readFileSync(path.join(root, 'tools', 'obfuscate.private.js'), 'utf8');
  for (const rel of ['core/brand.js', 'core/integrity.js', 'whatsapp/connection.js', 'core/plugins/worker.js', 'core/plugins/broker.js', 'core/boot.js']) {
    assert.ok(src.includes(`'${rel}'`), `${rel} must stay in the exclude list (a test reads its raw source)`);
  }
});

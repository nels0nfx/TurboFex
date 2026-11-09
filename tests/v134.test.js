require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const watchers = require('../whatsapp/watchers');
const stickercmd = require('../commands/stickercmd');
const watchcmds = require('../commands/watchcmds');
const statuscmds = require('../commands/statuscmds');
const { ownerChat } = require('../whatsapp/owner');

baileys.setForTests({ downloadMediaMessage: async (m) => Buffer.from(`FILE-${m.key.id}`) });

const OWNER = '27800000001@s.whatsapp.net';
const FRIEND = '27811110099@s.whatsapp.net';
const sent = [];
const sock = {
  user: { id: '27800000001:1@s.whatsapp.net' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  readMessages: async () => {},
  groupMetadata: async () => ({ subject: 'G', participants: [] }),
};
let n = 0;
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 80)); };
const find = (cmds, name) => (Array.isArray(cmds) ? cmds : [cmds]).find((c) => c.name === name);
const run = (cmd, args, extra = {}) => cmd.run({ sock, jid: OWNER, args, rest: args.join(' '), prefix: '.', reply: async (t) => sent.push({ j: 'reply', c: { text: t } }), commandList: handler.commandList || [], msg: {}, ...extra });
const SHA = Buffer.from('sticker-hash-123');
const sticker = (extra = {}) => ({ stickerMessage: { fileSha256: SHA, mimetype: 'image/webp', ...extra } });
const viewOnce = { viewOnceMessageV2: { message: { imageMessage: { url: 'https://x', mediaKey: Buffer.from('k'), mimetype: 'image/jpeg', caption: 'secret' } } } };

test('v1.3.4: the copy of view-once, deleted and edited messages can go to the chat where it happened', async () => {
  const cmd = find(watchcmds, 'deletejid');
  await cmd.run({ sock, jid: FRIEND, rest: 'chat', reply: async (t) => sent.push({ c: { text: t } }), prefix: '.' });
  assert.strictEqual(store.watchCfg('delete').to, 'chat');
  const cfg = store.watchCfg('delete');
  assert.strictEqual(watchers.dest(sock, cfg, '120363000000000555@g.us'), '120363000000000555@g.us');
  store.updateWatch('delete', (w) => { w.to = null; });
  assert.strictEqual(watchers.dest(sock, store.watchCfg('delete'), FRIEND), ownerChat(sock), 'default: your own chat');
  store.updateWatch('delete', (w) => { w.to = '27822220001@s.whatsapp.net'; });
  assert.strictEqual(watchers.dest(sock, store.watchCfg('delete'), FRIEND), '27822220001@s.whatsapp.net', 'a chosen chat still works');
  store.updateWatch('delete', (w) => { w.to = null; });
});

test('v1.3.4: an edited message is sent to the chat where it was edited when the destination is "chat"', async () => {
  store.updateWatch('edit', (w) => { w.mode = 'all'; w.to = 'chat'; });
  sent.length = 0;
  const G = '120363000000000556@g.us';
  await handler.handleMessage(sock, { key: { remoteJid: G, id: 'ORIG1', fromMe: false, participant: FRIEND }, message: { conversation: 'first text' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  await handler.handleMessage(sock, { key: { remoteJid: G, id: 'EDIT1', fromMe: false, participant: FRIEND }, message: { protocolMessage: { type: 14, key: { remoteJid: G, id: 'ORIG1' }, editedMessage: { conversation: 'second text' } } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
  const copy = sent.find((s) => s.c.text && /Edited message/.test(s.c.text));
  assert.ok(copy, 'the notice was sent');
  assert.strictEqual(copy.j, G, 'to the group where the message was edited');
  store.updateWatch('edit', (w) => { w.mode = 'off'; w.to = null; });
});

test('v1.3.4: replying to a status saves it (when switched on), silently, once', async () => {
  baileys.setForTests({ downloadMediaMessage: async () => Buffer.from('STATUS-PIC') });
  const reply = (id) => ({ key: { remoteJid: FRIEND, id: `R${++n}`, fromMe: true }, message: { extendedTextMessage: { text: 'nice one', contextInfo: { stanzaId: id, participant: FRIEND, remoteJid: 'status@broadcast', quotedMessage: { imageMessage: { url: 'https://x', mediaKey: Buffer.from('k'), mimetype: 'image/jpeg', caption: 'my day' } } } } }, messageTimestamp: Math.floor(Date.now() / 1000) });
  sent.length = 0;
  await handler.handleMessage(sock, reply('ST1'));
  await settle();
  assert.strictEqual(sent.filter((s) => s.c.image).length, 0, 'switched off: nothing is saved');

  await run(find(statuscmds, 'statusreply'), ['on']);
  assert.strictEqual(store.statusCfg().saveReply, true);
  sent.length = 0;
  await handler.handleMessage(sock, reply('ST2'));
  await settle();
  const saved = sent.filter((s) => s.c.image);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].j, ownerChat(sock), 'sent to your own chat');
  assert.match(saved[0].c.caption, /Status saved[\s\S]*my day/);
  assert.strictEqual(sent.filter((s) => s.j === FRIEND).length, 0, 'nothing was sent or reacted in the chat where you replied');

  sent.length = 0;
  await handler.handleMessage(sock, reply('ST2'));
  await settle();
  assert.strictEqual(sent.filter((s) => s.c.image).length, 0, 'the same status is saved once');

  // a reply that is not to a status, or written by somebody else, saves nothing
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: FRIEND, id: `R${++n}`, fromMe: false }, message: { extendedTextMessage: { text: 'hi', contextInfo: { stanzaId: 'ST9', participant: OWNER, remoteJid: 'status@broadcast', quotedMessage: { imageMessage: { url: 'https://x', mediaKey: Buffer.from('k') } } } } } });
  await settle();
  assert.strictEqual(sent.filter((s) => s.c.image).length, 0, 'only the owner');
  await run(find(statuscmds, 'statusreply'), ['off']);
});

test('v1.3.4: a sticker linked to vv opens a view-once silently and sends it to the view-once chat', async () => {
  baileys.setForTests({ downloadMediaMessage: async (m) => Buffer.from(`FILE-${m.key.id}`) });
  const cmds = handler.commandList || [];
  const set = find(stickercmd, 'setstickercmd');
  // 1) the owner replies to a sticker with: setstickercmd vv
  const lines = [];
  await set.run({ sock, jid: FRIEND, args: ['vv'], prefix: '.', commandList: cmds.length ? cmds : [{ name: 'vv', aliases: [], silentOnSticker: true }], reply: async (t) => lines.push(t), msg: { message: { extendedTextMessage: { text: '.setstickercmd vv', contextInfo: { stanzaId: 'S1', quotedMessage: sticker() } } } } });
  assert.match(lines[0], /Sticker saved/);
  assert.strictEqual(Object.keys(store.getStickerCmds()).length, 1);

  // 2) the owner sends that sticker as a reply to a view-once message in a chat with a friend
  const send = (id = `ST${++n}`, from = true) => ({ key: { remoteJid: FRIEND, id, fromMe: from }, message: { ...sticker({ contextInfo: { stanzaId: 'VO1', participant: FRIEND, quotedMessage: viewOnce } }) }, messageTimestamp: Math.floor(Date.now() / 1000) });
  sent.length = 0;
  await handler.handleMessage(sock, send());
  await settle();
  const img = sent.find((s) => s.c.image);
  assert.ok(img, 'the view-once was opened');
  assert.strictEqual(img.j, ownerChat(sock), 'sent to the view-once chat (default: your own chat)');
  assert.strictEqual(img.c.image.toString(), 'FILE-VO1');
  assert.strictEqual(sent.filter((s) => s.j === FRIEND).length, 0, 'no answer and no reaction in the chat');

  // 3) with the destination "chat" it goes to the chat where it was sent
  store.updateWatch('viewonce', (w) => { w.to = 'chat'; });
  sent.length = 0;
  await handler.handleMessage(sock, send());
  await settle();
  assert.strictEqual(sent.find((s) => s.c.image)?.j, FRIEND);
  assert.ok(!sent.some((s) => s.c.react), 'still no reaction');
  store.updateWatch('viewonce', (w) => { w.to = null; });

  // 4) somebody else sending the same sticker does nothing
  sent.length = 0;
  await handler.handleMessage(sock, send(`ST${++n}`, false));
  await settle();
  assert.strictEqual(sent.length, 0);

  // 5) a problem is told in the owner's own chat, never in the chat
  sent.length = 0;
  await handler.handleMessage(sock, { key: { remoteJid: FRIEND, id: `ST${++n}`, fromMe: true }, message: { ...sticker() } });
  await settle();
  assert.strictEqual(sent.filter((s) => s.j === FRIEND).length, 0);
  assert.ok(sent.some((s) => s.j === ownerChat(sock) && /Reply to a view-once/.test(s.c.text || '')), 'the owner is told where to look');

  // 6) the sticker can be removed
  const del = find(stickercmd, 'delstickercmd');
  await del.run({ msg: { message: { extendedTextMessage: { contextInfo: { stanzaId: 'S1', quotedMessage: sticker() } } } }, args: [], reply: async () => {}, prefix: '.' });
  assert.strictEqual(Object.keys(store.getStickerCmds()).length, 0);
  sent.length = 0;
  await handler.handleMessage(sock, send());
  await settle();
  assert.strictEqual(sent.filter((s) => s.c.image).length, 0, 'removed: the sticker does nothing');
});

test('v1.3.4 clean-up: old safety copies are deleted after 60 days, new ones stay, and sticker commands are capped', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const legacy = require('../core/legacyclean');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-prune-'));
  const dir = path.join(root, 'data', 'legacy-removed', 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'old.js'), 'x');
  fs.writeFileSync(path.join(dir, 'new.js'), 'x');
  const old = new Date(Date.now() - 90 * 86400000);
  fs.utimesSync(path.join(dir, 'old.js'), old, old);
  assert.strictEqual(legacy.pruneCopies(root, 60), 1);
  assert.ok(!fs.existsSync(path.join(dir, 'old.js')) && fs.existsSync(path.join(dir, 'new.js')));
  fs.rmSync(root, { recursive: true, force: true });
  for (let i = 0; i < 205; i++) store.setStickerCmd(`k${i}`, { cmd: 'ping', args: '' });
  assert.strictEqual(Object.keys(store.getStickerCmds()).length, 200);
  Object.keys(store.getStickerCmds()).forEach((k) => store.delStickerCmd(k));
});

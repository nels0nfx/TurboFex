require('./_setup');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const baileys = require('../core/baileys');
const { peel, textOf, findViewOnce, editInfo } = require('../whatsapp/unwrap');
const pairfix = require('../core/pairfix');
const secretedit = require('../whatsapp/secretedit');

// a stand-in for the WhatsApp library's message format
baileys.setForTests({
  proto: { Message: { create: (x) => x, encode: (x) => ({ finish: () => new TextEncoder().encode(JSON.stringify(x)) }), decode: (b) => JSON.parse(new TextDecoder().decode(b)) } },
});

test('envelopes are opened', () => {
  assert.strictEqual(textOf({ ephemeralMessage: { message: { extendedTextMessage: { text: 'hi' } } } }), 'hi');
  assert.strictEqual(peel({ editedMessage: { message: { protocolMessage: { type: 14 } } } }).content.protocolMessage.type, 14);
});
test('view-once messages are found, also when the file details are missing', () => {
  assert.strictEqual(findViewOnce({ viewOnceMessageV2: { message: { imageMessage: { mediaKey: 1 } } } }).kind, 'image');
  assert.ok(findViewOnce({ viewOnceMessage: { message: { videoMessage: {} } } }).empty);
  assert.strictEqual(findViewOnce({ imageMessage: {} }), null);
});
test('an edit is found in every shape', () => {
  const pm = { protocolMessage: { type: 14, key: { id: 'A' }, editedMessage: { conversation: 'new' } } };
  assert.deepStrictEqual(editInfo(pm), { id: 'A', text: 'new' });
  assert.deepStrictEqual(editInfo({ editedMessage: { message: pm } }), { id: 'A', text: 'new' });
});
test('a sealed edit is opened with the secret of the original message', () => {
  const secret = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const lid = '211459040641230@lid';
  const enc = secretedit.seal({ secret, origId: 'ORIG', origSender: lid, editor: lid, text: 'the new text', iv });
  const text = secretedit.decryptEdit({ sec: { targetMessageKey: { id: 'ORIG' }, encPayload: enc, encIv: iv }, key: { remoteJid: lid }, secret });
  assert.strictEqual(text, 'the new text');
  assert.strictEqual(secretedit.decryptEdit({ sec: { targetMessageKey: { id: 'ORIG' }, encPayload: enc, encIv: iv }, key: { remoteJid: lid }, secret: crypto.randomBytes(32) }), null);
  assert.deepStrictEqual(secretedit.findSecret({ messageContextInfo: { messageSecret: secret } }), secret);
});
test('linking: the QR gets a new secret after WhatsApp asks for a refresh, a linked bot is never touched', () => {
  const ws = new EventEmitter();
  const sock = { ws, ev: new EventEmitter(), authState: { creds: { registered: false, advSecretKey: 'OLD' } } };
  const shown = [];
  const link = pairfix.install(sock);
  link.onRefresh((q) => shown.push(q));
  assert.strictEqual(link.fixQr('REF,N,I,OLD'), 'REF,N,I,OLD');
  ws.emit('CB:notification,type:companion_reg_refresh', { content: [{ tag: 'other' }] });
  assert.strictEqual(shown.length, 0);
  ws.emit('CB:notification,type:companion_reg_refresh', { content: [{ tag: 'companion_reg_refresh' }] });
  const adv = sock.authState.creds.advSecretKey;
  assert.notStrictEqual(adv, 'OLD');
  assert.strictEqual(shown[0], `REF,N,I,${adv}`);
  assert.strictEqual(link.fixQr('REF2,N,I,OLD'), `REF2,N,I,${adv}`);
  const linked = { ws: new EventEmitter(), ev: new EventEmitter(), authState: { creds: { registered: true, advSecretKey: 'KEEP' } } };
  pairfix.install(linked);
  linked.ws.emit('CB:notification,type:companion_reg_refresh', { content: [{ tag: 'companion_reg_refresh' }] });
  assert.strictEqual(linked.authState.creds.advSecretKey, 'KEEP');
});

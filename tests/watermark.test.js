require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const wm = require('../whatsapp/watermark');

test('results get the watermark, errors and hints do not', () => {
  assert.strictEqual(wm.mark({ text: '🎵 Song' }, 'WM').text, '🎵 Song\n\nWM');
  assert.strictEqual(wm.mark({ text: '⚠️ Something failed' }, 'WM').text, '⚠️ Something failed');
  assert.strictEqual(wm.mark({ text: 'Reply to a picture' }, 'WM').text, 'Reply to a picture');
});
test('captions get it, stickers and audio cannot', () => {
  assert.strictEqual(wm.mark({ image: 1, caption: 'qr' }, 'WM').caption, 'qr\n\nWM');
  assert.deepStrictEqual(wm.mark({ sticker: 1 }, 'WM'), { sticker: 1 });
});
test('never added twice, never to edits', () => {
  assert.strictEqual(wm.mark({ text: 'x\n\nWM' }, 'WM').text, 'x\n\nWM');
  assert.deepStrictEqual(wm.mark({ text: 'x', edit: {} }, 'WM'), { text: 'x', edit: {} });
});
test('which commands: by category, by name, or switched off', () => {
  assert.ok(wm.applies({ name: 'x', category: 'media' }));
  assert.ok(wm.applies({ name: 'qr', category: 'tools' }));
  assert.ok(!wm.applies({ name: 'ping', category: 'general' }));
  assert.ok(!wm.applies({ name: 'x', category: 'media', watermark: false }));
});

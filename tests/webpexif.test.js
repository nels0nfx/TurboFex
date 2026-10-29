require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const { addExif } = require('../core/webpexif');

// a small WebP with the given chunks (the picture data is not decoded by these tests)
const chunk = (id, data) => {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};
const webp = (chunks) => {
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(12);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(4 + body.length, 4);
  h.write('WEBP', 8, 'latin1');
  return Buffer.concat([h, body]);
};
const ids = (buf) => {
  const out = [];
  for (let at = 12; at + 8 <= buf.length; ) {
    const size = buf.readUInt32LE(at + 4);
    out.push(buf.toString('latin1', at, at + 4));
    at += 8 + size + (size % 2);
  }
  return out;
};
const vp8l = (w, h, alpha) => {
  const d = Buffer.alloc(9);
  d[0] = 0x2f;
  d.writeUInt32LE(((w - 1) | ((h - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, 1);
  return chunk('VP8L', d);
};

test('a sticker with a VP8X header gets an EXIF chunk and the flag', () => {
  const src = webp([chunk('VP8X', Buffer.from([0x10, 0, 0, 0, 255, 1, 0, 255, 1, 0])), chunk('VP8 ', Buffer.alloc(20))]);
  const out = addExif(src, { pack: 'My Pack', author: 'Me' });
  assert.deepStrictEqual(ids(out), ['VP8X', 'VP8 ', 'EXIF']);
  assert.ok(out[20] & 0x08); // the EXIF flag in the VP8X header
  assert.ok(out.includes('My Pack') && out.includes('Me'));
  assert.strictEqual(out.readUInt32LE(4), out.length - 8); // the RIFF size is right
});
test('a simple lossless WebP gets a VP8X header with its real size', () => {
  const out = addExif(webp([vp8l(512, 300, true)]), { pack: 'P', author: 'A' });
  assert.deepStrictEqual(ids(out), ['VP8X', 'VP8L', 'EXIF']);
  assert.strictEqual(out.readUIntLE(24, 3) + 1, 512);
  assert.strictEqual(out.readUIntLE(27, 3) + 1, 300);
  assert.ok(out[20] & 0x10); // alpha
});
test('an old EXIF chunk is replaced, not doubled', () => {
  const once = addExif(webp([vp8l(8, 8, false)]), { pack: 'one', author: 'a' });
  const twice = addExif(once, { pack: 'two', author: 'a' });
  assert.strictEqual(ids(twice).filter((i) => i === 'EXIF').length, 1);
  assert.ok(twice.includes('two') && !twice.includes('one'));
});
test('anything that is not a WebP comes back unchanged', () => {
  const junk = Buffer.from('this is not a webp file at all');
  assert.strictEqual(addExif(junk, { pack: 'a', author: 'b' }), junk);
});

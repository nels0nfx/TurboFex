// Puts a pack name and an author inside a WebP sticker (the "Sticker by ..." WhatsApp shows). The image itself is not
// touched: a small EXIF chunk is added to the WebP file. If anything looks wrong the original sticker is returned.
const crypto = require('crypto');

// the header WhatsApp expects in front of the JSON
const WA_HEADER = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);

function makeExif(pack, author) {
  const json = Buffer.from(
    JSON.stringify({ 'sticker-pack-id': crypto.randomBytes(16).toString('hex'), 'sticker-pack-name': String(pack || ''), 'sticker-pack-publisher': String(author || ''), emojis: [''] }),
    'utf8'
  );
  const exif = Buffer.concat([WA_HEADER, json]);
  exif.writeUInt32LE(json.length, 14);
  return exif;
}

const chunk = (fourcc, data) => {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};

function parseChunks(webp) {
  const chunks = [];
  let at = 12;
  while (at + 8 <= webp.length) {
    const id = webp.toString('latin1', at, at + 4);
    const size = webp.readUInt32LE(at + 4);
    if (at + 8 + size > webp.length) throw new Error('chunk is cut off');
    chunks.push({ id, data: webp.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size % 2);
  }
  return chunks;
}

// a VP8X header for a simple (single image) WebP
function makeVp8x(first) {
  let w;
  let h;
  let alpha = 0;
  const d = first.data;
  if (first.id === 'VP8 ') {
    if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new Error('not a VP8 image');
    w = d.readUInt16LE(6) & 0x3fff;
    h = d.readUInt16LE(8) & 0x3fff;
  } else if (first.id === 'VP8L') {
    if (d[0] !== 0x2f) throw new Error('not a VP8L image');
    const bits = d.readUInt32LE(1);
    w = (bits & 0x3fff) + 1;
    h = ((bits >> 14) & 0x3fff) + 1;
    alpha = (bits >>> 28) & 1;
  } else {
    throw new Error('unknown WebP layout');
  }
  const data = Buffer.alloc(10);
  data[0] = 0x08 | (alpha ? 0x10 : 0);
  data.writeUIntLE(w - 1, 4, 3);
  data.writeUIntLE(h - 1, 7, 3);
  return { id: 'VP8X', data };
}

// returns the sticker with the credit inside, or the original when it cannot be done
function addExif(webp, { pack, author }) {
  try {
    if (!Buffer.isBuffer(webp) || webp.length < 20 || webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') return webp;
    let chunks = parseChunks(webp).filter((c) => c.id !== 'EXIF');
    if (!chunks.length) return webp;
    if (chunks[0].id !== 'VP8X') chunks = [makeVp8x(chunks[0]), ...chunks];
    else {
      chunks[0] = { id: 'VP8X', data: Buffer.from(chunks[0].data) };
      chunks[0].data[0] |= 0x08; // the "has EXIF" flag
    }
    chunks.push({ id: 'EXIF', data: makeExif(pack, author) });
    const body = Buffer.concat(chunks.map((c) => chunk(c.id, c.data)));
    const head = Buffer.alloc(12);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(4 + body.length, 4);
    head.write('WEBP', 8, 'latin1');
    return Buffer.concat([head, body]);
  } catch (err) {
    return webp;
  }
}

module.exports = { addExif, makeExif };

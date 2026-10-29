// Autosticker: pictures and videos written in a group (where it is switched on) are sent back as stickers
const media = require('./media');
const store = require('./store');

const lastAt = new Map();
const GAP_MS = 4000;

async function maybe(sock, msg, jid, botIds) {
  if (msg.key.fromMe || !store.getGroup(jid).autosticker) return;
  const own = media.unwrap(msg.message);
  const kind = media.kindOf(own);
  if (kind !== 'image' && kind !== 'video') return;
  if (kind === 'video' && (own.videoMessage?.seconds || 0) > 8) return; // long videos are not stickers
  if (Date.now() - (lastAt.get(jid) || 0) < GAP_MS) return;
  lastAt.set(jid, Date.now());
  if (lastAt.size > 2000) lastAt.clear();
  try {
    const found = media.findMedia(msg, jid, botIds);
    const buffer = await media.download(sock, found.source);
    const webp = await media.toSticker(kind, buffer);
    await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
  } catch (err) {
    // no picture or video tools here, a file that is too big... nothing to say in the group
  }
}

module.exports = { maybe };

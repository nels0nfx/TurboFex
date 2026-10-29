// Reveals a view-once picture, video or voice note: reply to it with "vv".
const media = require('../whatsapp/media');
const watchers = require('../whatsapp/watchers');
const clock = require('../core/clock');
const { ownerChat } = require('../whatsapp/owner');
const { getQuoted, num } = require('../whatsapp/utils');
const { peel, findViewOnce } = require('../whatsapp/unwrap');

module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'reveal'],
  category: 'watch',
  slow: true,
  ownerOnly: true,
  needs: [],
  weight: 'medium',
  description: 'Open a view-once picture, video or voice note: reply to it with vv (vv me = send it to your own chat)',
  async run({ sock, jid, msg, args, reply, prefix, botIds }) {
    const q = getQuoted(msg);
    if (!q) return reply(`Reply to a view-once message with *${prefix}vv*.\n*${prefix}vv me* sends the file to your own chat instead of this one.`);

    const vo = findViewOnce(q.message);
    const inner = peel(q.message).content;
    const node = vo?.node || inner.imageMessage || inner.videoMessage || inner.audioMessage;
    if (!node) return reply('⚠️ That message has no picture, video or voice note in it.');
    const kind = inner.videoMessage ? 'video' : inner.audioMessage ? 'audio' : 'image';

    const source = {
      key: { remoteJid: jid, id: q.id, participant: q.participant, fromMe: botIds.includes(num(q.participant)) },
      message: q.message,
    };
    let buffer;
    try {
      buffer = await watchers.fetchMedia(sock, source);
    } catch (err) {
      console.error('vv failed:', err.message);
      return reply(`⚠️ I could not open that file.\nReason: ${String(err.message).slice(0, 100)}\n${watchers.OPEN_ON_PHONE}`);
    }

    const to = (args[0] || '').toLowerCase() === 'me' ? ownerChat(sock) : jid;
    const caption = `👁️ *View-once opened*\n🕒 ${clock.stamp(Date.now())}${node.caption ? `\n\n${node.caption}` : ''}`;
    const opts = to === jid ? { quoted: msg } : undefined;
    if (kind === 'image') await sock.sendMessage(to, { image: buffer, caption }, opts);
    else if (kind === 'video') await sock.sendMessage(to, { video: buffer, caption }, opts);
    else await sock.sendMessage(to, { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: !!node.ptt }, opts);
    if (to !== jid) await reply('✅ Sent to your chat.');
  },
};

// TikTok downloader without the watermark: tiktok <link> (or reply to a message that has the link)
const ytdlp = require('../core/ytdlp');
const links = require('../core/linkkinds');
const { getQuoted, quotedText } = require('../whatsapp/utils');

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'tiktokdl'],
  category: 'media',
  slow: true,
  weight: 'heavy',
  needs: [],
  description: 'Download a TikTok video without the watermark: tiktok <link>',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    const link = links.firstLink(rest) || links.firstLink(quotedText(getQuoted(msg)));
    if (!link) return reply(`Send a TikTok link.\nExample: ${prefix}tiktok https://vm.tiktok.com/...\n(You can also reply to a message that has the link.)`);
    if (links.kindOf(link) !== 'tiktok') return reply('⚠️ That is not a TikTok link. Use *dl* for other sites.');
    await reply('⏳ Getting the TikTok without the watermark...');
    try {
      const v = await ytdlp.downloadVideo(link, { noWatermark: true, onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
      const caption = [`🎵 *${v.title || 'TikTok'}*`, v.artist && `👤 ${v.artist}`, v.duration && `⏱️ ${v.duration}`, '✅ No watermark'].filter(Boolean).join('\n');
      if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
      return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `tiktok${v.ext}`, caption }, { quoted: msg });
    } catch (err) {
      console.error('tiktok failed:', err.message);
      if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
      return reply(`⚠️ I could not get that TikTok. It may be private, removed, or has no clean version.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ''}`);
    }
  },
};

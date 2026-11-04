// TikTok downloader without the watermark: tiktok <link> (or reply to a message that has the link)
const ytdlp = require('../core/ytdlp');
const links = require('../core/linkkinds');
const { getQuoted, quotedText } = require('../whatsapp/utils');

module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'tiktokdl'],
  category: 'download',
  slow: true,
  weight: 'medium',
  needs: [],
  description: 'Download a TikTok video without the watermark: tiktok <link>',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    const link = links.firstLink(rest) || links.firstLink(quotedText(getQuoted(msg)));
    if (!link) return reply(`Send a TikTok link.\nExample: ${prefix}tiktok https://vm.tiktok.com/...\n(You can also reply to a message that has the link.)`);
    if (links.kindOf(link) !== 'tiktok') return reply('⚠️ That is not a TikTok link. Use *dl* for other sites.');
    reply('⏳ Getting the TikTok without the watermark...').catch(() => {}); // not awaited: the download starts at once
    try {
      const v = await ytdlp.downloadVideo(link, { noWatermark: true, onSetup: () => reply('⏳ *Getting ready, one moment...*') });
      const caption = [`🎵 *${v.title || 'TikTok'}*`, v.artist && `👤 ${v.artist}`, v.duration && `⏱️ ${v.duration}`, '✅ No watermark'].filter(Boolean).join('\n');
      if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
      return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `tiktok${v.ext}`, caption }, { quoted: msg });
    } catch (err) {
      console.error('tiktok failed:', err.message);
      return reply(ytdlp.explain(err, { isOwner, prefix, what: 'that TikTok' }));
    }
  },
};

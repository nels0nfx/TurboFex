// Downloads a video from a link (YouTube, TikTok, Instagram, Facebook, X and most other sites) or from a name.
const { downloadVideo } = require('../core/ytdlp');

module.exports = {
  name: 'dl',
  aliases: ['video', 'download'],
  category: 'media',
  slow: true,
  weight: 'heavy',
  needs: [],
  description: 'Download a video from a link or a name (up to 720p): dl <link or name>. For music use play',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`Send a link or a name.\nExample: ${prefix}dl https://youtu.be/...`);
    await reply('⏳ Downloading, this can take a moment...');
    try {
      const v = await downloadVideo(rest, { onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
      const caption = [`🎬 *${v.title || 'Video'}*`, v.artist && `👤 ${v.artist}`, v.duration && `⏱️ ${v.duration}`].filter(Boolean).join('\n');
      if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
      // another format: sent as a file so it still reaches the person
      return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `${(v.title || 'video').slice(0, 60)}${v.ext}`, caption }, { quoted: msg });
    } catch (err) {
      console.error('dl failed:', err.message);
      if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
      if (err.code === 'BOT_BLOCK') return reply(isOwner ? `⚠️ YouTube blocked this server.\n🍪 Fix: send a cookies.txt with *${prefix}ytcookies*.` : '⚠️ I could not download that right now. Please try another link or try again later.');
      return reply(`⚠️ I could not download that.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ' Check the link and try again.'}`);
    }
  },
};

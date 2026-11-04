// Downloads a video from a link (YouTube, TikTok, Instagram, Facebook, X and most other sites) or from a name.
const { downloadVideo, explain } = require('../core/ytdlp');

module.exports = {
  name: 'dl',
  aliases: ['video', 'download'],
  category: 'download',
  slow: true,
  weight: 'medium',
  needs: [],
  description: 'Download a video from a link or a name (up to 720p): dl <link or name>. For music use play',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`📥 *Video download*\n▸ Send a link or a name.\n▸ *Example:* \`${prefix}dl https://youtu.be/...\``);
    reply('⏳ *Downloading, this can take a moment...*').catch(() => {}); // not awaited: the download starts at once
    try {
      const v = await downloadVideo(rest, { onSetup: () => reply('⏳ *Getting ready, one moment...*') });
      const caption = [`🎬 *${v.title || 'Video'}*`, v.artist && `👤 ${v.artist}`, v.duration && `⏱️ ${v.duration}`].filter(Boolean).join('\n');
      if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
      // another format: sent as a file so it still reaches the person
      return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `${(v.title || 'video').slice(0, 60)}${v.ext}`, caption }, { quoted: msg });
    } catch (err) {
      console.error('dl failed:', err.message);
      const host = /facebook\.com|fb\.watch|fb\.com/i.test(rest) ? 'that Facebook link' : 'that link';
      return reply(explain(err, { isOwner, prefix, what: host })); // one shared wording for every download command
    }
  },
};

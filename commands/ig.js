// Instagram downloader: posts, reels and stories. ig <link> (or reply to a message that has the link)
const ytdlp = require('../core/ytdlp');
const links = require('../core/linkkinds');
const { getQuoted, quotedText } = require('../whatsapp/utils');

module.exports = {
  name: 'ig',
  aliases: ['instagram', 'insta', 'igdl'],
  category: 'media',
  slow: true,
  weight: 'heavy',
  needs: [],
  description: 'Download an Instagram post, reel or story: ig <link>',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    const link = links.firstLink(rest) || links.firstLink(quotedText(getQuoted(msg)));
    if (!link) return reply(`Send an Instagram link (post, reel or story).\nExample: ${prefix}ig https://www.instagram.com/reel/...\n(You can also reply to a message that has the link.)`);
    if (links.kindOf(link) !== 'instagram') return reply('⚠️ That is not an Instagram link. Use *dl* for other sites.');
    const kind = links.instagramKind(link);
    await reply(`⏳ Downloading the Instagram ${kind === 'other' ? 'video' : kind}...`);
    try {
      const v = await ytdlp.downloadVideo(link, { onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
      const caption = [`📸 *${(v.title || 'Instagram').slice(0, 100)}*`, v.artist && `👤 ${v.artist}`].filter(Boolean).join('\n');
      if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
      return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `instagram${v.ext}`, caption }, { quoted: msg });
    } catch (err) {
      console.error('ig failed:', err.message);
      if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
      const storyNote = kind === 'story' ? '\nStories need a logged-in Instagram: the owner can add cookies with the *ytcookies* command.' : '';
      return reply(`⚠️ I could not download that.${kind === 'story' || kind === 'other' ? ' The account may be private, the story may have expired, or it is a picture-only post.' : ' The account may be private or the post removed.'}${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}${storyNote}` : ''}`);
    }
  },
};

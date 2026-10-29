const media = require('../whatsapp/media');

module.exports = {
  name: 'sticker',
  category: 'media',
  slow: true,
  needs: ['sharp'],
  weight: 'medium',
  aliases: ['s'],
  description: 'Make a sticker from a picture, GIF or short video: reply to it with sticker',
  async run(ctx) {
    await media.handle(ctx, ['image', 'video', 'sticker'], 'Reply to a picture, GIF or short video with this command (or send one with the command as its caption).', async (found, buffer) => {
      const webp = await media.toSticker(found.kind, buffer);
      await ctx.sock.sendMessage(ctx.jid, { sticker: webp }, { quoted: ctx.msg });
    });
  },
};

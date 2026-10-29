const media = require('../whatsapp/media');

module.exports = {
  name: 'circle',
  category: 'media',
  slow: true,
  description: 'Make a round sticker from a picture: reply to it with circle',
  async run(ctx) {
    await media.handle(ctx, ['image', 'sticker'], 'Reply to a picture with this command.', async (found, buffer) => {
      const sharp = media.loadSharp();
      const mask = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>');
      const webp = await sharp(buffer)
        .resize(512, 512, { fit: 'cover' })
        .composite([{ input: mask, blend: 'dest-in' }])
        .webp({ quality: 80 })
        .toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { sticker: webp }, { quoted: ctx.msg });
    });
  },
};

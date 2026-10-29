const media = require('../whatsapp/media');

module.exports = {
  name: 'photo',
  category: 'media',
  slow: true,
  aliases: ['toimg'],
  description: 'Turn a sticker back into a picture: reply to the sticker with photo',
  async run(ctx) {
    await media.handle(ctx, ['sticker'], 'Reply to a sticker with this command.', async (found, buffer) => {
      const sharp = media.loadSharp();
      const png = await sharp(buffer).png().toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { image: png, caption: found.animated ? '🖼️ (first frame of the animated sticker)' : '🖼️ Here is your picture' }, { quoted: ctx.msg });
    });
  },
};

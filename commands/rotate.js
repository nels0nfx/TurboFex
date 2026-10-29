const media = require('../whatsapp/media');

module.exports = {
  name: 'rotate',
  category: 'media',
  slow: true,
  description: 'Turn a picture: reply to it with rotate 90 (90, 180, 270 or -90)',
  async run(ctx) {
    const deg = ctx.args[0] ? parseInt(ctx.args[0], 10) : 90;
    if (![90, 180, 270, -90].includes(deg)) return ctx.reply(`Choose 90, 180, 270 or -90.\nExample: ${ctx.prefix}rotate 90 (reply to a picture)`);
    await media.handle(ctx, ['image'], `Reply to a picture with ${ctx.prefix}rotate 90`, async (found, buffer) => {
      const sharp = media.loadSharp();
      const out = await sharp(buffer).rotate(deg).jpeg({ quality: 90 }).toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { image: out, caption: `🔄 Rotated ${deg}°` }, { quoted: ctx.msg });
    });
  },
};

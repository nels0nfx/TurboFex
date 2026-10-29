const media = require('../whatsapp/media');
const { selfJid } = require('../whatsapp/utils');

module.exports = {
  name: 'setpp',
  category: 'owner',
  slow: true,
  description: 'Change the bot\'s own profile picture: reply to a picture with setpp (owner only)',
  ownerOnly: true,
  async run(ctx) {
    await media.handle(ctx, ['image'], `Reply to a picture with ${ctx.prefix}setpp`, async (found, buffer) => {
      try {
        await ctx.sock.updateProfilePicture(selfJid(ctx.sock), buffer);
      } catch (err) {
        console.error('Profile picture failed:', err.message);
        return ctx.reply('⚠️ I could not change my profile picture.');
      }
      await ctx.reply('✅ My profile picture was changed.');
    });
  },
};

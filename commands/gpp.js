const media = require('../whatsapp/media');

module.exports = {
  name: 'gpp',
  category: 'group',
  slow: true,
  description: 'Change the group picture: reply to a picture with gpp (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run(ctx) {
    await media.handle(ctx, ['image'], `Reply to a picture with ${ctx.prefix}gpp`, async (found, buffer) => {
      try {
        await ctx.sock.updateProfilePicture(ctx.jid, buffer);
      } catch (err) {
        console.error('Group picture failed:', err.message);
        return ctx.reply('⚠️ I could not change the group picture. If only admins may edit the group, make me an admin first.');
      }
      await ctx.reply('✅ Group picture changed.');
    });
  },
};

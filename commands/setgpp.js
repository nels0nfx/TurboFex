const media = require('../whatsapp/media');

module.exports = {
  name: 'setgpp',
  aliases: ['setgroupicon'],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  slow: true,
  weight: 'medium',
  needs: [],
  description: 'Change the group picture: reply to a picture with setgpp',
  async run(ctx) {
    const { sock, jid, reply } = ctx;
    return media.handle(ctx, ['image'], `Reply to a picture with *${ctx.prefix}setgpp* to make it the group picture.`, async (found, buffer) => {
      await sock.updateProfilePicture(jid, buffer);
      await reply('✅ *The group picture was changed.*');
    });
  },
};

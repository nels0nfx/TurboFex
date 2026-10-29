const store = require('../whatsapp/store');
const { changeMembers } = require('../whatsapp/actions');

module.exports = {
  name: 'demote',
  category: 'group',
  description: 'Remove admin rights from a member (tag them or reply)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  run: (ctx) => {
    // with antidemote on, only the bot owner can demote through the bot
    if (store.getGroup(ctx.jid).antidemote && !ctx.isOwner) return ctx.reply('🛡️ Demoting is locked in this group (antidemote is on).');
    return changeMembers(ctx, 'demote', 'Demoted');
  },
};

const store = require('../whatsapp/store');
const { changeMembers } = require('../whatsapp/actions');

module.exports = {
  name: 'promote',
  category: 'group',
  description: 'Make a member an admin (tag them or reply)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  run: (ctx) => {
    // with antipromote on, only the bot owner can promote through the bot
    if (store.getGroup(ctx.jid).antipromote && !ctx.isOwner) return; // locked for everybody but the owner: stay silent
    return changeMembers(ctx, 'promote', 'Promoted to admin');
  },
};

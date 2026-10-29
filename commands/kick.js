const { changeMembers } = require('../whatsapp/actions');

module.exports = {
  name: 'kick',
  category: 'group',
  aliases: ['remove'],
  description: 'Remove a member (tag them or reply to their message)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  run: (ctx) => changeMembers(ctx, 'remove', 'Removed'),
};

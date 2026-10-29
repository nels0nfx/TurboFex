const { toggleSetting } = require('../whatsapp/actions');

module.exports = {
  name: 'pdm',
  category: 'group',
  description: 'Announce when someone is promoted or demoted: on / off (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) => toggleSetting(ctx, 'pdm', 'Promote/demote notices'),
};

const { toggleSetting } = require('../whatsapp/actions');

module.exports = {
  name: 'welcome',
  category: 'group',
  description: 'Welcome message for new members on/off (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) => toggleSetting(ctx, 'welcome', 'Welcome message'),
};

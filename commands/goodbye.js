const { toggleSetting } = require('../whatsapp/actions');

module.exports = {
  name: 'goodbye',
  category: 'group',
  description: 'Goodbye message when someone leaves on/off (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) => toggleSetting(ctx, 'goodbye', 'Goodbye message'),
};

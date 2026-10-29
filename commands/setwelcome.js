const store = require('../whatsapp/store');
const { setMessage } = require('../whatsapp/actions');

module.exports = {
  name: 'setwelcome',
  category: 'group',
  description: 'Set the welcome message (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) =>
    setMessage(ctx, {
      textKey: 'welcomeText',
      onKey: 'welcome',
      label: 'welcome',
      defaultText: store.DEFAULT_WELCOME,
      toggleCmd: 'welcome',
    }),
};

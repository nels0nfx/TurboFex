const store = require('../whatsapp/store');
const { setMessage } = require('../whatsapp/actions');

module.exports = {
  name: 'setgoodbye',
  category: 'group',
  description: 'Set the goodbye message (admins only)',
  groupOnly: true,
  adminOnly: true,
  run: (ctx) =>
    setMessage(ctx, {
      textKey: 'goodbyeText',
      onKey: 'goodbye',
      label: 'goodbye',
      defaultText: store.DEFAULT_GOODBYE,
      toggleCmd: 'goodbye',
    }),
};

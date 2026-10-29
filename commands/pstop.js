const store = require('../whatsapp/store');
const { removeFilter } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'pstop',
  category: 'autoreply',
  description: 'Remove an auto-reply that applies to all private chats: pstop hello (owner only)',
  ownerOnly: true,
  run: (ctx) => removeFilter(ctx, store.getPrivateFilters(), () => store.saveNow()),
};

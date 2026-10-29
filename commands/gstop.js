const store = require('../whatsapp/store');
const { removeFilter } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'gstop',
  category: 'autoreply',
  description: 'Remove an auto-reply that applies to all chats: gstop hello (owner only)',
  ownerOnly: true,
  run: (ctx) => removeFilter(ctx, store.getGlobalFilters(), () => store.saveNow()),
};

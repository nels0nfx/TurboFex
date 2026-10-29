const store = require('../whatsapp/store');
const { addFilter, listText } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'pfilter',
  category: 'autoreply',
  description: 'Auto-reply in ALL private chats: pfilter hello | Hi! (no text = show the list) (owner only)',
  ownerOnly: true,
  async run(ctx) {
    const set = store.getPrivateFilters();
    if (!ctx.rest) return ctx.reply(listText(set, 'Auto-replies for all private chats'));
    return addFilter(ctx, set, () => store.saveNow());
  },
};

const store = require('../whatsapp/store');
const { addFilter, listText } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'gfilter',
  category: 'autoreply',
  description: 'Auto-reply in ALL chats: gfilter hello | Hi! (no text = show the list) (owner only)',
  ownerOnly: true,
  async run(ctx) {
    const set = store.getGlobalFilters();
    if (!ctx.rest) return ctx.reply(listText(set, 'Auto-replies for all chats'));
    return addFilter(ctx, set, () => store.saveNow());
  },
};

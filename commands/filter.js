const store = require('../whatsapp/store');
const { addFilter } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'filter',
  category: 'autoreply',
  description: 'Auto-reply to a word in this chat: filter hello | Hi there! (group admins in groups)',
  async run(ctx) {
    if (ctx.isGroup && !(ctx.isAdmin || ctx.isOwner)) return ctx.reply('⚠️ Only group admins can set auto-replies in a group.');
    return addFilter(ctx, store.getGroup(ctx.jid).filters, () => store.update(ctx.jid, () => {}));
  },
};

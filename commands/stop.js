const store = require('../whatsapp/store');
const { removeFilter } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'stop',
  category: 'autoreply',
  aliases: ['unfilter'],
  description: 'Remove an auto-reply from this chat: stop hello (group admins in groups)',
  async run(ctx) {
    if (ctx.isGroup && !(ctx.isAdmin || ctx.isOwner)) return ctx.reply('⚠️ Only group admins can remove auto-replies in a group.');
    return removeFilter(ctx, store.getGroup(ctx.jid).filters, () => store.update(ctx.jid, () => {}));
  },
};

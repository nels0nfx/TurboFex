const store = require('../whatsapp/store');
const { setActionMode } = require('../whatsapp/actions');
const { libraryKnows } = require('../whatsapp/groupstatus');

module.exports = [
  {
    name: 'antigstatus',
    category: 'group',
    description: 'Stop members posting group statuses here: off / delete / warn / kick (admins only)',
    groupOnly: true,
    adminOnly: true,
    async run(ctx) {
      await setActionMode(ctx, { key: 'antigstatusMode', label: 'Anti group status', trigger: 'posts a group status' });
      if (store.getGroup(ctx.jid).antigstatusMode !== 'off' && !libraryKnows('groupStatusMessageV2')) {
        await ctx.reply(ctx.isOwner ? '⚠️ *Anti group status cannot work on this server yet.*\n▸ The WhatsApp library is too old to see group statuses. Update the bot packages, then restart.' : '⚠️ *This protection is saved, but it is not active right now.*\n▸ The bot owner has been asked to fix it.');
      }
    },
  },
  {
    name: 'antigm',
    category: 'group',
    description: 'Stop members mentioning this group in their status: off / delete / warn / kick (admins only)',
    groupOnly: true,
    adminOnly: true,
    async run(ctx) {
      await setActionMode(ctx, { key: 'antigmMode', label: 'Anti group mention', trigger: 'mentions this group in a status' });
      if (store.getGroup(ctx.jid).antigmMode !== 'off' && !libraryKnows('groupStatusMentionMessage')) {
        await ctx.reply(ctx.isOwner ? '⚠️ *Anti group mention cannot work on this server yet.*\n▸ The WhatsApp library is too old to see group mentions in statuses. Update the bot packages, then restart.' : '⚠️ *This protection is saved, but it is not active right now.*\n▸ The bot owner has been asked to fix it.');
      }
    },
  },
];

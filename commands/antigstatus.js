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
        await ctx.reply('⚠️ The WhatsApp library on this server cannot see group statuses yet, so this setting cannot work. The bot owner must update the bot (npm install).');
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
        await ctx.reply('⚠️ The WhatsApp library on this server cannot see group mentions in statuses yet, so this setting cannot work. The bot owner must update the bot (npm install).');
      }
    },
  },
];

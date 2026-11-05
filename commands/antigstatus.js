const store = require('../whatsapp/store');
const { setActionMode } = require('../whatsapp/actions');
const { libraryKnows } = require('../whatsapp/groupstatus');
const protect = require('../whatsapp/protect');

module.exports = [
  {
    name: 'antigstatus',
    category: 'group',
    description: 'Stop members posting group statuses here: off / delete / warn / kick (admins only)',
    groupOnly: true,
    adminOnly: true,
    async run(ctx) {
      if ((ctx.args[0] || '').toLowerCase() === 'debug') {
        if (!ctx.isOwner) return ctx.reply('⚠️ *Only the bot owner can use that.*');
        protect.startDebug();
        return ctx.reply('🔎 *Anti group status check is on for 10 minutes.*\n▸ Ask a member who is not an admin to post a group status. I will send you a short report in your own chat.');
      }
      const report = () => {
        const s = protect.gstats;
        return `📊 *Group statuses since the bot started*\n▸ *Seen:* ${s.seen}\n▸ *Deleted:* ${s.deleted}\n▸ *Refused by WhatsApp:* ${s.refused}\n▸ *Skipped, the poster is an admin or the owner:* ${s.adminPosted}\n▸ *Skipped, I am not an admin:* ${s.botNotAdmin}\n▸ *Posted from the bot's own account (never touched):* ${s.ownPosts}`;
      };
      if ((ctx.args[0] || '').toLowerCase() === 'report') return ctx.reply(report());
      await setActionMode(ctx, { key: 'antigstatusMode', label: 'Anti group status', trigger: 'posts a group status' });
      if (!ctx.args[0]) await ctx.reply(`${report()}\n_Admins, the owner and the bot's own account are never affected. Test with a member who is not an admin._`);
      if (store.getGroup(ctx.jid).antigstatusMode !== 'off' && libraryKnows('groupStatusMessageV2')) await ctx.reply('▸ *Detection:* ready. Admins and the owner are never affected.');
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

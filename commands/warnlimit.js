const store = require('../whatsapp/store');

module.exports = {
  name: 'warnlimit',
  category: 'group',
  aliases: ['setwarn'],
  description: 'Set how many warnings before removal (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, args, reply, prefix }) {
    if (!args[0]) {
      return reply(
        `⚠️ Warn limit is currently *${store.getLimit(jid)}*.\nTo change it: ${prefix}warnlimit 5`
      );
    }
    const n = parseInt(args[0], 10);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return reply(`Please give a number from 1 to 20.\nExample: ${prefix}warnlimit 5`);
    }
    store.setLimit(jid, n);
    return reply(`✅ Members will now be removed after *${n}* warnings.`);
  },
};

const { getTargets, num } = require('../whatsapp/utils');
const store = require('../whatsapp/store');

module.exports = {
  name: 'resetwarn',
  category: 'group',
  aliases: ['unwarn'],
  description: 'Clear a member\'s warnings (tag or reply)',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, msg, reply, prefix, cmdName }) {
    const targets = getTargets(msg);
    if (!targets.length) {
      return reply(`Please tag the person or reply to their message.\nExample: ${prefix}${cmdName} @person`);
    }
    store.resetWarnings(jid, targets[0]);
    return reply(`✅ Warnings cleared for @${num(targets[0])}`, { mentions: [targets[0]] });
  },
};

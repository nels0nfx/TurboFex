const store = require('../whatsapp/store');
const { resolveTarget, num } = require('../whatsapp/utils');

module.exports = {
  name: 'ban',
  category: 'owner',
  description: 'Stop the bot from answering a person: ban @user (no name = show the list) (owner only)',
  ownerOnly: true,
  async run({ msg, args, reply, prefix, config }) {
    const target = resolveTarget(msg, args);
    if (!target) {
      const list = store.getBanned();
      return reply(`🚷 *Banned from the bot* (${list.length})\n${list.length ? list.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'Nobody.'}\n\nTo ban: ${prefix}ban @person\nTo unban: ${prefix}unban @person`);
    }
    if (num(target) === config.ownerNumber) return reply('⚠️ I will not ban the owner.');
    store.addBanned(target);
    await reply(`🚷 @${num(target)} is now banned from using the bot.`, { mentions: [target] });
  },
};

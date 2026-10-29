const store = require('../whatsapp/store');
const { resolveTarget, num } = require('../whatsapp/utils');

module.exports = {
  name: 'unban',
  category: 'owner',
  description: 'Let a banned person use the bot again (owner only)',
  ownerOnly: true,
  async run({ msg, args, reply, prefix }) {
    const target = resolveTarget(msg, args);
    if (!target) return reply(`Tag the person, reply to them, or type their number.\nExample: ${prefix}unban @person`);
    const done = store.removeBanned(target);
    await reply(done ? `✅ @${num(target)} can use the bot again.` : 'ℹ️ That person is not banned.', { mentions: [target] });
  },
};

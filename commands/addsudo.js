const store = require('../whatsapp/store');
const { resolveTarget, num } = require('../whatsapp/utils');

module.exports = {
  name: 'addsudo',
  category: 'owner',
  description: 'Give someone owner rights (tag, reply or type their number) (main owner only)',
  realOwnerOnly: true,
  async run({ msg, args, reply, prefix }) {
    const target = resolveTarget(msg, args);
    if (!target) return reply(`Tag the person, reply to them, or type their number.\nExample: ${prefix}addsudo 27821234567`);
    store.addSudo(target);
    await reply(`✅ @${num(target)} now has owner rights.`, { mentions: [target] });
  },
};

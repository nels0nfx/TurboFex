const store = require('../whatsapp/store');
const { resolveTarget, num } = require('../whatsapp/utils');

module.exports = {
  name: 'delsudo',
  category: 'owner',
  description: 'Take owner rights away from someone (main owner only)',
  realOwnerOnly: true,
  async run({ msg, args, reply, prefix }) {
    const target = resolveTarget(msg, args);
    if (!target) return reply(`Tag the person, reply to them, or type their number.\nExample: ${prefix}delsudo 27821234567`);
    const done = store.removeSudo(target);
    await reply(done ? `✅ @${num(target)} no longer has owner rights.` : 'ℹ️ That person is not on the list.', {
      mentions: [target],
    });
  },
};

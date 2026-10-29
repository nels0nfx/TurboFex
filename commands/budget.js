const b = require('../whatsapp/budget');

module.exports = {
  name: 'budget',
  category: 'budget',
  description: 'Set a monthly spending limit: budget 5000 (budget off to remove)',
  async run({ msg, args, reply, prefix, isGroup, botIds }) {
    const key = b.userKey(msg, botIds);
    const tip = isGroup ? b.PRIVACY : '';

    if ((args[0] || '').toLowerCase() === 'off') {
      b.setLimit(key, null);
      return reply('✅ Monthly budget removed.');
    }
    if (!args[0]) {
      const m = b.month(key);
      return reply(
        (m.limit
          ? `🎯 Your monthly budget is *${b.money(m.limit)}* (spent so far: ${b.money(m.spent)}).`
          : `🎯 You have no monthly budget yet.\nSet one: ${prefix}budget 5000`) + tip
      );
    }
    const amount = b.parseAmount(args[0]);
    if (!amount) return reply(`Type the amount.\nExample: ${prefix}budget 5000`);
    b.setLimit(key, amount);
    return reply(`✅ Monthly budget set to *${b.money(amount)}*. I will warn you when you go over it.${tip}`);
  },
};

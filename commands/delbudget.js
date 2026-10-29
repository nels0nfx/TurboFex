const b = require('../whatsapp/budget');

module.exports = {
  name: 'delbudget',
  category: 'budget',
  description: 'Delete ALL your saved budget data: delbudget confirm',
  async run({ msg, args, reply, prefix, botIds }) {
    if ((args[0] || '').toLowerCase() !== 'confirm') {
      return reply(`⚠️ This deletes all your income, expenses and your budget limit.\nTo continue type: ${prefix}delbudget confirm`);
    }
    b.clear(b.userKey(msg, botIds));
    await reply('🗑️ All your budget data was deleted.');
  },
};

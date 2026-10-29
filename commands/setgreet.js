const store = require('../whatsapp/store');

module.exports = {
  name: 'setgreet',
  category: 'autoreply',
  description: 'Set the greeting sent to people who write to you privately (once a day each): setgreet Hi @user! (owner only)',
  ownerOnly: true,
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`Type the greeting. Use @user for their name.\nExample: ${prefix}setgreet Hi @user! I will reply soon 🙂\n\nSee it: ${prefix}getgreet\nSwitch it off: ${prefix}delgreet`);
    if (rest.length > 1000) return reply('⚠️ That greeting is too long (max 1000 characters).');
    store.setGreet(rest);
    await reply('✅ Greeting saved. People who write to me privately get it once a day.');
  },
};

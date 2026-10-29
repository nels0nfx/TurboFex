const store = require('../whatsapp/store');

module.exports = {
  name: 'getgreet',
  category: 'autoreply',
  description: 'Show the greeting for private chats (owner only)',
  ownerOnly: true,
  async run({ reply, prefix }) {
    const g = store.getGreet();
    await reply(g ? `👋 *Current greeting:*\n\n${g}` : `ℹ️ No greeting is set.\nSet one: ${prefix}setgreet Hi @user!`);
  },
};

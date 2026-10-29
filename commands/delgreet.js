const store = require('../whatsapp/store');

module.exports = {
  name: 'delgreet',
  category: 'autoreply',
  description: 'Switch off the greeting for private chats (owner only)',
  ownerOnly: true,
  async run({ reply }) {
    if (!store.getGreet()) return reply('ℹ️ No greeting was set.');
    store.setGreet(null);
    await reply('✅ Greeting removed.');
  },
};

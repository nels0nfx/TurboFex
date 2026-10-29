const store = require('../whatsapp/store');

module.exports = {
  name: 'mode',
  category: 'owner',
  description: 'Set the bot to public or private (owner only)',
  ownerOnly: true,
  async run({ args, reply, prefix, config }) {
    const choice = (args[0] || '').toLowerCase();

    if (choice !== 'public' && choice !== 'private') {
      return reply(
        `🤖 Bot mode: *${store.getMode().toUpperCase()}*\n\n` +
          `• ${prefix}mode public - everyone can use commands\n` +
          `• ${prefix}mode private - only the owner can use commands; everybody else gets no reply at all (running games still work)`
      );
    }
    if (choice === 'private' && !config.ownerNumber) {
      return reply('⚠️ Set NUMBER (your number) in config.js or the environment first, otherwise nobody could use the bot.');
    }

    store.setMode(choice);
    return reply(
      choice === 'private'
        ? '🔒 Bot is now *PRIVATE*. Only the owner can use commands, everybody else gets no reply.\n(Games in progress, auto-replies, anti-link, welcome and goodbye still work.)'
        : '🔓 Bot is now *PUBLIC*. Everyone can use commands.'
    );
  },
};

const { restartBot } = require('../core/restart');
const bootnote = require('../core/bootnote');
const brand = require('../core/brand');

module.exports = {
  name: 'restart',
  category: 'owner',
  description: 'Restart the bot (owner only)',
  ownerOnly: true,
  async run({ reply, jid }) {
    bootnote.write({ type: 'restart', chat: jid });
    await reply(`🔄 Restarting ${brand.botName}... I will message you here when I am back.`);
    restartBot();
  },
};

const brand = require('../core/brand');

module.exports = {
  name: 'owner',
  category: 'general',
  description: 'Show who owns this bot',
  async run({ reply, config }) {
    const link = config.ownerNumber ? `\n📞 wa.me/${config.ownerNumber}` : '';
    await reply(`👑 *${brand.botName}* owner: ${brand.creator}${link}`);
  },
};

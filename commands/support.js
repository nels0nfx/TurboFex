const brand = require('../core/brand');
const { linksText } = require('../whatsapp/welcome');

module.exports = {
  name: 'support',
  category: 'general',
  aliases: ['links', 'about'],
  description: 'Support group, channels and source code',
  async run({ reply }) {
    await reply(
      `⚡ *${brand.botName}* by ${brand.creator}\n\n${linksText()}\n\n` +
        `Ask questions, report problems and get news there. Thank you for using ${brand.botName}! 🙏`
    );
  },
};

const pkg = require('../package.json');
const brand = require('../core/brand');
const clock = require('../core/clock');
const store = require('../whatsapp/store');

module.exports = {
  name: 'alive',
  category: 'general',
  description: 'Show that the bot is running, with its version and uptime',
  async run({ reply, isOwner }) {
    const ram = Math.round(process.memoryUsage().rss / 1048576);
    await reply(
      `✅ *${brand.botName}* is alive!\n\n` +
        `📦 Version: v${pkg.version}\n` +
        `🔐 Mode: ${store.getMode() === 'private' ? 'Private' : 'Public'}\n` +
        `⏱️ Uptime: ${clock.uptime()}` +
        (isOwner ? `\n💾 RAM: ${ram} MB` : '')
    );
  },
};

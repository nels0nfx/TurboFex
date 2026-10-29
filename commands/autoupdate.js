const store = require('../whatsapp/store');

module.exports = {
  name: 'autoupdate',
  category: 'owner',
  description: 'Install new versions automatically when the bot starts: on/off (owner only)',
  ownerOnly: true,
  async run({ args, reply, prefix }) {
    const choice = (args[0] || '').toLowerCase();
    if (choice !== 'on' && choice !== 'off') {
      return reply(
        `🔄 Auto-update is currently *${store.getAutoUpdate() ? 'ON' : 'OFF'}*.\nUse ${prefix}autoupdate on  or  ${prefix}autoupdate off`
      );
    }
    store.setAutoUpdate(choice === 'on');
    return reply(`✅ Auto-update is now *${choice.toUpperCase()}*.`);
  },
};

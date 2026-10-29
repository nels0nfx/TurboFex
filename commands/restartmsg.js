const store = require('../whatsapp/store');

module.exports = {
  name: 'restartmsg',
  category: 'owner',
  ownerOnly: true,
  description: 'Message sent when the bot is back after a restart (short menu and links): restartmsg on / off. "Update complete" is always sent.',
  async run({ args, reply, prefix }) {
    const c = (args[0] || '').toLowerCase();
    if (c !== 'on' && c !== 'off') {
      return reply(`🔄 Restart message is *${store.getRestartMsg() ? 'ON' : 'OFF'}*.\nUse ${prefix}restartmsg on  or  ${prefix}restartmsg off\n\n(After an update you always get an "update complete" message.)`);
    }
    store.setRestartMsg(c === 'on');
    return reply(`✅ Restart message is now *${c.toUpperCase()}*.`);
  },
};

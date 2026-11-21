const autotag = require('../whatsapp/autotag');

module.exports = {
  name: 'autotag',
  category: 'owner',
  description: 'Tag everyone silently whenever someone writes in this group: autotag on / off (owner only)',
  ownerOnly: true,
  groupOnly: true,
  noAgain: true,
  async run({ jid, args, reply, prefix }) {
    const w = (args[0] || '').toLowerCase();
    if (w === 'on' || w === 'off') {
      autotag.set(jid, w === 'on');
      return reply(w === 'on'
        ? '✅ *Auto tag is ON in this group.*\n▸ _Every message written here now tags everybody silently. The bot does not react or answer._\n▸ Switch it off with `' + prefix + 'autotag off`.'
        : '✅ *Auto tag is OFF in this group.*\n▸ _Nobody is tagged any more._');
    }
    return reply(`🔔 *Auto tag in this group: ${autotag.isOn(jid) ? 'ON' : 'OFF'}*\n▸ \`${prefix}autotag on\` / \`${prefix}autotag off\``);
  },
};

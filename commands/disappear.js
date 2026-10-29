const meta = require('../whatsapp/metadata');

const OPTIONS = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };

module.exports = {
  name: 'disappear',
  category: 'group',
  description: 'Disappearing messages: off / 24h / 7d / 90d (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, args, reply, prefix }) {
    const choice = (args[0] || '').toLowerCase();
    if (!(choice in OPTIONS)) {
      return reply(`Choose one: ${prefix}disappear off | 24h | 7d | 90d`);
    }
    try {
      await sock.groupToggleEphemeral(jid, OPTIONS[choice]);
      meta.invalidate(jid);
      await reply(choice === 'off' ? '✅ Disappearing messages are now *OFF*.' : `✅ Messages will now disappear after *${choice}*.`);
    } catch (err) {
      await reply('⚠️ I could not change that. Make me a group admin and try again.');
    }
  },
};

// The owner name shown in the menu header (detected from WhatsApp; this only lets the owner check or change it)
const ownername = require('../whatsapp/ownername');

module.exports = {
  name: 'ownername',
  category: 'owner',
  description: 'The owner name in the menu header: ownername (see it), ownername set <name>, ownername auto',
  ownerOnly: true,
  async run({ sock, args, rest, reply, prefix }) {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'set') {
      const name = ownername.setCustom(rest.replace(/^set\s*/i, ''));
      return reply(name ? `✅ The menu now shows *${name}* as the owner.\n▸ \`${prefix}ownername auto\` goes back to the name from WhatsApp.` : `⚠️ Write the name: \`${prefix}ownername set Nelson\``);
    }
    if (sub === 'auto') {
      ownername.setCustom('');
      const name = ownername.get(sock);
      return reply(name ? `✅ The menu shows the name from WhatsApp: *${name}*.` : '✅ Back to the name from WhatsApp. WhatsApp has not told it yet; it appears after your next message to the bot.');
    }
    const name = ownername.get(sock);
    return reply(`👑 *Owner name in the menu:* ${name || 'not known yet'}${ownername.js.data.custom ? ' (set by you)' : ' (from WhatsApp)'}\n▸ Change it: \`${prefix}ownername set <name>\`\n▸ Back to WhatsApp's name: \`${prefix}ownername auto\``);
  },
};

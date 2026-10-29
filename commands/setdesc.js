const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'setdesc',
  category: 'group',
  description: 'Change the group description (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, rest, reply, prefix }) {
    if (!rest) return reply(`Type the new description.\nExample: ${prefix}setdesc Be kind. No spam.`);
    try {
      await sock.groupUpdateDescription(jid, rest.slice(0, 2000));
      meta.invalidate(jid);
      await reply('✅ Group description changed.');
    } catch (err) {
      await reply('⚠️ I could not change the description. Make me a group admin and try again.');
    }
  },
};

const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'setname',
  category: 'group',
  description: 'Change the group name (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, rest, reply, prefix }) {
    if (!rest) return reply(`Type the new name.\nExample: ${prefix}setname Weekend Crew`);
    try {
      await sock.groupUpdateSubject(jid, rest.slice(0, 100));
      meta.invalidate(jid);
      await reply('✅ Group name changed.');
    } catch (err) {
      await reply('⚠️ I could not change the name. Make me a group admin and try again.');
    }
  },
};

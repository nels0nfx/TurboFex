const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'lock',
  category: 'group',
  description: 'Only admins can edit the group name, picture and description (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    await sock.groupSettingUpdate(jid, 'locked');
    meta.invalidate(jid);
    await reply('🔒 Group info is now locked. Only admins can edit it.');
  },
};

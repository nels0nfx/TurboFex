const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'unlock',
  category: 'group',
  description: 'Let all members edit the group name, picture and description (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    await sock.groupSettingUpdate(jid, 'unlocked');
    meta.invalidate(jid);
    await reply('🔓 Group info is now unlocked. All members can edit it.');
  },
};

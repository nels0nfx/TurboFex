module.exports = {
  name: 'close',
  category: 'group',
  aliases: [],
  description: 'Only admins can send messages (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    await sock.groupSettingUpdate(jid, 'announcement');
    await reply('🔒 Group closed. Only admins can send messages.');
  },
};

module.exports = {
  name: 'open',
  category: 'group',
  aliases: ['unmute'],
  description: 'Let everyone send messages (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    await sock.groupSettingUpdate(jid, 'not_announcement');
    await reply('🔓 Group opened. Everyone can send messages.');
  },
};

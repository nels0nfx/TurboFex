module.exports = {
  name: 'invite',
  category: 'group',
  aliases: ['link'],
  description: 'Get the group invite link (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    const code = await sock.groupInviteCode(jid);
    await reply(`🔗 *Group invite link*\nhttps://chat.whatsapp.com/${code}`);
  },
};

module.exports = {
  name: 'revoke',
  category: 'group',
  aliases: ['resetlink'],
  description: 'Cancel the old invite link and make a new one (admins only)',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ sock, jid, reply }) {
    const code = await sock.groupRevokeInvite(jid);
    await reply(`✅ The old link no longer works.\n🔗 New link: https://chat.whatsapp.com/${code}`);
  },
};

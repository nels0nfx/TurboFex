module.exports = {
  name: 'join',
  category: 'owner',
  description: 'Make the bot join a group from its invite link (owner only)',
  ownerOnly: true,
  async run({ sock, args, rest, reply, prefix }) {
    const match = /chat\.whatsapp\.com\/([A-Za-z0-9]+)/.exec(rest || args[0] || '');
    if (!match) return reply(`Send the invite link.\nExample: ${prefix}join https://chat.whatsapp.com/XXXXXXXX`);
    try {
      await sock.groupAcceptInvite(match[1]);
      await reply('✅ Joined the group.');
    } catch (err) {
      await reply('⚠️ I could not join. The link may be wrong, expired, or the group needs approval.');
    }
  },
};

module.exports = {
  name: 'setbio',
  category: 'owner',
  description: 'Change the bot\'s WhatsApp About text (owner only)',
  ownerOnly: true,
  async run({ sock, rest, reply, prefix }) {
    if (!rest) return reply(`Type the new text.\nExample: ${prefix}setbio Powered by TurboFex`);
    if (rest.length > 139) return reply('⚠️ That is too long. WhatsApp allows up to 139 characters.');
    await sock.updateProfileStatus(rest);
    await reply('✅ About text updated.');
  },
};

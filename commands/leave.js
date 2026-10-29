module.exports = {
  name: 'leave',
  category: 'group',
  description: 'Make the bot leave this group (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, reply }) {
    await reply('👋 Goodbye everyone!');
    await sock.groupLeave(jid);
  },
};

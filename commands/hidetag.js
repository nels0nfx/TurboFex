const { getQuoted, quotedText } = require('../whatsapp/utils');

module.exports = {
  name: 'hidetag',
  category: 'group',
  aliases: ['tag'],
  description: 'Send a message that notifies everyone without listing names (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, jid, msg, rest, reply, groupMetadata, prefix, cmdName }) {
    const text = rest || quotedText(getQuoted(msg));
    if (!text) return reply(`Type a message or reply to one.\nExample: ${prefix}${cmdName} Meeting at 8`);
    await sock.sendMessage(jid, { text, mentions: groupMetadata.participants.map((p) => p.id) });
  },
};

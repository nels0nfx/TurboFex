const { getQuoted, num } = require('../whatsapp/utils');

module.exports = {
  name: 'delete',
  category: 'tools',
  aliases: ['del'],
  description: 'Delete a message: reply to it with delete (group admins can delete anyone\'s)',
  async run({ sock, jid, msg, reply, prefix, botIds, isGroup, isAdmin, isOwner, isBotAdmin }) {
    const q = getQuoted(msg);
    if (!q) return reply(`Reply to the message you want deleted, then type ${prefix}delete`);

    const fromMe = botIds.includes(num(q.participant));
    if (isGroup && !(isAdmin || isOwner)) return reply('⚠️ Only group admins can delete messages.');
    if (isGroup && !fromMe && !isBotAdmin) return reply('⚠️ Please make me a group admin first, then try again.');

    await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe, id: q.id, participant: q.participant } });
  },
};

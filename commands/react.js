const { getQuoted, num } = require('../whatsapp/utils');

module.exports = {
  name: 'react',
  category: 'tools',
  description: 'React to a message: reply to it with react 👍',
  async run({ sock, jid, msg, args, reply, prefix, botIds }) {
    const q = getQuoted(msg);
    if (!q) return reply(`Reply to a message, then type ${prefix}react 👍`);
    await sock.sendMessage(jid, {
      react: {
        text: args[0] || '👍',
        key: { remoteJid: jid, fromMe: botIds.includes(num(q.participant)), id: q.id, participant: q.participant },
      },
    });
  },
};

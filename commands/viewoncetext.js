// Sends a text message as a VIEW-ONCE text (WhatsApp added them recently): the other person can open it once.
module.exports = {
  name: 'viewoncetext',
  aliases: ['vot', 'textonce', 'oncetext'],
  category: 'owner',
  ownerOnly: true,
  noAgain: true,
  description: 'Send a text as a view-once message in this chat: viewoncetext Meet me at 8 (your own message is deleted, so only the view-once text stays)',
  async run({ sock, jid, msg, rest, reply, prefix }) {
    const text = rest.trim();
    if (!text) return reply(`🔒 *Send a view-once text*\n▸ \`${prefix}viewoncetext Meet me at 8\`\n▸ _It is sent here as a view-once message: they can open it once. I also delete your command message, so the words are not left in the chat._\n▸ _Open it with ${prefix}vv (reply to it) if you ever need to read one that was sent to you._`);

    await sock.sendMessage(jid, { text, viewOnce: true });

    // your own command message holds the same words in plain sight: take it away (this works for your own messages; where it does not, nothing is lost)
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch (err) {
      // the words stay visible in the command message: it is told below
      return reply('ℹ️ *Sent as view-once.* I could not delete your command message, so you may want to delete it yourself.');
    }
  },
};

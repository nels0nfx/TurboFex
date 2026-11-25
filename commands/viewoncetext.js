const baileys = require('../core/baileys');
const idmap = require('../whatsapp/idmap');
const outbox = require('../whatsapp/outbox');
const sentIds = require('../whatsapp/sent');

// WhatsApp wants the view-once mark ON the text itself. The library's own `viewOnce: true` puts the text inside a view-once
// envelope (right for pictures, not for text), and that message never shows. So the message is built and sent here.
async function sendViewOnceText(sock, jid, text) {
  const to = jid.endsWith('@s.whatsapp.net') ? idmap.lidSync(jid) || jid : jid; // same address rule as every other message
  const full = baileys.get().generateWAMessageFromContent(to, { extendedTextMessage: { text, viewOnce: true } }, { userJid: sock.user.id });
  sentIds.remember(full.key.id); // our own message: never answered
  outbox.remember(full); // kept so a phone that cannot open it can ask for it again
  await sock.relayMessage(to, full.message, { messageId: full.key.id });
}

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

    await sendViewOnceText(sock, jid, text); // if this fails, your command message is NOT deleted

    // your own command message holds the same words in plain sight: take it away (this works for your own messages; where it does not, nothing is lost)
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch (err) {
      // the words stay visible in the command message: it is told below
      return reply('ℹ️ *Sent as view-once.* I could not delete your command message, so you may want to delete it yourself.');
    }
  },
};

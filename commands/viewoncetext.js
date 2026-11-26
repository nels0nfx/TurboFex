const baileys = require('../core/baileys');
const idmap = require('../whatsapp/idmap');
const outbox = require('../whatsapp/outbox');
const sentIds = require('../whatsapp/sent');
const vault = require('../whatsapp/vovault');
const { parseDestination } = require('../whatsapp/dest');
const { ownerChat } = require('../whatsapp/owner');

// WhatsApp wants the view-once mark ON the text itself. The library's own `viewOnce: true` puts the text inside a view-once
// envelope (right for pictures, not for text), and that message never shows. So the message is built and sent here.
async function sendViewOnceText(sock, jid, text) {
  const to = jid.endsWith('@s.whatsapp.net') ? idmap.lidSync(jid) || jid : jid; // same address rule as every other message
  const full = baileys.get().generateWAMessageFromContent(to, { extendedTextMessage: { text, viewOnce: true } }, { userJid: sock.user.id });
  sentIds.remember(full.key.id); // our own message: never answered
  vault.keepText(full.key.id, text, { jid: to, sender: sock.user.id, own: true }); // so vv can open it again later, as often as you want
  outbox.remember(full); // kept so a phone that cannot open it can ask for it again
  await sock.relayMessage(to, full.message, { messageId: full.key.id });
}

// Where the text goes: "here" (this chat) when nothing is chosen, or "<where> | <words>": a phone number, a group id, a group number
// from gjids, part of a group name, "here" or "me" (your own chat). The words are only split off at the FIRST "|".
async function parseCommand(sock, rest, jid) {
  const t = rest.trim();
  const bar = t.indexOf('|');
  if (bar === -1) return { jid, text: t, here: true };
  const where = t.slice(0, bar).trim();
  const text = t.slice(bar + 1).trim();
  if (!where) return { jid, text, here: true }; // "| words": this chat
  const d = await parseDestination(sock, where, jid);
  if (d.error) return { error: true, text };
  const target = d.jid || ownerChat(sock);
  return { jid: target, name: d.name, text, here: target === jid };
}

// Sends a text message as a VIEW-ONCE text (WhatsApp added them recently): the other person can open it once.
module.exports = {
  name: 'viewoncetext',
  aliases: ['vot', 'textonce', 'oncetext'],
  category: 'owner',
  ownerOnly: true,
  noAgain: true,
  description: 'Send a text as a view-once message, here or to any chat: viewoncetext Meet me at 8 / viewoncetext 27821234567 | Meet me at 8 (your own message is deleted, so only the view-once text stays)',
  async run({ sock, jid, msg, rest, reply, prefix }) {
    const text = rest.trim();
    if (!text || text === '|') {
      return reply(
        `🔒 *Send a view-once text*\n` +
          `▸ \`${prefix}viewoncetext Meet me at 8\` _(sends it in this chat)_\n` +
          `▸ \`${prefix}viewoncetext 27821234567 | Meet me at 8\` _(sends it to a person)_\n` +
          `▸ \`${prefix}viewoncetext 3 | Meet me at 8\` _(a group: its number from ${prefix}gjids, its id, or part of its name)_\n` +
          `▸ \`${prefix}viewoncetext me | Meet me at 8\` _(your own chat)_\n` +
          `▸ _Your command message is deleted, so the words are not left in the chat._\n` +
          `▸ _Reply to a view-once with ${prefix}vv to open it, as many times as you like._`,
      );
    }

    const cmd = await parseCommand(sock, text, jid);
    if (cmd.error) return reply(`⚠️ *I could not find that chat.*\n▸ Use a phone number, a group number from \`${prefix}gjids\`, a group id, part of a group name, \`here\` or \`me\`.\n▸ _Write it before a | like this: \`${prefix}viewoncetext 27821234567 | Meet me at 8\`_`);
    if (!cmd.text) return reply(`⚠️ *Write the words after the |*\n▸ \`${prefix}viewoncetext 27821234567 | Meet me at 8\``);

    try {
      await sendViewOnceText(sock, cmd.jid, cmd.text); // if this fails, your command message is NOT deleted
    } catch (err) {
      console.error('viewoncetext failed:', err.message);
      if (cmd.here) throw err;
      return reply('⚠️ *I could not send that view-once text.*\n▸ Check the number or group and try again.');
    }

    // your own command message holds the same words in plain sight: take it away (this works for your own messages; where it does not, nothing is lost)
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch (err) {
      // the words stay visible in the command message: it is told below
      return reply('ℹ️ *Sent as view-once.* I could not delete your command message, so you may want to delete it yourself.');
    }
    if (!cmd.here) await reply(`✅ *View-once text sent.*\n▸ *To:* ${cmd.name || (cmd.jid.endsWith('@g.us') ? 'the group' : `+${cmd.jid.split('@')[0].split(':')[0]}`)}`);
  },
};

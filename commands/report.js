// A member flags a message to the group admins.
const { getQuoted, quotedText, num } = require('../whatsapp/utils');

const last = new Map();

module.exports = {
  name: 'report',
  category: 'group',
  everyone: true,
  groupOnly: true,
  needs: [],
  weight: 'light',
  description: 'Tell the admins about a problem: reply to the message with report <why>',
  async run({ sock, jid, msg, rest, reply, prefix, myJid, groupMetadata }) {
    const quoted = getQuoted(msg);
    if (!quoted && !rest) return reply(`Reply to the message you want to report with *${prefix}report <why>*.\nExample: ${prefix}report spam`);

    const who = num(myJid);
    if (Date.now() - (last.get(who) || 0) < 2 * 60 * 1000) return reply('⏳ You just sent a report. Please wait a moment before sending another.');
    last.set(who, Date.now());
    if (last.size > 2000) last.clear();

    const admins = (groupMetadata?.participants || []).filter((p) => p.admin).map((p) => p.id).slice(0, 15);
    if (!admins.length) return reply('⚠️ I could not find the admins of this group.');
    const snippet = quoted ? quotedText(quoted).slice(0, 200) : '';
    const against = quoted?.participant;

    await sock.sendMessage(jid, {
      text:
        `🚨 *Report*\n▸ *By:* @${who}\n${against ? `▸ *About:* @${num(against)}\n` : ''}▸ *Reason:* ${rest || 'not given'}\n` +
        `${snippet ? `▸ *Message:* ${snippet}\n` : ''}\n${admins.map((j) => `@${num(j)}`).join(' ')}`,
      mentions: [myJid, ...(against ? [against] : []), ...admins],
    }, { quoted: msg });
    return undefined;
  },
};

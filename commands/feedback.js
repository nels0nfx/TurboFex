const jsonstore = require('../core/jsonstore');
const clock = require('../core/clock');
const { ownerChat } = require('../whatsapp/owner');
const { getQuoted, quotedText, num } = require('../whatsapp/utils');

const js = jsonstore.open('feedback', { perDay: {}, count: 0 });
const PER_DAY = 3;

module.exports = {
  name: 'feedback',
  aliases: ['suggest', 'bug'],
  category: 'general',
  everyone: true,
  needs: [],
  weight: 'light',
  description: 'Send the bot owner a bug report or an idea: feedback <your message>',
  async run({ sock, msg, jid, rest, reply, prefix, myJid, isGroup }) {
    const quoted = getQuoted(msg);
    const text = (rest || (quoted ? quotedText(quoted) : '') || '').trim();
    if (!text) return reply(`Write your message after the command.\nExample: ${prefix}feedback the menu is great, please add a quiz game`);
    if (text.length > 800) return reply('⚠️ Please keep it under 800 characters.');

    const who = num(myJid);
    const today = new Date().toISOString().slice(0, 10);
    const rec = js.data.perDay[who];
    if (rec && rec.day === today && rec.n >= PER_DAY) return reply(`⏳ You already sent ${PER_DAY} messages today. Please try again tomorrow.`);
    js.data.perDay[who] = { day: today, n: rec && rec.day === today ? rec.n + 1 : 1 };
    js.data.count += 1;
    for (const k of Object.keys(js.data.perDay)) if (js.data.perDay[k].day !== today) delete js.data.perDay[k];
    js.touch();

    await sock.sendMessage(ownerChat(sock), {
      text: `📬 *Feedback #${js.data.count}*\n▸ *From:* @${num(myJid)}${isGroup ? ' (in a group)' : ''}\n▸ *When:* ${clock.stamp(Date.now())}\n\n${text}`,
      mentions: [myJid],
    });
    return reply('✅ *Thank you!* Your message was sent to the bot owner.');
  },
};

const activity = require('../whatsapp/activity');
const { num, participantIds } = require('../whatsapp/utils');

module.exports = {
  name: 'msgs',
  category: 'group',
  description: 'Show the most active members (counted since the bot joined)',
  groupOnly: true,
  async run({ jid, reply, groupMetadata }) {
    const counts = activity.get(jid);
    const rows = groupMetadata.participants
      .map((p) => ({ id: p.id, c: Math.max(0, ...participantIds(p).map((i) => counts[i] || 0)) }))
      .filter((r) => r.c > 0)
      .sort((a, b) => b.c - a.c)
      .slice(0, 10);

    if (!rows.length) return reply('📊 No messages counted yet. I count messages from the moment I am added.');
    const list = rows.map((r, i) => `${i + 1}. @${num(r.id)} - ${r.c} messages`).join('\n');
    await reply(`📊 *Most active members*\n\n${list}`, { mentions: rows.map((r) => r.id) });
  },
};

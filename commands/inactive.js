const activity = require('../whatsapp/activity');
const { num, participantIds } = require('../whatsapp/utils');

module.exports = {
  name: 'inactive',
  category: 'group',
  description: 'List members who have not sent a message since the bot started counting (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, reply, groupMetadata, botIds }) {
    const counts = activity.get(jid);
    if (!activity.total(jid)) {
      return reply('😴 I have not counted any messages in this group yet, so I cannot tell who is silent.');
    }
    const quiet = groupMetadata.participants.filter(
      (p) => !participantIds(p).some((i) => counts[i] || botIds.includes(i))
    );
    if (!quiet.length) return reply('✅ Everyone has sent at least one message.');

    const shown = quiet.slice(0, 40);
    const more = quiet.length > shown.length ? `\n...and ${quiet.length - shown.length} more` : '';
    const list = shown.map((p, i) => `${i + 1}. @${num(p.id)}`).join('\n');
    await reply(`😴 *Silent members* (${quiet.length})\nNo message seen since I started counting.\n\n${list}${more}`, {
      mentions: shown.map((p) => p.id),
    });
  },
};

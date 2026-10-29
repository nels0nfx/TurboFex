const { num } = require('../whatsapp/utils');

module.exports = {
  name: 'tagall',
  category: 'group',
  aliases: ['everyone'],
  description: 'Mention everyone in the group, numbered (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ reply, args, groupMetadata }) {
    const members = groupMetadata.participants.map((p) => p.id);
    const note = args.join(' ');
    const list = members.map((id, i) => `${i + 1}. @${num(id)}`).join('\n');
    await reply(
      `📢 *Attention everyone*${note ? `\n${note}` : ''}\n\n👥 Members: ${members.length}\n\n${list}`,
      { mentions: members }
    );
  },
};

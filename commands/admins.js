const { num } = require('../whatsapp/utils');

module.exports = {
  name: 'admins',
  category: 'group',
  description: 'List and tag the group admins',
  groupOnly: true,
  async run({ reply, groupMetadata }) {
    const admins = groupMetadata.participants.filter((p) => p.admin).map((p) => p.id);
    const list = admins.map((id, i) => `${i + 1}. @${num(id)}`).join('\n');
    await reply(`👑 *Group admins* (${admins.length})\n\n${list}`, { mentions: admins });
  },
};

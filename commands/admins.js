// admins = list the group admins AND tag them. tagadmins / admintag / calladmins are its aliases.
//   admins                 -> the list, every admin is tagged
//   admins Please help us  -> the same, with your message on top
const { num } = require('../whatsapp/utils');
const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'admins',
  aliases: ['tagadmins', 'admintag', 'calladmins'],
  category: 'group',
  description: 'List and tag the group admins, with an optional message: admins or admins please help',
  groupOnly: true,
  async run({ sock, jid, rest, reply, groupMetadata }) {
    let info = groupMetadata;
    if (!info?.participants?.length) info = await meta.getMeta(sock, jid).catch(() => null);
    const admins = (info?.participants || []).filter((p) => p.admin).map((p) => p.id);
    if (!admins.length) return reply('⚠️ *I could not find the admins of this group.*');
    const note = rest ? `\n_${rest.slice(0, 500)}_\n` : '';
    const list = admins.map((id, i) => `${i + 1}. @${num(id)}`).join('\n');
    await reply(`👑 *Group admins* (${admins.length})${note}\n${list}`, { mentions: admins });
  },
};

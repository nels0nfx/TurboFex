const store = require('../whatsapp/store');
const { isCreator } = require('../whatsapp/adminguard');

module.exports = {
  name: 'antidemote',
  category: 'group',
  description: 'Undo demotions made by anyone except the group creator and the bot owner: antidemote on / off',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, args, reply, prefix, isOwner, myJid, groupMetadata }) {
    const a = (args[0] || '').toLowerCase();
    const g = store.getGroup(jid);
    if (a !== 'on' && a !== 'off') {
      return reply(`*Anti-demote:* ${g.antidemote ? 'ON' : 'OFF'}\n▸ Nobody else can remove admins: it is undone at once.\n▸ \`${prefix}antidemote on\` / \`${prefix}antidemote off\`\n_Needs the bot to be an admin. Only the group creator and the bot owner can switch it._`);
    }
    // an admin must not be able to switch off the protection that stops admins from being removed
    if (!isOwner && !isCreator(groupMetadata, myJid)) return reply('⚠️ Only the group creator or the bot owner can change this protection.');
    store.update(jid, (x) => {
      x.antidemote = a === 'on';
    });
    return reply(`✅ Anti-demote is now *${a.toUpperCase()}*.`);
  },
};

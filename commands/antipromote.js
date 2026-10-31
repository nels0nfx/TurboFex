const store = require('../whatsapp/store');
const { isCreator } = require('../whatsapp/adminguard');

module.exports = {
  name: 'antipromote',
  category: 'group',
  description: 'Undo promotions made by anyone except the group creator and the bot owner: antipromote on / off',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, args, reply, prefix, isOwner, myJid, groupMetadata }) {
    const a = (args[0] || '').toLowerCase();
    const g = store.getGroup(jid);
    if (a !== 'on' && a !== 'off') {
      return reply(`*Anti-promote:* ${g.antipromote ? 'ON' : 'OFF'}\n▸ Nobody else can make new admins: it is undone at once.\n▸ \`${prefix}antipromote on\` / \`${prefix}antipromote off\`\n_Needs the bot to be an admin. Only the group creator and the bot owner can switch it._`);
    }
    // an admin must not be able to switch off the protection that stops admins from being removed
    if (!isOwner && !isCreator(groupMetadata, myJid)) return; // not allowed: stay silent
    store.update(jid, (x) => {
      x.antipromote = a === 'on';
    });
    return reply(`✅ Anti-promote is now *${a.toUpperCase()}*.`);
  },
};

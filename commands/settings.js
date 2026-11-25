const view = require('../whatsapp/settingsview');
const meta = require('../whatsapp/metadata');

module.exports = {
  name: 'settings',
  aliases: ['allsettings', 'mysettings'],
  category: 'owner',
  ownerOnly: true,
  description: 'Show all the bot settings: settings (the whole bot), settings group (this group). Secrets are never shown',
  async run({ jid, args, isGroup, reply, prefix }) {
    if ((args[0] || '').toLowerCase() === 'group') {
      if (!isGroup) return reply(`⚠️ *${prefix}settings group* only works inside a group.\n▸ _Use ${prefix}settings for the settings of the whole bot._`);
      const m = meta.peek(jid);
      return reply(view.groupText(jid, m && m.subject));
    }
    return reply(`${view.botText()}\n\n▸ _${isGroup ? `${prefix}settings group shows this group.` : `${prefix}settings group (inside a group) shows that group.`} ${prefix}resetsettings puts the bot-wide ones back to the defaults (with undo)._`);
  },
};

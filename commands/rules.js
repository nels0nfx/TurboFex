const store = require('../whatsapp/store');
const { getQuoted, quotedText } = require('../whatsapp/utils');

module.exports = [
  {
    name: 'rules',
    category: 'group',
    everyone: true,
    groupOnly: true,
    description: 'Show the rules of this group',
    async run({ jid, reply, prefix }) {
      const rules = store.getGroup(jid).rules;
      if (!rules) return reply(`No rules were set for this group yet.\nAdmins: ${prefix}setrules <the rules>`);
      return reply(`*Group rules*\n\n${rules}`);
    },
  },
  {
    name: 'setrules',
    category: 'group',
    groupOnly: true,
    adminOnly: true,
    description: 'Set the rules of this group (write them, or reply to a message): setrules <rules>, setrules clear',
    async run({ jid, msg, rest, reply, prefix }) {
      if (rest.toLowerCase() === 'clear') {
        store.update(jid, (g) => {
          g.rules = null;
        });
        return reply('✅ The rules were removed.');
      }
      const quoted = getQuoted(msg);
      const text = (rest || (quoted ? quotedText(quoted) : '') || '').trim();
      if (!text) return reply(`Write the rules after the command, or reply to a message that holds them.\nExample: ${prefix}setrules 1. Be kind\n2. No spam`);
      if (text.length > 1500) return reply('⚠️ Keep the rules under 1500 characters.');
      store.update(jid, (g) => {
        g.rules = text;
      });
      return reply(`✅ *Rules saved.* Everybody can see them with ${prefix}rules.`);
    },
  },
];

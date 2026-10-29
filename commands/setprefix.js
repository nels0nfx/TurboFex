const store = require('../whatsapp/store');

module.exports = {
  name: 'setprefix',
  category: 'owner',
  description: 'Change the command prefix, or use the bot with no prefix: setprefix . / setprefix none (owner only)',
  ownerOnly: true,
  async run({ args, reply, prefix, config }) {
    const v = args[0] || '';
    if (!v) {
      return reply(
        `🔧 *Prefix*\n*Current:* ${prefix || 'none (no prefix)'}\n\n▸ \`${prefix}setprefix .\` – change it\n▸ \`${prefix}setprefix none\` – use the bot with no prefix\n▸ \`${prefix}setprefix reset\` – back to the default`
      );
    }
    if (v.toLowerCase() === 'reset') {
      store.setPrefix(null);
      const back = store.effectivePrefix();
      return reply(`✅ *Prefix is back to ${back}*\nUse \`${back}menu\` from now on.`);
    }
    if (/^(none|off|no|remove|empty)$/i.test(v)) {
      store.setNoPrefix(true);
      return reply('✅ *No prefix mode is ON.*\n_Just write the command:_ `menu`, `ping`, `play calm down`\n_The old prefix no longer works._\n*Bring a prefix back:* `setprefix .` or `setprefix reset`');
    }
    if (!/^\S{1,3}$/.test(v)) return reply('⚠️ *The prefix must be 1 to 3 characters with no spaces.* Or write `none` to use no prefix.');
    store.setPrefix(v);
    return reply(`✅ *Prefix is now ${v}*\nUse \`${v}menu\` from now on.`);
  },
};

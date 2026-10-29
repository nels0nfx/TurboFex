const store = require('../whatsapp/store');

const TEXT = {
  on: '⏳ while I work, then ✅ when it is done',
  smart: 'only slow commands: ⏳ while I work, then ✅ (quick commands get no reaction)',
  clean: '⏳ while I work, then the reaction is removed when it is done',
  off: 'no reactions on commands',
};

module.exports = {
  name: 'cmdreact',
  aliases: ['reactions'],
  category: 'owner',
  ownerOnly: true,
  noReact: true,
  description: 'Reaction on commands (⏳ working, ✅ done): cmdreact on / smart / clean / off',
  async run({ args, reply, prefix }) {
    const c = (args[0] || '').toLowerCase();
    if (!TEXT[c]) {
      const now = store.getCmdReact();
      return reply(
        `⏳ *Command reactions:* ${now.toUpperCase()}\n(${TEXT[now]})\n\n` +
          `${prefix}cmdreact on - ⏳ then ✅\n${prefix}cmdreact smart - only for slow commands (fewer messages)\n${prefix}cmdreact clean - ⏳ then removed\n${prefix}cmdreact off - no reactions`
      );
    }
    store.setCmdReact(c);
    return reply(`✅ Command reactions: *${c.toUpperCase()}*\n${TEXT[c]}`);
  },
};

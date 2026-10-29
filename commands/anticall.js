const store = require('../whatsapp/store');

const TEXT = {
  off: 'calls are ignored (they ring on the bot phone)',
  reject: 'calls are rejected and the caller gets a short message',
  block: 'calls are rejected and the caller is blocked',
};

module.exports = {
  name: 'anticall',
  category: 'security',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'What happens with calls to the bot: anticall off / reject / block',
  async run({ args, reply, prefix }) {
    const a = (args[0] || '').toLowerCase();
    if (!TEXT[a]) {
      const now = store.getAnticall();
      return reply(`*Anti-call:* ${now.toUpperCase()}\n▸ ${TEXT[now]}\n\n▸ \`${prefix}anticall reject\`\n▸ \`${prefix}anticall block\`\n▸ \`${prefix}anticall off\``);
    }
    store.setAnticall(a);
    return reply(`✅ Anti-call: *${a.toUpperCase()}*\n▸ ${TEXT[a]}`);
  },
};

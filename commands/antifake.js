const store = require('../whatsapp/store');

module.exports = {
  name: 'antifake',
  category: 'group',
  description: 'Only let numbers with certain country codes join, e.g. antifake 27 263 (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, args, reply, prefix, isBotAdmin }) {
    const g = store.getGroup(jid);
    if ((args[0] || '').toLowerCase() === 'off') {
      store.update(jid, (grp) => {
        grp.antifake = [];
      });
      return reply('✅ Anti-fake is now *OFF*.');
    }

    const codes = args.map((a) => a.replace(/\D/g, '')).filter((a) => a.length >= 1 && a.length <= 4);
    if (!codes.length) {
      const now = g.antifake.length ? `only +${g.antifake.join(', +')}` : 'OFF';
      return reply(
        `🌍 Anti-fake is currently *${now}*.\n\nTo allow only certain countries:\n${prefix}antifake 27 263\n(27 = South Africa, 263 = Zimbabwe)\n\nTo switch off: ${prefix}antifake off`
      );
    }
    store.update(jid, (grp) => {
      grp.antifake = [...new Set(codes)];
    });
    await reply(`✅ New members must have a number starting with: +${[...new Set(codes)].join(', +')}`);
    if (!isBotAdmin) await reply('⚠️ Note: I must be a group admin to remove people.');
  },
};

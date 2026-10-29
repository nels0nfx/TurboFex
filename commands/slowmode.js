const store = require('../whatsapp/store');

module.exports = {
  name: 'slowmode',
  category: 'group',
  description: 'Members can only write every few seconds: slowmode 10 (seconds), slowmode off',
  groupOnly: true,
  adminOnly: true,
  botAdminRequired: true,
  async run({ jid, args, reply, prefix }) {
    const a = (args[0] || '').toLowerCase();
    if (!a) {
      const s = store.getGroup(jid).slowmode;
      return reply(`*Slow mode:* ${s ? `ON (${s} seconds)` : 'OFF'}\n▸ \`${prefix}slowmode 10\`\n▸ \`${prefix}slowmode off\`\n_Admins are never limited. Messages that come too soon are deleted._`);
    }
    if (['off', '0'].includes(a)) {
      store.update(jid, (g) => {
        g.slowmode = 0;
      });
      return reply('✅ Slow mode is *OFF*.');
    }
    const n = parseInt(a, 10);
    if (!Number.isFinite(n) || n < 2 || n > 3600) return reply(`⚠️ Choose between 2 and 3600 seconds, e.g. ${prefix}slowmode 10`);
    store.update(jid, (g) => {
      g.slowmode = n;
    });
    return reply(`✅ Slow mode is *ON*: members can write once every *${n} seconds*.`);
  },
};

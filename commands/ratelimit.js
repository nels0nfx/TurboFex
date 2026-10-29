const store = require('../whatsapp/store');

module.exports = {
  name: 'ratelimit',
  aliases: ['limit'],
  category: 'security',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'How many commands one person may use per minute: ratelimit 20 / on / off',
  async run({ args, reply, prefix }) {
    const a = (args[0] || '').toLowerCase();
    if (a === 'on' || a === 'off') {
      store.updateRate((r) => {
        r.on = a === 'on';
      });
      return reply(`✅ Rate limit is now *${a.toUpperCase()}*.`);
    }
    if (a === 'owner') {
      const v = (args[1] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) return reply(`*Usage:* \`${prefix}ratelimit owner on\` (limit yourself too, to test it) or \`${prefix}ratelimit owner off\``);
      store.updateRate((r) => {
        r.owner = v === 'on';
      });
      return reply(v === 'on' ? '✅ *The limit now applies to you too.* Use it to test, then switch it off again.' : '✅ *You are not limited again.*');
    }
    const n = parseInt(a, 10);
    if (a && Number.isFinite(n)) {
      if (n < 1 || n > 120) return reply('⚠️ Choose a number between 1 and 120 commands per minute.');
      store.updateRate((r) => {
        r.limit = n;
      });
      return reply(`✅ Each person can use *${n}* commands per minute.`);
    }
    const r = store.rateCfg();
    return reply(`*Rate limit:* ${r.on ? 'ON' : 'OFF'}\n▸ *Per person:* ${r.limit} commands per minute\n▸ *After the limit:* 30 seconds pause\n▸ *Coin commands:* max 8 in 20 seconds (then a 20 second pause)\n▸ *The owner:* ${r.owner ? 'limited too (test mode)' : 'never limited'}\n\n▸ \`${prefix}ratelimit 20\`\n▸ \`${prefix}ratelimit off\`\n▸ \`${prefix}ratelimit owner on\` – test it on yourself`);
  },
};

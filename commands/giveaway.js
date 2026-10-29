const crypto = require('crypto');
const { num } = require('../whatsapp/utils');

module.exports = {
  name: 'giveaway',
  aliases: ['draw'],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  needs: [],
  weight: 'light',
  description: 'Pick random winners from the members: giveaway 2 airtime (add "noadmins" to leave admins out)',
  async run({ args, rest, reply, prefix, groupMetadata, botIds }) {
    let count = 1;
    let words = rest.split(/\s+/).filter(Boolean);
    if (words.length && /^\d{1,2}$/.test(words[0])) {
      count = Math.max(1, Math.min(20, Number(words[0])));
      words = words.slice(1);
    }
    const noAdmins = words.some((w) => w.toLowerCase() === 'noadmins');
    const prize = words.filter((w) => w.toLowerCase() !== 'noadmins').join(' ');

    let pool = (groupMetadata?.participants || []).filter((p) => !botIds.includes(num(p.id)) && !(noAdmins && p.admin));
    if (pool.length < count) return reply(`⚠️ There are only ${pool.length} members to choose from.`);
    const winners = [];
    for (let i = 0; i < count; i++) {
      const at = crypto.randomInt(0, pool.length);
      winners.push(pool[at].id);
      pool = pool.filter((_, j) => j !== at);
    }
    const total = (groupMetadata.participants || []).length;
    return reply(
      `🎁 *Giveaway*\n${prize ? `▸ *Prize:* ${prize}\n` : ''}▸ *Winner${count > 1 ? 's' : ''}:* ${winners.map((w) => `@${num(w)}`).join(', ')}\n\n_Drawn at random from ${total - (noAdmins ? (groupMetadata.participants || []).filter((p) => p.admin).length : 0)} members._`,
      { mentions: winners }
    );
  },
};

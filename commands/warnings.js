const { getTargets, num } = require('../whatsapp/utils');
const store = require('../whatsapp/store');

module.exports = {
  name: 'warnings',
  category: 'group',
  aliases: ['warns'],
  description: 'See warnings (tag someone, or leave empty to see everyone)',
  groupOnly: true,
  async run({ jid, msg, reply }) {
    const max = store.getLimit(jid);
    const targets = getTargets(msg);

    if (targets.length) {
      const count = store.getWarnings(jid, targets[0]);
      return reply(`@${num(targets[0])} has ${count}/${max} warnings.`, { mentions: [targets[0]] });
    }

    const all = store.allWarnings(jid);
    if (!all.length) return reply('✅ Nobody in this group has warnings.');

    const lines = all.map((w, i) => `${i + 1}. @${num(w.jid)} - ${w.count}/${max}`);
    return reply(`⚠️ *Warnings*\n\n${lines.join('\n')}`, { mentions: all.map((w) => w.jid) });
  },
};

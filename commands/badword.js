const store = require('../whatsapp/store');

module.exports = {
  name: 'badword',
  category: 'group',
  description: 'Manage the banned word list: add / remove / list (admins only)',
  groupOnly: true,
  adminOnly: true,
  async run({ jid, args, reply, prefix }) {
    const sub = (args[0] || '').toLowerCase();
    const word = args.slice(1).join(' ').toLowerCase().trim();
    const g = store.getGroup(jid);

    if (sub === 'add') {
      if (word.length < 2 || word.length > 30) return reply('⚠️ A banned word must be 2 to 30 characters long.');
      if (g.badWords.length >= 50) return reply('⚠️ The list is full (50 words). Remove some first.');
      if (g.badWords.includes(word)) return reply('ℹ️ That word is already on the list.');
      store.update(jid, (grp) => grp.badWords.push(word));
      return reply(`✅ Added to the banned words. Turn the filter on with ${prefix}antiword warn (or delete / kick).`);
    }

    if (sub === 'remove' || sub === 'del') {
      if (!g.badWords.includes(word)) return reply('ℹ️ That word is not on the list.');
      store.update(jid, (grp) => {
        grp.badWords = grp.badWords.filter((w) => w !== word);
      });
      return reply('✅ Removed from the banned words.');
    }

    const list = g.badWords.length ? g.badWords.map((w, i) => `${i + 1}. ${w}`).join('\n') : 'No words yet.';
    return reply(
      `🤬 *Banned words* (filter is ${g.antiwordMode.toUpperCase()})\n\n${list}\n\n` +
        `${prefix}badword add <word>\n${prefix}badword remove <word>`
    );
  },
};

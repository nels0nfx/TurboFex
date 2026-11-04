// warnings = see warnings. topwarned / warnboard are aliases (the top list, admins only).
//   warnings @person   -> that person's warnings
//   warnings           -> everybody with warnings, the most warned first
const { getTargets, num } = require('../whatsapp/utils');
const store = require('../whatsapp/store');

const medals = ['🥇', '🥈', '🥉'];
const SHOW = 15;

module.exports = {
  name: 'warnings',
  category: 'group',
  aliases: ['warns', 'warning', 'topwarned', 'warnboard'],
  description: 'See warnings: warnings @person, or warnings alone for the members with the most warnings (topwarned = admins only)',
  groupOnly: true,
  async run({ jid, msg, reply, cmdName, isAdmin, isOwner }) {
    // the old "topwarned" was for admins only: it stays that way (silent for members)
    if (['topwarned', 'warnboard'].includes(cmdName) && !(isAdmin || isOwner)) return;

    const max = store.getLimit(jid);
    const targets = cmdName === 'topwarned' || cmdName === 'warnboard' ? [] : getTargets(msg);

    if (targets.length) {
      const count = store.getWarnings(jid, targets[0]);
      return reply(`⚠️ *Warnings*\n@${num(targets[0])} has *${count}/${max}* warnings.`, { mentions: [targets[0]] });
    }

    const all = store.allWarnings(jid).sort((a, b) => b.count - a.count);
    if (!all.length) return reply('✨ *Nobody has a warning.* A clean group!');

    const shown = all.slice(0, SHOW);
    const lines = shown.map((w, i) => `${medals[i] || '▫️'} @${num(w.jid)} - ${w.count}/${max}`);
    const more = all.length > shown.length ? `\n_...and ${all.length - shown.length} more_` : '';
    return reply(`⚠️ *Most warnings* (${all.length})\n\n${lines.join('\n')}${more}`, { mentions: shown.map((w) => w.jid) });
  },
};

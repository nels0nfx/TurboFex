const config = require('../config');
const sessionBackup = require('../core/sessionbackup');

const when = (name) => name.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/, '$1-$2-$3 $4:$5 UTC');

module.exports = [
  {
    name: 'loginbackup',
    aliases: ['sessionbackup'],
    category: 'owner',
    realOwnerOnly: true,
    noReact: true,
    needs: [],
    weight: 'light',
    description: 'Backup of the bot login (kept on the server, never sent): loginbackup / loginbackup now',
    async run({ args, reply, prefix }) {
      if ((args[0] || '').toLowerCase() === 'now') {
        const b = await sessionBackup.backupNow(config.sessionDir);
        return reply(b ? `✅ Login backup saved (${when(b.name)}, ${b.files} files).` : '⚠️ There is no linked login to back up yet.');
      }
      const all = sessionBackup.list();
      return reply(
        `*Login backup*\n` +
          (all.length ? all.map((n) => `▸ ${when(n)}`).join('\n') : '▸ none yet (the first one is made a few minutes after the bot connects)') +
          `\n\n_A copy is made every day and the last 3 are kept inside the bot's data folder. It is never sent over WhatsApp._\n` +
          `▸ Make one now: \`${prefix}loginbackup now\`\n` +
          `▸ Restore after losing the login: start the bot once with \`RESTORE_LOGIN=1\``
      );
    },
  },
  {
    name: 'sessionclean',
    category: 'owner',
    realOwnerOnly: true,
    noReact: true,
    needs: [],
    weight: 'light',
    description: 'Remove old encryption files of chats that have been silent for months (runs by itself monthly)',
    async run({ reply }) {
      const r = sessionBackup.cleanup(config.sessionDir);
      return reply(`*Session cleanup*\n▸ Removed: ${r.removed} files (${Math.round(r.bytes / 1024)} KB)\n▸ Kept: ${r.kept}\n_Only files of chats silent for 90+ days are removed; WhatsApp rebuilds them if they write again._`);
    },
  },
];

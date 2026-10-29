const pkg = require('../package.json');
const clock = require('../core/clock');
const meta = require('../whatsapp/metadata');
const stats = require('../whatsapp/stats');

const ago = (t) => clock.duration(Date.now() - t);

module.exports = {
  name: 'stats',
  category: 'owner',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'How the bot is used: commands, busiest groups, last errors (stats errors, stats reset)',
  async run({ sock, args, reply, diag }) {
    const a = (args[0] || '').toLowerCase();
    if (a === 'reset') {
      stats.reset();
      return reply('✅ Statistics were reset.');
    }
    const s = stats.summary();
    if (a === 'errors') {
      if (!s.lastErrors.length) return reply('*No errors recorded.* ✅');
      return reply(`*Last errors*\n${s.lastErrors.map((e) => `▸ ${ago(e.at)} ago, *${e.name}*: ${e.message}`).reverse().join('\n')}`);
    }
    const groups = [];
    for (const [jid, n] of s.topGroups) {
      let name = jid.split('@')[0].slice(-6);
      try {
        name = (await meta.getMeta(sock, jid)).subject || name;
      } catch (err) {
        // the id is shown instead
      }
      groups.push(`▸ ${name}: ${n}`);
    }
    return reply(
      `*Bot statistics*\n` +
        `▸ *Version:* v${pkg.version}   *Uptime:* ${clock.uptime()}\n` +
        `▸ *Commands:* ${s.today} today, ${s.week} this week, ${s.total} in total\n` +
        `▸ *Messages handled since start:* ${diag.stats.handled}\n` +
        `▸ *Errors:* ${s.errors}\n\n` +
        `*Most used commands*\n${s.topCommands.map(([n, c], i) => `${i + 1}. ${n}: ${c}`).join('\n') || '_nothing yet_'}\n\n` +
        `*Busiest groups*\n${groups.join('\n') || '_nothing yet_'}\n\n` +
        `_Counting since ${ago(s.since)} ago._ \`stats errors\` shows the last errors.`
    );
  },
};

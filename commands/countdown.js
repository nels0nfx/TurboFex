const clock = require('../core/clock');

module.exports = {
  name: 'countdown',
  category: 'tools',
  description: 'Days until a date: countdown 2026-12-25 Christmas',
  async run({ args, reply, prefix }) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(args[0] || '');
    const name = args.slice(1).join(' ').trim();
    if (!m) return reply(`Give the date as year-month-day, then an optional name.\nExample: ${prefix}countdown 2026-12-25 Christmas`);
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const target = new Date(Date.UTC(y, mo - 1, d));
    if (target.getUTCFullYear() !== y || target.getUTCMonth() !== mo - 1 || target.getUTCDate() !== d) return reply('⚠️ That is not a real date.');
    const [ty, tmo, td] = new Intl.DateTimeFormat('en-CA', { timeZone: clock.zone() }).format(new Date()).split('-').map(Number);
    const days = Math.round((target.getTime() - Date.UTC(ty, tmo - 1, td)) / 86400000);
    const label = name ? `*${name}*` : 'that day';
    if (days === 0) return reply(`🎉 It is ${label} TODAY!`);
    if (days > 0) return reply(`⏳ ${days} day${days === 1 ? '' : 's'} until ${label} (${days >= 7 ? `about ${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'}` : 'less than a week'}).`);
    await reply(`📅 ${label} was ${-days} day${days === -1 ? '' : 's'} ago.`);
  },
};

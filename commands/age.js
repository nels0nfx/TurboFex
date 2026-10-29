const clock = require('../core/clock');

function parseDate(text) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  return m ? [Number(m[3]), Number(m[2]), Number(m[1])] : null;
}

function validDate(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

module.exports = {
  name: 'age',
  category: 'tools',
  description: 'Work out an age and the next birthday: age 1995-04-23 (or age 23/04/1995)',
  async run({ args, reply, prefix }) {
    const p = parseDate(args[0] || '');
    if (!p || !validDate(...p)) return reply(`Give a birth date as year-month-day or day/month/year.\nExample: ${prefix}age 1995-04-23`);
    const [y, mo, d] = p;
    const [ty, tmo, td] = new Intl.DateTimeFormat('en-CA', { timeZone: clock.zone() }).format(new Date()).split('-').map(Number);
    if (Date.UTC(y, mo - 1, d) > Date.UTC(ty, tmo - 1, td)) return reply('⚠️ That date is in the future.');

    let years = ty - y;
    let months = tmo - mo;
    let days = td - d;
    if (days < 0) {
      months -= 1;
      days += new Date(Date.UTC(ty, tmo - 1, 0)).getUTCDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    let next = Date.UTC(ty, mo - 1, d);
    if (next < Date.UTC(ty, tmo - 1, td)) next = Date.UTC(ty + 1, mo - 1, d);
    const left = Math.round((next - Date.UTC(ty, tmo - 1, td)) / 86400000);
    await reply(`🎂 *${years}* years, ${months} months and ${days} days old\n🎉 Next birthday: ${left === 0 ? 'TODAY! 🥳' : `in ${left} day${left === 1 ? '' : 's'}`}`);
  },
};

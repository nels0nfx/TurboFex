const b = require('../whatsapp/budget');
const clock = require('../core/clock');

module.exports = {
  name: 'summary',
  category: 'budget',
  description: 'See this month\'s income, spending and latest entries',
  async run({ msg, reply, prefix, isGroup, botIds }) {
    const m = b.month(b.userKey(msg, botIds));
    if (!m.list.length && !m.limit) {
      return reply(`📒 Nothing saved this month yet.\nTry: ${prefix}income 5000 salary  or  ${prefix}expense 250 groceries`);
    }

    let text = `💰 *Budget summary: ${clock.monthLabel()}*\n\n📥 Income: ${b.money(m.income)}\n📤 Spent: ${b.money(m.spent)}\n💵 Balance: ${b.money(m.income - m.spent)}`;
    if (m.limit) {
      const pct = Math.round((m.spent / m.limit) * 100);
      const left = m.limit - m.spent;
      text += `\n🎯 Budget: ${b.money(m.limit)} (${pct}% used, ${left >= 0 ? `${b.money(left)} left` : `${b.money(-left)} over`})`;
    }
    const latest = m.list.slice(-5).reverse();
    if (latest.length) {
      text += '\n\n🕓 *Latest*\n' + latest
        .map((e) => `• ${clock.shortDate(e.t)}  ${e.type === 'in' ? '+' : '-'}${b.money(e.amt)}${e.note ? '  ' + e.note : ''}`)
        .join('\n');
    }
    await reply(text + (isGroup ? b.PRIVACY : ''));
  },
};

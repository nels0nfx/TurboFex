module.exports = {
  name: 'calc',
  category: 'tools',
  description: 'Calculator, e.g. calc 12*(3+4)',
  async run({ rest, reply, prefix }) {
    const expr = rest.replace(/×/g, '*').replace(/÷/g, '/');
    if (!expr) return reply(`Example: ${prefix}calc 12*(3+4)`);
    if (!/^[0-9+\-*/().%\s^]+$/.test(expr) || expr.length > 100) {
      return reply('⚠️ I can only work with numbers and + - * / ( ) % ^');
    }
    let value;
    try {
      value = Function(`"use strict"; return (${expr.replace(/\^/g, '**')})`)();
    } catch (err) {
      return reply('⚠️ I could not work that out.');
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return reply('⚠️ I could not work that out.');
    await reply(`🧮 ${expr} = *${Math.round(value * 1e10) / 1e10}*`);
  },
};

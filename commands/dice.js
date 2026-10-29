module.exports = {
  name: 'dice',
  category: 'fun',
  aliases: ['roll'],
  description: 'Roll dice: dice, dice 20, or dice 2d6',
  async run({ args, reply }) {
    let count = 1;
    let sides = 6;
    const m = /^(\d{1,2})?d(\d{1,3})$/i.exec(args[0] || '');
    if (m) {
      count = Number(m[1] || 1);
      sides = Number(m[2]);
    } else if (/^\d{1,3}$/.test(args[0] || '')) {
      sides = Number(args[0]);
    }
    if (count < 1 || count > 10 || sides < 2 || sides > 100) {
      return reply('⚠️ Use 1 to 10 dice with 2 to 100 sides, e.g. dice 2d6');
    }
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    await reply(`🎲 ${count}d${sides}: ${rolls.join(' + ')}${count > 1 ? ` = *${total}*` : ''}`);
  },
};

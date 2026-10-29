const games = require('../whatsapp/play');

const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '7️⃣'];

module.exports = {
  name: 'slots',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  description: 'Slot machine. "slots" opens a lobby (type join, then spin), "slots spin" is one quick spin',
  async run(ctx) {
    if ((ctx.args[0] || '').toLowerCase() === 'spin') {
      const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const [a, b, c] = [pick(), pick(), pick()];
      const result = a === b && b === c ? '🎉 JACKPOT!' : a === b || b === c || a === c ? '😮 So close! Two match.' : '😅 No match. Try again!';
      return ctx.reply(`🎰 *Slots*\n\n| ${a} | ${b} | ${c} |\n\n${result}`);
    }
    return games.fromCommand(ctx, 'slots', { defaultRounds: 3 });
  },
};

const games = require('../whatsapp/play');

module.exports = {
  name: 'mathquiz',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  aliases: ['math'],
  description: 'Maths race. Players type join, first correct answer wins (mathquiz hard 8 = hard, 8 rounds)',
  run: (ctx) => {
    const words = ctx.args.map((a) => a.toLowerCase());
    const level = ['easy', 'medium', 'hard'].find((l) => words.includes(l)) || 'easy';
    return games.fromCommand(ctx, 'mathquiz', { defaultRounds: 5, options: { level } });
  },
};

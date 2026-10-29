const games = require('../whatsapp/play');

module.exports = {
  name: 'scramble',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  description: 'Unscramble the word. Players type join, first to type it wins (scramble 5 = 5 rounds)',
  run: (ctx) => games.fromCommand(ctx, 'scramble', { defaultRounds: 5 }),
};

const games = require('../whatsapp/play');

module.exports = {
  name: 'guess',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  description: 'Guess the number 1-100. Players type join, then send guesses (e.g. guess 5 = 5 rounds, guess solo)',
  run: (ctx) => games.fromCommand(ctx, 'guess', { defaultRounds: 3 }),
};

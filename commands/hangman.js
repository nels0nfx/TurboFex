const games = require('../whatsapp/play');

module.exports = {
  name: 'hangman',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  description: 'Hangman. Players type join, then send letters (e.g. hangman 5 = 5 rounds, hangman solo)',
  run: (ctx) => games.fromCommand(ctx, 'hangman', { defaultRounds: 5 }),
};

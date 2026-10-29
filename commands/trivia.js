const games = require('../whatsapp/play');

module.exports = {
  name: 'trivia',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  aliases: ['quiz'],
  description: 'Trivia quiz. Players type join, then answer 1-4 (trivia 8 = 8 rounds, trivia solo)',
  run: (ctx) => games.fromCommand(ctx, 'trivia', { defaultRounds: 5 }),
};

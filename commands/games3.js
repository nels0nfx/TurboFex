// More games: blackjack, higherlower, mines, typerace, flags, capitals, bingo. Admins start them, everybody joins by typing join.
const games = require('../whatsapp/play');

const base = { category: 'games', adminOnly: true, needs: [], weight: 'light' };

module.exports = [
  {
    ...base,
    name: 'blackjack',
    aliases: ['bj', '21'],
    description: 'Blackjack against the dealer, blackjack',
    run: (ctx) => games.fromCommand(ctx, 'blackjack', { defaultRounds: 1 }),
  },
  { ...base, name: 'higherlower', aliases: ['hl'], description: 'Guess if the next number is higher or lower. Last one standing wins', run: (ctx) => games.fromCommand(ctx, 'higherlower', { defaultRounds: 1 }) },
  { ...base, name: 'mines', aliases: ['minesweeper'], description: 'Take turns opening squares: a mine knocks you out', run: (ctx) => games.fromCommand(ctx, 'mines', { defaultRounds: 1 }) },
  { ...base, name: 'typerace', description: 'First to type the sentence exactly wins (typerace 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'typerace', { defaultRounds: 5 }) },
  { ...base, name: 'flags', aliases: ['flagquiz'], description: 'Name the country from its flag (flags 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'flags', { defaultRounds: 5 }) },
  { ...base, name: 'capitals', aliases: ['capitalquiz'], description: 'Name the capital city of a country (capitals 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'capitals', { defaultRounds: 5 }) },
  { ...base, name: 'bingo', description: 'Every player gets a card, the first complete card wins', run: (ctx) => games.fromCommand(ctx, 'bingo', { defaultRounds: 1 }) },
];

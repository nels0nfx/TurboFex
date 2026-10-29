// More games: blackjack, higherlower, mines, typerace, flags, capitals, bingo. Admins start them, everybody joins by typing join.
const games = require('../whatsapp/play');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');

const base = { category: 'games', adminOnly: true, needs: [], weight: 'light' };

module.exports = [
  {
    ...base,
    name: 'blackjack',
    aliases: ['bj', '21'],
    description: 'Blackjack against the dealer, with an optional coin bet: blackjack 100',
    async run(ctx) {
      const raw = ctx.args.find((a) => /^\d{1,6}$/.test(a));
      const bet = raw ? parseInt(raw, 10) : 0;
      if (bet && !S.isOn(ctx.jid)) return ctx.reply(ui.warn('Bets need the realm to be open in this group.'));
      if (bet && A.balance(ctx.jid, ctx.myJid) < bet) return ctx.reply(ui.warn(`You only have ${ui.money(A.balance(ctx.jid, ctx.myJid))}. See \`${ctx.prefix}daily\``));
      return games.fromCommand({ ...ctx, args: ctx.args.filter((a) => a !== raw) }, 'blackjack', { defaultRounds: 1, options: { bet, group: ctx.jid } }); // the bet is not a number of rounds
    },
  },
  { ...base, name: 'higherlower', aliases: ['hl'], description: 'Guess if the next number is higher or lower. Last one standing wins', run: (ctx) => games.fromCommand(ctx, 'higherlower', { defaultRounds: 1 }) },
  { ...base, name: 'mines', aliases: ['minesweeper'], description: 'Take turns opening squares: a mine knocks you out', run: (ctx) => games.fromCommand(ctx, 'mines', { defaultRounds: 1 }) },
  { ...base, name: 'typerace', description: 'First to type the sentence exactly wins (typerace 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'typerace', { defaultRounds: 5 }) },
  { ...base, name: 'flags', aliases: ['flagquiz'], description: 'Name the country from its flag (flags 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'flags', { defaultRounds: 5 }) },
  { ...base, name: 'capitals', aliases: ['capitalquiz'], description: 'Name the capital city of a country (capitals 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'capitals', { defaultRounds: 5 }) },
  { ...base, name: 'bingo', description: 'Every player gets a card, the first complete card wins', run: (ctx) => games.fromCommand(ctx, 'bingo', { defaultRounds: 1 }) },
];

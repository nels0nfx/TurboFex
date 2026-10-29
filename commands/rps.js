const games = require('../whatsapp/play');

const { MOVES, ALIAS, BEATS } = games.rps;

module.exports = {
  name: 'rps',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  description: 'Rock paper scissors. "rps" opens a lobby (type join), "rps rock" is a quick match against the bot',
  async run(ctx) {
    const raw = (ctx.args[0] || '').toLowerCase();
    const mine = ALIAS[raw] || (MOVES[raw] ? raw : null);

    if (!mine) return games.fromCommand(ctx, 'rps', { defaultRounds: 3 });

    // quick one-off match against the bot
    const names = Object.keys(MOVES);
    const bot = names[Math.floor(Math.random() * names.length)];
    const result = mine === bot ? "🤝 It's a draw!" : BEATS[mine] === bot ? '🎉 You win!' : '🤖 I win!';
    await ctx.reply(`You: ${MOVES[mine]} ${mine}\nMe: ${MOVES[bot]} ${bot}\n\n${result}`);
  },
};

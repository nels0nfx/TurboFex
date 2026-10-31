const games = require('../whatsapp/play');

module.exports = {
  name: 'endgame',
  category: 'games',
  aliases: ['stopgame'],
  description: 'End the game running in this chat (the starter, players or a group admin)',
  async run({ jid, reply, myIds, isGroup, isAdmin, isOwner }) {
    const game = games.get(jid);
    if (!game) return reply('ℹ️ There is no game running here.');
    if (isGroup && !isAdmin && !isOwner && !games.canEnd(game, myIds)) return; // not allowed: stay silent
    games.end(jid);
    await reply('🛑 Game ended.');
  },
};

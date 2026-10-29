const games = require('../whatsapp/play');
const { resolveTarget, selfJid, num } = require('../whatsapp/utils');

module.exports = {
  name: 'tictactoe',
  category: 'games',
  adminOnly: true, // only admins start a game, everybody can join it
  aliases: ['ttt'],
  description: 'Tic-tac-toe. "ttt" opens a lobby (someone types join), "ttt @friend" challenges a friend, "ttt bot" plays the bot',
  async run({ sock, jid, msg, args, reply, prefix, botIds, myIds, myJid, isGroup, isAdmin, isOwner }) {
    const existing = games.get(jid);
    const words = args.map((a) => a.toLowerCase());

    if (words[0] === 'end') {
      if (!existing) return reply('ℹ️ There is no game running here.');
      if (isGroup && !isAdmin && !isOwner && !games.canEnd(existing, myIds)) return reply('⚠️ Only the players or a group admin can end the game.');
      games.end(jid);
      return reply('🛑 Game ended.');
    }
    if (existing) return reply(games.busyText(prefix));

    let useBot = words.includes('bot') || words.includes('ai') || words.includes('solo');
    let invited = null;
    let invitedJid = null;

    if (!isGroup) {
      // private chat: if the owner types it, the other person is invited; if the other person types it, they play the bot
      if (msg.key.fromMe) {
        invited = [num(jid), num(msg.key.remoteJidAlt)].filter(Boolean);
        invitedJid = jid;
      } else {
        useBot = true;
      }
    } else {
      const target = resolveTarget(msg, args);
      if (target && botIds.includes(num(target))) useBot = true;
      else if (target) {
        if (myIds.includes(num(target))) return reply('😅 You cannot play against yourself.');
        invited = [num(target)];
        invitedJid = target;
      }
    }

    if (useBot) {
      invited = null;
      invitedJid = null;
    }
    await games.open({
      sock, jid, msg, type: 'ttt', starter: { ids: myIds, jid: myJid },
      options: useBot ? { ai: true, botJid: selfJid(sock) } : {},
      invited, invitedJid, instant: useBot,
    });
  },
};

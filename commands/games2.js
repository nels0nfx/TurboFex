// New games: riddle, emojiquiz, wordle, connect4, duel, plus roast
const games = require('../whatsapp/play');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const ui = require('../core/realm/ui');
const { resolveTarget, num } = require('../whatsapp/utils');

// only admins (and the owner) start a game; everybody joins by typing join
const base = { category: 'games', adminOnly: true, needs: [], weight: 'light' };

// connect4 and duel: two players. "connect4" opens a lobby (someone types join), "connect4 @friend" challenges a friend.
function twoPlayer(type, label, extra = () => ({})) {
  return async (ctx) => {
    const { sock, jid, msg, args, reply, prefix, myIds, myJid, botIds, isGroup, isAdmin, isOwner } = ctx;
    const existing = games.get(jid);
    if (!isGroup) return reply(`⚠️ ${label} is played in groups.`);
    if ((args[0] || '').toLowerCase() === 'end') {
      if (!existing) return reply('ℹ️ There is no game running here.');
      if (!isAdmin && !isOwner && !games.canEnd(existing, myIds)) return reply('⚠️ Only the players or a group admin can end the game.');
      games.end(jid);
      return reply('🛑 Game ended.');
    }
    if (existing) return reply(games.busyText(prefix));
    const target = resolveTarget(msg, args);
    if (target && botIds.includes(num(target))) return reply('🤖 I cannot play this one, challenge a person.');
    if (target && myIds.includes(num(target))) return reply('😅 You cannot play against yourself.');
    const more = await extra(ctx, target);
    if (more && more.error) return reply(more.error);
    await games.open({
      sock, jid, msg, type, starter: { ids: myIds, jid: myJid },
      options: more?.options || {},
      invited: target ? [num(target)] : null, invitedJid: target || null,
    });
  };
}

module.exports = [
  { ...base, name: 'riddle', description: 'Riddles: first to type the answer wins (riddle 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'riddle', { defaultRounds: 5 }) },
  { ...base, name: 'emojiquiz', aliases: ['emoji'], description: 'Guess the movie or word from emojis (emojiquiz 5 = 5 rounds)', run: (ctx) => games.fromCommand(ctx, 'emojiquiz', { defaultRounds: 5 }) },
  { ...base, name: 'wordle', description: 'Guess the 5-letter word in 6 tries, together (wordle 3 = 3 words)', run: (ctx) => games.fromCommand(ctx, 'wordle', { defaultRounds: 1 }) },
  {
    ...base,
    name: 'connect4',
    aliases: ['c4'],
    groupOnly: true,
    description: 'Connect 4 for two: "connect4" opens a lobby (type join), "connect4 @friend" challenges a friend',
    run: twoPlayer('connect4', 'Connect 4'),
  },
  {
    ...base,
    name: 'duel',
    groupOnly: true,
    description: 'Fight a member turn by turn, with an optional coin bet: duel @user 100',
    run: twoPlayer('duel', 'Duel', async ({ args, myJid, prefix, jid }) => {
      const raw = args.find((a) => /^\d{1,6}$/.test(a));
      const bet = raw ? parseInt(raw, 10) : 0;
      if (bet > 100000) return { error: '⚠️ The highest bet is 100,000 Aurum.' };
      if (bet && !S.isOn(jid)) return { error: '⚠️ Bets need the realm to be open in this group.' };
      if (bet && A.balance(jid, myJid) < bet) return { error: `⚠️ You only have ${ui.money(A.balance(jid, myJid))}. See ${prefix}daily` };
      return { options: { bet, group: jid } };
    }),
  },
  {
    ...base,
    category: 'fun',
    adminOnly: false,
    everyone: true,
    name: 'roast',
    description: 'A light-hearted roast for a friend: roast @user',
    async run({ msg, args, reply, myJid }) {
      const target = resolveTarget(msg, args) || myJid;
      const lines = [
        'is the reason the group chat goes quiet when the bill comes.',
        'has a 100% success rate at arriving fashionably late.',
        'types "I am on my way" while still in bed.',
        'once lost an argument with an autocorrect.',
        'is the main character in a story where the wifi is always weak.',
        'could get lost in a one-room house and blame the map.',
        'says "five minutes" and means "see you tomorrow".',
        'has 3,000 photos and zero of them are in focus.',
        'will read this message and reply "lol" three days later.',
        'charges their phone to 100% and still lives at 2%.',
        'brings energy to the group, mostly by draining everybody else\'s.',
        'is proof that "reply all" was a mistake.',
        'makes a great backup plan, for when the real plan fails.',
        'would lose a staring contest to a screensaver.',
        'sends voice notes longer than most podcasts.',
      ];
      await reply(`🔥 @${num(target)} ${lines[Math.floor(Math.random() * lines.length)]}\n\n_Just for fun, no hard feelings!_ 😄`, { mentions: [target] });
    },
  },
];

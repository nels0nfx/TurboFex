const store = require('../whatsapp/store');
const levels = require('../whatsapp/levels');
const { getTargets, num } = require('../whatsapp/utils');

module.exports = [
  {
    name: 'rank',
    aliases: ['level', 'xp'],
    category: 'group',
    everyone: true,
    groupOnly: true,
    needs: [],
    weight: 'light',
    description: 'Your level and XP in this group (admins: rank on / rank off)',
    async run({ jid, msg, args, reply, prefix, isAdmin, isOwner, myJid }) {
      const a = (args[0] || '').toLowerCase();
      if (a === 'on' || a === 'off') {
        if (!isAdmin && !isOwner) return reply('⚠️ Only group admins can switch ranks on or off.');
        store.update(jid, (g) => {
          g.rank = a === 'on';
        });
        return reply(`✅ Ranks are now *${a.toUpperCase()}* in this group.${a === 'on' ? '\n_Members earn XP by chatting. Try rank and top._' : ''}`);
      }
      if (!store.getGroup(jid).rank) return reply(`Ranks are off in this group. Admins can switch them on with ${prefix}rank on.`);
      const target = getTargets(msg)[0] || myJid || msg.key.participant;
      const s = levels.statsOf(jid, target);
      if (!s.position) return reply(`@${num(target)} has no XP yet. Chat with the group to earn some!`, { mentions: [target] });
      return reply(
        `*Rank of @${num(target)}*\n▸ *Level:* ${s.level}\n▸ *XP:* ${s.xp}\n▸ *Position:* ${s.position} of ${s.total}\n\n${levels.bar(s.into, s.need)}  ${s.into}/${s.need} XP to level ${s.level + 1}`,
        { mentions: [target] }
      );
    },
  },
  {
    name: 'top',
    aliases: ['leaderboard'],
    category: 'group',
    everyone: true,
    groupOnly: true,
    needs: [],
    weight: 'light',
    description: 'The most active members of this group',
    async run({ jid, reply, prefix }) {
      if (!store.getGroup(jid).rank) return reply(`Ranks are off in this group. Admins can switch them on with ${prefix}rank on.`);
      const top = levels.board(jid).slice(0, 10);
      if (!top.length) return reply('Nobody has earned XP yet. Start chatting!');
      const medal = ['1.', '2.', '3.'];
      return reply(
        `*Top members*\n${top.map(([, v], i) => `${medal[i] || `${i + 1}.`} @${num(v.j)}: level ${levels.level(v.x)} (${v.x} XP)`).join('\n')}`,
        { mentions: top.map(([, v]) => v.j) }
      );
    },
  },
];

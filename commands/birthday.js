const store = require('../whatsapp/store');
const birthdays = require('../whatsapp/birthdays');
const { getTargets, num } = require('../whatsapp/utils');

const text = (bd) => `${bd.d} ${birthdays.MONTHS[bd.m - 1][0].toUpperCase()}${birthdays.MONTHS[bd.m - 1].slice(1)}`;

module.exports = [
  {
    name: 'setbirthday',
    aliases: ['mybirthday'],
    category: 'group',
    everyone: true,
    needs: [],
    weight: 'light',
    description: 'Save your birthday: setbirthday 25 Dec (or 25-12). setbirthday remove deletes it',
    async run({ args, rest, reply, prefix, myIds, myJid }) {
      if ((args[0] || '').toLowerCase() === 'remove') return reply(birthdays.remove(myIds) ? '✅ Your birthday was removed.' : '_You had not saved a birthday._');
      const bd = birthdays.parse(rest);
      if (!bd) return reply(`Write your birthday like this: ${prefix}setbirthday 25 Dec  or  ${prefix}setbirthday 25-12\n_The year is not needed._`);
      birthdays.save(myIds, myJid, bd);
      return reply(`🎂 *Saved:* your birthday is on *${text(bd)}*.\nGroups that switched birthdays on will wish you.`);
    },
  },
  {
    name: 'birthday',
    aliases: ['birthdays'],
    category: 'group',
    everyone: true,
    needs: [],
    weight: 'light',
    description: 'Upcoming birthdays in this group (admins: birthday on / off to switch the daily wishes)',
    async run({ jid, msg, args, reply, prefix, isGroup, isAdmin, isOwner, groupMetadata }) {
      const a = (args[0] || '').toLowerCase();
      if (!isGroup) return reply(`Save your own birthday with ${prefix}setbirthday 25 Dec. Use ${prefix}birthday in a group to see the upcoming ones.`);
      if (a === 'on' || a === 'off') {
        if (!isAdmin && !isOwner) return; // not allowed: stay silent
        store.update(jid, (g) => {
          g.birthdays = a === 'on';
        });
        return reply(`✅ Birthday wishes are now *${a.toUpperCase()}* in this group.${a === 'on' ? '\n_Members who saved a birthday are wished at 08:00 on the day._' : ''}`);
      }
      const target = getTargets(msg)[0];
      const known = birthdays.inGroup(groupMetadata);
      if (target) {
        const hit = known.find((x) => num(x.jid) === num(target)) || { bd: birthdays.find([num(target)]) };
        if (!hit.bd) return reply(`@${num(target)} has not saved a birthday.`, { mentions: [target] });
        return reply(`🎂 @${num(target)}: *${text(hit.bd)}*`, { mentions: [target] });
      }
      if (!known.length) return reply(`Nobody here has saved a birthday yet.\nSave yours with ${prefix}setbirthday 25 Dec.`);
      const next = known.map((x) => ({ ...x, in: birthdays.daysUntil(x.bd) })).sort((x, y) => x.in - y.in).slice(0, 6);
      return reply(
        `🎂 *Upcoming birthdays*\n${next.map((x) => `▸ @${num(x.jid)}: ${text(x.bd)} ${x.in === 0 ? '(today!)' : x.in === 1 ? '(tomorrow)' : `(in ${x.in} days)`}`).join('\n')}\n\n_Wishes: ${store.getGroup(jid).birthdays ? 'ON' : `OFF, admins can use ${prefix}birthday on`}_`,
        { mentions: next.map((x) => x.jid) }
      );
    },
  },
];

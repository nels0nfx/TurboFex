const store = require('../whatsapp/store');
const clock = require('../core/clock');
const { parseWhen } = require('../core/when');

const MAX_PER_CHAT = 20;

module.exports = {
  name: 'remind',
  category: 'tools',
  description: 'Remind you later: remind 10m call mom, remind 2h feed the cat, remind 18:30 dinner',
  async run({ jid, args, myIds, myJid, reply, prefix }) {
    const at = parseWhen(args[0]);
    const text = args.slice(1).join(' ').trim();
    if (!at || !text) {
      return reply(
        `Say when, then what to remind you about.\n${prefix}remind 10m call mom\n${prefix}remind 1h30m take the pizza out\n${prefix}remind 18:30 dinner (${clock.zone()} time)\n\nLongest: 30 days. See them with ${prefix}reminders`
      );
    }
    if (text.length > 500) return reply('⚠️ That reminder is too long (max 500 characters).');
    if (store.reminders().filter((r) => r.jid === jid).length >= MAX_PER_CHAT) {
      return reply(`⚠️ This chat already has ${MAX_PER_CHAT} reminders. Remove one with ${prefix}unremind <number>`);
    }
    const item = store.addReminder({ jid, who: myJid, ids: myIds, at, text });
    await reply(`⏰ Done! I will remind you on *${clock.stamp(at)}* (${clock.zone()} time) in ${clock.duration(at - Date.now())}.\nCancel it with ${prefix}unremind ${item.id}`);
  },
};

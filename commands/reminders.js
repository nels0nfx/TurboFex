const store = require('../whatsapp/store');
const clock = require('../core/clock');

module.exports = {
  name: 'reminders',
  category: 'tools',
  description: 'Show your reminders in this chat',
  async run({ jid, myIds, reply, prefix }) {
    const mine = store.reminders().filter((r) => r.jid === jid && r.ids.some((i) => myIds.includes(i)));
    if (!mine.length) return reply(`⏰ You have no reminders here.\nAdd one: ${prefix}remind 10m call mom`);
    const lines = mine.sort((a, b) => a.at - b.at).map((r) => `#${r.id}  ${clock.stamp(r.at)}  ${r.text.replace(/\s+/g, ' ').slice(0, 50)}`);
    await reply(`⏰ *Your reminders* (${clock.zone()} time)\n\n${lines.join('\n')}\n\nRemove one: ${prefix}unremind <number>`);
  },
};

const store = require('../whatsapp/store');
const clock = require('../core/clock');
const repeat = require('../core/repeat');

module.exports = {
  name: 'schedules',
  category: 'tools',
  description: 'Show the scheduled messages and commands in this chat',
  async run({ jid, reply, prefix }) {
    const list = store.schedules().filter((s) => s.jid === jid);
    if (!list.length) return reply(`⏰ *Nothing scheduled here.*\nAdd one: \`${prefix}schedule 18:30 Dinner time!\`\nAll the options: \`${prefix}schedule\``);
    const lines = list.map((s) => `▸ *#${s.id}* – ${repeat.describe(s)}\n   ${s.cmd ? '⚙️ ' : ''}${s.text.replace(/\s+/g, ' ').slice(0, 50)}`);
    await reply(`⏰ *Scheduled* _(${clock.zone()} time)_\n\n${lines.join('\n')}\n\nRemove one: \`${prefix}unschedule <number>\``);
  },
};

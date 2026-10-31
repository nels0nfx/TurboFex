const store = require('../whatsapp/store');

module.exports = {
  name: 'unschedule',
  category: 'tools',
  description: 'Remove a scheduled message: unschedule 3',
  async run({ jid, args, reply, prefix, isGroup, isAdmin, isOwner }) {
    if (isGroup && !(isAdmin || isOwner)) return; // not allowed: stay silent
    const id = parseInt(args[0], 10);
    if (!Number.isInteger(id)) return reply(`Which one? See ${prefix}schedules for the numbers.\nExample: ${prefix}unschedule 3`);
    const item = store.schedules().find((s) => s.id === id && s.jid === jid);
    if (!item) return reply('ℹ️ I could not find that scheduled message in this chat.');
    store.removeSchedule(id);
    await reply(`✅ Removed scheduled message #${id}.`);
  },
};

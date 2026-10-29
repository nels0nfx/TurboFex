const store = require('../whatsapp/store');

module.exports = {
  name: 'unremind',
  category: 'tools',
  description: 'Remove one of your reminders: unremind 3',
  async run({ jid, args, myIds, reply, prefix }) {
    const id = parseInt(args[0], 10);
    if (!Number.isInteger(id)) return reply(`Which one? See ${prefix}reminders for the numbers.\nExample: ${prefix}unremind 3`);
    const item = store.reminders().find((r) => r.id === id && r.jid === jid && r.ids.some((i) => myIds.includes(i)));
    if (!item) return reply('ℹ️ I could not find that reminder of yours in this chat.');
    store.removeReminder(id);
    await reply(`✅ Removed reminder #${id}.`);
  },
};

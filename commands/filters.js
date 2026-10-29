const store = require('../whatsapp/store');
const { listText } = require('../whatsapp/filtercmd');

module.exports = {
  name: 'filters',
  category: 'autoreply',
  description: 'Show the auto-replies set up in this chat',
  async run({ jid, reply, isGroup }) {
    const own = listText(store.peekFilters(jid), isGroup ? 'Auto-replies in this group' : 'Auto-replies in this chat');
    const extra = [];
    const p = Object.keys(store.getPrivateFilters()).length;
    const g = Object.keys(store.getGlobalFilters()).length;
    if (!isGroup && p) extra.push(`📩 ${p} for all private chats (set by the owner)`);
    if (g) extra.push(`🌍 ${g} for every chat (set by the owner)`);
    await reply(own + (extra.length ? `\n\nAlso active:\n${extra.join('\n')}` : ''));
  },
};

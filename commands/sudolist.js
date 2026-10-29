const store = require('../whatsapp/store');

module.exports = {
  name: 'sudolist',
  category: 'owner',
  description: 'Show everyone with owner rights (owner only)',
  ownerOnly: true,
  async run({ reply, config }) {
    const list = store.getSudo();
    const main = config.ownerNumber ? `👑 Main owner: ${config.ownerNumber}\n\n` : '';
    await reply(`${main}🔑 *Extra owners* (${list.length})\n${list.length ? list.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None yet.'}`);
  },
};

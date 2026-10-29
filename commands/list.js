const { smallcaps: sc } = require('../core/fonts');
const { groupByCategory } = require('../whatsapp/categories');

module.exports = {
  name: 'list',
  category: 'general',
  description: 'List every command with a short description',
  async run({ reply, commandList, isOwner }) {
    const text = groupByCategory(commandList, isOwner)
      .map((s) => `┌─ *${s.meta.title}*\n${s.cmds.map((c) => `│ ${s.meta.symbol} ${sc(c.name)}\n│    _${c.description}_`).join('\n')}\n└──────`)
      .join('\n\n');
    await reply(text);
  },
};

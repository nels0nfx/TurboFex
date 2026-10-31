const brand = require('../core/brand');
const store = require('../whatsapp/store');
const { groupByCategory } = require('../whatsapp/categories');

// A short, friendly guide for people who have never used the bot. The long list of commands is in the menu command.
module.exports = {
  name: 'help',
  category: 'general',
  description: 'A quick guide: how to use the bot and find commands',
  async run({ reply, prefix, commandList, isOwner, isAdmin }) {
    const p = prefix || '';
    const sections = groupByCategory(commandList, isOwner);
    const total = sections.reduce((n, s) => n + s.cmds.length, 0);
    const lines = [
      `⚡ *Welcome to ${brand.botName}*`,
      'I help run WhatsApp groups, and I also have tools, games and fun commands.',
      '',
      '*How it works*',
      prefix ? `▸ Start a command with \`${p}\`, for example \`${p}ping\`.` : '▸ Just type the command name, for example `ping`.',
      `▸ \`${p}menu\` shows all ${total} commands you can use, by category.`,
      `▸ \`${p}menu group\` shows one category, with a short description of each command.`,
      `▸ \`${p}menu kick\` shows help for one command.`,
      `▸ \`${p}list\` shows every command with its description.`,
      '',
      '*If a command needs more from you*',
      '▸ Leave something out and I will tell you what is missing and show an example.',
      '▸ Some commands are only for group admins. If you are not allowed to use one, I stay quiet.',
      '',
      '*Good ones to try first*',
      `▸ \`${p}ping\` – is the bot online?`,
      `▸ \`${p}daily\` – your daily gift in the Empire of Fex (groups)`,
      `▸ \`${p}weather Lagos\` – the weather in a city`,
    ];
    if (isAdmin || isOwner) {
      lines.push('', '*For group admins*', `▸ Make me a group admin so I can remove people, delete messages and change group settings.`, `▸ Protections such as \`${p}antilink\`, \`${p}antispam\` and \`${p}welcome\` are off until you switch them on.`);
    }
    if (isOwner) {
      lines.push('', '*For the bot owner*', `▸ The bot is *${store.getMode() === 'private' ? 'PRIVATE' : 'PUBLIC'}* now. ${store.getMode() === 'private' ? `Only you can use commands. \`${p}mode public\` lets everybody use them.` : `Everybody can use commands. \`${p}mode private\` keeps them for you only.`}`, `▸ \`${p}status\` shows the health of the bot.`);
    }
    await reply(lines.join('\n'));
  },
};

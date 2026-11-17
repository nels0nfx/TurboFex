// ".again" is understood by the message handler (it swaps in the last command of this person in this chat).
// This file only gives it a name in the menu, and answers when there is nothing to repeat.
module.exports = {
  name: 'again',
  aliases: ['redo'],
  category: 'general',
  description: 'Run your last command again (works for about 10 minutes)',
  noAgain: true,
  async run({ reply }) {
    await reply('ℹ️ *Nothing to repeat yet.*\n▸ _Run a command first, then send_ `again`_._');
  },
};

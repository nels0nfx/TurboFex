// Switching the bot's identity needs a fresh link, and linking a new device has been unreliable since WhatsApp changed
// the process on 28 July 2026. Until that is certain on your server, this command refuses, so the bot cannot be locked out.
module.exports = {
  name: 'relink',
  category: 'owner',
  realOwnerOnly: true,
  noReact: true,
  description: 'Link the bot again with another identity (switched off for now: linking new devices is unreliable)',
  async run({ reply }) {
    return reply(
      '*Relink is switched off*\n' +
        'Since 28 July 2026 WhatsApp has made linking a new device unreliable, and this command logs the bot out first. ' +
        'If the new link failed, the bot would stay offline.\n\n' +
        '▸ Keep the bot linked as it is.\n' +
        '▸ View-once files can still be opened with *vv* (reply to the message).'
    );
  },
};

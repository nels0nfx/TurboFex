const fs = require('fs');
const path = require('path');
const { DATA } = require('../core/paths');

module.exports = {
  name: 'backup',
  category: 'owner',
  description: 'Send the bot\'s saved settings as a file to the owner (owner only)',
  ownerOnly: true,
  async run({ sock, jid, reply, isGroup, config }) {
    require('../whatsapp/store').saveNow();
    const file = path.join(DATA, 'groups.json');
    if (!fs.existsSync(file)) return reply('ℹ️ There is nothing to back up yet.');

    // never post the backup inside a group
    const to = isGroup ? (config.ownerNumber ? `${config.ownerNumber}@s.whatsapp.net` : null) : jid;
    if (!to) return reply('⚠️ Use this command in a private chat with the bot.');

    await sock.sendMessage(to, {
      document: fs.readFileSync(file),
      mimetype: 'application/json',
      fileName: 'turbofex-settings-backup.json',
    });
    if (isGroup) await reply('✅ Backup sent to your private chat.');
  },
};

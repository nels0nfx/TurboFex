const { resolveTarget } = require('../whatsapp/utils');

module.exports = {
  name: 'jid',
  category: 'tools',
  description: 'Show the WhatsApp ID of this chat, or of a tagged person',
  async run({ jid, msg, args, reply }) {
    const target = resolveTarget(msg, args);
    await reply(target ? `🆔 ${target}` : `🆔 ${jid}`);
  },
};

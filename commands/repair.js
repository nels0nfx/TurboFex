const config = require('../config');
const repair = require('../core/repair');
const { restartBot } = require('../core/restart');
const bootnote = require('../core/bootnote');

module.exports = {
  name: 'repair',
  category: 'owner',
  description: 'Fix "Bad MAC" decryption errors: clears old chat sessions and restarts (you stay logged in) (owner only)',
  ownerOnly: true,
  async run({ reply, jid }) {
    const n = repair.clearSessions(config.sessionDir);
    bootnote.write({ type: 'repair', chat: jid });
    await reply(`🛠️ Cleared ${n} old chat session files. Restarting now. You stay logged in.\n\nTip: make sure this WhatsApp number is linked to only ONE running bot. Two copies fight each other and cause "Bad MAC".`);
    restartBot();
  },
};

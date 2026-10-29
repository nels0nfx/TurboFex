module.exports = {
  name: 'ping',
  category: 'general',
  description: 'Check if the bot is online and how fast it answers',
  async run({ sock, jid, reply, timing }) {
    const start = Date.now();
    const sent = await reply('🏓 Pinging...');
    const sendMs = Date.now() - start; // how long WhatsApp took to take my reply (network + encryption)
    const ms = timing.thinkMs + sendMs; // from the command arriving to my reply being sent
    const text = `🏓 *Pong!*  ⚡ ${ms} ms\n_Bot:_ ${timing.thinkMs} ms  •  _WhatsApp:_ ${sendMs} ms`;
    try {
      await sock.sendMessage(jid, { text, edit: sent.key });
    } catch (err) {
      await reply(text);
    }
  },
};

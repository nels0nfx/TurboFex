module.exports = {
  name: 'ping',
  category: 'general',
  description: 'Check that the bot is online and how fast it answers',
  async run({ sock, jid, reply, timing }) {
    // response time = from the moment the bot got your message until its reply was accepted by WhatsApp.
    // (The detailed breakdown for the owner is in the status command, not here.)
    const start = Date.now();
    const sent = await reply('🏓 Checking...');
    const sendMs = Date.now() - start;
    const ms = timing.thinkMs + sendMs;
    console.log(`🏓 ping: ${ms} ms (bot ${timing.thinkMs} ms, WhatsApp took ${sendMs} ms to accept the reply)`); // detail for the owner: the console only
    const text = `🏓 *Pong!* I am online.\n⚡ Response time: *${ms} ms*`;
    try {
      await sock.sendMessage(jid, { text, edit: sent.key });
    } catch (err) {
      await reply(text);
    }
  },
};

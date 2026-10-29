module.exports = {
  name: 'poll',
  category: 'tools',
  description: 'Make a poll, e.g. poll Best day? | Friday | Saturday | Sunday',
  async run({ sock, jid, rest, reply, prefix }) {
    const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 13) {
      return reply(`Write the question and 2 to 12 options, split with |\nExample: ${prefix}poll Best day? | Friday | Saturday | Sunday`);
    }
    const [name, ...values] = parts;
    await sock.sendMessage(jid, { poll: { name, values, selectableCount: 1 } });
  },
};

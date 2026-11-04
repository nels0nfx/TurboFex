// choose = let the bot pick. spinwheel / wheel / spinthewheel are aliases (the same, but it spins first).
//   choose pizza | burger | sushi      -> picks at once
//   spinwheel pizza, burgers, sushi    -> spins the wheel, then shows the winner
// Both ways accept "|" or "," or a new line between the choices ("|" wins when it is used).
const MAX_ITEMS = 20;
const SPIN_WORDS = ['spinwheel', 'wheel', 'spinthewheel'];
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const pause = (ms) => (process.env.TURBOFEX_FAST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

module.exports = {
  name: 'choose',
  aliases: ['spinwheel', 'wheel', 'spinthewheel'],
  category: 'fun',
  description: 'Let the bot pick: choose pizza | burger | sushi (spinwheel pizza, burgers, sushi spins a wheel first)',
  async run({ sock, jid, msg, rest, reply, prefix, cmdName }) {
    const spin = SPIN_WORDS.includes(cmdName);
    // "|" wins when it is used (so a choice may contain a comma: Paris, France | Rome); otherwise commas split too
    const items = rest.split(rest.includes('|') ? /[|\n]+/ : /[,\n]+/).map((o) => o.trim()).filter(Boolean);
    if (items.length < 2) {
      return reply(`🎡 *Usage:* \`${prefix}${spin ? 'spinwheel' : 'choose'} pizza | burger | sushi\`\n_Give me at least two choices, split with | or a comma._`);
    }
    if (items.length > MAX_ITEMS) return reply(`⚠️ *I can pick from ${MAX_ITEMS} choices at most.*`);
    const winner = pickOne(items);

    if (!spin) return reply(`🤔 *I choose:* ${winner}`);

    // the wheel: one message that is edited a few times
    const first = await sock.sendMessage(jid, { text: '🎡 *Spinning...*' }, { quoted: msg });
    for (const frame of [pickOne(items), pickOne(items), pickOne(items)]) {
      await pause(700);
      try {
        await sock.sendMessage(jid, { text: `🎡 *Spinning...*\n➡️ ${frame}`, edit: first?.key });
      } catch (err) {
        break; // the message cannot be edited: only the result is sent
      }
    }
    await pause(700);
    try {
      return await sock.sendMessage(jid, { text: `🎡 *The wheel stopped!*\n\n🎉 *${winner}*`, edit: first?.key });
    } catch (err) {
      return reply(`🎡 *The wheel stopped!*\n\n🎉 *${winner}*`);
    }
  },
};

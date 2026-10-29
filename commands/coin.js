module.exports = {
  name: 'coin',
  category: 'fun',
  aliases: [],
  description: 'Flip a coin',
  async run({ reply }) {
    await reply(Math.random() < 0.5 ? '🪙 *Heads!*' : '🪙 *Tails!*');
  },
};

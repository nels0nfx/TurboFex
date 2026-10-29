module.exports = {
  name: 'choose',
  category: 'fun',
  description: 'Let the bot pick: choose pizza | burger | sushi',
  async run({ rest, reply, prefix }) {
    const options = rest.split('|').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) return reply(`Give me at least two options, split with |\nExample: ${prefix}choose pizza | burger | sushi`);
    await reply(`🤔 I choose: *${options[Math.floor(Math.random() * options.length)]}*`);
  },
};

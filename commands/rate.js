module.exports = {
  name: 'rate',
  category: 'fun',
  description: 'Rate anything out of 100: rate my cooking',
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`What should I rate?\nExample: ${prefix}rate my cooking`);
    await reply(`⭐ I rate *${rest.slice(0, 60)}* a solid *${Math.floor(Math.random() * 101)}/100*`);
  },
};

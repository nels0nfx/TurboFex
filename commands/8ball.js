const ANSWERS = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'You can count on it.', 'Most likely.',
  'Looks good.', 'Signs point to yes.', 'Yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'I cannot predict that right now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My answer is no.', 'My sources say no.', 'It does not look good.', 'Very doubtful.',
];

module.exports = {
  name: '8ball',
  category: 'fun',
  description: 'Ask the magic 8-ball a yes/no question',
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`Ask a question.\nExample: ${prefix}8ball Will it rain tomorrow?`);
    await reply(`🎱 ${ANSWERS[Math.floor(Math.random() * ANSWERS.length)]}`);
  },
};

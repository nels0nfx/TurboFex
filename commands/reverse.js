module.exports = {
  name: 'reverse',
  category: 'tools',
  description: 'Write text backwards: reverse hello',
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`Type some text.\nExample: ${prefix}reverse hello`);
    await reply([...rest.slice(0, 500)].reverse().join(''));
  },
};

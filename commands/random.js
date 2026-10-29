module.exports = {
  name: 'random',
  category: 'tools',
  aliases: ['rand'],
  description: 'Pick a random number: random 100, or random 5 20',
  async run({ args, reply, prefix }) {
    const nums = args.map((a) => parseInt(a, 10)).filter((n) => Number.isInteger(n));
    let [min, max] = nums.length >= 2 ? nums : [1, nums[0] || 100];
    if (min > max) [min, max] = [max, min];
    if (Math.abs(max) > 1e9 || Math.abs(min) > 1e9) return reply('⚠️ Please use numbers below 1,000,000,000.');
    await reply(`🎲 Between ${min} and ${max}: *${min + Math.floor(Math.random() * (max - min + 1))}*\n(${prefix}random 5 20 sets your own range)`);
  },
};

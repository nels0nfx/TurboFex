const crypto = require('crypto');

module.exports = {
  name: 'password',
  category: 'tools',
  aliases: ['pass'],
  description: 'Make a strong random password: password 20 (use it in a private chat)',
  async run({ args, reply, isGroup }) {
    if (isGroup) return reply('🔒 Please use this in a private chat with me, so nobody else sees your password.');
    const n = args[0] ? parseInt(args[0], 10) : 16;
    if (!Number.isInteger(n) || n < 8 || n > 64) return reply('Give a length from 8 to 64, e.g. password 20');
    const sets = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%^&*-_=+?'];
    const all = sets.join('');
    const chars = sets.map((s) => s[crypto.randomInt(s.length)]); // at least one of each kind
    while (chars.length < n) chars.push(all[crypto.randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    await reply(`🔐 Your new password:\n\n${chars.join('')}\n\nSave it somewhere safe, then delete this message.`);
  },
};

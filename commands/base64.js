module.exports = {
  name: 'base64',
  category: 'tools',
  aliases: ['b64'],
  description: 'Encode or decode text: base64 encode hello, base64 decode aGVsbG8=',
  async run({ args, rest, reply, prefix }) {
    const mode = (args[0] || '').toLowerCase();
    const text = rest.slice(args[0] ? args[0].length : 0).trim();
    if (!['encode', 'decode'].includes(mode) || !text) {
      return reply(`Use:\n${prefix}base64 encode hello\n${prefix}base64 decode aGVsbG8=`);
    }
    if (text.length > 2000) return reply('⚠️ Please keep it under 2000 characters.');
    if (mode === 'encode') return reply(`🔐 ${Buffer.from(text, 'utf8').toString('base64')}`);
    if (!/^[A-Za-z0-9+/=_-]+$/.test(text)) return reply('⚠️ That does not look like base64.');
    await reply(`🔓 ${Buffer.from(text, 'base64').toString('utf8')}`);
  },
};

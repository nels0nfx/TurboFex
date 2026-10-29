const crypto = require('crypto');

module.exports = {
  name: 'hash',
  category: 'tools',
  description: 'Show the MD5, SHA-1 and SHA-256 fingerprints of a text: hash hello',
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`Type some text.\nExample: ${prefix}hash hello`);
    const h = (alg) => crypto.createHash(alg).update(rest).digest('hex');
    await reply(`🔑 *Hashes*\nMD5: ${h('md5')}\nSHA-1: ${h('sha1')}\nSHA-256: ${h('sha256')}`);
  },
};

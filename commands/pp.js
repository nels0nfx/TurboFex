const { resolveTarget, num } = require('../whatsapp/utils');

module.exports = {
  name: 'pp',
  category: 'tools',
  description: 'Get someone\'s profile picture (tag them, reply, or type their number)',
  async run({ sock, jid, msg, args, reply }) {
    const target = resolveTarget(msg, args) || msg.key.participant || jid;
    try {
      const url = await sock.profilePictureUrl(target, 'image');
      await sock.sendMessage(jid, { image: { url }, caption: `🖼️ @${num(target)}`, mentions: [target] }, { quoted: msg });
    } catch (err) {
      await reply('⚠️ No picture found. They may not have one, or they hide it.');
    }
  },
};

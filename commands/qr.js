module.exports = {
  name: 'qr',
  category: 'tools',
  slow: true,
  description: 'Make a QR code: qr https://example.com',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`Type the text or link.\nExample: ${prefix}qr https://example.com`);
    if (rest.length > 500) return reply('⚠️ That is too long for a QR code (max 500 characters).');
    let QR;
    try {
      QR = require('qrcode');
    } catch (err) {
      return reply(isOwner ? '⚠️ QR codes need the "qrcode" package, which is not installed on this server yet. Restart the bot with npm install enabled.' : '⚠️ This feature is not available on this server right now.');
    }
    const buffer = await QR.toBuffer(rest, { type: 'png', margin: 2, scale: 8, errorCorrectionLevel: 'M' });
    await sock.sendMessage(jid, { image: buffer, caption: `🔳 QR code for:\n${rest.slice(0, 200)}` }, { quoted: msg });
  },
};

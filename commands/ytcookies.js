// Gives the downloader a cookies.txt so YouTube stops answering "confirm you are not a bot".
const fs = require('fs');
const path = require('path');
const media = require('../whatsapp/media');
const { DATA } = require('../core/paths');

const FILE = path.join(DATA, 'cookies.txt');

module.exports = {
  name: 'ytcookies',
  aliases: ['cookies'],
  category: 'owner',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'Give play a cookies.txt (send the file with this word as caption, or reply to it). ytcookies remove = delete it',
  async run({ sock, jid, msg, args, reply, prefix, botIds }) {
    if ((args[0] || '').toLowerCase() === 'remove') {
      fs.rmSync(FILE, { force: true });
      return reply('✅ Cookies removed.');
    }
    const found = media.findMedia(msg, jid, botIds);
    if (!found || found.kind !== 'document') {
      return reply(
        `🍪 *Cookies for play:* ${fs.existsSync(FILE) ? 'saved ✅' : 'none'}\n\n` +
          `YouTube often blocks servers ("confirm you are not a bot"). With a cookies file from a browser where you are logged in to YouTube it works again.\n\n` +
          `1. In a browser, use an extension that exports cookies.txt while on youtube.com (use a spare Google account, not your main one).\n` +
          `2. Send the file here with *${prefix}ytcookies* as the caption, or reply to the file with *${prefix}ytcookies*.\n\n${prefix}ytcookies remove - delete it`
      );
    }
    let buffer;
    try {
      buffer = await media.download(sock, found.source);
    } catch (err) {
      return reply('⚠️ I could not read that file. Send it again.');
    }
    const text = buffer.toString('utf8');
    if (!/youtube\.com|google\.com/i.test(text) || !text.includes('\t')) return reply('⚠️ That does not look like a cookies.txt file (Netscape format) for YouTube.');
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, text);
    return reply('✅ Cookies saved. Try *play* again. If YouTube blocks it again later, export a fresh file.');
  },
};

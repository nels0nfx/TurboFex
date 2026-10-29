// Changes the pack name and author of a sticker (reply to it).
const media = require('../whatsapp/media');
const store = require('../whatsapp/store');
const brand = require('../core/brand');
const { addExif } = require('../core/webpexif');

module.exports = {
  name: 'take',
  aliases: ['steal'],
  category: 'media',
  needs: [],
  weight: 'light',
  stickerCredit: false, // this command sets the credit itself
  description: 'Put your own pack name and author on a sticker: reply to it with take My Pack | My Name',
  async run({ sock, jid, msg, rest, reply, prefix, botIds }) {
    const found = media.findMedia(msg, jid, botIds);
    if (!found || found.kind !== 'sticker') return reply(`Reply to a sticker with *${prefix}take My Pack | My Name*.\n_Without a name, your own WhatsApp name is used._`);
    const [packArg, authorArg] = rest.split('|').map((x) => x.trim());
    const cfg = store.stickerCfg();
    const pack = (packArg || cfg.pack || brand.botName).slice(0, 40);
    const author = (authorArg || msg.pushName || cfg.author || brand.creator).slice(0, 40);
    let buffer;
    try {
      buffer = await media.download(sock, found.source);
    } catch (err) {
      return reply('⚠️ I could not read that sticker. Send it again and reply to it.');
    }
    const out = addExif(buffer, { pack, author });
    await sock.sendMessage(jid, { sticker: out }, { quoted: msg });
    return undefined;
  },
};

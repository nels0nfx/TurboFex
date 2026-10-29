const store = require('../whatsapp/store');
const brand = require('../core/brand');

module.exports = {
  name: 'stickerpack',
  aliases: ['stickername'],
  category: 'owner',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'Pack name and author shown inside the stickers the bot makes: stickerpack My Pack | My Name',
  async run({ rest, args, reply, prefix }) {
    const cfg = store.stickerCfg();
    const a = (args[0] || '').toLowerCase();
    if (a === 'off' || a === 'on') {
      store.updateSticker((s) => {
        s.on = a === 'on';
      });
      return reply(`✅ Sticker credit is now *${a.toUpperCase()}*.`);
    }
    if (a === 'reset') {
      store.updateSticker((s) => {
        s.pack = null;
        s.author = null;
      });
      return reply(`✅ Back to the default: *${brand.botName}* by *${brand.creator}*.`);
    }
    if (rest) {
      const [pack, author] = rest.split('|').map((x) => x.trim());
      if (!pack || pack.length > 40 || (author || '').length > 40) return reply(`⚠️ Write it like this: ${prefix}stickerpack My Pack | My Name (up to 40 characters each).`);
      store.updateSticker((s) => {
        s.pack = pack;
        s.author = author || brand.creator;
      });
      return reply(`✅ New stickers will show *${pack}* by *${author || brand.creator}*.`);
    }
    return reply(
      `*Sticker credit:* ${cfg.on ? 'ON' : 'OFF'}\n▸ *Pack:* ${cfg.pack || brand.botName}\n▸ *Author:* ${cfg.author || brand.creator}\n\n` +
        `▸ \`${prefix}stickerpack My Pack | My Name\`\n▸ \`${prefix}stickerpack reset\`\n▸ \`${prefix}stickerpack off\`\n_Applies to stickers made from now on._`
    );
  },
};

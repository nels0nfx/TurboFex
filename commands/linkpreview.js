const store = require('../whatsapp/store');
const linkpreview = require('../core/linkpreview');

module.exports = {
  name: 'linkpreview',
  aliases: ['preview'],
  category: 'owner',
  ownerOnly: true,
  noReact: true,
  needs: [],
  weight: 'light',
  description: 'Link previews under messages that contain a link: linkpreview on / off / test <link>',
  async run({ sock, args, reply, prefix }) {
    const a = (args[0] || '').toLowerCase();
    if (a === 'on' || a === 'off') {
      store.setLinkPreview(a === 'on');
      return reply(`✅ Link previews are now *${a.toUpperCase()}*.`);
    }
    if (a === 'test') {
      if (!args[1]) return reply(`Give a link to test.\nExample: ${prefix}linkpreview test https://github.com`);
      linkpreview.cache.clear();
      const t = Date.now();
      const info = await linkpreview.getUrlInfo(args[1], {}, sock.waUploadToServer);
      if (!info) return reply('⚠️ No preview could be made for that link (the page has no title, is not public, or took too long).');
      return reply(`*Preview works* (${Date.now() - t} ms)\n▸ *Title:* ${info.title}\n▸ *Description:* ${info.description || '-'}\n▸ *Picture:* ${info.jpegThumbnail ? `${Math.round(info.jpegThumbnail.length / 1024)} KB` : 'none'}\n▸ *Full card:* ${info.highQualityThumbnail ? 'yes (big picture sent)' : 'no (small card)'}`);
    }
    return reply(`*Link previews:* ${store.getLinkPreview() ? 'ON' : 'OFF'}\n▸ \`${prefix}linkpreview off\` / \`${prefix}linkpreview on\`\n▸ \`${prefix}linkpreview test <link>\`\n_The card with a picture and title is added under a message when it contains a link._`);
  },
};

const store = require('../whatsapp/store');
const brand = require('../core/brand');
const watermark = require('../whatsapp/watermark');

module.exports = {
  name: 'watermark',
  aliases: ['wm'],
  category: 'owner',
  ownerOnly: true,
  noReact: false,
  description: 'Line added under the result of some commands once they worked: watermark on / off / text <your text> / reset',
  async run({ rest, args, reply, prefix }) {
    const cfg = store.watermarkCfg();
    const c = (args[0] || '').toLowerCase();

    if (c === 'on' || c === 'off') {
      store.updateWatermark((w) => {
        w.on = c === 'on';
      });
      return reply(`✅ Watermark is now *${c.toUpperCase()}*.`);
    }
    if (c === 'text') {
      const t = rest.slice(4).trim();
      if (!t) return reply(`Write the text after the word text.\nExample: ${prefix}watermark text 🔥 Made by My Bot`);
      if (t.length > 120) return reply('⚠️ Keep the watermark under 120 characters.');
      store.updateWatermark((w) => {
        w.text = t;
      });
      return reply(`✅ Watermark text saved:\n${t}`);
    }
    if (c === 'reset') {
      store.updateWatermark((w) => {
        w.text = null;
      });
      return reply(`✅ Watermark text is back to the default:\n${brand.watermark.text}`);
    }
    return reply(
      `🏷️ *Watermark:* ${cfg.on ? 'ON' : 'OFF'}\n${watermark.text()}\n\n` +
        `It is added under the result of media, audio, video and editor commands (and ${brand.watermark.commands.join(', ')}) when they worked.\n\n` +
        `${prefix}watermark on / off\n${prefix}watermark text <your text>\n${prefix}watermark reset`
    );
  },
};

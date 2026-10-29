// Picture effects: reply to a picture with the effect name
const media = require('../whatsapp/media');

const EFFECTS = [
  { name: 'blur', description: 'Blur a picture (blur 5 = a bit, blur 20 = a lot)', apply: (img, args) => img.blur(Math.min(60, Math.max(1, parseFloat(args[0]) || 8))) },
  { name: 'grey', description: 'Turn a picture black and white', apply: (img) => img.greyscale() },
  { name: 'invert', description: 'Invert the colours (negative)', apply: (img) => img.negate() },
  { name: 'sepia', description: 'Old-photo brown tone', apply: (img) => img.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]) },
  { name: 'mirror', description: 'Flip a picture left to right', apply: (img) => img.flop() },
  { name: 'flip', description: 'Turn a picture upside down (top to bottom)', apply: (img) => img.flip() },
  { name: 'sharpen', description: 'Make a picture crisper', apply: (img) => img.sharpen({ sigma: 2 }) },
  { name: 'brighten', description: 'Make a picture brighter', apply: (img) => img.modulate({ brightness: 1.3 }) },
  { name: 'contrast', description: 'Make colours stronger', apply: (img) => img.linear(1.3, -30) },
  {
    name: 'pixelate',
    description: 'Pixelate a picture (pixelate 10 = big blocks)',
    async apply(img, args, sharp, buffer) {
      const meta = await sharp(buffer).metadata();
      const n = Math.min(60, Math.max(4, parseInt(args[0], 10) || 16));
      const small = await sharp(buffer).rotate().resize({ width: Math.max(8, Math.round(meta.width / n)) }).toBuffer();
      return sharp(small).resize(meta.width, meta.height, { kernel: 'nearest', fit: 'fill' });
    },
  },
];

module.exports = EFFECTS.map((e) => ({
  name: e.name,
  category: 'editor',
  slow: true,
  description: `${e.description}: reply to a picture with ${e.name}`,
  async run(ctx) {
    await media.handle(ctx, ['image'], `Reply to a picture with ${ctx.prefix}${e.name}`, async (found, buffer) => {
      const sharp = media.loadSharp();
      const base = sharp(buffer).rotate(); // respects the way the phone held the camera
      const edited = await e.apply(base, ctx.args, sharp, buffer);
      const out = await edited.jpeg({ quality: 90 }).toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { image: out, caption: `🎨 ${e.name}` }, { quoted: ctx.msg });
    });
  },
}));

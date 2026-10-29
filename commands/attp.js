// Turns text into a sticker (a picture of the text on a transparent background).
const media = require('../whatsapp/media');

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55'];
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// splits the text into lines of about `width` characters
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function svg(text) {
  const width = text.length <= 12 ? 8 : text.length <= 40 ? 11 : 15;
  const lines = wrap(text, width).slice(0, 8);
  const size = Math.max(40, Math.min(150, Math.floor(480 / Math.max(lines.length, 3.2)), Math.floor(470 / (width * 0.62))));
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const startY = 256 - ((lines.length - 1) * size * 1.1) / 2 + size * 0.35;
  const tspans = lines.map((l, i) => `<text x="256" y="${startY + i * size * 1.1}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${size}" fill="${color}" stroke="#ffffff" stroke-width="${Math.max(3, size / 14)}" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${tspans}</svg>`;
}

module.exports = {
  name: 'attp',
  aliases: ['textsticker'],
  category: 'media',
  slow: true,
  weight: 'medium',
  needs: ['sharp'],
  description: 'Turn text into a sticker: attp hello world',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`Write the text after the command.\nExample: ${prefix}attp good morning`);
    if (rest.length > 120) return reply('⚠️ Keep the text under 120 characters.');
    let sharp;
    try {
      sharp = media.loadSharp();
    } catch (err) {
      return reply(isOwner ? '⚠️ This needs the "sharp" package, which is not installed on this server.' : media.NOT_HERE);
    }
    const webp = await sharp(Buffer.from(svg(rest))).webp({ quality: 90 }).toBuffer();
    await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
    return undefined;
  },
};
module.exports.svg = svg;

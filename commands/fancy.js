// Turns normal text into stylish unicode fonts
const range = (upper, lower, digit) => (text) =>
  [...text]
    .map((ch) => {
      const c = ch.codePointAt(0);
      if (upper != null && c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
      if (lower != null && c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
      if (digit != null && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
      return ch;
    })
    .join('');

const SMALL_CAPS = { a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ' };

const STYLES = [
  ['Bold', range(0x1d400, 0x1d41a, 0x1d7ce)],
  ['Italic', (t) => range(0x1d434, 0x1d44e)(t).replace(/h/g, 'ℎ')],
  ['Bold italic', range(0x1d468, 0x1d482, 0x1d7ce)],
  ['Script', range(0x1d4d0, 0x1d4ea)],
  ['Gothic', range(0x1d56c, 0x1d586)],
  ['Monospace', range(0x1d670, 0x1d68a, 0x1d7f6)],
  ['Sans bold', range(0x1d5d4, 0x1d5ee, 0x1d7ec)],
  ['Sans italic', range(0x1d608, 0x1d622)],
  [
    'Bubble',
    (t) => [...t].map((ch) => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x24b6 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x24d0 + c - 97);
      if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49);
      if (c === 48) return '⓪';
      return ch;
    }).join(''),
  ],
  [
    'Wide',
    (t) => [...t].map((ch) => {
      const c = ch.codePointAt(0);
      if (c === 32) return '\u3000';
      return c >= 33 && c <= 126 ? String.fromCodePoint(c + 0xfee0) : ch;
    }).join(''),
  ],
  ['Small caps', (t) => [...t.toLowerCase()].map((ch) => SMALL_CAPS[ch] || ch).join('')],
  ['Strike', (t) => [...t].map((ch) => (ch === ' ' ? ch : ch + '\u0336')).join('')],
  ['Underline', (t) => [...t].map((ch) => (ch === ' ' ? ch : ch + '\u0332')).join('')],
];

module.exports = {
  name: 'fancy',
  category: 'tools',
  description: 'Turn text into stylish fonts: fancy TurboFex',
  async run({ rest, reply, prefix }) {
    if (!rest) return reply(`Type some text.\nExample: ${prefix}fancy TurboFex`);
    if (rest.length > 60) return reply('⚠️ Please keep it under 60 characters.');
    const lines = STYLES.map(([name, fn], i) => `${i + 1}. ${fn(rest)}`);
    await reply(`✨ *Fancy text*\n\n${lines.join('\n')}\n\nTap and hold a line to copy it.`);
  },
};

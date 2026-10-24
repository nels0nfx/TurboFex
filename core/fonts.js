// Text styles for the menu and messages. WhatsApp shows these special letters on every phone.
const SMALL_CAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

function mapRange(text, upperStart, lowerStart, digitStart) {
  let out = '';
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(upperStart + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(lowerStart + (c - 97));
    else if (digitStart && c >= 48 && c <= 57) out += String.fromCodePoint(digitStart + (c - 48));
    else out += ch;
  }
  return out;
}

const smallcaps = (text) => [...String(text)].map((ch) => SMALL_CAPS[ch.toLowerCase()] || ch).join('');
const bold = (text) => mapRange(text, 0x1d5d4, 0x1d5ee, 0x1d7ec);
const mono = (text) => mapRange(text, 0x1d670, 0x1d68a, 0x1d7f6);

module.exports = { smallcaps, bold, mono };

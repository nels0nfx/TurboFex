// More tools (v0.9.3): timer, uuid, wordcount, upper, lower, leet, zalgo, ascii, roman, color, tip, percent, discount, timestamp
// None of these need the internet.
const crypto = require('crypto');
const store = require('../whatsapp/store');
const clock = require('../core/clock');
const { parseWhen } = require('../core/when');
const { getQuoted, quotedText } = require('../whatsapp/utils');

const base = { category: 'tools', needs: [], weight: 'light' };
const MAX_TIMERS_PER_CHAT = 20;

// the text to work on: what was typed after the command, or the message that was replied to
const textOf = ({ rest, msg }) => rest || quotedText(getQuoted(msg)) || '';
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "1,250" "12.5%" "$40" -> number (or NaN)
const toNum = (s) => Number(String(s).replace(/[,%$€£₦\s]/g, ''));
const trim = (n) => String(Number(n.toFixed(4)));

// ---------------------------------------------------------------- ascii art (a 3 x 5 block font)
// Each letter is 3 columns wide and 5 rows tall: # is a filled block, . is empty
const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'], '!': ['.#.', '.#.', '.#.', '...', '.#.'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '.': ['...', '...', '...', '...', '.#.'], '-': ['...', '...', '###', '...', '...'],
};
const PER_LINE = 8; // letters per line so it fits on a phone screen

function asciiArt(text) {
  const chars = [...String(text).toUpperCase()].filter((c) => FONT[c]);
  const blocks = [];
  for (let i = 0; i < chars.length; i += PER_LINE) {
    const part = chars.slice(i, i + PER_LINE);
    const rows = [0, 1, 2, 3, 4].map((r) => part.map((c) => FONT[c][r].replace(/#/g, '█').replace(/\./g, ' ')).join(' ').replace(/\s+$/, ''));
    blocks.push(rows.join('\n'));
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------- roman numerals
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function toRoman(n) {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}
function fromRoman(s) {
  if (!/^[MDCLXVI]+$/.test(s)) return null;
  let n = 0;
  let rest = s;
  for (const [v, sym] of ROMAN) while (rest.startsWith(sym)) { n += v; rest = rest.slice(sym.length); }
  return !rest && toRoman(n) === s ? n : null; // only proper numerals count (IIII is not accepted)
}

// ---------------------------------------------------------------- colours
const NAMED = { red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080', pink: 'ffc0cb', black: '000000', white: 'ffffff', grey: '808080', gray: '808080', brown: 'a52a2a', cyan: '00ffff', magenta: 'ff00ff', gold: 'ffd700', navy: '000080', teal: '008080', lime: '00ff00' };
function parseColor(text) {
  let t = String(text || '').trim().toLowerCase().replace(/^#/, '');
  if (NAMED[t]) t = NAMED[t];
  if (/^[0-9a-f]{3}$/.test(t)) t = t.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(t)) return null;
  return { hex: t, r: parseInt(t.slice(0, 2), 16), g: parseInt(t.slice(2, 4), 16), b: parseInt(t.slice(4, 6), 16) };
}
function toHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return `${h}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

// ---------------------------------------------------------------- time zones for .timestamp
function offsetAt(zone, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// "2026-12-25 10:00" written in the bot's time zone -> ms since 1970 (or null)
function localToEpoch(text, zone) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(guess).getUTCMonth() !== mo - 1) return null; // 31 February and the like
  let t = guess - offsetAt(zone, guess);
  t = guess - offsetAt(zone, t); // second pass: right around a clock change
  return t;
}
const fmtLocal = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: clock.zone(), dateStyle: 'full', timeStyle: 'medium' }).format(new Date(ms));

module.exports = [
  {
    ...base,
    name: 'timer',
    aliases: ['countdowntimer', 'settimer'],
    description: 'Start a timer and I tag you when it ends: timer 10m (or timer 25m study)',
    async run({ jid, args, myIds, myJid, reply, prefix }) {
      const at = parseWhen(args[0]);
      if (!at) return reply(`Say how long.\n${prefix}timer 10m\n${prefix}timer 1h30m pizza\n\nShortest: 30 seconds. Longest: 30 days.`);
      if (store.reminders().filter((r) => r.jid === jid).length >= MAX_TIMERS_PER_CHAT) return reply(`⚠️ This chat already has ${MAX_TIMERS_PER_CHAT} timers and reminders. Remove one with ${prefix}unremind <number>`);
      const label = args.slice(1).join(' ').trim().slice(0, 200);
      const item = store.addReminder({ jid, who: myJid, ids: myIds, at, text: label ? `Your timer is up: ${label}` : 'Your timer is up!' });
      return reply(`⏱️ *Timer set for ${clock.duration(at - Date.now())}.* I will tag you at ${clock.stamp(at)}.\nCancel it with ${prefix}unremind ${item.id}`);
    },
  },
  {
    ...base,
    name: 'uuid',
    aliases: ['guid'],
    description: 'Make random unique IDs: uuid or uuid 5',
    async run({ args, reply }) {
      const n = Math.min(10, Math.max(1, parseInt(args[0], 10) || 1));
      return reply(`🆔 *UUID${n > 1 ? 's' : ''}*\n\n${Array.from({ length: n }, () => `\`\`\`${crypto.randomUUID()}\`\`\``).join('\n')}`);
    },
  },
  {
    ...base,
    name: 'wordcount',
    aliases: ['wc', 'count'],
    description: 'Count words and letters: wordcount your text (or reply to a message)',
    async run(ctx) {
      const t = textOf(ctx);
      if (!t.trim()) return ctx.reply(`Write some text, or reply to a message.\nExample: ${ctx.prefix}wordcount The quick brown fox`);
      const words = t.trim().split(/\s+/).filter(Boolean);
      const sentences = (t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).filter((s) => s.trim()).length;
      const mins = words.length / 200;
      const longest = words.reduce((a, w) => (w.replace(/\W/g, '').length > a.length ? w.replace(/\W/g, '') : a), '');
      return ctx.reply(
        `🔢 *Word count*\n\n📝 *Words:* ${words.length}\n🔤 *Letters and symbols:* ${[...t].length}\n🔡 *Without spaces:* ${[...t.replace(/\s/g, '')].length}\n📄 *Sentences:* ${sentences}\n` +
          `📏 *Longest word:* ${longest || '-'}\n⏳ *Reading time:* ${mins < 1 ? 'under a minute' : `about ${Math.round(mins)} min`}`
      );
    },
  },
  {
    ...base,
    name: 'upper',
    aliases: ['uppercase', 'caps'],
    description: 'MAKE TEXT CAPITAL LETTERS: upper hello (or reply to a message)',
    async run(ctx) {
      const t = textOf(ctx);
      if (!t.trim()) return ctx.reply(`Write some text, or reply to a message.\nExample: ${ctx.prefix}upper hello world`);
      return ctx.reply(t.toUpperCase().slice(0, 3000));
    },
  },
  {
    ...base,
    name: 'lower',
    aliases: ['lowercase', 'small'],
    description: 'make text small letters: lower HELLO (or reply to a message)',
    async run(ctx) {
      const t = textOf(ctx);
      if (!t.trim()) return ctx.reply(`Write some text, or reply to a message.\nExample: ${ctx.prefix}lower HELLO WORLD`);
      return ctx.reply(t.toLowerCase().slice(0, 3000));
    },
  },
  {
    ...base,
    name: 'leet',
    aliases: ['1337', 'hacker'],
    description: 'Write in leet speak: leet hello world',
    async run(ctx) {
      const t = textOf(ctx);
      if (!t.trim()) return ctx.reply(`Write some text, or reply to a message.\nExample: ${ctx.prefix}leet hello world`);
      const map = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', g: '9', b: '8' };
      return ctx.reply([...t.slice(0, 1000)].map((c) => map[c.toLowerCase()] || c).join(''));
    },
  },
  {
    ...base,
    name: 'zalgo',
    aliases: ['glitch', 'creepy'],
    description: 'Make creepy glitchy text: zalgo hello',
    async run(ctx) {
      const t = textOf(ctx).slice(0, 100);
      if (!t.trim()) return ctx.reply(`Write some text, or reply to a message.\nExample: ${ctx.prefix}zalgo hello`);
      const marks = Array.from({ length: 112 }, (_, i) => String.fromCharCode(0x300 + i));
      const out = [...t].map((c) => (/\s/.test(c) ? c : c + Array.from({ length: 1 + crypto.randomInt(0, 4) }, () => marks[crypto.randomInt(0, marks.length)]).join(''))).join('');
      return ctx.reply(out);
    },
  },
  {
    ...base,
    name: 'ascii',
    aliases: ['bigtext', 'asciiart'],
    description: 'Write big block letters: ascii hello (up to 24 letters)',
    async run(ctx) {
      const t = textOf(ctx).slice(0, 24);
      if (!t.trim()) return ctx.reply(`Write a short word.\nExample: ${ctx.prefix}ascii hello\n_Letters, numbers, space and ! ? . - work._`);
      const art = asciiArt(t);
      if (!art.trim()) return ctx.reply('⚠️ I can only draw letters, numbers, space and ! ? . -');
      return ctx.reply(`\`\`\`\n${art}\n\`\`\``);
    },
  },
  {
    ...base,
    name: 'roman',
    aliases: ['romannumeral'],
    description: 'Roman numerals both ways: roman 2026 or roman MMXXVI',
    async run({ args, reply, prefix }) {
      const a = (args[0] || '').trim();
      if (/^\d+$/.test(a)) {
        const n = parseInt(a, 10);
        if (n < 1 || n > 3999) return reply('⚠️ Roman numerals only go from 1 to 3999.');
        return reply(`🏛️ *${n}* = *${toRoman(n)}*`);
      }
      const n = a ? fromRoman(a.toUpperCase()) : null;
      if (n) return reply(`🏛️ *${a.toUpperCase()}* = *${n}*`);
      return reply(`Write a number from 1 to 3999, or a roman numeral.\nExample: ${prefix}roman 2026\nExample: ${prefix}roman MMXXVI`);
    },
  },
  {
    ...base,
    name: 'color',
    aliases: ['colour', 'hex'],
    description: 'Show a colour and its codes: color #ff5733 (or a name like red)',
    async run({ sock, jid, msg, args, reply, prefix }) {
      const c = parseColor(args[0]);
      if (!c) return reply(`Write a colour code or a basic colour name.\nExample: ${prefix}color #ff5733\nExample: ${prefix}color teal`);
      const text = `🎨 *#${c.hex.toUpperCase()}*\n\n▸ *RGB:* ${c.r}, ${c.g}, ${c.b}\n▸ *HSL:* ${toHsl(c)}`;
      try {
        const sharp = require('sharp');
        const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: c.r, g: c.g, b: c.b } } }).png().toBuffer();
        return await sock.sendMessage(jid, { image: png, caption: text }, { quoted: msg });
      } catch (err) {
        return reply(text); // no picture tool on this host: the codes are still useful
      }
    },
  },
  {
    ...base,
    name: 'tip',
    aliases: ['tipcalc'],
    description: 'Work out a tip and split the bill: tip 50 15 3 (bill, percent, people)',
    async run({ args, reply, prefix }) {
      const bill = toNum(args[0]);
      const pct = args[1] === undefined ? 15 : toNum(args[1]);
      const people = args[2] === undefined ? 1 : Math.floor(toNum(args[2]));
      if (!(bill > 0) || !(pct >= 0 && pct <= 100) || !(people >= 1 && people <= 100)) {
        return reply(`Write the bill, then the tip percent and the number of people if you like.\nExample: ${prefix}tip 50 15 3\n(bill 50, tip 15%, 3 people. The default tip is 15%.)`);
      }
      const tip = (bill * pct) / 100;
      const total = bill + tip;
      return reply(`🧾 *Tip calculator*\n\n▸ *Bill:* ${money(bill)}\n▸ *Tip (${trim(pct)}%):* ${money(tip)}\n▸ *Total:* ${money(total)}${people > 1 ? `\n\n👥 *Each of ${people}:* ${money(total / people)}` : ''}`);
    },
  },
  {
    ...base,
    name: 'percent',
    aliases: ['percentage', 'pct'],
    description: 'Percentages: percent 20 of 150 | percent 30 in 120 | percent 80 to 100',
    async run({ args, reply, prefix }) {
      const [a, word, b] = [toNum(args[0]), String(args[1] || '').toLowerCase(), toNum(args[2])];
      if (Number.isNaN(a) || Number.isNaN(b) || !['of', 'in', 'to'].includes(word)) {
        return reply(`*Percentages*\n▸ ${prefix}percent 20 of 150   (20% of 150)\n▸ ${prefix}percent 30 in 120   (30 is what % of 120)\n▸ ${prefix}percent 80 to 100   (the change from 80 to 100)`);
      }
      if (word === 'of') return reply(`🧮 *${trim(a)}%* of ${trim(b)} = *${trim((a * b) / 100)}*`);
      if (word === 'in') {
        if (b === 0) return reply('⚠️ I cannot divide by zero.');
        return reply(`🧮 ${trim(a)} is *${trim((a / b) * 100)}%* of ${trim(b)}`);
      }
      if (a === 0) return reply('⚠️ I cannot work out a change that starts from zero.');
      const ch = ((b - a) / Math.abs(a)) * 100;
      return reply(`🧮 From ${trim(a)} to ${trim(b)} is ${ch >= 0 ? '📈 an increase' : '📉 a decrease'} of *${trim(Math.abs(ch))}%*`);
    },
  },
  {
    ...base,
    name: 'discount',
    aliases: ['sale', 'saleprice'],
    description: 'Price after a discount: discount 200 25 (price, percent off)',
    async run({ args, reply, prefix }) {
      const price = toNum(args[0]);
      const pct = toNum(args[1]);
      if (!(price >= 0) || !(pct >= 0 && pct <= 100)) return reply(`Write the price and the percent off.\nExample: ${prefix}discount 200 25   (200 with 25% off)`);
      const saved = (price * pct) / 100;
      return reply(`🏷️ *Discount*\n\n▸ *Price:* ${money(price)}\n▸ *Off (${trim(pct)}%):* -${money(saved)}\n▸ *You pay:* *${money(price - saved)}*`);
    },
  },
  {
    ...base,
    name: 'timestamp',
    aliases: ['unixtime', 'epoch'],
    description: 'Unix time: timestamp (now), timestamp 1767225600, or timestamp 2026-12-25 10:00',
    async run({ rest, reply, prefix }) {
      const zone = clock.zone();
      let ms = Date.now();
      const t = rest.trim();
      if (t) {
        if (/^\d{9,13}$/.test(t)) ms = t.length > 11 ? Number(t) : Number(t) * 1000;
        else {
          const e = localToEpoch(t, zone);
          if (e === null) return reply(`Write a Unix number or a date.\nExample: ${prefix}timestamp 1767225600\nExample: ${prefix}timestamp 2026-12-25 10:00   (${zone} time)`);
          ms = e;
        }
      }
      if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return reply('⚠️ That number is too big to be a date.');
      return reply(`🕒 *Timestamp*\n\n▸ *Unix (seconds):* ${Math.floor(ms / 1000)}\n▸ *Unix (milliseconds):* ${ms}\n▸ *UTC:* ${new Date(ms).toISOString()}\n▸ *${zone}:* ${fmtLocal(ms)}`);
    },
  },
];

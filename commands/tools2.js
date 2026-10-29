// More tools: crypto, prayer, verse, urban, timein, morse, binary, bmi, split, readqr
const web = require('../core/web');
const media = require('../whatsapp/media');
const clock = require('../core/clock');

const base = { needs: [], weight: 'light' };
const down = (what) => `⚠️ *${what} is not answering right now.* Please try again later.`;

const COINS = { btc: 'bitcoin', eth: 'ethereum', bnb: 'binancecoin', sol: 'solana', xrp: 'ripple', doge: 'dogecoin', ada: 'cardano', usdt: 'tether', ltc: 'litecoin', trx: 'tron', dot: 'polkadot', matic: 'matic-network', shib: 'shiba-inu', ton: 'the-open-network', avax: 'avalanche-2', link: 'chainlink' };
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 });

module.exports = [
  {
    ...base,
    name: 'crypto',
    aliases: ['price'],
    category: 'lookup',
    description: 'Live price of a coin: crypto btc',
    async run({ args, reply, prefix }) {
      const q = (args[0] || '').toLowerCase();
      if (!q) return reply(`*Usage:* \`${prefix}crypto btc\`\n*Some coins:* ${Object.keys(COINS).join(', ')}`);
      const id = COINS[q] || q;
      try {
        const j = await web.getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd,ngn,eur&include_24hr_change=true`, { timeout: 10000 });
        const c = j[id];
        if (!c) return reply(`🔎 *I do not know the coin "${q.slice(0, 20)}".* Try its full name, for example \`${prefix}crypto bitcoin\`.`);
        const ch = c.usd_24h_change;
        await reply(`🪙 *${id[0].toUpperCase()}${id.slice(1)}*\n*USD:* $${money(c.usd)}\n*EUR:* €${money(c.eur)}\n*NGN:* ₦${money(c.ngn)}\n*24 hours:* ${ch >= 0 ? '📈 +' : '📉 '}${ch.toFixed(2)}%`);
      } catch (err) {
        await reply(down('The price service'));
      }
    },
  },
  {
    ...base,
    name: 'prayer',
    aliases: ['salah', 'prayertimes'],
    category: 'lookup',
    description: 'Prayer times for a city: prayer Lagos, Nigeria',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}prayer <city>\`\n*Example:* \`${prefix}prayer Lagos, Nigeria\``);
      try {
        const j = await web.getJson(`https://api.aladhan.com/v1/timingsByAddress?address=${encodeURIComponent(rest.slice(0, 80))}&method=2`, { timeout: 10000 });
        const t = j?.data?.timings;
        if (!t) throw new Error('no timings');
        await reply(`🕌 *Prayer times – ${rest.slice(0, 40)}*\n_${j.data.date?.readable || 'today'}_\n\n*Fajr:* ${t.Fajr}\n*Sunrise:* ${t.Sunrise}\n*Dhuhr:* ${t.Dhuhr}\n*Asr:* ${t.Asr}\n*Maghrib:* ${t.Maghrib}\n*Isha:* ${t.Isha}\n\n_Time zone: ${j.data.meta?.timezone || '-'}_`);
      } catch (err) {
        await reply(`🔎 *I could not find prayer times for "${rest.slice(0, 40)}".* Try the city and the country.`);
      }
    },
  },
  {
    ...base,
    name: 'verse',
    aliases: ['bible'],
    category: 'lookup',
    description: 'A Bible verse: verse (random) or verse john 3:16',
    async run({ rest, reply }) {
      try {
        const j = await web.getJson(rest ? `https://bible-api.com/${encodeURIComponent(rest.slice(0, 60))}` : 'https://bible-api.com/?random=verse', { timeout: 10000 });
        if (!j.text) return reply(`🔎 *I could not find "${rest.slice(0, 40)}".* Example: \`verse john 3:16\``);
        await reply(`📖 *${j.reference}*\n\n_${String(j.text).trim().slice(0, 1500)}_\n\n${j.translation_name || ''}`);
      } catch (err) {
        await reply(rest ? `🔎 *I could not find "${rest.slice(0, 40)}".* Example: \`verse john 3:16\`` : down('The Bible service'));
      }
    },
  },
  {
    ...base,
    name: 'urban',
    aliases: ['slang'],
    category: 'lookup',
    description: 'What a slang word means: urban rizz',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}urban <word>\``);
      try {
        const j = await web.getJson(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(rest.slice(0, 60))}`, { timeout: 10000 });
        const d = j.list?.[0];
        if (!d) return reply(`🔎 *No definition found for "${rest.slice(0, 40)}".*`);
        const clean = (t) => String(t).replace(/[\[\]]/g, '').replace(/\r/g, '').trim();
        await reply(`📚 *${d.word}*\n\n${clean(d.definition).slice(0, 700)}\n\n_Example:_ ${clean(d.example).slice(0, 300)}\n\n_Slang definitions are written by users and can be crude._`);
      } catch (err) {
        await reply(down('The slang dictionary'));
      }
    },
  },
  {
    ...base,
    name: 'timein',
    aliases: ['time2', 'worldtime'],
    category: 'tools',
    description: 'The time anywhere: timein Tokyo, timein Nigeria, timein UTC+2',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}timein <city or country>\`\n*Examples:* \`${prefix}timein Tokyo\` · \`${prefix}timein Nigeria\``);
      const zone = require('./region').find(rest);
      if (!zone) return reply(`🔎 *I do not know "${rest.slice(0, 40)}".* Try a country, a city, or a name like Asia/Tokyo.`);
      const f = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts }).format(new Date());
      await reply(`🕒 *${rest.slice(0, 40)}*\n*Time:* ${f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}\n*Date:* ${f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n*Zone:* ${zone}\n_Your bot time:_ ${clock.parts().time}`);
    },
  },
  {
    ...base,
    name: 'morse',
    category: 'tools',
    description: 'Text to Morse code and back: morse hello / morse .... . .-.. .-.. ---',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}morse hello\` _(or Morse code to read it back)_`);
      if (/^[.\-/\s]+$/.test(rest)) {
        return reply(`📡 *Text*\n${rest.trim().split(/\s*\/\s*|\s{3,}/).map((w) => w.trim().split(/\s+/).map((c) => UNMORSE[c] || '?').join('')).join(' ')}`);
      }
      await reply(`📡 *Morse*\n${rest.toLowerCase().split('').map((c) => (c === ' ' ? '/' : MORSE[c] || '')).filter(Boolean).join(' ')}`);
    },
  },
  {
    ...base,
    name: 'binary',
    aliases: ['bin'],
    category: 'tools',
    description: 'Text to binary and back: binary hi / binary 01101000 01101001',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}binary hi\` _(or binary numbers to read them back)_`);
      if (/^[01\s]+$/.test(rest) && rest.replace(/\s/g, '').length % 8 === 0) {
        const bits = rest.replace(/\s/g, '').match(/.{8}/g);
        return reply(`💻 *Text*\n${Buffer.from(bits.map((b) => parseInt(b, 2))).toString('utf8').slice(0, 500)}`);
      }
      await reply(`💻 *Binary*\n${[...Buffer.from(rest.slice(0, 120), 'utf8')].map((b) => b.toString(2).padStart(8, '0')).join(' ')}`);
    },
  },
  {
    ...base,
    name: 'bmi',
    category: 'tools',
    description: 'Body mass index: bmi 70 175 (kg, cm)',
    async run({ args, reply, prefix }) {
      const [w, h0] = args.map((a) => parseFloat(a));
      const h = h0 > 3 ? h0 / 100 : h0; // 175 or 1.75
      if (!(w > 20 && w < 400) || !(h > 0.5 && h < 2.6)) return reply(`*Usage:* \`${prefix}bmi 70 175\` _(weight in kg, height in cm)_`);
      const v = w / (h * h);
      const word = v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy weight' : v < 30 ? 'Overweight' : 'Obese';
      await reply(`⚖️ *BMI*\n*Value:* ${v.toFixed(1)}\n*Range:* ${word}\n\n_BMI is only a rough guide. Ask a doctor about your health._`);
    },
  },
  {
    ...base,
    name: 'split',
    aliases: ['splitbill'],
    category: 'tools',
    description: 'Split a bill with an optional tip: split 5000 4 10 (amount, people, tip %)',
    async run({ args, reply, prefix }) {
      const [amount, people, tip = 0] = args.map((a) => parseFloat(a.replace(/[%,]/g, '')));
      if (!(amount > 0) || !(people >= 1) || people > 200) return reply(`*Usage:* \`${prefix}split 5000 4 10\` _(amount, people, tip in %)_`);
      const total = amount * (1 + tip / 100);
      await reply(`🧾 *Bill*\n*Amount:* ${money(amount)}\n*Tip:* ${tip}% → ${money(total - amount)}\n*Total:* ${money(total)}\n*Each of ${Math.floor(people)}:* *${money(total / Math.floor(people))}*`);
    },
  },
  {
    ...base,
    name: 'readqr',
    aliases: ['scanqr'],
    category: 'tools',
    slow: true,
    description: 'Read a QR code from a picture: reply to the image with readqr',
    async run(ctx) {
      await media.handle(ctx, ['image'], `Reply to a picture with a QR code using ${ctx.prefix}readqr`, async (found, buffer) => {
        let jsQR;
        try {
          jsQR = require('jsqr');
        } catch (err) {
          return ctx.reply(ctx.isOwner ? '⚠️ *The QR reader is not installed.* Run `npm install` on the server and restart the bot.' : media.NOT_HERE);
        }
        const { data, info } = await media.loadSharp()(buffer).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
        await ctx.reply(code ? `🔳 *QR code*\n${code.data.slice(0, 1500)}` : '🔎 *I could not find a QR code in that picture.* Try a sharper, closer one.');
      });
    },
  },
];

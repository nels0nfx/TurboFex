// More lookups and fun from the web: news, github, ip, horoscope, quote, fact, meme. Each has a fallback or a clear message when the service is down.
const net = require('net');
const web = require('../core/web');
const { assertPublicUrl } = require('../core/safefetch');

const base = { needs: [], weight: 'light' };
const down = (what) => `⚠️ *${what} is not answering right now.* Please try again later.`;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const QUOTES = [
  ['A journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['The best way to predict the future is to create it.', 'Peter Drucker'],
  ['What we think, we become.', 'Buddha'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['If you want to go fast, go alone. If you want to go far, go together.', 'African proverb'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
];
const FACTS = [
  'Honey never spoils: edible honey was found in ancient Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than a year on Venus.',
  'Bananas are berries, but strawberries are not.',
  'Sharks existed before trees did.',
  'The Eiffel Tower grows a few centimetres taller in summer because metal expands in the heat.',
  'Wombats produce cube-shaped droppings.',
  'There are more possible chess games than atoms in the observable universe.',
];
const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

module.exports = [
  {
    ...base,
    name: 'news',
    aliases: ['headlines'],
    category: 'lookup',
    description: 'Top headlines, or news about a topic: news / news nigeria football',
    async run({ rest, reply, jid, isGroup, prefix }) {
      const q = rest.trim().slice(0, 60);
      try {
        const url = q ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en` : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
        const xml = await web.getText(url, { timeout: 12000 });
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map((m) => ({
          title: web.decode((/<title>([\s\S]*?)<\/title>/.exec(m[1]) || [])[1]),
          link: web.decode((/<link>([\s\S]*?)<\/link>/.exec(m[1]) || [])[1]),
        }));
        if (!items.length) return reply(`📰 *I found no news for "${q}".*`);
        await reply(`📰 *${q ? `News: ${q}` : 'Top headlines'}*\n\n${items.map((i, n) => `${n + 1}. ${i.title}\n${i.link}`).join('\n\n')}`);
      } catch (err) {
        await reply(down('The news service'));
      }
    },
  },
  {
    ...base,
    name: 'github',
    aliases: ['gh'],
    category: 'lookup',
    description: 'A GitHub user or repository: github torvalds / github torvalds/linux',
    async run({ sock, jid, msg, args, reply, prefix }) {
      const q = (args[0] || '').replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
      if (!/^[\w.-]+(\/[\w.-]+)?$/.test(q)) return reply(`*Usage:* \`${prefix}github <user>\` or \`${prefix}github <user>/<repo>\``);
      try {
        if (q.includes('/')) {
          const r = await web.getJson(`https://api.github.com/repos/${q}`);
          return reply(
            `📦 *${r.full_name}*\n_${r.description || 'no description'}_\n\n` +
              `⭐ *Stars:* ${r.stargazers_count}  🍴 *Forks:* ${r.forks_count}  👁️ *Watchers:* ${r.subscribers_count ?? r.watchers_count}\n` +
              `${r.language ? `💻 *Language:* ${r.language}\n` : ''}🕒 *Updated:* ${String(r.pushed_at).slice(0, 10)}\n${r.license?.spdx_id ? `📄 *License:* ${r.license.spdx_id}\n` : ''}🔗 ${r.html_url}`
          );
        }
        const u = await web.getJson(`https://api.github.com/users/${q}`);
        const text =
          `🐙 *${u.name || u.login}* (${u.login})\n${u.bio ? `_${u.bio}_\n` : ''}\n` +
          `📦 *Repos:* ${u.public_repos}  👥 *Followers:* ${u.followers}  ➡️ *Following:* ${u.following}\n` +
          `${u.location ? `📍 *Location:* ${u.location}\n` : ''}${u.company ? `🏢 *Company:* ${u.company}\n` : ''}📅 *Joined:* ${String(u.created_at).slice(0, 10)}\n🔗 ${u.html_url}`;
        try {
          const img = await web.getBuffer(u.avatar_url, { timeout: 10000, max: 2 * 1024 * 1024 });
          return await sock.sendMessage(jid, { image: img, caption: text }, { quoted: msg });
        } catch (err) {
          return reply(text);
        }
      } catch (err) {
        await reply(err.code === 'HTTP' && /404/.test(err.message) ? '🔎 I could not find that on GitHub.' : down('GitHub'));
      }
    },
  },
  {
    ...base,
    name: 'ip',
    aliases: ['iplookup'],
    category: 'lookup',
    description: 'Where an IP address is from: ip 8.8.8.8',
    async run({ args, reply, prefix }) {
      const ip = (args[0] || '').trim();
      if (!net.isIP(ip)) return reply(`*Usage:* \`${prefix}ip 8.8.8.8\``);
      try {
        const j = await web.getJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
        if (!j.success) return reply('🔎 That is not a public address I can look up.');
        await reply(
          `🌍 *IP ${j.ip}*\n▸ *Country:* ${j.flag?.emoji || ''} ${j.country}\n▸ *Region:* ${j.region || '-'}\n▸ *City:* ${j.city || '-'}\n` +
            `▸ *Provider:* ${j.connection?.isp || '-'}\n▸ *Time zone:* ${j.timezone?.id || '-'}\n\n_Locations from an address are only approximate._`
        );
      } catch (err) {
        await reply(down('The address service'));
      }
    },
  },
  {
    ...base,
    name: 'horoscope',
    aliases: ['zodiac', 'star'],
    category: 'lookup',
    description: 'Your horoscope for today: horoscope leo',
    async run({ args, reply, prefix }) {
      const sign = (args[0] || '').toLowerCase();
      if (!SIGNS.includes(sign)) return reply(`*Usage:* \`${prefix}horoscope <sign>\`\n*Signs:* ${SIGNS.join(', ')}`);
      try {
        const j = await web.getJson(`https://ohmanda.com/api/horoscope/${sign}/`);
        if (!j.horoscope) throw new Error('empty');
        await reply(`🔮 *${sign[0].toUpperCase()}${sign.slice(1)}* - ${j.date || 'today'}\n\n${j.horoscope}`);
      } catch (err) {
        await reply(down('The horoscope service'));
      }
    },
  },
  {
    ...base,
    name: 'quote',
    category: 'fun',
    description: 'A random inspiring quote',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://zenquotes.io/api/random', { timeout: 6000 });
        if (j?.[0]?.q && !/too many requests/i.test(j[0].q)) return reply(`💬 _"${j[0].q}"_\n— ${j[0].a}`);
      } catch (err) {
        // the saved quotes below
      }
      const [q, a] = pick(QUOTES);
      await reply(`💬 _"${q}"_\n— ${a}`);
    },
  },
  {
    ...base,
    name: 'fact',
    aliases: ['funfact'],
    category: 'fun',
    description: 'A random fun fact',
    async run({ reply }) {
      try {
        const j = await web.getJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { timeout: 6000 });
        if (j?.text) return reply(`🧠 *Did you know?*\n${j.text}`);
      } catch (err) {
        // the saved facts below
      }
      await reply(`🧠 *Did you know?*\n${pick(FACTS)}`);
    },
  },
  {
    ...base,
    name: 'meme',
    category: 'fun',
    slow: true,
    description: 'A random meme (meme or meme <subreddit>)',
    async run({ sock, jid, msg, args, reply }) {
      const sub = /^[\w]{2,21}$/.test(args[0] || '') ? `/${args[0]}` : '';
      try {
        for (let i = 0; i < 3; i++) {
          const j = await web.getJson(`https://meme-api.com/gimme${sub}`, { timeout: 10000 });
          if (j.nsfw || j.spoiler || !j.url) continue;
          await assertPublicUrl(j.url);
          const buffer = await web.getBuffer(j.url, { timeout: 15000, max: 6 * 1024 * 1024 });
          return await sock.sendMessage(jid, { image: buffer, caption: `😂 ${String(j.title || '').slice(0, 150)}` }, { quoted: msg });
        }
        await reply('😕 I could not find a suitable meme. Try again.');
      } catch (err) {
        await reply(down('The meme service'));
      }
    },
  },
];

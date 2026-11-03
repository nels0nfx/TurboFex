// New lookups (v1.0.7): movie, tvshow, rhyme, synonym, wordofday, namemeaning, dialcode, postcode, hadith, emojimeaning
// They use free public services that need no key (iTunes, TVmaze, Datamuse, dictionaryapi.dev, REST Countries, Zippopotam,
// the Hadith API on jsDelivr) and the AI for names and emojis. Each one says clearly when its service is down.
const web = require('../core/web');
const dialcodes = require('../core/dialcodes');
const ai = require('../core/ai');
const clock = require('../core/clock');
const { getQuoted, quotedText } = require('../whatsapp/utils');

const base = { category: 'lookup', needs: [], weight: 'light' };
const enc = encodeURIComponent;
const down = (what) => `⚠️ *${what} is not answering right now.* Please try again later.`;
const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const plain = (html) => web.decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const notFound = (err) => /\b404\b/.test(String(err?.message));
const textOf = (ctx) => (ctx.rest || quotedText(getQuoted(ctx.msg)) || '').trim();

// a picture with a caption; if the picture cannot be loaded the text is still sent
async function withPicture(ctx, url, text) {
  const { sock, jid, msg, reply } = ctx;
  if (url && /^https:\/\//i.test(url)) {
    try {
      const img = await web.getBuffer(url, { timeout: 12000, max: 3 * 1024 * 1024 });
      return await sock.sendMessage(jid, { image: img, caption: text }, { quoted: msg });
    } catch (err) {
      // no picture: the text is sent
    }
  }
  return reply(text);
}

// words for "word of the day" (one a day, in order; the meaning comes from the dictionary)
const WORDS = ['serendipity', 'ephemeral', 'ubiquitous', 'eloquent', 'resilient', 'meticulous', 'benevolent', 'candid', 'diligent', 'empathy', 'frugal', 'gregarious', 'humble', 'integrity', 'jovial', 'keen', 'lucid', 'mundane', 'nostalgia', 'optimistic', 'pragmatic', 'quaint', 'reluctant', 'sincere', 'tenacious', 'unique', 'vivid', 'witty', 'zealous', 'ambiguous', 'bewildered', 'cherish', 'dilemma', 'endeavor', 'fascinate', 'grateful', 'hesitate', 'inevitable', 'jubilant', 'kindle', 'lenient', 'mesmerize', 'nuance', 'obstinate', 'perseverance', 'quest', 'radiant', 'solitude', 'tranquil', 'undermine', 'vigilant', 'wander', 'yearn', 'zenith', 'adversity', 'blossom', 'compassion', 'daunting', 'enthusiasm', 'flourish', 'genuine', 'harmony', 'inspire', 'justify', 'knack', 'legacy', 'modest', 'naive', 'ominous', 'peculiar', 'reliable', 'scrutinize', 'thrive', 'versatile', 'whimsical', 'aspire', 'brevity', 'curious', 'eager', 'fortitude', 'graceful', 'horizon', 'imagine', 'jargon', 'loyal', 'mellow', 'novel', 'optimum', 'prosper', 'rapport', 'savor', 'trivial', 'utmost', 'valor', 'wisdom', 'amiable', 'bountiful', 'charisma', 'devoted', 'elegant', 'fervent', 'gallant', 'hearty', 'idyllic', 'jolly', 'kinship', 'luminous', 'merit', 'noble', 'outspoken', 'poise', 'radical', 'steadfast', 'timid', 'unwavering', 'vibrant', 'warmth'];
const wordOfToday = (date = new Date()) => {
  const p = clock.parts(date);
  const days = Math.floor(Date.UTC(p.y, p.mo - 1, p.dom) / 86400000);
  return WORDS[days % WORDS.length];
};

// ---- where the movie facts come from (the first one that knows the title wins)
async function movieFromItunes(q) {
  const j = await web.getJson(`https://itunes.apple.com/search?term=${enc(q)}&media=movie&entity=movie&limit=5&country=US`);
  const results = Array.isArray(j?.results) ? j.results : [];
  if (!results.length) {
    console.error('movie: iTunes had nothing for this title:', JSON.stringify(j).slice(0, 160));
    return null;
  }
  const w = q.toLowerCase();
  const rank = (r) => (String(r.trackName).toLowerCase() === w ? 3 : String(r.trackName).toLowerCase().startsWith(w) ? 2 : String(r.trackName).toLowerCase().includes(w) ? 1 : 0);
  const m = [...results].sort((a, b) => rank(b) - rank(a))[0];
  const year = String(m.releaseDate || '').slice(0, 4);
  const lines = [`🎬 *${m.trackName}*${year ? ` (${year})` : ''}`, m.primaryGenreName && `🎭 *Genre:* ${m.primaryGenreName}`, m.artistName && `🎥 *Director:* ${m.artistName}`, m.trackTimeMillis && `⏱️ *Length:* ${Math.round(m.trackTimeMillis / 60000)} min`, m.contentAdvisoryRating && `🔞 *Rated:* ${m.contentAdvisoryRating}`, '', cut(m.longDescription || m.shortDescription, 450), m.trackViewUrl && `\n🔗 ${m.trackViewUrl}`].filter((x) => x || x === '');
  return { text: lines.join('\n'), picture: String(m.artworkUrl100 || '').replace('100x100bb', '600x600bb') };
}

async function movieFromWikipedia(q) {
  const found = await web.getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(`${q} film`)}&srlimit=5&format=json&origin=*`);
  const hits = found?.query?.search || [];
  const hit = hits.find((h) => /film|movie/i.test(`${h.title} ${h.snippet}`)) || hits[0];
  if (!hit) return null;
  const page = await web.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(hit.title.replace(/ /g, '_'))}`);
  if (!page?.extract) return null;
  const lines = [`🎬 *${page.title}*`, page.description && `_${page.description}_`, '', cut(page.extract, 500), page.content_urls?.desktop?.page && `\n🔗 ${page.content_urls.desktop.page}`].filter((x) => x || x === '');
  return { text: lines.join('\n'), picture: page.thumbnail?.source };
}

module.exports = [
  {
    ...base,
    name: 'movie',
    aliases: ['film', 'movieinfo'],
    description: 'Facts about a movie: movie The Lion King',
    async run(ctx) {
      const q = textOf(ctx);
      if (!q) return ctx.reply(`🎬 *Usage:* \`${ctx.prefix}movie <title>\`\n*Example:* \`${ctx.prefix}movie Black Panther\``);
      let failed = 0;
      for (const source of [movieFromItunes, movieFromWikipedia]) {
        try {
          const found = await source(q.slice(0, 80));
          if (found) return withPicture(ctx, found.picture, found.text);
        } catch (err) {
          failed += 1;
          console.error(`movie (${source.name}) failed:`, err.message);
        }
      }
      return ctx.reply(failed === 2 ? down('The movie service') : `🔎 I could not find a movie called *${cut(q, 40)}*.`);
    },
  },

  {
    ...base,
    name: 'tvshow',
    aliases: ['series', 'tv'],
    description: 'Facts about a TV show: tvshow Money Heist',
    async run(ctx) {
      const q = textOf(ctx);
      if (!q) return ctx.reply(`📺 *Usage:* \`${ctx.prefix}tvshow <name>\`\n*Example:* \`${ctx.prefix}tvshow Money Heist\``);
      try {
        const s = await web.getJson(`https://api.tvmaze.com/singlesearch/shows?q=${enc(q.slice(0, 80))}`);
        const year = String(s.premiered || '').slice(0, 4);
        const lines = [
          `📺 *${s.name}*${year ? ` (${year})` : ''}`,
          s.genres?.length && `🎭 *Genre:* ${s.genres.join(', ')}`,
          s.rating?.average && `⭐ *Rating:* ${s.rating.average}/10`,
          s.status && `📡 *Status:* ${s.status}`,
          (s.network?.name || s.webChannel?.name) && `📍 *On:* ${s.network?.name || s.webChannel?.name}`,
          s.runtime && `⏱️ *Episode length:* ${s.runtime} min`,
          s.language && `🗣️ *Language:* ${s.language}`,
          '',
          cut(plain(s.summary), 450),
          s.url && `\n🔗 ${s.url}`,
        ].filter((x) => x !== undefined && x !== false && x !== null && x !== 0);
        return withPicture(ctx, s.image?.original || s.image?.medium, lines.join('\n'));
      } catch (err) {
        return ctx.reply(notFound(err) ? `🔎 I could not find a show called *${cut(q, 40)}*.` : down('The TV service'));
      }
    },
  },

  {
    ...base,
    name: 'rhyme',
    aliases: ['rhymes', 'rhymewith'],
    description: 'Words that rhyme: rhyme love',
    async run({ args, reply, prefix }) {
      const word = (args[0] || '').toLowerCase().replace(/[^a-z'-]/g, '').slice(0, 25);
      if (!word) return reply(`🎵 *Usage:* \`${prefix}rhyme <word>\`\n*Example:* \`${prefix}rhyme night\``);
      try {
        let list = await web.getJson(`https://api.datamuse.com/words?rel_rhy=${enc(word)}&max=25`);
        let near = false;
        if (!Array.isArray(list) || list.length < 3) {
          list = await web.getJson(`https://api.datamuse.com/words?rel_nry=${enc(word)}&max=25`);
          near = true;
        }
        const words = (list || []).map((x) => x.word).filter(Boolean).slice(0, 25);
        if (!words.length) return reply(`🎵 I could not find rhymes for *${word}*.`);
        return reply(`🎵 *Words that ${near ? 'almost ' : ''}rhyme with ${word}*\n\n${words.join(', ')}`);
      } catch (err) {
        return reply(down('The word service'));
      }
    },
  },

  {
    ...base,
    name: 'synonym',
    aliases: ['synonyms', 'thesaurus'],
    description: 'Other words with the same meaning, and the opposites: synonym happy',
    async run({ args, reply, prefix }) {
      const word = (args[0] || '').toLowerCase().replace(/[^a-z'-]/g, '').slice(0, 25);
      if (!word) return reply(`📚 *Usage:* \`${prefix}synonym <word>\`\n*Example:* \`${prefix}synonym happy\``);
      try {
        const [syn, ant] = await Promise.all([web.getJson(`https://api.datamuse.com/words?rel_syn=${enc(word)}&max=20`), web.getJson(`https://api.datamuse.com/words?rel_ant=${enc(word)}&max=10`)]);
        const s = (syn || []).map((x) => x.word).filter(Boolean);
        const a = (ant || []).map((x) => x.word).filter(Boolean);
        if (!s.length && !a.length) return reply(`📚 I could not find other words for *${word}*.`);
        return reply(`📚 *${word}*\n${s.length ? `\n✅ *Same meaning:* ${s.join(', ')}` : ''}${a.length ? `\n↔️ *Opposite:* ${a.join(', ')}` : ''}`);
      } catch (err) {
        return reply(down('The word service'));
      }
    },
  },

  {
    ...base,
    name: 'wordofday',
    aliases: ['wotd', 'dailyword'],
    description: 'A new English word every day with its meaning',
    async run({ reply }) {
      const word = wordOfToday();
      try {
        const data = await web.getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`);
        const entry = Array.isArray(data) ? data[0] : null;
        const m = (entry?.meanings || [])[0];
        const d = (m?.definitions || [])[0];
        if (!d) throw new Error('no meaning');
        return reply(`📖 *Word of the day*\n\n*${word}*${entry.phonetic ? `  ${entry.phonetic}` : ''}\n_${m.partOfSpeech}_\n\n${d.definition}${d.example ? `\n\n_"${d.example}"_` : ''}`);
      } catch (err) {
        return reply(`📖 *Word of the day:* *${word}*\n_The dictionary is not answering, so I cannot show the meaning. Try_ \`.define ${word}\` _in a moment._`);
      }
    },
  },

  {
    ...base,
    name: 'namemeaning',
    aliases: ['nameorigin', 'whatsmyname'],
    description: 'The meaning and origin of a first name: namemeaning Amara',
    async run(ctx) {
      const name = (ctx.args[0] || '').replace(/[^\p{L}'-]/gu, '').slice(0, 30);
      if (!name) return ctx.reply(`📛 *Usage:* \`${ctx.prefix}namemeaning <first name>\`\n*Example:* \`${ctx.prefix}namemeaning Amara\``);
      try {
        const answer = await ai.chat([{ role: 'user', content: `Give the meaning and origin of the first name "${name}" in 2 short sentences, then one well-known person with that name. If you are not sure about the name, say so honestly. No introduction.` }]);
        return ctx.reply(`📛 *${name}*\n\n${answer}`);
      } catch (err) {
        console.error('namemeaning failed:', err.message);
        return ctx.reply(`⚠️ *${ai.NAME} is not answering right now.* Please try again in a moment.`);
      }
    },
  },

  {
    ...base,
    name: 'dialcode',
    aliases: ['callingcode', 'countrycode'],
    description: 'The phone code of a country, or the country of a code: dialcode Kenya, dialcode +234',
    async run({ rest, reply, prefix }) {
      const q = rest.trim();
      if (!q) return reply(`📞 *Usage:* \`${prefix}dialcode <country>\` _or_ \`${prefix}dialcode +234\`\n*Examples:* \`${prefix}dialcode Kenya\` · \`${prefix}dialcode 44\``);
      if (/^\+?\d{1,4}$/.test(q)) {
        const digits = q.replace('+', '');
        const hits = dialcodes.byCode(digits);
        if (!hits.length) return reply(`📞 I do not know a country with the code *+${digits}*.`);
        const list = hits.slice(0, 15).map((c) => `${c.flag} ${c.name} (${dialcodes.show(c)})`);
        return reply(`📞 *+${digits}*\n\n${list.join('\n')}${hits.length > 15 ? `\n_...and ${hits.length - 15} more_` : ''}${digits === '1' ? '\n\n_+1 is shared by many countries. The Caribbean ones add an area code, for example +1 876 is Jamaica._' : ''}`);
      }
      const c = dialcodes.byName(q);
      if (!c) return reply(`🔎 I could not find a country called *${cut(q, 30)}*.`);
      return reply(`${c.flag} *${c.name}*\n📞 *Dial code:* ${dialcodes.show(c)}\n_From abroad dial_ ${dialcodes.show(c).replace(' ', '')} _then the number without its first 0._`);
    },
  },

  {
    ...base,
    name: 'postcode',
    aliases: ['zipcode', 'zip'],
    description: 'Find a place from its postcode: postcode us 90210 (country code, then the code)',
    async run({ args, reply, prefix }) {
      let [country, code] = args;
      if (args.length === 1 && /^\d{5}$/.test(args[0])) [country, code] = ['us', args[0]];
      if (!country || !code || !/^[a-z]{2}$/i.test(country)) return reply(`📮 *Usage:* \`${prefix}postcode <2-letter country> <postcode>\`\n*Examples:* \`${prefix}postcode us 90210\` · \`${prefix}postcode de 10115\` · \`${prefix}postcode za 0001\``);
      try {
        const j = await web.getJson(`https://api.zippopotam.us/${enc(country.toLowerCase())}/${enc(String(code).slice(0, 12))}`);
        const places = (j.places || []).slice(0, 6);
        if (!places.length) return reply(`📮 I found nothing for *${code}*.`);
        return reply(`📮 *${j['post code'] || code}* - ${j.country}\n\n${places.map((p) => `📍 ${p['place name']}${p.state ? `, ${p.state}` : ''}`).join('\n')}`);
      } catch (err) {
        return reply(notFound(err) ? `📮 I could not find the postcode *${cut(code, 12)}* in *${country.toUpperCase()}*. Check the country and the code.` : down('The postcode service'));
      }
    },
  },

  {
    ...base,
    name: 'hadith',
    aliases: ['bukhari', 'randomhadith'],
    description: 'A hadith from Sahih al-Bukhari: hadith (random) or hadith 1234',
    async run({ args, reply, prefix }) {
      const asked = parseInt(args[0], 10);
      if (args[0] && !(asked >= 1 && asked <= 7563)) return reply(`📜 *Usage:* \`${prefix}hadith\` _(a random one)_ or \`${prefix}hadith 1234\` _(a number from 1 to 7563)_`);
      const n = asked || 1 + Math.floor(Math.random() * 7000);
      try {
        const j = await web.getJson(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-bukhari/${n}.json`);
        const h = (j.hadiths || [])[0];
        if (!h?.text) throw new Error('no text');
        return reply(`📜 *Sahih al-Bukhari ${h.hadithnumber || n}*\n\n${cut(h.text, 1100)}\n\n_Next one: ${prefix}hadith_`);
      } catch (err) {
        return reply(notFound(err) ? `📜 I could not find hadith number *${n}*.` : down('The hadith service'));
      }
    },
  },

  {
    ...base,
    name: 'emojimeaning',
    aliases: ['emojiinfo', 'whatsthisemoji'],
    description: 'What an emoji means and how people use it: emojimeaning 🫠',
    async run(ctx) {
      const found = textOf(ctx).match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u);
      if (!found) return ctx.reply(`🔤 *Usage:* \`${ctx.prefix}emojimeaning 🫠\` _(or reply to a message with an emoji)_`);
      try {
        const answer = await ai.chat([{ role: 'user', content: `Explain the emoji ${found[0]} in 2 short sentences: its official meaning, and how people really use it in chats (including slang meanings, if any). No introduction.` }]);
        return ctx.reply(`${found[0]} *Emoji meaning*\n\n${answer}`);
      } catch (err) {
        console.error('emojimeaning failed:', err.message);
        return ctx.reply(`⚠️ *${ai.NAME} is not answering right now.* Please try again in a moment.`);
      }
    },
  },
];

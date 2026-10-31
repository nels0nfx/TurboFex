// More lookups (v0.9.3): country, pokemon, anime, meal, cocktail, book, quran, npm, iss, earthquake, holiday, sunrise, moon, apod, isup, dns
// All of them use free public web services that need no key. Each one says clearly when the service is down.
const web = require('../core/web');
const safefetch = require('../core/safefetch');
const moon = require('../core/moon');
const clock = require('../core/clock');

const base = { category: 'lookup', needs: [], weight: 'light' };
const down = (what) => `⚠️ *${what} is not answering right now.* Please try again later.`;
const enc = encodeURIComponent;
const num = (n) => Number(n).toLocaleString('en-US');
const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const notFound = (err) => /\b404\b/.test(String(err?.message));
// a picture is a nice extra: if it cannot be loaded the text is still sent
async function sendWithPicture(ctx, url, text) {
  const { sock, jid, msg, reply } = ctx;
  if (url && /^https:\/\//i.test(url)) {
    try {
      const img = await web.getBuffer(url, { timeout: 12000, max: 3 * 1024 * 1024 });
      return await sock.sendMessage(jid, { image: img, caption: text }, { quoted: msg });
    } catch (err) {
      // no picture: send the text
    }
  }
  return reply(text);
}
const hostOf = (raw) => {
  const h = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h) ? h : null;
};

module.exports = [
  {
    ...base,
    name: 'country',
    aliases: ['nation', 'countryinfo'],
    description: 'Facts about a country: country Nigeria',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`Write a country.\nExample: ${prefix}country Nigeria`);
      try {
        const list = await web.getJson(`https://restcountries.com/v3.1/name/${enc(rest.slice(0, 60))}?fields=name,capital,region,subregion,population,area,languages,currencies,flag,timezones`);
        if (!Array.isArray(list) || !list.length) return reply(`🔎 I could not find a country called *${cut(rest, 30)}*.`);
        const q = rest.trim().toLowerCase();
        const c = list.find((x) => String(x.name?.common).toLowerCase() === q) || list[0];
        const cur = Object.values(c.currencies || {}).map((x) => `${x.name}${x.symbol ? ` (${x.symbol})` : ''}`).join(', ');
        const langs = Object.values(c.languages || {}).slice(0, 5).join(', ');
        return reply(
          `${c.flag || '🌍'} *${c.name?.common}*\n_${c.name?.official || ''}_\n\n` +
            `🏛️ *Capital:* ${(c.capital || []).join(', ') || 'none'}\n🌐 *Region:* ${[c.region, c.subregion].filter(Boolean).join(' / ')}\n` +
            `👥 *Population:* ${num(c.population)}\n📐 *Area:* ${num(c.area)} km²\n🗣️ *Languages:* ${langs || 'unknown'}\n💱 *Currency:* ${cur || 'unknown'}\n🕒 *Time zones:* ${(c.timezones || []).slice(0, 3).join(', ')}`
        );
      } catch (err) {
        return reply(notFound(err) ? `🔎 I could not find a country called *${cut(rest, 30)}*.` : down('The country service'));
      }
    },
  },
  {
    ...base,
    name: 'pokemon',
    aliases: ['pokedex', 'poke'],
    slow: true,
    description: 'Facts about a Pokémon: pokemon pikachu',
    async run(ctx) {
      const { rest, reply, prefix } = ctx;
      if (!rest) return reply(`Write a Pokémon name or number.\nExample: ${prefix}pokemon pikachu`);
      const q = rest.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
      if (!q) return reply(`Write a Pokémon name or number.\nExample: ${prefix}pokemon pikachu`);
      try {
        const p = await web.getJson(`https://pokeapi.co/api/v2/pokemon/${enc(q)}`, { timeout: 10000 });
        const stat = (n) => p.stats?.find((s) => s.stat?.name === n)?.base_stat ?? '?';
        const text =
          `⚡ *${p.name[0].toUpperCase()}${p.name.slice(1)}*  #${p.id}\n\n` +
          `🔥 *Type:* ${p.types.map((t) => t.type.name).join(', ')}\n📏 *Height:* ${p.height / 10} m   ⚖️ *Weight:* ${p.weight / 10} kg\n` +
          `✨ *Abilities:* ${p.abilities.map((a) => a.ability.name.replace(/-/g, ' ')).join(', ')}\n\n` +
          `❤️ HP ${stat('hp')}  ⚔️ Attack ${stat('attack')}  🛡️ Defense ${stat('defense')}\n💨 Speed ${stat('speed')}  🔮 Sp.Atk ${stat('special-attack')}  🔰 Sp.Def ${stat('special-defense')}`;
        return await sendWithPicture(ctx, p.sprites?.other?.['official-artwork']?.front_default, text);
      } catch (err) {
        return reply(notFound(err) ? `🔎 I could not find a Pokémon called *${cut(rest, 30)}*.` : down('The Pokémon service'));
      }
    },
  },
  {
    ...base,
    name: 'anime',
    aliases: ['animeinfo', 'jikan'],
    slow: true,
    description: 'Facts about an anime: anime naruto',
    async run(ctx) {
      const { rest, reply, prefix } = ctx;
      if (!rest) return reply(`Write an anime name.\nExample: ${prefix}anime naruto`);
      try {
        const j = await web.getJson(`https://api.jikan.moe/v4/anime?q=${enc(rest.slice(0, 80))}&limit=1&sfw=true`, { timeout: 12000 });
        const a = j?.data?.[0];
        if (!a) return reply(`🔎 I could not find an anime called *${cut(rest, 30)}*.`);
        const text =
          `🎌 *${a.title_english || a.title}*${a.title_english && a.title !== a.title_english ? `\n_${a.title}_` : ''}\n\n` +
          `📺 *Type:* ${a.type || '?'}   🎞️ *Episodes:* ${a.episodes ?? '?'}\n📅 *Status:* ${a.status || '?'}${a.year ? `   🗓️ *Year:* ${a.year}` : ''}\n` +
          `⭐ *Score:* ${a.score ?? 'not rated'}\n🎭 *Genres:* ${(a.genres || []).map((g) => g.name).join(', ') || '?'}\n\n${cut(a.synopsis, 450)}\n\n🔗 ${a.url}`;
        return await sendWithPicture(ctx, a.images?.jpg?.image_url, text);
      } catch (err) {
        return reply(down('The anime service'));
      }
    },
  },
  {
    ...base,
    name: 'meal',
    aliases: ['dish', 'themeal'],
    slow: true,
    description: 'A recipe: meal pasta (or just meal for a random one)',
    async run(ctx) {
      const { rest, reply } = ctx;
      try {
        const url = rest ? `https://www.themealdb.com/api/json/v1/1/search.php?s=${enc(rest.slice(0, 60))}` : 'https://www.themealdb.com/api/json/v1/1/random.php';
        const m = (await web.getJson(url, { timeout: 10000 }))?.meals?.[0];
        if (!m) return reply(`🔎 I could not find a meal called *${cut(rest, 30)}*.`);
        const items = [];
        for (let i = 1; i <= 20; i++) {
          const ing = String(m[`strIngredient${i}`] || '').trim();
          if (ing) items.push(`▸ ${String(m[`strMeasure${i}`] || '').trim()} ${ing}`.replace(/\s+/g, ' '));
        }
        const text =
          `🍽️ *${m.strMeal}*\n${[m.strCategory, m.strArea].filter(Boolean).join(' • ')}\n\n🛒 *Ingredients*\n${items.join('\n')}\n\n👩‍🍳 *Method*\n${cut(m.strInstructions, 900)}${m.strYoutube ? `\n\n▶️ ${m.strYoutube}` : ''}`;
        return await sendWithPicture(ctx, m.strMealThumb, text);
      } catch (err) {
        return reply(down('The recipe service'));
      }
    },
  },
  {
    ...base,
    name: 'cocktail',
    aliases: ['mixdrink', 'cocktails'],
    slow: true,
    description: 'A drink recipe: cocktail mojito (or just cocktail for a random one)',
    async run(ctx) {
      const { rest, reply } = ctx;
      try {
        const url = rest ? `https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${enc(rest.slice(0, 60))}` : 'https://www.thecocktaildb.com/api/json/v1/1/random.php';
        const d = (await web.getJson(url, { timeout: 10000 }))?.drinks?.[0];
        if (!d) return reply(`🔎 I could not find a drink called *${cut(rest, 30)}*.`);
        const items = [];
        for (let i = 1; i <= 15; i++) {
          const ing = String(d[`strIngredient${i}`] || '').trim();
          if (ing) items.push(`▸ ${String(d[`strMeasure${i}`] || '').trim()} ${ing}`.replace(/\s+/g, ' '));
        }
        const text = `🍹 *${d.strDrink}*\n${[d.strCategory, d.strAlcoholic, d.strGlass].filter(Boolean).join(' • ')}\n\n🛒 *Ingredients*\n${items.join('\n')}\n\n🥄 *Method*\n${cut(d.strInstructions, 700)}`;
        return await sendWithPicture(ctx, d.strDrinkThumb, text);
      } catch (err) {
        return reply(down('The drinks service'));
      }
    },
  },
  {
    ...base,
    name: 'book',
    aliases: ['bookinfo', 'findbook'],
    description: 'Find a book: book Things Fall Apart',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`Write a book title or an author.\nExample: ${prefix}book Things Fall Apart`);
      try {
        const j = await web.getJson(`https://openlibrary.org/search.json?q=${enc(rest.slice(0, 100))}&limit=1&fields=title,author_name,first_publish_year,number_of_pages_median,subject,ratings_average,key,edition_count`, { timeout: 10000 });
        const b = j?.docs?.[0];
        if (!b) return reply(`🔎 I could not find a book called *${cut(rest, 30)}*.`);
        return reply(
          `📚 *${b.title}*\n✍️ ${(b.author_name || ['unknown author']).slice(0, 3).join(', ')}\n\n` +
            `${b.first_publish_year ? `📅 *First published:* ${b.first_publish_year}\n` : ''}${b.number_of_pages_median ? `📄 *Pages:* about ${b.number_of_pages_median}\n` : ''}${b.edition_count ? `📖 *Editions:* ${b.edition_count}\n` : ''}` +
            `${b.ratings_average ? `⭐ *Rating:* ${Number(b.ratings_average).toFixed(1)} / 5\n` : ''}${b.subject?.length ? `🏷️ *Subjects:* ${b.subject.slice(0, 5).join(', ')}\n` : ''}🔗 https://openlibrary.org${b.key}`
        );
      } catch (err) {
        return reply(down('The book service'));
      }
    },
  },
  {
    ...base,
    name: 'quran',
    aliases: ['ayah', 'surah'],
    description: 'A verse of the Quran: quran 2:255, quran 112 (start of a surah) or quran for a random one',
    async run({ args, reply, prefix }) {
      const a = (args[0] || '').trim();
      let ref;
      if (!a) ref = String(1 + Math.floor(Math.random() * 6236));
      else {
        const m = /^(\d{1,3})(?::(\d{1,3}))?$/.exec(a);
        if (!m || +m[1] < 1 || +m[1] > 114) return reply(`Write a surah number from 1 to 114, and a verse if you like.\nExample: ${prefix}quran 2:255`);
        ref = `${m[1]}:${m[2] || 1}`;
      }
      try {
        const j = await web.getJson(`https://api.alquran.cloud/v1/ayah/${ref}/editions/quran-uthmani,en.sahih`, { timeout: 10000 });
        const [ar, en] = j?.data || [];
        if (!ar || !en) return reply(`🔎 I could not find the verse *${cut(a, 12)}*. Check the numbers.`);
        return reply(`📖 *${ar.surah.englishName}* (${ar.surah.name}) ${ar.surah.number}:${ar.numberInSurah}\n\n${ar.text}\n\n_${en.text}_`);
      } catch (err) {
        return reply(a && notFound(err) ? `🔎 I could not find the verse *${cut(a, 12)}*. Check the numbers.` : down('The Quran service'));
      }
    },
  },
  {
    ...base,
    name: 'npm',
    aliases: ['npmjs', 'package'],
    description: 'Facts about an npm package: npm express',
    async run({ args, reply, prefix }) {
      const name = (args[0] || '').toLowerCase();
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) || name.length > 100) return reply(`Write a package name.\nExample: ${prefix}npm express`);
      try {
        const p = await web.getJson(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { timeout: 10000 });
        let weekly = null;
        try {
          weekly = (await web.getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`, { timeout: 8000 }))?.downloads;
        } catch (err) {
          weekly = null;
        }
        return reply(
          `📦 *${p.name}* v${p.version}\n_${cut(p.description, 200) || 'no description'}_\n\n` +
            `${weekly != null ? `⬇️ *Downloads last week:* ${num(weekly)}\n` : ''}📄 *License:* ${typeof p.license === 'string' ? p.license : 'unknown'}\n🧩 *Dependencies:* ${Object.keys(p.dependencies || {}).length}\n` +
            `🔗 https://www.npmjs.com/package/${name}`
        );
      } catch (err) {
        return reply(notFound(err) ? `🔎 I could not find a package called *${cut(name, 30)}*.` : down('The npm service'));
      }
    },
  },
  {
    ...base,
    name: 'iss',
    aliases: ['spacestation'],
    description: 'Where the International Space Station is right now',
    async run({ reply }) {
      try {
        const s = await web.getJson('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 8000 });
        if (typeof s.latitude !== 'number') throw new Error('bad answer');
        const lat = s.latitude.toFixed(3);
        const lon = s.longitude.toFixed(3);
        return reply(
          `🛰️ *International Space Station*\n\n📍 *Position:* ${lat}°, ${lon}°\n⬆️ *Height:* ${Math.round(s.altitude)} km\n🚀 *Speed:* ${num(Math.round(s.velocity))} km/h\n` +
            `${s.visibility ? `☀️ *Light:* ${s.visibility}\n` : ''}\n🗺️ https://maps.google.com/?q=${lat},${lon}`
        );
      } catch (err) {
        return reply(down('The space station tracker'));
      }
    },
  },
  {
    ...base,
    name: 'earthquake',
    aliases: ['quake', 'quakes'],
    description: 'The strongest earthquakes of the last day (magnitude 4.5 and up)',
    async run({ reply }) {
      try {
        let j = await web.getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { timeout: 10000 });
        let span = 'the last 24 hours';
        if (!j?.features?.length) {
          j = await web.getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', { timeout: 12000 });
          span = 'the last 7 days (none in the last 24 hours)';
        }
        const list = (j?.features || []).map((f) => f.properties).filter((p) => p && typeof p.mag === 'number').sort((a, b) => b.mag - a.mag).slice(0, 5);
        if (!list.length) return reply('🌍 No earthquakes of magnitude 4.5 or more were reported recently.');
        const lines = list.map((p) => `▸ *M ${p.mag.toFixed(1)}* ${cut(p.place, 60)}\n   ${clock.stamp(p.time)}`);
        return reply(`🌋 *Strongest earthquakes in ${span}*\n\n${lines.join('\n')}\n\n_Source: USGS_`);
      } catch (err) {
        return reply(down('The earthquake service'));
      }
    },
  },
  {
    ...base,
    name: 'holiday',
    aliases: ['holidays', 'publicholiday'],
    description: 'The next public holidays of a country: holiday NG (use the 2-letter country code)',
    async run({ args, reply, prefix }) {
      const cc = (args[0] || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return reply(`Write the 2-letter country code.\nExample: ${prefix}holiday NG   (NG Nigeria, ZA South Africa, GB United Kingdom, US United States)`);
      try {
        const list = await web.getJson(`https://date.nager.at/api/v3/NextPublicHolidays/${cc}`, { timeout: 10000 });
        if (!Array.isArray(list) || !list.length) return reply(`🔎 I found no holidays for *${cc}*. Check the country code.`);
        const lines = list.slice(0, 6).map((h) => `▸ *${h.date}*  ${h.name}${h.localName && h.localName !== h.name ? ` (${h.localName})` : ''}`);
        return reply(`🎉 *Next public holidays: ${cc}*\n\n${lines.join('\n')}`);
      } catch (err) {
        return reply(notFound(err) ? `🔎 I found no holidays for *${cc}*. Check the country code.` : down('The holiday service'));
      }
    },
  },
  {
    ...base,
    name: 'sunrise',
    aliases: ['sunset', 'suntimes'],
    description: 'Sunrise and sunset times for a city: sunrise Lagos',
    async run({ rest, reply, prefix }) {
      if (!rest) return reply(`Write a city.\nExample: ${prefix}sunrise Lagos`);
      try {
        const g = (await web.getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(rest.slice(0, 60))}&count=1`, { timeout: 8000 }))?.results?.[0];
        if (!g) return reply(`🔎 I could not find a city called *${cut(rest, 30)}*.`);
        const r = (await web.getJson(`https://api.sunrise-sunset.org/json?lat=${g.latitude}&lng=${g.longitude}&formatted=0`, { timeout: 8000 }))?.results;
        if (!r?.sunrise) throw new Error('bad answer');
        const tz = g.timezone || 'UTC';
        const at = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
        const hours = Math.floor(r.day_length / 3600);
        const mins = Math.round((r.day_length % 3600) / 60);
        return reply(`🌅 *${g.name}${g.country ? `, ${g.country}` : ''}*\n_Local time (${tz})_\n\n🌄 *Sunrise:* ${at(r.sunrise)}\n☀️ *Midday:* ${at(r.solar_noon)}\n🌇 *Sunset:* ${at(r.sunset)}\n⏳ *Daylight:* ${hours}h ${mins}m`);
      } catch (err) {
        return reply(down('The sun times service'));
      }
    },
  },
  {
    ...base,
    name: 'moon',
    aliases: ['moonphase', 'lunar'],
    description: 'The phase of the moon today',
    async run({ reply }) {
      const m = moon.info(new Date());
      const day = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: clock.zone(), day: 'numeric', month: 'short' }).format(d);
      return reply(`${m.emoji} *${m.name}*\n\n💡 *Lit up:* ${m.lit}%\n📆 *Moon age:* ${m.age.toFixed(1)} days\n🌕 *Next full moon:* ${day(m.nextFull)}\n🌑 *Next new moon:* ${day(m.nextNew)}\n\n_Worked out by the bot, accurate to about a day._`);
    },
  },
  {
    ...base,
    name: 'apod',
    aliases: ['nasa', 'spacepic'],
    slow: true,
    description: 'NASA\'s astronomy picture of the day',
    async run(ctx) {
      const { reply } = ctx;
      try {
        const a = await web.getJson('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY', { timeout: 12000 });
        if (!a?.title) throw new Error('bad answer');
        const text = `🌌 *${a.title}*\n_${a.date}${a.copyright ? ` • © ${String(a.copyright).replace(/\s+/g, ' ').trim()}` : ''}_\n\n${cut(a.explanation, 600)}`;
        if (a.media_type === 'image') return await sendWithPicture(ctx, a.url, text);
        return reply(`${text}\n\n▶️ ${a.url}`);
      } catch (err) {
        return reply(down('NASA'));
      }
    },
  },
  {
    ...base,
    name: 'isup',
    aliases: ['siteup', 'isdown', 'sitecheck'],
    description: 'Check if a website is up: isup google.com',
    async run({ args, reply, prefix, isOwner }) {
      const host = hostOf(args[0]);
      if (!host) return reply(`Write a website.\nExample: ${prefix}isup google.com`);
      const started = Date.now();
      try {
        let res;
        try {
          res = await safefetch.get(`https://${host}/`, { timeout: 7000, maxBytes: 2048 });
        } catch (first) {
          if (first.code === 'BLOCKED') throw first;
          res = await safefetch.get(`http://${host}/`, { timeout: 7000, maxBytes: 2048 });
        }
        const ms = Date.now() - started;
        // any answer under 500 means the site is alive (403 and 404 are answers too)
        return reply(res.status < 500 ? `✅ *${host} is UP*\nAnswered in ${ms} ms (code ${res.status}).` : `⚠️ *${host} answers, but with an error* (code ${res.status}).\nIt may be having problems.`);
      } catch (err) {
        if (err.code === 'BLOCKED') return reply('⚠️ I cannot check that address.');
        return reply(`❌ *${host} looks DOWN* from here.\n_It did not answer in time. It may be down for everybody, or only for me._${isOwner ? `\nReason: ${cut(err.message, 80)}` : ''}`);
      }
    },
  },
  {
    ...base,
    name: 'dns',
    aliases: ['dnslookup', 'nslookup'],
    description: 'DNS records of a domain: dns google.com (or dns google.com MX)',
    async run({ args, reply, prefix }) {
      const host = hostOf(args[0]);
      const type = (args[1] || 'A').toUpperCase();
      if (!host || !['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'].includes(type)) {
        return reply(`Write a domain, and a record type if you like (A, AAAA, MX, TXT, NS, CNAME).\nExample: ${prefix}dns google.com MX`);
      }
      try {
        const j = await web.getJson(`https://dns.google/resolve?name=${enc(host)}&type=${type}`, { timeout: 8000 });
        if (j.Status === 3) return reply(`🔎 *${host}* does not exist.`);
        const rows = (j.Answer || []).slice(0, 10);
        if (!rows.length) return reply(`🔎 *${host}* has no ${type} records.`);
        const lines = rows.map((r) => `▸ ${cut(String(r.data).replace(/^"|"$/g, ''), 150)}  _(TTL ${r.TTL}s)_`);
        return reply(`🌐 *${type} records for ${host}*\n\n${lines.join('\n')}`);
      } catch (err) {
        return reply(down('The DNS service'));
      }
    },
  },
];

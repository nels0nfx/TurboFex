// Media and web tools: lyrics, tts, tovn, ocr, removebg, image, ssweb, shorten
const media = require('../whatsapp/media');
const web = require('../core/web');
const { assertPublicUrl } = require('../core/safefetch');
const { getQuoted } = require('../whatsapp/utils');
const store = require('../whatsapp/store');
const apikeys = require('../core/apikeys');
const songmatch = require('../core/songmatch');

const base = { needs: [], weight: 'light' };

const LANGS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'sw', 'yo', 'ig', 'ha', 'zu', 'af', 'tr', 'id', 'ja', 'ko', 'nl', 'pl', 'zh-cn', 'zh-tw']);

// the words of the message that was replied to
function quotedText(msg) {
  const q = getQuoted(msg);
  const m = q?.message;
  return m ? m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '' : '';
}

// cuts a text into pieces of at most 180 characters at sentence or word ends (the speech service takes short pieces)
function pieces(text, size = 180) {
  const out = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest.length > size) {
    let cut = Math.max(rest.lastIndexOf('. ', size), rest.lastIndexOf('! ', size), rest.lastIndexOf('? ', size), rest.lastIndexOf(', ', size));
    if (cut < size / 3) cut = rest.lastIndexOf(' ', size);
    if (cut < 1) cut = size;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// a voice note (opus) is what WhatsApp shows as a round "voice message"; without ffmpeg the sound is sent as normal audio
async function sendVoice(ctx, buffer, srcMime = 'mp3') {
  let out = null;
  try {
    out = await media.ffmpeg(buffer, 'ogg', (i, o) => ['-i', i, '-vn', '-t', '300', '-c:a', 'libopus', '-b:a', '48k', '-application', 'voip', o]);
  } catch (err) {
    if (err.code !== 'NEED_FFMPEG') throw err;
  }
  if (out) return ctx.sock.sendMessage(ctx.jid, { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: ctx.msg });
  return ctx.sock.sendMessage(ctx.jid, { audio: buffer, mimetype: srcMime === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }, { quoted: ctx.msg });
}

module.exports = [
  {
    ...base,
    name: 'lyrics',
    aliases: ['lyric'],
    category: 'media',
    description: 'Lyrics of a song (needs a Musixmatch key from the owner): lyrics rema calm down',
    async run({ rest, reply, prefix, isOwner }) {
      if (!rest) return reply(`*Usage:* \`${prefix}lyrics <artist and song>\`\n*Example:* \`${prefix}lyrics rema calm down\``);
      const q = encodeURIComponent(rest);
      const links = `🔗 https://genius.com/search?q=${q}`;
      const key = store.getApiKey('musixmatch');
      if (!key) {
        return reply(
          `🎵 *Lyrics need a licensed source.*\n${isOwner ? `Get a free key at developer.musixmatch.com and send it with \`${prefix}setapi musixmatch <key>\`.` : 'The bot owner has not set it up yet.'}\n\nUntil then: ${links}`
        );
      }
      try {
        const api = (path) => web.getJson(`https://api.musixmatch.com/ws/1.1/${path}&apikey=${encodeURIComponent(key)}`, { timeout: 12000 });
        const found = await api(`track.search?q=${q}&s_track_rating=desc&f_has_lyrics=1&page_size=1`);
        const track = found?.message?.body?.track_list?.[0]?.track;
        if (!track) return reply(`🔎 *I could not find the lyrics of "${rest.slice(0, 40)}".*\n${links}`);
        const got = await api(`track.lyrics.get?track_id=${track.track_id}`);
        const lyr = got?.message?.body?.lyrics;
        const body = String(lyr?.lyrics_body || '').replace(/\*{3,}[\s\S]*$/, '').trim();
        if (!body) return reply(`🔎 *No lyrics were returned for this song.*\n${links}`);
        await reply(
          `🎵 *${track.track_name}* – ${track.artist_name}\n\n${body.slice(0, 3500)}\n\n` +
            `_Lyrics from Musixmatch${lyr.lyrics_copyright ? `. ${String(lyr.lyrics_copyright).slice(0, 120)}` : ''}. The free plan shows only part of the song._\n${track.track_share_url ? `🔗 ${String(track.track_share_url).split('?')[0]}` : links}`
        );
      } catch (err) {
        console.error('lyrics failed:', err.message);
        await reply(`⚠️ *The lyrics service is not answering right now.* Please try again later.\n${links}`);
      }
    },
  },
  {
    ...base,
    name: 'tts',
    aliases: ['say', 'speak'],
    category: 'media',
    slow: true,
    description: 'Turn text into a voice note: tts hello everyone (or tts fr bonjour; reply to a message to read it out)',
    async run(ctx) {
      const { args, rest, msg, reply, prefix } = ctx;
      let lang = 'en';
      let text = rest;
      if (args[0] && LANGS.has(args[0].toLowerCase())) {
        lang = args[0].toLowerCase();
        text = rest.slice(args[0].length).trim();
      }
      text = (text || quotedText(msg)).trim();
      if (!text) return reply(`*Usage:* \`${prefix}tts hello everyone\`\n*Other languages:* \`${prefix}tts fr bonjour\`\n_${[...LANGS].join(', ')}_`);
      if (text.length > 500) return reply(`⚠️ That is too long for a voice note (${text.length} characters, the limit is 500).`);
      try {
        const parts = [];
        for (const p of pieces(text)) {
          parts.push(await web.getBuffer(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(p)}`, { timeout: 15000, max: 3 * 1024 * 1024 }));
        }
        await sendVoice(ctx, Buffer.concat(parts));
      } catch (err) {
        console.error('tts failed:', err.message);
        await reply('⚠️ I could not make the voice note right now. Please try again later.');
      }
    },
  },
  {
    ...base,
    name: 'tovn',
    aliases: ['voicenote', 'toptt'],
    category: 'media',
    slow: true,
    description: 'Send audio or a video as a voice note: reply to it with tovn',
    async run(ctx) {
      await media.handle(ctx, ['audio', 'video'], `Reply to an audio or video with ${ctx.prefix}tovn`, async (found, buffer) => {
        await sendVoice(ctx, buffer, 'other');
      });
    },
  },
  {
    ...base,
    name: 'ocr',
    aliases: ['readtext', 'totext'],
    category: 'media',
    slow: true,
    description: 'Read the text in a picture: reply to an image with ocr',
    async run(ctx) {
      await media.handle(ctx, ['image'], `Reply to a picture with ${ctx.prefix}ocr`, async (found, buffer) => {
        let jpeg = buffer;
        try {
          jpeg = await media.loadSharp()(buffer, { failOn: 'none' }).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(); // the free service takes up to 1 MB
        } catch (err) {
          // sent as it is
        }
        const form = new FormData();
        form.append('apikey', store.getApiKey('ocr') || 'helloworld');
        form.append('language', 'eng');
        form.append('OCREngine', '2');
        form.append('scale', 'true');
        form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'image.jpg');
        const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
        const j = await res.json();
        const text = (j.ParsedResults || []).map((r) => r.ParsedText || '').join('\n').trim();
        if (!text) return ctx.reply(j.IsErroredOnProcessing ? '⚠️ *The text reader could not process that picture.* Try a clearer or smaller one.' : '🔎 *I could not find any text in that picture.*');
        await ctx.reply(`📝 *Text found:*\n\n${text.slice(0, 3500)}`);
      });
    },
  },
  {
    ...base,
    name: 'removebg',
    aliases: ['nobg', 'rmbg'],
    category: 'media',
    slow: true,
    description: 'Remove the background of a picture: reply to an image with removebg (the owner can send the API key with removebg <key>)',
    async run(ctx) {
      const { args, isOwner, reply, prefix } = ctx;
      // the owner sends the key: it is checked and saved by the bot itself
      if (isOwner && args[0] && apikeys.LOOKS_LIKE_KEY.test(args[0])) return reply(await apikeys.save(ctx, 'removebg', args[0]));
      const key = store.getApiKey('removebg');
      if (!key) {
        return reply(isOwner ? `🔑 *This needs a free remove.bg key.*\nGet one at remove.bg/api, then send it here:\n\`${prefix}removebg <your key>\`` : media.NOT_HERE);
      }
      await media.handle(ctx, ['image'], `Reply to a picture with ${prefix}removebg`, async (found, buffer) => {
        const form = new FormData();
        form.append('size', 'auto');
        form.append('image_file', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');
        const res = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form, signal: AbortSignal.timeout(45000) });
        if (res.status === 401 || res.status === 403) return ctx.reply(isOwner ? `⚠️ *remove.bg refused the key.* Send a new one: \`${prefix}removebg <your key>\`` : '⚠️ *This feature is not working right now.*');
        if (res.status === 402) return ctx.reply('⚠️ *The remove.bg free credits are finished* for this month.');
        if (!res.ok) throw new Error(`remove.bg answered ${res.status}`);
        const png = Buffer.from(await res.arrayBuffer());
        // sent as a file so the transparent background is kept
        await ctx.sock.sendMessage(ctx.jid, { document: png, mimetype: 'image/png', fileName: 'no-background.png' }, { quoted: ctx.msg });
      });
    },
  },
  {
    ...base,
    name: 'image',
    aliases: ['img', 'pic'],
    category: 'media',
    slow: true,
    description: 'Search for a picture: image sunset beach (the best match, not a random one)',
    async run({ sock, jid, msg, rest, reply, prefix }) {
      if (!rest) return reply(`*Usage:* \`${prefix}image <what to look for>\`\n*Example:* \`${prefix}image red ferrari f40\``);
      const query = rest.replace(/["“”]/g, '').trim().slice(0, 100);
      const asked = songmatch.tokens(query);
      // how many of the asked words does a result's title / tags contain? (0..1)
      const fit = (text) => {
        const have = new Set(songmatch.tokens(text, true));
        return asked.length ? asked.filter((t) => have.has(t) || [...have].some((h) => h.length > 3 && t.length > 3 && (h.startsWith(t) || t.startsWith(h)))).length / asked.length : 0;
      };
      const found = [];
      try {
        const j = await web.getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=20&mature=false&filter_dead=true`, { timeout: 12000 });
        (j.results || []).forEach((r, i) => {
          const url = r.thumbnail || r.url;
          if (url) found.push({ url, score: fit(`${r.title || ''} ${(r.tags || []).map((t) => t.name).join(' ')}`) - i * 0.002, title: r.title, credit: r.creator, license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), page: r.foreign_landing_url });
        });
      } catch (err) {
        console.error('image search (Openverse) failed:', err.message);
      }
      try {
        const j = await web.getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=1000&format=json&origin=*`, { timeout: 12000 });
        Object.values(j.query?.pages || {}).forEach((p) => {
          const ii = p.imageinfo?.[0];
          if (ii && /^image\/(jpeg|png)/.test(ii.mime || '') && (ii.thumburl || ii.url)) {
            found.push({ url: ii.thumburl || ii.url, score: fit(String(p.title || '').replace(/^File:/, '').replace(/\.\w+$/, '')) - 0.01, title: String(p.title || '').replace(/^File:/, '').replace(/\.\w+$/, ''), license: 'Wikimedia Commons', page: ii.descriptionurl });
          }
        });
      } catch (err) {
        console.error('image search (Commons) failed:', err.message);
      }
      // only a picture that really matches what was asked: a wrong picture is worse than no picture
      const good = found.filter((f) => f.score >= 0.55).sort((a, b) => b.score - a.score);
      if (!good.length) return reply(`🔎 *I could not find a picture that matches "${query.slice(0, 40)}".*\nTry other or fewer words, for example the name of the thing only.`);
      for (const r of good.slice(0, 4)) {
        try {
          await assertPublicUrl(r.url);
          const buffer = await web.getBuffer(r.url, { timeout: 15000, max: 5 * 1024 * 1024 });
          const credit = `🖼️ *${String(r.title || query).slice(0, 80)}*\n${r.credit ? `📸 ${String(r.credit).slice(0, 50)}\n` : ''}📄 ${r.license}\n${r.page ? `🔗 ${r.page}` : ''}`;
          return await sock.sendMessage(jid, { image: buffer, caption: credit.trim() }, { quoted: msg });
        } catch (err) {
          // the next best one
        }
      }
      await reply('⚠️ *I found pictures but could not download them.* Please try again.');
    },
  },
  {
    ...base,
    name: 'ssweb',
    aliases: ['screenshot', 'ss'],
    category: 'media',
    slow: true,
    description: 'A screenshot of a website: ssweb https://example.com',
    async run({ sock, jid, msg, args, reply, prefix }) {
      let url = (args[0] || '').trim();
      if (!url) return reply(`*Usage:* \`${prefix}ssweb https://example.com\``);
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        await assertPublicUrl(url);
      } catch (err) {
        return reply('⚠️ That address is not a public website.');
      }
      try {
        const buffer = await web.getBuffer(`https://image.thum.io/get/width/1280/crop/900/noanimate/${url}`, { timeout: 40000, max: 6 * 1024 * 1024 });
        await sock.sendMessage(jid, { image: buffer, caption: `🖥️ ${url.slice(0, 200)}` }, { quoted: msg });
      } catch (err) {
        console.error('ssweb failed:', err.message);
        await reply('⚠️ I could not take a screenshot of that site right now.');
      }
    },
  },
  {
    ...base,
    name: 'shorten',
    aliases: ['short', 'tinyurl'],
    category: 'tools',
    description: 'Make a long link short: shorten https://example.com/very/long/link',
    async run({ args, reply, prefix }) {
      let url = (args[0] || '').trim();
      if (!url) return reply(`*Usage:* \`${prefix}shorten https://example.com/very/long/link\``);
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        await assertPublicUrl(url);
        const j = await web.getJson(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`, { timeout: 10000 });
        if (!j.shorturl) throw new Error(j.errormessage || 'no short link');
        await reply(`🔗 *Short link*\n${j.shorturl}`);
      } catch (err) {
        await reply('⚠️ I could not shorten that link. Check that it is a real web address.');
      }
    },
  },
];

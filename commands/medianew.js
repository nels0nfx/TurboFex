// New download and media commands (v1.0.7): spotify, facebook, twitter, pinterest, soundcloud, ytthumb, emojimix, tovideo, collage, resize
const media = require('../whatsapp/media');
const web = require('../core/web');
const safefetch = require('../core/safefetch');
const { downloadAudio, downloadVideo, youtubeId } = require('../core/ytdlp');
const { getQuoted, quotedText } = require('../whatsapp/utils');

const dl = { category: 'download', slow: true, weight: 'heavy', needs: [] };
const mm = { category: 'media', slow: true, needs: [] };

// the first web address in a text (also one typed without https://)
function linkIn(text) {
  const m = /https?:\/\/\S+/i.exec(text || '') || /\b((?:[a-z0-9-]+\.)+[a-z]{2,}\/\S+)/i.exec(text || '');
  if (!m) return null;
  return /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[1]}`;
}
const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (err) {
    return '';
  }
};
const hostIs = (url, ...names) => names.some((n) => hostOf(url) === n || hostOf(url).endsWith(`.${n}`));
const textOf = (ctx) => ctx.rest || quotedText(getQuoted(ctx.msg)) || '';

// the content of <meta property="..."> from a web page
function metaContent(html, prop) {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return web.decode((a || b || [])[1] || '');
}

function nice(ctx, err, what) {
  console.error(`${what} failed:`, err.message);
  const { reply, isOwner, prefix } = ctx;
  if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
  if (err.code === 'BOT_BLOCK') return reply(isOwner ? `⚠️ The site blocked this server.\n🍪 Fix: send a cookies.txt with *${prefix}ytcookies*.` : '⚠️ I could not download that right now. Please try another link or try again later.');
  return reply(`⚠️ I could not get that.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ' Check the link and try again.'}`);
}

// a link from one site is handed to the normal video downloader (the dl command)
const siteVideo = (name, aliases, test, description, example) => ({
  ...dl,
  name,
  aliases,
  description,
  async run(ctx) {
    const link = linkIn(textOf(ctx));
    if (!link) return ctx.reply(`Send a link.\nExample: ${ctx.prefix}${name} ${example}`);
    if (!test(link)) return ctx.reply(`⚠️ That is not a ${name} link. Example: ${example}`);
    return require('./dl').run({ ...ctx, rest: link });
  },
});

module.exports = [
  {
    ...dl,
    weight: 'medium',
    name: 'spotify',
    aliases: ['spot', 'spotifysong'],
    description: 'Get a song from a Spotify link or its name: spotify <link or artist and song> (sends the audio)',
    async run(ctx) {
      const { reply, prefix } = ctx;
      const link = linkIn(textOf(ctx));
      if (!textOf(ctx)) return reply(`Send a Spotify song link or a song name.\nExample: ${prefix}spotify https://open.spotify.com/track/...\nExample: ${prefix}spotify calm down rema`);
      let query = textOf(ctx).trim();
      if (link && hostIs(link, 'spotify.com', 'spotify.link')) {
        try {
          const page = await safefetch.get(link, { timeout: 9000, maxBytes: 600 * 1024 });
          const html = page.body.toString('utf8');
          if (/\/(album|playlist|artist|show|episode)\//i.test(page.url)) return reply('⚠️ *Please send the link of one song* (a track), not an album, playlist or artist.');
          const title = metaContent(html, 'og:title');
          const parts = metaContent(html, 'og:description').split(/\s·\s/).map((p) => p.trim());
          const artist = parts.find((p) => p && p.toLowerCase() !== title.toLowerCase() && !/^\d{4}$/.test(p)) || '';
          if (!title) throw new Error('no title in the page');
          query = `${artist} ${title}`.trim();
          await reply(`🎧 *${title}*${artist ? ` - ${artist}` : ''}\n⏳ Getting the audio...`);
        } catch (err) {
          return nice(ctx, err, 'spotify');
        }
      } else if (link) {
        return reply('⚠️ *That is not a Spotify link.* Send a Spotify song link or just the song name.');
      }
      return require('./play').run({ ...ctx, rest: query });
    },
  },

  siteVideo('facebook', ['fb', 'fbvideo'], (l) => hostIs(l, 'facebook.com', 'fb.watch', 'fb.com'), 'Download a Facebook video from its link: facebook <link>', 'https://fb.watch/...'),
  siteVideo('twitter', ['x', 'xvideo', 'tweet'], (l) => hostIs(l, 'twitter.com', 'x.com', 'fxtwitter.com', 'vxtwitter.com'), 'Download the video of a Twitter / X post: twitter <link>', 'https://x.com/user/status/...'),

  {
    ...dl,
    name: 'pinterest',
    aliases: ['pinvideo', 'pinimg'],
    description: 'Download a Pinterest video or picture from its link: pinterest <link>',
    async run(ctx) {
      const { sock, jid, msg, reply, prefix } = ctx;
      const link = linkIn(textOf(ctx));
      if (!link) return reply(`Send a link.\nExample: ${prefix}pinterest https://pin.it/...`);
      if (!hostIs(link, 'pinterest.com', 'pin.it') && !/^pinterest\./i.test(hostOf(link).replace(/^www\./, ''))) return reply('⚠️ That is not a Pinterest link. Example: https://pin.it/...');
      await reply('⏳ Getting your pin...');
      try {
        const v = await downloadVideo(link, { onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
        const caption = `📌 *${v.title || 'Pinterest'}*`;
        if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
        return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `pin${v.ext}`, caption }, { quoted: msg });
      } catch (err) {
        if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
        // a pin with only a picture: the picture of the page is sent in full size
        try {
          const page = await safefetch.get(link, { timeout: 9000, maxBytes: 600 * 1024 });
          const html = page.body.toString('utf8');
          const image = metaContent(html, 'og:image').replace(/\/(?:\d+x\d*|\d*x\d+)\//, '/originals/');
          if (!/^https:\/\//i.test(image)) throw new Error('no picture in the page');
          const img = await web.getBuffer(image, { timeout: 15000, max: 8 * 1024 * 1024 });
          return await sock.sendMessage(jid, { image: img, caption: `📌 *${metaContent(html, 'og:title') || 'Pinterest'}*` }, { quoted: msg });
        } catch (err2) {
          return nice(ctx, err2, 'pinterest');
        }
      }
    },
  },

  {
    ...dl,
    weight: 'medium',
    name: 'soundcloud',
    aliases: ['sc', 'scsong'],
    description: 'Get a song from SoundCloud: soundcloud <link or name> (sends the audio)',
    async run(ctx) {
      const { sock, jid, msg, reply, prefix } = ctx;
      const target = textOf(ctx).trim();
      if (!target) return reply(`Send a SoundCloud link or a name.\nExample: ${prefix}soundcloud burna boy last last`);
      const link = linkIn(target);
      if (link && !hostIs(link, 'soundcloud.com')) return reply('⚠️ That is not a SoundCloud link. Send a soundcloud.com link or just a song name.');
      await reply('⏳ Getting your audio, one moment...');
      try {
        const a = await downloadAudio(link || target, { source: 'soundcloud', onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
        const lines = [`🎵 *${a.title || 'Audio'}*`, a.artist && `👤 ${a.artist}`, a.duration && `⏱️ ${a.duration}`, a.url && `🔗 ${a.url}`].filter(Boolean);
        await sock.sendMessage(jid, { text: lines.join('\n') }, { quoted: msg });
        return await sock.sendMessage(jid, { audio: a.buffer, mimetype: a.mimetype });
      } catch (err) {
        return nice(ctx, err, 'soundcloud');
      }
    },
  },

  {
    ...dl,
    weight: 'light',
    slow: false,
    name: 'ytthumb',
    aliases: ['thumbnail', 'ytimage'],
    description: 'Get the thumbnail picture of a YouTube video: ytthumb <link>',
    async run(ctx) {
      const { sock, jid, msg, reply, prefix } = ctx;
      const text = textOf(ctx).trim();
      const id = youtubeId(text) || (/^[\w-]{11}$/.test(text) ? text : null);
      if (!id) return reply(`Send a YouTube link.\nExample: ${prefix}ytthumb https://youtu.be/dQw4w9WgXcQ`);
      for (const size of ['maxresdefault', 'sddefault', 'hqdefault']) {
        try {
          const img = await web.getBuffer(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { timeout: 12000, max: 3 * 1024 * 1024 });
          return await sock.sendMessage(jid, { image: img, caption: '🖼️ *Thumbnail*' }, { quoted: msg });
        } catch (err) {
          // this size does not exist: the next one is tried
        }
      }
      return reply('⚠️ *I could not find that video.* Check the link.');
    },
  },

  {
    ...mm,
    weight: 'medium',
    name: 'emojimix',
    aliases: ['mix', 'emojikitchen'],
    description: 'Mix two emojis into one sticker: emojimix 😀 😎',
    async run(ctx) {
      const { sock, jid, msg, rest, reply, prefix, isOwner } = ctx;
      const found = String(rest || '').match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu) || [];
      if (found.length < 2) return reply(`🎨 *Usage:* \`${prefix}emojimix 😀 😎\`\n_Two emojis make one new sticker._`);
      try {
        const png = await web.getBuffer(`https://emojik.vercel.app/s/${encodeURIComponent(found[0])}_${encodeURIComponent(found[1])}?size=512`, { timeout: 15000, max: 3 * 1024 * 1024 });
        const webp = await media.toSticker('image', png);
        return await sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
      } catch (err) {
        console.error('emojimix failed:', err.message);
        if (err.code === 'NEED_SHARP') return reply(isOwner ? '⚠️ This needs the "sharp" package, which is not installed on this server.' : media.NOT_HERE);
        return reply('⚠️ *These two emojis do not mix* (or the mixing service is not answering). Try two other emojis.');
      }
    },
  },

  {
    ...mm,
    weight: 'medium',
    name: 'tovideo',
    aliases: ['stickertovideo', 'tomp4'],
    description: 'Turn a sticker into a video you can save: reply to the sticker with tovideo',
    async run(ctx) {
      await media.handle(ctx, ['sticker'], `Reply to a sticker with \`${ctx.prefix}tovideo\`.`, async (found, buffer) => {
        const sharp = media.loadSharp();
        const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        let mp4;
        if (found.animated) {
          const gif = await sharp(buffer, { animated: true }).gif().toBuffer();
          mp4 = await media.ffmpeg(gif, 'mp4', (i, o) => ['-i', i, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', even, o]);
        } else {
          const png = await sharp(buffer).png().toBuffer();
          mp4 = await media.ffmpeg(png, 'mp4', (i, o) => ['-loop', '1', '-i', i, '-t', '3', '-r', '25', '-pix_fmt', 'yuv420p', '-vf', even, o]);
        }
        await ctx.sock.sendMessage(ctx.jid, { video: mp4, mimetype: 'video/mp4', gifPlayback: !!found.animated, caption: '🎞️ Here is your video' }, { quoted: ctx.msg });
      });
    },
  },

  {
    ...mm,
    weight: 'medium',
    name: 'collage',
    aliases: ['membercollage', 'gridpic'],
    groupOnly: true,
    description: 'Make one picture from the profile pictures of the group members',
    async run(ctx) {
      const { sock, jid, msg, reply, groupMetadata: meta, isOwner } = ctx;
      try {
        const sharp = media.loadSharp();
        const members = (meta?.participants || []).map((p) => p.id).slice(0, 25);
        const tiles = [];
        await Promise.all(
          members.map(async (id) => {
            try {
              const url = await sock.profilePictureUrl(id, 'image');
              if (!url) return;
              const buf = await web.getBuffer(url, { timeout: 8000, max: 2 * 1024 * 1024 });
              tiles.push(await sharp(buf).resize(240, 240, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer());
            } catch (err) {
              // this person has no picture (or hides it)
            }
          })
        );
        if (tiles.length < 2) return reply('⚠️ *Not enough profile pictures.* Most members hide theirs, or have none.');
        const cols = Math.ceil(Math.sqrt(tiles.length));
        const rows = Math.ceil(tiles.length / cols);
        const out = await sharp({ create: { width: cols * 240, height: rows * 240, channels: 3, background: '#111111' } })
          .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 240, top: Math.floor(i / cols) * 240 })))
          .jpeg({ quality: 85 })
          .toBuffer();
        return await sock.sendMessage(jid, { image: out, caption: `🖼️ *${meta?.subject || 'The group'}* - ${tiles.length} members` }, { quoted: msg });
      } catch (err) {
        console.error('collage failed:', err.message);
        if (err.code === 'NEED_SHARP') return reply(isOwner ? '⚠️ This needs the "sharp" package, which is not installed on this server.' : media.NOT_HERE);
        return reply('⚠️ I could not make the collage right now. Please try again later.');
      }
    },
  },

  {
    ...mm,
    weight: 'medium',
    name: 'resize',
    aliases: ['shrink', 'scalepic'],
    description: 'Change the size of a picture: reply to it with resize 50% or resize 800 or resize 800x600',
    async run(ctx) {
      const { args, prefix } = ctx;
      const spec = (args.find((a) => /^\d+(%|x\d+)?$/i.test(a)) || '').toLowerCase();
      const asFile = args.some((a) => ['file', 'doc', 'document'].includes(a.toLowerCase()));
      const help = `Reply to a picture with:\n▸ \`${prefix}resize 50%\` (half the size)\n▸ \`${prefix}resize 800\` (800 wide)\n▸ \`${prefix}resize 800x600\` (fits inside 800 by 600)\n_Add_ \`file\` _to get it as a file without WhatsApp compression._`;
      if (!spec) return ctx.reply(`📐 *Resize a picture*\n${help}`);
      await media.handle(ctx, ['image'], help, async (found, buffer) => {
        const sharp = media.loadSharp();
        const meta = await sharp(buffer).metadata();
        const w0 = meta.width;
        const h0 = meta.height;
        if (!w0 || !h0) throw new Error('I cannot read that picture.');
        let w;
        let h;
        if (spec.endsWith('%')) {
          const p = parseInt(spec, 10);
          if (p < 5 || p > 400) return ctx.reply('⚠️ *The percentage must be between 5% and 400%.*');
          w = Math.round((w0 * p) / 100);
          h = Math.round((h0 * p) / 100);
        } else if (spec.includes('x')) {
          [w, h] = spec.split('x').map(Number);
        } else {
          w = parseInt(spec, 10);
        }
        if (w < 16 || w > 4096 || (h && (h < 16 || h > 4096))) return ctx.reply('⚠️ *The size must be between 16 and 4096 pixels.*');
        const png = meta.format === 'png';
        const pipeline = sharp(buffer).rotate().resize(w, h || null, { fit: 'inside', withoutEnlargement: false });
        const out = await (png ? pipeline.png() : pipeline.jpeg({ quality: 90 })).toBuffer();
        const after = await sharp(out).metadata();
        const caption = `📐 ${after.width}x${after.height} _(was ${w0}x${h0})_`;
        if (asFile) return ctx.sock.sendMessage(ctx.jid, { document: out, mimetype: png ? 'image/png' : 'image/jpeg', fileName: `resized.${png ? 'png' : 'jpg'}`, caption }, { quoted: ctx.msg });
        return ctx.sock.sendMessage(ctx.jid, { image: out, caption }, { quoted: ctx.msg });
      });
    },
  },
];

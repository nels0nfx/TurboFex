// play: always sends AUDIO. A song name or a link from almost any site (YouTube, TikTok, SoundCloud, Instagram,
// Facebook... anything the downloader supports) or a direct link to an audio file.
const { downloadAudio, titleOf, searchFlat, youtubeId, MAX_MB, MAX_SECONDS } = require('../core/ytdlp');
const ytsearch = require('../core/ytsearch');
const songmatch = require('../core/songmatch');
const piped = require('../core/piped');
const audius = require('../core/audius');
const { readLimited } = require('../core/download');

const MAX_BYTES = MAX_MB * 1024 * 1024;
const DIRECT_AUDIO = /\.(mp3|m4a|ogg|opus|wav|aac|flac)(\?|#|$)/i;

async function sendAudio(sock, jid, msg, a) {
  const lines = [`🎵 *${a.title || 'Audio'}*`, a.artist && `👤 ${a.artist}`, a.duration && `⏱️ ${a.duration}`, a.url && `🔗 ${a.url}`].filter(Boolean);
  await sock.sendMessage(jid, { text: lines.join('\n') }, { quoted: msg });
  return sock.sendMessage(jid, { audio: a.buffer, mimetype: a.mimetype });
}

module.exports = {
  name: 'play',
  category: 'media',
  slow: true,
  weight: 'medium',
  needs: [],
  aliases: ['song', 'audio'],
  description: 'play <artist and song, or a link>: sends the audio (no cookies needed; YouTube, TikTok, SoundCloud and more)',
  async run({ sock, jid, msg, rest, reply, prefix, isOwner }) {
    if (!rest) return reply(`Type a song name or a link.\n${prefix}play calm down\n${prefix}play https://youtu.be/...`);
    const nice = (err, fallback) => `⚠️ ${fallback}${isOwner ? `\nReason: ${String(err.message).slice(0, 140)}` : ''}`;

    // a direct link to an audio file
    if (/^https?:\/\/\S+$/i.test(rest) && DIRECT_AUDIO.test(rest)) {
      try {
        const res = await fetch(rest, { redirect: 'follow', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'TurboFex' } });
        if (res.ok) {
          const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (Number(res.headers.get('content-length')) <= MAX_BYTES) {
            const buffer = await readLimited(res, MAX_BYTES);
            return sock.sendMessage(jid, { audio: buffer, mimetype: type.startsWith('audio/') ? type : 'audio/mpeg' }, { quoted: msg });
          }
        }
      } catch (err) {
        // the downloader below tries as well
      }
    }

    await reply('⏳ Getting your audio, one moment...');
    const setup = { onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') };
    const isLink = /^https?:\/\//i.test(rest);
    const log = (what, err) => console.error(`Play (${what}) failed:`, err.message);
    let problem;

    // ---- A link: get exactly that. If it fails, find the same song by its title (only a CLOSE match is accepted).
    let query = isLink ? '' : rest;
    let wantedId = isLink ? youtubeId(rest) : null;
    if (isLink) {
      try {
        return await sendAudio(sock, jid, msg, await downloadAudio(rest, setup));
      } catch (err) {
        problem = err;
        log('link', err);
        if (err.code === 'TOO_LONG' || err.code === 'TOO_BIG') return reply(`⚠️ ${err.message}`);
      }
      if (wantedId) {
        try {
          return await sendAudio(sock, jid, msg, await piped.getAudio(wantedId, { maxBytes: MAX_BYTES, maxSeconds: MAX_SECONDS }));
        } catch (err) {
          log('Piped', err);
        }
        query = await titleOf(rest);
      }
    }

    // ---- A song name: look at SEVERAL results and pick the one that really is the song (not a cover, remix or 1 hour mix)
    let picks = [];
    if (query && !isLink) {
      try {
        picks = songmatch.rank(await searchFlat(query, { source: 'youtube', limit: 10, onSetup: setup.onSetup }), query);
      } catch (err) {
        log('search', err);
        try {
          picks = songmatch.rank(await ytsearch.search(query, 10), query); // the search page itself, when the downloader cannot search
        } catch (err2) {
          log('search page', err2);
        }
      }
      const good = picks.filter((p) => p.coverage >= 0.5);
      if (good.length) picks = good;
      // download the best two (the first one can be blocked or too long while the second is fine)
      for (const pick of picks.slice(0, 2)) {
        try {
          return await sendAudio(sock, jid, msg, await downloadAudio(pick.url, setup));
        } catch (err) {
          problem = err;
          log(`YouTube ${pick.id}`, err);
          if (err.code === 'TOO_BIG') return reply(`⚠️ ${err.message}`);
        }
      }
      // YouTube blocks this server (no cookies): the same video through a Piped server
      for (const pick of picks.slice(0, 2)) {
        try {
          return await sendAudio(sock, jid, msg, await piped.getAudio(pick.id, { maxBytes: MAX_BYTES, maxSeconds: MAX_SECONDS }));
        } catch (err) {
          log(`Piped ${pick.id}`, err);
        }
      }
    }

    // ---- Other sites. A wrong song is worse than no song, so only a close match is accepted here.
    if (query) {
      try {
        const [best] = songmatch.rank(await searchFlat(query, { source: 'soundcloud', limit: 6 }), query);
        if (songmatch.isClose(best)) return await sendAudio(sock, jid, msg, await downloadAudio(best.url, setup));
      } catch (err) {
        log('SoundCloud', err);
      }
      try {
        const found = songmatch.rank((await audius.search(query, 6)).map((t) => ({ ...t, channel: t.artist })), query);
        if (songmatch.isClose(found[0])) {
          const t = found[0];
          const buffer = await audius.download(t);
          return await sendAudio(sock, jid, msg, { buffer, mimetype: 'audio/mpeg', title: t.title, artist: t.artist, duration: t.duration, url: t.url });
        }
      } catch (err) {
        log('Audius', err);
      }
    }

    if (problem?.code === 'BOT_BLOCK' || (!picks.length && !isLink)) {
      return reply(isOwner ? `⚠️ I could not get that song. YouTube blocks this server and no other source had it.\n🍪 Optional fix: send a cookies.txt with *${prefix}ytcookies*. (You can also set PIPED_INSTANCES to your own Piped server.)` : '⚠️ I could not find that song right now. Please try another name, add the artist, or try again later.');
    }
    return reply(nice(problem || new Error('no match'), 'I could not find that exact song. Try the artist and the title, for example: play rema calm down'));
  },
};

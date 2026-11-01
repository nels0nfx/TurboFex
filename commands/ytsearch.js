// YouTube search with a download option:
//   ytsearch <words>        shows the top 5 results
//   ytsearch video <number> downloads that result as a video
//   ytsearch audio <number> downloads that result as an MP3
// The last results of each person are saved (data/ytsearch-results.json), so the numbers still work after a restart.
const ytdlp = require('../core/ytdlp');
const jsonstore = require('../core/jsonstore');

const KEEP_MS = 30 * 60 * 1000; // a result list is valid for 30 minutes
const MAX_LISTS = 300;
const js = jsonstore.open('ytsearch-results', { lists: {} }, { delay: 500 });

const mins = (s) => {
  const n = Math.round(Number(s) || 0);
  return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : 'live';
};

function forget() {
  const now = Date.now();
  const lists = js.data.lists;
  for (const k of Object.keys(lists)) if (now - lists[k].at > KEEP_MS) delete lists[k];
  const keys = Object.keys(lists);
  if (keys.length > MAX_LISTS) for (const k of keys.slice(0, keys.length - MAX_LISTS)) delete lists[k];
}

module.exports = {
  name: 'ytsearch',
  aliases: ['yts', 'ytfind'],
  category: 'media',
  slow: true,
  weight: 'heavy',
  needs: [],
  description: 'Search YouTube and download a result: ytsearch <words>, then ytsearch video 2 or ytsearch audio 2',
  async run({ sock, jid, msg, args, rest, reply, prefix, myIds, isOwner }) {
    const key = `${jid}|${(myIds && myIds[0]) || jid}`;
    const first = String(args[0] || '').toLowerCase();

    // ----- download one of the saved results -----
    if (['video', 'audio', 'mp3', 'dl'].includes(first) && /^\d+$/.test(args[1] || '')) {
      const kind = first === 'video' || first === 'dl' ? 'video' : 'audio';
      const list = js.data.lists[key];
      if (!list || Date.now() - list.at > KEEP_MS) return reply(`Search first: ${prefix}ytsearch <words> (the list is kept for 30 minutes).`);
      const item = list.items[Number(args[1]) - 1];
      if (!item) return reply(`Pick a number from 1 to ${list.items.length}.`);
      await reply(`⏳ Downloading ${kind === 'video' ? 'the video' : 'the audio'}: *${item.title.slice(0, 70)}*`);
      const onSetup = () => reply('⏳ Setting up the downloader (first time only, about a minute)...');
      try {
        if (kind === 'video') {
          const v = await ytdlp.downloadVideo(item.url, { onSetup });
          const caption = [`🎬 *${v.title || item.title}*`, v.artist && `👤 ${v.artist}`, v.duration && `⏱️ ${v.duration}`].filter(Boolean).join('\n');
          if (v.ext === '.mp4') return await sock.sendMessage(jid, { video: v.buffer, mimetype: 'video/mp4', caption }, { quoted: msg });
          return await sock.sendMessage(jid, { document: v.buffer, mimetype: v.mimetype, fileName: `${(v.title || 'video').slice(0, 60)}${v.ext}`, caption }, { quoted: msg });
        }
        const a = await ytdlp.downloadAudio(item.url, { onSetup });
        return await sock.sendMessage(jid, { audio: a.buffer, mimetype: a.mimetype }, { quoted: msg });
      } catch (err) {
        console.error('ytsearch download failed:', err.message);
        if (['TOO_LONG', 'TOO_BIG', 'BLOCKED'].includes(err.code)) return reply(`⚠️ ${err.message}`);
        if (err.code === 'BOT_BLOCK') return reply(isOwner ? `⚠️ YouTube blocked this server.\n🍪 Fix: send a cookies.txt with *${prefix}ytcookies*.` : '⚠️ YouTube is not answering right now. Try again later.');
        return reply(`⚠️ I could not download that.${isOwner ? `\nReason: ${String(err.message).slice(0, 120)}` : ' Try another result.'}`);
      }
    }
    if (['video', 'audio', 'mp3', 'dl'].includes(first)) return reply(`Say which result: ${prefix}ytsearch ${first} 2`);

    // ----- a new search -----
    if (!rest) return reply(`Search YouTube: ${prefix}ytsearch <words>\nThen: ${prefix}ytsearch video 1  or  ${prefix}ytsearch audio 1`);
    await reply('🔎 Searching YouTube...');
    let items = [];
    try {
      items = await ytdlp.searchFlat(rest, { limit: 5, onSetup: () => reply('⏳ Setting up the downloader (first time only, about a minute)...') });
    } catch (err) {
      try {
        items = (await require('../core/ytsearch').search(rest, 5)).map((r) => ({ id: r.id, title: r.title, channel: r.channel, duration: 0, durationText: r.duration, url: `https://www.youtube.com/watch?v=${r.id}` }));
      } catch (err2) {
        console.error('ytsearch failed:', err2.message);
        return reply(`⚠️ The search did not work right now. Try again in a moment.${isOwner ? `\nReason: ${String(err2.message).slice(0, 120)}` : ''}`);
      }
    }
    items = items.slice(0, 5);
    if (!items.length) return reply('😕 I found nothing for that. Try other words.');
    forget();
    js.data.lists[key] = { at: Date.now(), items: items.map((i) => ({ id: i.id, title: i.title, channel: i.channel, url: i.url })) };
    js.touch();
    const lines = items.map((r, i) => `*${i + 1}.* ${r.title.slice(0, 80)}\n     👤 ${r.channel || '-'} · ⏱️ ${r.durationText || mins(r.duration)}`);
    return reply(`🔎 *YouTube: ${rest.slice(0, 50)}*\n\n${lines.join('\n\n')}\n\n▸ Video: *${prefix}ytsearch video 1*\n▸ Audio: *${prefix}ytsearch audio 1*`);
  },
};

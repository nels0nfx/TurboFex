// A way to get a YouTube song when YouTube blocks this server and there is no cookies.txt: public "Piped" servers give out the
// audio stream of a video without any login. They come and go, so several are tried, and you can use your own with
// PIPED_INSTANCES=https://your-piped-api.example,https://another.example (comma separated, the API address).
const { readLimited } = require('./download');
const { assertPublicUrl } = require('./safefetch');

const DEFAULTS = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee'];
const instances = () => (process.env.PIPED_INSTANCES ? process.env.PIPED_INSTANCES.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean) : DEFAULTS);

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// { buffer, mimetype, title, artist, duration, url } or throws
async function getAudio(videoId, { maxBytes, maxSeconds = 3600 } = {}) {
  let lastErr = new Error('no Piped server answered');
  for (const base of instances()) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, { headers: { 'User-Agent': 'TurboFex', Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`error ${res.status}`);
      const info = await res.json();
      if (info.duration && info.duration > maxSeconds) throw Object.assign(new Error(`That is longer than ${Math.round(maxSeconds / 60)} minutes.`), { code: 'TOO_LONG' });
      // the best m4a (plays on every phone) that fits the size limit
      const pick = (info.audioStreams || [])
        .filter((a) => a.url && /mp4|m4a/i.test(`${a.mimeType} ${a.format}`) && !a.videoOnly)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
        .find((a) => !a.contentLength || a.contentLength <= maxBytes);
      if (!pick) throw new Error('no usable audio stream');
      await assertPublicUrl(pick.url);
      const file = await fetch(pick.url, { redirect: 'follow', headers: { 'User-Agent': 'TurboFex' }, signal: AbortSignal.timeout(90000) });
      if (!file.ok) throw new Error(`stream error ${file.status}`);
      const buffer = await readLimited(file, maxBytes);
      return {
        buffer,
        mimetype: 'audio/mp4',
        title: info.title || '',
        artist: String(info.uploader || '').replace(/ - Topic$/i, ''),
        duration: info.duration ? mmss(info.duration) : '',
        url: `https://www.youtube.com/watch?v=${videoId}`,
      };
    } catch (err) {
      if (err.code === 'TOO_LONG') throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { getAudio, instances };

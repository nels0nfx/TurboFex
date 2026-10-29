const { readLimited } = require('./download');

const APP = 'TurboFex';
const BASE = 'https://api.audius.co/v1';
const MAX_BYTES = 25 * 1024 * 1024;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function search(query, limit = 3) {
  const res = await fetch(`${BASE}/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'TurboFex' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Audius answered with error ${res.status}`);
  const json = await res.json();
  return (json.data || [])
    .filter((t) => t && t.id && t.is_streamable !== false && (t.duration || 0) <= 12 * 60)
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      title: t.title || '(no title)',
      artist: t.user?.name || '',
      duration: t.duration ? mmss(t.duration) : '',
      url: t.permalink ? `https://audius.co${t.permalink}` : '',
    }));
}

async function download(track) {
  const res = await fetch(`${BASE}/tracks/${track.id}/stream?app_name=${APP}`, {
    redirect: 'follow',
    headers: { 'User-Agent': 'TurboFex' },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`Audius answered with error ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw Object.assign(new Error('That file is bigger than 25 MB.'), { code: 'TOO_BIG' });
  return readLimited(res, MAX_BYTES);
}

module.exports = { search, download };

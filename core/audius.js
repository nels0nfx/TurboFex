const { readLimited } = require('./download');

const APP = 'TurboFex';
const BASE = 'https://api.audius.co/v1';
const MAX_BYTES = 25 * 1024 * 1024;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function search(query, limit = 3) {
  const res = await fetch(`${BASE}/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'TurboFex/0.4' },
  });
  if (!res.ok) throw new Error(`Audius search failed: ${res.status}`);
  const data = await res.json();
  return (data.data || []).slice(0, limit).map((t) => ({
    id: t.id,
    title: t.title,
    user: t.user?.name || 'Unknown',
    duration: t.duration,
    durationText: mmss(t.duration),
    artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || null,
    streamUrl: `${BASE}/tracks/${t.id}/stream?app_name=${APP}`,
  }));
}

async function download(trackId) {
  const url = `${BASE}/tracks/${trackId}/stream?app_name=${APP}`;
  return readLimited(url, MAX_BYTES);
}

module.exports = { search, download };

const MAX = 25 * 1024 * 1024; // 25 MB

async function readLimited(url, maxBytes = MAX) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'TurboFex/0.4' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('File too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('File too large');
  return buf;
}

module.exports = { readLimited, MAX };

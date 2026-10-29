// Searches YouTube's public search page (no account or key needed) and returns the top results
async function search(query, limit = 3) {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`YouTube answered with error ${res.status}`);
  const html = await res.text();
  const m = /var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s.exec(html);
  if (!m) throw new Error('could not read the search page');
  const data = JSON.parse(m[1]);

  const out = [];
  (function walk(node) {
    if (out.length >= limit || !node || typeof node !== 'object') return;
    const v = node.videoRenderer;
    if (v?.videoId) {
      out.push({
        id: v.videoId,
        title: (v.title?.runs || []).map((r) => r.text).join('') || '(no title)',
        channel: v.ownerText?.runs?.[0]?.text || '',
        duration: v.lengthText?.simpleText || 'live',
        views: v.viewCountText?.simpleText || '',
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
      });
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  })(data);
  return out;
}

module.exports = { search };

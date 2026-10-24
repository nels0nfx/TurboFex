async function search(query, limit = 5) {
  // Lightweight YouTube search helper (no API key).
  // Returns basic title + url results for play / dl commands.
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return [];
  try {
    const res = await fetch(`https://www.youtube.com/results?search_query=${q}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TurboFex/0.4)' },
    });
    const html = await res.text();
    const results = [];
    const re = /"videoId":"([^"]+)".*?"title":\{"runs":\[\{"text":"([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) && results.length < limit) {
      results.push({ id: m[1], title: m[2], url: `https://www.youtube.com/watch?v=${m[1]}` });
    }
    return results;
  } catch {
    return [];
  }
}

module.exports = { search };

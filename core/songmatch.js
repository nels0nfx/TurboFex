// Picks the RIGHT song out of search results. The old play command took the first YouTube result, which is often a
// cover, a remix, a "slowed + reverb" copy, a live show or a one hour mix. Here every result gets a score from how
// well its title and channel match what was asked, and the ones that look like something else are pushed down.
const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ');

const FILLER = new Set(['the', 'a', 'an', 'by', 'feat', 'ft', 'featuring', 'official', 'audio', 'video', 'music', 'song', 'lyrics', 'lyric', 'hd', 'hq', 'and', 'of', 'x', 'with', 'prod', 'new']);

function tokens(s, keepFiller = false) {
  const out = strip(s).split(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff]+/).filter(Boolean);
  return keepFiller ? out : out.filter((t) => !FILLER.has(t));
}

// words that mean "a different version of the song". Allowed only when the person asked for them.
const VERSION_WORDS = ['cover', 'remix', 'live', 'slowed', 'reverb', 'sped', 'speed', 'nightcore', 'karaoke', 'instrumental', '8d', 'bassboosted', 'boosted', 'mashup', 'acoustic', 'reaction', 'tutorial', 'lesson', 'parody', 'flip', 'edit', 'version', 'piano', 'guitar', 'orchestra', 'minus', 'type', 'beat', 'loop', 'hour', 'hours', 'mix', 'playlist', 'compilation', 'album', 'jukebox', 'podcast', 'interview', 'dance', 'choreography', 'trailer', 'teaser', 'shorts', 'snippet', 'preview'];

// 215 or "3:35" or "1:02:03" -> seconds
function seconds(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '').split(':').map(Number);
  return parts.length > 1 && parts.every(Number.isFinite) ? parts.reduce((t, n) => t * 60 + n, 0) : Number(v) || 0;
}

// score of one result for the wanted song. { score, coverage } (coverage = share of the asked words found, 0..1)
function rate(item, query) {
  const want = tokens(query);
  const askedRaw = new Set(tokens(query, true));
  const title = tokens(item.title, true);
  const channel = tokens(item.channel, true);
  const have = new Set([...title, ...channel]);
  if (!want.length) return { score: 0, coverage: 0 };

  const found = want.filter((t) => have.has(t) || [...have].some((h) => h.length > 3 && t.length > 3 && (h.startsWith(t) || t.startsWith(h))));
  const coverage = found.length / want.length;
  let score = coverage * 140;

  // the title itself should hold the song words (a channel match alone is weaker)
  const inTitle = want.filter((t) => title.includes(t)).length / want.length;
  score += inTitle * 20;

  for (const w of VERSION_WORDS) {
    if (title.includes(w) && !askedRaw.has(w)) score -= w === 'live' || w === 'hour' || w === 'hours' || w === 'playlist' || w === 'album' ? 40 : 28;
  }
  // lots of extra words in the title = probably not just the song
  const extra = title.filter((t) => !FILLER.has(t) && !want.includes(t) && !VERSION_WORDS.includes(t)).length;
  score -= Math.max(0, extra - 4) * 2;

  const text = `${strip(item.title)} ${strip(item.channel)}`;
  if (/ - topic$/.test(strip(item.channel).trim())) score += 15; // YouTube's automatic channel with the original studio audio
  if (/official audio|official music video|official video|\(audio\)/.test(text)) score += 8;
  if (/vevo$/.test(strip(item.channel).replace(/\s/g, ''))) score += 6;

  const d = seconds(item.duration);
  if (Number.isFinite(d) && d > 0) {
    if (d < 60) score -= 45;
    else if (d < 100) score -= 12;
    else if (d >= 120 && d <= 480) score += 6;
    else if (d > 720) score -= 35;
  }
  return { score, coverage };
}

// the results best first: [{ ...item, score, coverage }]
function rank(items, query) {
  return (items || [])
    .map((it) => ({ ...it, ...rate(it, query) }))
    .sort((a, b) => b.score - a.score);
}

// Is this result close enough to be the song that was asked for? Used for the backup sources, where sending
// a wrong song is worse than saying "not found".
const MIN_COVERAGE = 0.75;
const isClose = (item) => item && item.coverage >= MIN_COVERAGE && item.score >= 60;

module.exports = { rate, rank, isClose, tokens, MIN_COVERAGE };

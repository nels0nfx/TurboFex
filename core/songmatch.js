// Picks the RIGHT song out of search results. The old play command took the first YouTube result, which is often a
// cover, a remix, a "slowed + reverb" copy, a live show or a one hour mix. Here every result gets a score from how
// well its title and channel match what was asked, and the ones that look like something else are pushed down.
const strip = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents of Latin letters
    .normalize('NFC') // put Korean, Hindi... letters back together (NFKD had taken them apart)
    .replace(/&/g, ' and ');

const FILLER = new Set(['the', 'a', 'an', 'by', 'feat', 'ft', 'featuring', 'official', 'audio', 'video', 'music', 'song', 'lyrics', 'lyric', 'hd', 'hq', 'and', 'of', 'x', 'with', 'prod', 'new']);

function tokens(s, keepFiller = false) {
  // letters and digits of ANY script (before, only Latin, Cyrillic, Arabic and Chinese counted: a song name in Hindi, Korean, Thai or Greek had no words at all)
  const out = strip(s).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  return keepFiller ? out : out.filter((t) => !FILLER.has(t));
}

// Small typing mistakes still match: one letter wrong, missing, extra or swapped in a word of 5+ letters that starts the same (two in a word
// of 8+), and two swapped letters in a 4 letter word. Words that only start the same (a prefix of 4+ letters) match too ("rihanna" / "rihann").
function editDistance(a, b) { // swaps count as one mistake
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
function same(t, h) {
  if (t === h) return true;
  if (t.length > 3 && h.length > 3 && (h.startsWith(t) || t.startsWith(h))) return true;
  const short = Math.min(t.length, h.length);
  if (short < 4 || t[0] !== h[0]) return false;
  // a 4 letter word is only forgiven for two swapped letters ("donw"), never for another word ("calm" / "call")
  if (short === 4) return t.length === h.length && [...t].sort().join('') === [...h].sort().join('') && editDistance(t, h) <= 1;
  return editDistance(t, h) <= (short >= 8 ? 2 : 1);
}

// how many of the asked words a result must have to be the song: all of them up to 3 words, then three quarters
const neededWords = (n) => (n <= 3 ? n : Math.ceil(n * 0.75));

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

  const found = want.filter((t) => have.has(t) || [...have].some((h) => same(t, h)));
  const coverage = found.length / want.length;
  let score = coverage * 140;

  // the asked words one after the other, in this order, in the title (or the channel and the title): the song itself, not a mix of words
  const flat = (arr) => ` ${arr.join(' ')} `;
  const phrase = tokens(query).length > 1 && (flat(title).includes(flat(want)) || flat([...channel, ...title]).includes(flat(want)));
  if (phrase) score += 45;

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
  return { score, coverage, matched: found.length, wanted: want.length, exact: phrase };
}

// the results best first: [{ ...item, score, coverage }]
function rank(items, query) {
  return (items || [])
    .map((it) => ({ ...it, ...rate(it, query) }))
    .sort((a, b) => b.score - a.score);
}

// Is this result close enough to be the song that was asked for? A wrong song is worse than saying "not found": all the asked words up to
// 3 words, three quarters of them after that, and a score that shows it is not a different version.
const MIN_COVERAGE = 0.75;
const isClose = (item) => item && item.coverage >= MIN_COVERAGE && item.score >= 60;
const isRight = (item) => !!item && item.wanted > 0 && item.matched >= neededWords(item.wanted) && item.score >= 60;

module.exports = { rate, rank, isClose, isRight, tokens, same, neededWords, MIN_COVERAGE };

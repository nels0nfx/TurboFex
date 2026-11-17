// Understanding near-misses: when somebody types a command that does not exist (".mneu"), find the one they most likely meant.
// Plain rules (spelling distance), no AI. It only ever looks at commands the sender is allowed to use, so it can never show a
// command that is hidden from that person.

// number of single-letter changes (add, remove, change, swap two neighbours) between two words
function distance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}

// short words may be 1 letter off, longer words 2
const limitFor = (len) => (len <= 4 ? 1 : 2);

// word: what was typed (any case). names: Map of command name or alias -> command. allowed(cmd): may THIS sender use it?
// Returns the command that was most likely meant, or null (nothing close, or two different commands are equally close).
function suggest(word, names, allowed) {
  const w = String(word || '').toLowerCase();
  if (!/^[a-z0-9]{3,20}$/.test(w) || names.has(w)) return null;
  const limit = limitFor(w.length);
  let best = null; let bestD = Infinity; let tie = false;
  for (const [key, cmd] of names) {
    if (Math.abs(key.length - w.length) > limit) continue;
    const dist = distance(w, key);
    if (dist > limit || dist === 0) continue;
    if (typeof allowed === 'function' && !allowed(cmd)) continue;
    if (dist < bestD) { best = cmd; bestD = dist; tie = false; } else if (dist === bestD && cmd !== best) tie = true;
  }
  return best && !tie ? best : null;
}

module.exports = { distance, suggest };

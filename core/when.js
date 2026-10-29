// Understands "10m", "2h", "1h30m", "1d", "45s" and clock times like "18:30"
const clock = require('./clock');

const MIN_MS = 30 * 1000;
const MAX_MS = 30 * 24 * 3600 * 1000;

// returns the moment (ms since 1970) or null
function parseWhen(token, now = Date.now()) {
  const t = String(token || '').trim().toLowerCase();

  const hhmm = clock.parseHHMM(t);
  if (hhmm) {
    const cur = clock.parts(new Date(now)).hhmm;
    const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
    let diff = toMin(hhmm) - toMin(cur);
    if (diff <= 0) diff += 1440; // that time already passed today: tomorrow
    return Math.floor(now / 60000) * 60000 + diff * 60000;
  }

  const m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || !t) return null;
  const ms = ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 1000;
  return ms >= MIN_MS && ms <= MAX_MS ? now + ms : null;
}

module.exports = { parseWhen };

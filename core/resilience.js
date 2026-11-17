// How the bot copes when a command keeps failing.
//  - classify(): is a failure temporary (network, timeout, a busy service) or a real bug?
//  - a command that fails again and again is paused for a few minutes (it "rests"), then it gets a fresh chance by itself
//  - one summary that other parts of the bot (status, alerts) read
// Everything is kept in memory only.
const cfg = { failures: 5, windowMs: 10 * 60 * 1000, restMs: 3 * 60 * 1000, retryMs: 1200 };
const retryMs = () => cfg.retryMs;
// the commands the owner needs to fix things are never paused
const NEVER = new Set(['menu', 'help', 'ping', 'status', 'update', 'plugin', 'server', 'restart', 'repair', 'again', 'autocorrect']);

const state = new Map(); // command -> { fails: [{ at, kind, why }], until: 0, told: 0 }

const TEMP = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|timed? ?out|fetch failed|network|\b(408|429|500|502|503|504)\b|rate.?limit|overloaded|temporarily|connection closed|too many requests/i;
function classify(err) {
  const text = `${err && err.code ? err.code + ' ' : ''}${err && err.message ? err.message : err}`;
  const status = err && (err.status || err.statusCode || (err.output && err.output.statusCode));
  if ([408, 429, 500, 502, 503, 504].includes(Number(status))) return 'temporary';
  return TEMP.test(text) ? 'temporary' : 'bug';
}

const rec = (name) => { if (!state.has(name)) state.set(name, { fails: [], until: 0, told: 0 }); return state.get(name); };
const fresh = (r, now) => { r.fails = r.fails.filter((f) => now - f.at < cfg.windowMs); return r.fails; };

// null when the command may run, or { secondsLeft, first } when it is resting (first: nobody was told in this rest yet)
function hold(name, now = Date.now()) {
  const r = state.get(name);
  if (!r || r.until <= now || NEVER.has(name)) return null;
  const first = r.told !== r.until; // the first person who runs into this rest is told; the others are not, so the chat stays quiet
  r.told = r.until;
  return { secondsLeft: Math.ceil((r.until - now) / 1000), first };
}
// a failure happened; returns { opened: true, why } when this one started a rest
function fail(name, kind, why, now = Date.now()) {
  if (NEVER.has(name)) return { opened: false };
  const r = rec(name); fresh(r, now).push({ at: now, kind, why: String(why || '').slice(0, 150) });
  if (r.fails.length >= cfg.failures && r.until <= now) {
    r.until = now + cfg.restMs; r.told = 0; r.fails = [];
    return { opened: true, why: String(why || '').slice(0, 150), minutes: Math.max(1, Math.round(cfg.restMs / 60000)) };
  }
  return { opened: false };
}
// the command worked: it is trusted again
function ok(name) { const r = state.get(name); if (r) { r.fails = []; r.until = 0; } }

// what is wrong right now, for status and alerts
function summary(now = Date.now()) {
  const resting = []; const failing = [];
  for (const [name, r] of state) {
    if (r.until > now) resting.push({ name, secondsLeft: Math.ceil((r.until - now) / 1000) });
    else { const n = fresh(r, now).length; if (n >= 2) failing.push({ name, count: n, last: r.fails[r.fails.length - 1].why }); }
  }
  return { resting, failing };
}
function configure(o) { Object.assign(cfg, o || {}); }
function reset() { state.clear(); }
module.exports = { retryMs, classify, hold, fail, ok, summary, configure, reset, NEVER };

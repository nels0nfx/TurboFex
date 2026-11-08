// Command rate limit per person. Protects a public bot from one person flooding it. The owner is never limited.
const store = require('./store');

const hits = new Map(); // person -> times of recent commands
const blocked = new Map(); // person -> until when
const BLOCK_MS = 30000;

// Returns { ok: true } or { ok: false, seconds, notify } (notify: true only for the first refusal of a block)
function check(who) {
  const cfg = store.rateCfg();
  if (!cfg.on || !who) return { ok: true };
  const now = Date.now();
  const until = blocked.get(who) || 0;
  if (until > now) return { ok: false, seconds: Math.ceil((until - now) / 1000), notify: false };
  const list = (hits.get(who) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(who, list);
  if (hits.size > 5000) hits.clear();
  if (list.length > cfg.limit) {
    blocked.set(who, now + BLOCK_MS);
    hits.delete(who);
    return { ok: false, seconds: BLOCK_MS / 1000, notify: true };
  }
  return { ok: true };
}

const reset = () => {
  hits.clear();
  blocked.clear();
};

module.exports = { check, reset };

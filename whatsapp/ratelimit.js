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

// A second, tighter guard only for the Empire's commands (purse, daily, give...): by default 8 in 20 seconds, then a 20 second pause (God sets the numbers).
// It protects the economy from spam even when the normal limit is high.
const eco = new Map();
const ecoBlocked = new Map();
const settings = require('../core/realm/settings');
require('../core/realm/aurum'); // registers the settings
const ECO = () => ({ window: settings.get('core.rateWindow') * 1000, max: settings.get('core.rateMax'), block: settings.get('core.rateBlock') * 1000 });
function checkEconomy(who) {
  const cfg = store.rateCfg();
  if (!cfg.on || !who) return { ok: true };
  const now = Date.now();
  const until = ecoBlocked.get(who) || 0;
  if (until > now) return { ok: false, seconds: Math.ceil((until - now) / 1000), notify: false };
  const E = ECO();
  const list = (eco.get(who) || []).filter((t) => now - t < E.window);
  list.push(now);
  eco.set(who, list);
  if (eco.size > 5000) eco.clear();
  if (list.length > E.max) {
    ecoBlocked.set(who, now + E.block);
    eco.delete(who);
    return { ok: false, seconds: E.block / 1000, notify: true };
  }
  return { ok: true };
}

const reset = () => {
  hits.clear();
  blocked.clear();
  eco.clear();
  ecoBlocked.clear();
};

module.exports = { check, checkEconomy, reset };

// Ranks: members earn XP for chatting (at most once every 45 seconds) and reach levels.
const crypto = require('crypto');
const jsonstore = require('../core/jsonstore');
const { num } = require('./utils');
const idmap = require('./idmap');

const js = jsonstore.open('levels', {}); // { group: { member: { x: xp, j: jid } } }
const lastXp = new Map();
const GAP_MS = 45000;

// One person = one key: the phone number when it is known (the same person can arrive as a phone number or as a hidden id)
function keyOf(jid) {
  const pn = idmap.isLid(jid) ? idmap.pnSync(jid) : null;
  return num(pn || jid);
}

const level = (xp) => Math.floor(Math.sqrt(xp / 25));
const xpFor = (lvl) => lvl * lvl * 25;

// gives XP for a message. Returns { xp, level, up } or null (too soon)
function award(group, sender) {
  const key = keyOf(sender);
  if (!key) return null;
  const k = `${group}|${key}`;
  const now = Date.now();
  if (now - (lastXp.get(k) || 0) < GAP_MS) return null;
  lastXp.set(k, now);
  if (lastXp.size > 20000) lastXp.clear();
  const g = js.data[group] || (js.data[group] = {});
  const me = g[key] || (g[key] = { x: 0, j: sender });
  const before = level(me.x);
  me.x += 5 + crypto.randomInt(0, 8); // 5 to 12
  me.j = sender;
  js.touch();
  return { xp: me.x, level: level(me.x), up: level(me.x) > before };
}

// the ranking; entries saved under the other kind of id of the same person are added together
function board(group) {
  const merged = new Map();
  for (const [k, v] of Object.entries(js.data[group] || {})) {
    const key = keyOf(v.j || k);
    const at = merged.get(key);
    if (at) at.x += v.x;
    else merged.set(key, { x: v.x, j: v.j });
  }
  return [...merged.entries()].sort((a, b) => b[1].x - a[1].x);
}

function statsOf(group, sender) {
  const key = keyOf(sender);
  const list = board(group);
  const at = list.findIndex(([k]) => k === key);
  const xp = at >= 0 ? list[at][1].x : 0;
  const lvl = level(xp);
  return { xp, level: lvl, position: at >= 0 ? at + 1 : null, total: list.length, into: xp - xpFor(lvl), need: xpFor(lvl + 1) - xpFor(lvl) };
}

const bar = (part, whole, size = 10) => {
  const filled = Math.max(0, Math.min(size, Math.round((part / whole) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
};

module.exports = { award, board, statsOf, level, xpFor, bar, keyOf };

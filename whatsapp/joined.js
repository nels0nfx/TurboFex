// Remembers when members joined each group (used by the newmembers command).
// Only joins that the bot saw while it was running are known; people who were already in the group are not listed.
const jsonstore = require('../core/jsonstore');
const { num } = require('./utils');

const js = jsonstore.open('joined', {}); // { group: { member: timestamp } }
const MAX_PER_GROUP = 300;
const KEEP_MS = 60 * 24 * 3600 * 1000; // forget joins older than 60 days

function record(group, ids, at = Date.now()) {
  if (!group || !ids || !ids.length) return;
  const g = js.data[group] || (js.data[group] = {});
  for (const id of ids) {
    const k = num(id);
    if (k) g[k] = { at, j: id };
  }
  const keys = Object.keys(g);
  if (keys.length > MAX_PER_GROUP) {
    keys.sort((a, b) => g[a].at - g[b].at);
    for (const k of keys.slice(0, keys.length - MAX_PER_GROUP)) delete g[k];
  }
  js.touch();
}

// somebody left or was removed: they are no longer a "new member"
function forget(group, ids) {
  const g = js.data[group];
  if (!g) return;
  for (const id of ids || []) delete g[num(id)];
  js.touch();
}

// joins in the last `days` days, newest first: [{ id, at }]
function recent(group, days = 7, now = Date.now()) {
  const g = js.data[group] || {};
  const since = now - Math.min(days, 60) * 24 * 3600 * 1000;
  return Object.values(g)
    .filter((v) => v.at >= since && now - v.at <= KEEP_MS)
    .sort((a, b) => b.at - a.at)
    .map((v) => ({ id: v.j, at: v.at }));
}

module.exports = { record, forget, recent };

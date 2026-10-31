// Remembers when each member last wrote in a group (used by the listonline command).
// WhatsApp does not tell a bot who is online, so "online" here means "wrote a message a few minutes ago".
// It is kept in memory only: after a restart the list starts empty.
const { num } = require('./utils');

const seen = new Map(); // group -> Map(member number -> { at, j })
const MAX_GROUPS = 300;
const MAX_MEMBERS = 2000;

function touch(group, sender, at = Date.now()) {
  const k = num(sender);
  if (!group || !k) return;
  let g = seen.get(group);
  if (!g) {
    if (seen.size >= MAX_GROUPS) seen.delete(seen.keys().next().value);
    g = new Map();
    seen.set(group, g);
  }
  g.delete(k); // keeps the newest at the end
  g.set(k, { at, j: sender });
  if (g.size > MAX_MEMBERS) g.delete(g.keys().next().value);
}

// members who wrote in the last `minutes` minutes, newest first: [{ id, at }]
function within(group, minutes = 10, now = Date.now()) {
  const g = seen.get(group);
  if (!g) return [];
  const since = now - minutes * 60 * 1000;
  return [...g.values()].filter((v) => v.at >= since).sort((a, b) => b.at - a.at).map((v) => ({ id: v.j, at: v.at }));
}

module.exports = { touch, within };

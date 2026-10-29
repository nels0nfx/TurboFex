// Keeps recent messages in memory (only while anti-delete / anti-edit is on)
const MAX_ITEMS = 1500;
const MAX_BYTES = 30 * 1024 * 1024; // pictures and videos count towards this
const TTL_MS = 24 * 3600 * 1000;

const items = new Map(); // id -> item
let bytes = 0;

function drop(id) {
  const it = items.get(id);
  if (it) bytes -= it.buffer ? it.buffer.length : 0;
  items.delete(id);
}

function remember(id, item) {
  if (!id) return;
  drop(id);
  items.set(id, { ...item, at: Date.now() });
  bytes += item.buffer ? item.buffer.length : 0;
  while ((items.size > MAX_ITEMS || bytes > MAX_BYTES) && items.size) drop(items.keys().next().value);
}

function get(id) {
  const it = items.get(id);
  if (!it) return null;
  if (Date.now() - it.at > TTL_MS) {
    drop(id);
    return null;
  }
  return it;
}

const stats = () => ({ items: items.size, bytes });

module.exports = { remember, get, drop, stats, MAX_BYTES };

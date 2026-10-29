// When a person's phone cannot open one of our messages it asks us to send it again.
// For that the library needs the message back, so the last ones are remembered here.
const MAX = 1000;
const TTL_MS = 6 * 3600 * 1000;
const items = new Map();

function remember(sent) {
  const id = sent?.key?.id;
  if (!id || !sent.message) return;
  items.set(id, { message: sent.message, at: Date.now() });
  if (items.size > MAX) items.delete(items.keys().next().value);
}

// used as the library's getMessage(key)
function get(key) {
  const it = items.get(key?.id);
  if (!it) return undefined;
  if (Date.now() - it.at > TTL_MS) {
    items.delete(key.id);
    return undefined;
  }
  return it.message;
}

module.exports = { remember, get, size: () => items.size };

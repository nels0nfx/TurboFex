// Remembers the ids of messages the bot itself sent, so it never answers its own messages
const ids = new Set();

function remember(id) {
  ids.add(id);
  if (ids.size > 300) ids.delete(ids.values().next().value);
}

const has = (id) => ids.has(id);

module.exports = { remember, has };

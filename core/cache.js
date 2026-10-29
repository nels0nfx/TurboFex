// A small in-memory cache with an expiry time. Given to the WhatsApp library so it remembers who has which devices
// for much longer than its default 5 minutes: the first message to a group after a quiet period no longer has to
// ask WhatsApp for every member's devices again (that was a big part of "slow in groups").
function makeCache(ttlMs, max = 10000) {
  const m = new Map();
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.until < Date.now()) {
        m.delete(key);
        return undefined;
      }
      return e.value;
    },
    set(key, value) {
      if (m.size >= max) m.delete(m.keys().next().value);
      m.set(key, { value, until: Date.now() + ttlMs });
      return true;
    },
    del(key) {
      m.delete(key);
    },
    flushAll() {
      m.clear();
    },
  };
}

module.exports = { makeCache };

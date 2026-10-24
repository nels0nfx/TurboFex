// Write-behind for the encryption keys. Every message the bot receives or sends changes keys, and each change was
// written to disk BEFORE the next message of that chat could be sent. On a host with a slow disk, and in a busy
// group, replies queued up behind those writes (seconds). Now the change is kept in memory at once and written to
// disk in one batch a moment later. Everything is also written when the bot stops or restarts.
// Switch off with FAST_KEYS=off.
const { onFlush } = require('./flush');

const FLUSH_MS = 500;

function fastKeys(keys) {
  if (String(process.env.FAST_KEYS || '').toLowerCase() === 'off') return keys;
  const pending = new Map(); // "type\0id" -> value | null (null = delete)
  let inflight = new Map(); // being written right now
  let timer = null;
  let writing = null;
  const key = (type, id) => `${type}\u0000${id}`;

  async function writeBatch() {
    if (!pending.size) return;
    inflight = new Map(pending);
    pending.clear();
    const data = {};
    for (const [k, v] of inflight) {
      const [type, id] = k.split('\u0000');
      (data[type] || (data[type] = {}))[id] = v;
    }
    try {
      await keys.set(data);
    } catch (err) {
      console.error('Could not save encryption keys (will retry):', err.message);
      for (const [k, v] of inflight) if (!pending.has(k)) pending.set(k, v); // keep, try again later
    } finally {
      inflight = new Map();
    }
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    writing = (writing || Promise.resolve()).then(writeBatch).finally(() => {
      if (pending.size && !timer) schedule();
    });
    return writing;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
    if (timer.unref) timer.unref();
  }

  onFlush(flush);

  return {
    async get(type, ids) {
      const out = {};
      const missing = [];
      for (const id of ids) {
        const k = key(type, id);
        const v = pending.has(k) ? pending.get(k) : inflight.has(k) ? inflight.get(k) : undefined;
        if (pending.has(k) || inflight.has(k)) {
          if (v !== null && v !== undefined) out[id] = v;
        } else {
          missing.push(id);
        }
      }
      if (missing.length) Object.assign(out, await keys.get(type, missing));
      return out;
    },
    async set(data) {
      for (const type in data) for (const id in data[type]) pending.set(key(type, id), data[type][id] ?? null);
      schedule();
    },
    async clear() {
      pending.clear();
      if (keys.clear) await keys.clear();
    },
  };
}

module.exports = { fastKeys };

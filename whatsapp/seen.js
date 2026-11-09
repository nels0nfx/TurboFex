const path = require('path');
const { DATA } = require('../core/paths');
const safefile = require('../core/safefile');
const { onFlushSync } = require('../core/flush');

const dir = DATA;

// a list of recently handled ids, kept on disk so a restart does not handle them again.
// Saved atomically with a backup copy and written again when the bot stops or restarts.
function makeSeen(fileName, max) {
  const file = path.join(dir, fileName);
  const loaded = safefile.load(file, fileName);
  const list = Array.isArray(loaded.data) ? loaded.data : [];
  const set = new Set(list);
  let dirty = loaded.state === 'recovered';

  let nextAt = 0; // the timer does not write before this time: a slow save (slow disk, big list) makes the next ones rarer
  function saveNow() {
    if (!dirty) return;
    const began = Date.now();
    try {
      safefile.save(file, [...set]);
      dirty = false;
    } catch (err) {
      console.error(`Could not save ${fileName}:`, err.message); // stays dirty: tried again
    }
    nextAt = Date.now() + Math.min(15000, (Date.now() - began) * 20); // a 50 ms save waits 1 s, a 300 ms save waits 6 s
  }
  const tick = () => {
    if (Date.now() >= nextAt) saveNow();
  };
  const timer = setInterval(tick, 1000);
  if (timer.unref) timer.unref();
  onFlushSync(saveNow);

  // true if this id was already handled, otherwise remembers it
  function check(jid, id) {
    if (!id) return false;
    const key = `${jid}|${id}`;
    if (set.has(key)) return true;
    add(key);
    return false;
  }

  function add(key) {
    set.add(key);
    if (set.size > max) set.delete(set.values().next().value);
    dirty = true;
  }

  // was it handled before? (does not remember it)
  const has = (jid, id) => !!id && set.has(`${jid}|${id}`);
  // remembers it without asking
  const mark = (jid, id) => {
    if (id && !set.has(`${jid}|${id}`)) add(`${jid}|${id}`);
  };
  // forgets it (the work on it failed before anything was done, so the next delivery may try again)
  const forget = (jid, id) => {
    if (set.delete(`${jid}|${id}`)) dirty = true;
  };
  return { check, has, mark, forget, saveNow };
}

const messages = makeSeen('seen.json', 400);
const statuses = makeSeen('seen-status.json', 1500);

module.exports = { check: messages.check, saveNow: messages.saveNow, statuses };

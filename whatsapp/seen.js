const fs = require('fs');
const path = require('path');
const { DATA } = require('../core/paths');

const dir = DATA;

// a list of recently handled ids, kept on disk so a restart does not handle them again
function makeSeen(fileName, max) {
  const file = path.join(dir, fileName);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(list)) list = [];
  } catch (err) {
    list = [];
  }
  const set = new Set(list);
  let dirty = false;

  function saveNow() {
    if (!dirty) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...set]));
      dirty = false;
    } catch (err) {
      // not important
    }
  }
  setInterval(saveNow, 3000).unref();
  process.on('exit', saveNow);

  // true if this id was already handled, otherwise remembers it
  function check(jid, id) {
    if (!id) return false;
    const key = `${jid}|${id}`;
    if (set.has(key)) return true;
    set.add(key);
    if (set.size > max) set.delete(set.values().next().value);
    dirty = true;
    return false;
  }
  return { check, saveNow };
}

const messages = makeSeen('seen.json', 400);
const statuses = makeSeen('seen-status.json', 1500);

module.exports = { check: messages.check, saveNow: messages.saveNow, statuses };

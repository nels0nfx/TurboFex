// A small note left on disk just before the bot restarts ("I am restarting because of an update"), so that the
// NEW copy of the bot can tell the owner it is back and done. It is removed once the message was sent.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const file = path.join(DATA, 'boot-note.json');
const MAX_AGE_MS = 30 * 60 * 1000;

// note = { type: 'update' | 'restart' | 'repair' | 'rollback', chat?: jid, from?, to?, notes? }
function write(note) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...note, at: Date.now() }));
    return true;
  } catch (err) {
    return false;
  }
}

function peek() {
  try {
    const note = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!note || typeof note !== 'object' || Date.now() - (note.at || 0) > MAX_AGE_MS) {
      clear();
      return null;
    }
    return note;
  } catch (err) {
    return null;
  }
}

function clear() {
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    // not important
  }
}

module.exports = { write, peek, clear };

// Safe saving and loading of the bot's JSON files. Every saved file goes through here.
//
// WRITE: the new content is written to a temporary file, forced onto the disk (fsync), the temporary file takes the place
//        of the real file, and a mirror copy is kept as "<name>.bak". A crash, a power cut or a
//        panel "kill" can never leave a half-written file behind.
// READ:  if the file cannot be read, the ".bak" copy is tried. If both are broken the broken file is MOVED aside
//        ("<name>.corrupt-<time>"), never overwritten and never deleted, so nothing is lost silently and the owner can
//        look at it. Only a file that really does not exist counts as "first start" and gets the default values.
const fs = require('fs');
const path = require('path');

const KEEP_CORRUPT = 5; // how many moved-aside broken copies of one file are kept

const info = { recovered: [], quarantined: [] }; // what happened at start (shown by the owner's status command)

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) throw new Error('file is empty');
  return JSON.parse(text);
}

// moves a broken file aside so it is never overwritten
function quarantine(file) {
  try {
    const to = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, to);
    info.quarantined.push(to);
    // keep only the newest few
    const dir = path.dirname(file);
    const base = `${path.basename(file)}.corrupt-`;
    const old = fs.readdirSync(dir).filter((f) => f.startsWith(base)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_CORRUPT))) fs.rmSync(path.join(dir, f), { force: true });
    return to;
  } catch (err) {
    return null;
  }
}

// reads a JSON file. Returns { data, state } where state is one of:
//   'ok'        the file was read
//   'recovered' the file was broken, the last good copy (.bak) was used
//   'missing'   there was no file and no copy: a normal first start (data is null)
//   'lost'      the file and its copy were both broken (data is null; the broken files were moved aside, not deleted)
function load(file, label = path.basename(file)) {
  let main = null;
  let exists = false;
  try {
    main = parseFile(file);
    return { data: main, state: 'ok' };
  } catch (err) {
    exists = fs.existsSync(file);
    if (exists) console.error(`⚠️ The saved file ${label} is damaged (${err.message}). Trying its backup copy...`);
  }
  // the temporary file of an interrupted save can still hold the newest complete data
  for (const alt of [`${file}.tmp`, `${file}.bak`]) {
    try {
      const data = parseFile(alt);
      if (exists) quarantine(file);
      info.recovered.push(label);
      console.error(`✅ ${label} was restored from ${path.basename(alt)}.`);
      return { data, state: 'recovered' };
    } catch (err) {
      // try the next copy
    }
  }
  if (exists) {
    const moved = quarantine(file);
    console.error(`⚠️ ${label} could not be repaired. The damaged file was kept as ${moved ? path.basename(moved) : 'it is'} (nothing was deleted).`);
    return { data: null, state: 'lost' };
  }
  return { data: null, state: 'missing' };
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // not possible on every system (Windows): not important
  }
}

// writes text to a file in a crash-safe way. "good" = the current file is known to be complete (then it becomes the .bak)
function writeText(file, text, { backup = true } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(dir);
  if (backup) {
    // the backup copy always mirrors the newest complete file (a crash between the two steps leaves it one save behind)
    try {
      fs.copyFileSync(file, `${file}.bak`);
    } catch (err) {
      // not important: the real file was saved
    }
  }
}

// serialises and writes. Returns the text that was written (used to see if anything changed later)
function save(file, data, opts) {
  const text = JSON.stringify(data);
  if (text === undefined) throw new Error('nothing to save');
  writeText(file, text, opts);
  return text;
}

module.exports = { load, save, writeText, quarantine, info };

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const NOTE_FILE = path.join(paths.data, 'bootnote.json');

function write(note) {
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(NOTE_FILE, JSON.stringify({ ...note, at: Date.now() }) + '\n');
  } catch {}
}

function readAndClear() {
  try {
    if (!fs.existsSync(NOTE_FILE)) return null;
    const note = JSON.parse(fs.readFileSync(NOTE_FILE, 'utf8'));
    fs.unlinkSync(NOTE_FILE);
    return note;
  } catch {
    return null;
  }
}

module.exports = { write, readAndClear };

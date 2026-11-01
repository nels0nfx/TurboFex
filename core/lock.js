// One bot per data folder. Two copies of the bot using the same data/ folder would overwrite each other's saved settings,
// counters and records. This lock file says "a bot is running here". It is refreshed every few seconds, so a lock that
// nobody refreshes any more (the bot crashed or was killed) is simply ignored: it can never block a start for long.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');

const FILE = path.join(DATA, '.bot.lock');
const BEAT_MS = 5000;
const STALE_MS = 20000; // a lock that was not refreshed for this long is dead
const WAIT_MS = 25000; // a starting bot waits this long for the old copy to finish (restart, update)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    return null;
  }
}

function aliveElsewhere() {
  const l = read();
  if (!l || !l.pid) return null;
  if (l.pid === process.pid) return null;
  let age = Infinity;
  try {
    age = Date.now() - fs.statSync(FILE).mtimeMs;
  } catch (err) {
    return null;
  }
  if (age > STALE_MS) return null; // nobody refreshes it: dead
  try {
    process.kill(l.pid, 0); // does that process exist?
  } catch (err) {
    if (err.code === 'ESRCH') return null;
  }
  return l;
}

function write() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
  } catch (err) {
    // not important
  }
}

let beat = null;

// Returns true when this process owns the data folder. When another live bot owns it, waits for it to leave; if it does
// not, returns false (the caller stops, so nothing is overwritten).
async function acquire(waitMs = WAIT_MS) {
  const t0 = Date.now();
  let told = false;
  while (aliveElsewhere()) {
    if (Date.now() - t0 > waitMs) return false;
    if (!told) {
      told = true;
      console.log('⏳ Another copy of the bot is still using this data folder. Waiting for it to finish...');
    }
    await sleep(1000);
  }
  write();
  beat = setInterval(write, BEAT_MS);
  if (beat.unref) beat.unref();
  process.on('exit', release);
  return true;
}

function release() {
  if (beat) clearInterval(beat);
  beat = null;
  try {
    if ((read() || {}).pid === process.pid) fs.rmSync(FILE, { force: true });
  } catch (err) {
    // not important
  }
}

module.exports = { acquire, release, aliveElsewhere, FILE };

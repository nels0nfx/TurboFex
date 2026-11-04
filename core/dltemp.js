// Temporary space for the downloader. yt-dlp (the downloader program) unpacks itself into a temp folder EVERY time it runs,
// and every download also needs a work folder. On a small panel the system temp folder is tiny or full, which caused
// "Failed to extract entry" and "No space left on device". So all of it now lives in data/tmp (the bot's own disk space),
// old leftovers are cleaned automatically, and the free space is checked before a download starts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA } = require('./paths');

const ROOT = path.join(DATA, 'tmp');
const active = new Set(); // work folders that are in use right now: they are never cleaned
const MIN_FREE_MB = Number(process.env.DL_MIN_FREE_MB) || 200;

function root() {
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    return ROOT;
  } catch (err) {
    return os.tmpdir(); // the data folder cannot be written: the system folder is the last choice
  }
}

// the settings that make the downloader (and ffmpeg) use our folder instead of the system one
function env() {
  const r = root();
  return { ...process.env, TMPDIR: r, TEMP: r, TMP: r };
}

// a new private work folder for one download
function makeWorkDir() {
  const dir = fs.mkdtempSync(path.join(root(), 'tfx-'));
  active.add(dir);
  return dir;
}

function release(dir) {
  active.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // a locked file is cleaned later by cleanStale
  }
}

// free space in MB of the disk that holds a folder (Infinity when it cannot be read)
function freeMb(dir = root()) {
  try {
    const s = fs.statfsSync(dir);
    return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576);
  } catch (err) {
    return Infinity;
  }
}

// removes old work folders and the unpacked leftovers of downloaders that were stopped (folders named _MEI...)
function cleanStale(maxAgeMs = 10 * 60 * 1000) {
  let removed = 0;
  const now = Date.now();
  for (const base of new Set([root(), os.tmpdir()])) {
    let names = [];
    try {
      names = fs.readdirSync(base);
    } catch (err) {
      continue;
    }
    for (const name of names) {
      const mine = /^tfx-/.test(name);
      const left = /^_MEI/.test(name);
      if (!mine && !left) continue;
      const full = path.join(base, name);
      if (active.has(full)) continue;
      try {
        const age = now - fs.statSync(full).mtimeMs;
        // the system temp folder is shared: only touch downloader leftovers there, and only when clearly old
        if (age >= (base === ROOT ? maxAgeMs : Math.max(maxAgeMs, 60 * 60 * 1000))) {
          fs.rmSync(full, { recursive: true, force: true });
          removed += 1;
        }
      } catch (err) {
        // gone already
      }
    }
  }
  return removed;
}

// before a download: makes room when needed. Returns false when there is still not enough space.
function ensureSpace(needMb = MIN_FREE_MB) {
  if (freeMb() >= needMb) return true;
  cleanStale(0);
  return freeMb() >= needMb;
}

module.exports = { root, env, makeWorkDir, release, freeMb, cleanStale, ensureSpace, MIN_FREE_MB };

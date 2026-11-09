// A small saved JSON file for a feature (levels, notes, birthdays, stats, and more...). Changes are kept in memory and
// written to disk a moment later (and always when the bot stops or restarts).
//
// What makes it safe (see core/safefile.js for the file part):
//  - a broken or half-written file is NEVER replaced by empty defaults: the last good copy is used, or the broken file is
//    moved aside and kept;
//  - saved values always win over default values: defaults only fill what is missing (fillDefaults);
//  - a feature that forgets to call touch() is still saved: every few seconds the store compares itself with what is on
//    disk and writes when something changed (the "safety net");
//  - a failed write keeps the changes and tries again, it never forgets them;
//  - every store registers with core/flush.js so a stop, a restart or a SIGTERM writes everything first.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');
const { onFlushSync } = require('./flush');
const safefile = require('./safefile');


const DEFAULT_DELAY = 1000; // a change is written this long after it happens
const NET_EVERY = 10000; // the safety net looks for unnoticed changes this often

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Fills in only what is MISSING. Values that were saved are never touched.
function fillDefaults(saved, defaults) {
  if (!isPlain(saved) || !isPlain(defaults)) return saved;
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in saved)) saved[k] = JSON.parse(JSON.stringify(v));
    else if (isPlain(saved[k]) && isPlain(v)) fillDefaults(saved[k], v);
  }
  return saved;
}

// One copy per day of every saved file is kept in data/backups (the last 7 days). The ".bak" copy mirrors the newest save,
// so it cannot help if a mistake in the code saved wrong data; the daily copy can.
const SNAP_DAYS = 7;
const snapped = new Map(); // file -> the day its daily copy was checked (saves the disk lookups on every save)
function snapshot(file, name) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (snapped.get(file) === day) return;
    const dir = path.join(path.dirname(file), 'backups');
    const to = path.join(dir, `${name}.${day}.json`);
    if (fs.existsSync(to)) {
      snapped.set(file, day);
      return;
    }
    if (!fs.existsSync(file)) return;
    snapped.set(file, day);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, to);
    const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${name}.`) && f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - SNAP_DAYS))) fs.rmSync(path.join(dir, f), { force: true });
  } catch (err) {
    // not important
  }
}

const stores = new Map();

function open(name, initial, opts = {}) {
  if (stores.has(name)) return stores.get(name); // the same file is never opened twice (two copies would overwrite each other)
  const file = path.join(opts.dir || DATA, `${name}.json`);
  const fresh = () => (typeof initial === 'function' ? initial() : JSON.parse(JSON.stringify(initial)));
  const delay = opts.delay || DEFAULT_DELAY;

  const loaded = safefile.load(file, `${name}.json`);
  let data;
  let last = null; // the text that is on disk now
  if (loaded.data === null || loaded.data === undefined) {
    data = fresh();
  } else {
    data = loaded.data;
    const defaults = fresh();
    if (opts.fill !== false && isPlain(defaults) && isPlain(data)) fillDefaults(data, defaults);
    try {
      last = JSON.stringify(loaded.data);
    } catch (err) {
      last = null;
    }
  }
  let dirty = loaded.state === 'recovered' || loaded.state === 'lost'; // a repaired file is written back at once
  let timer = null;
  let failures = 0;
  let costMs = 0; // how long the last save took: a big file is saved and checked less often, so it can never keep the bot busy

  const write = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    let text;
    const began = Date.now();
    try {
      text = JSON.stringify(data);
    } catch (err) {
      console.error(`Could not save ${name}:`, err.message);
      return false;
    }
    costMs = Date.now() - began;
    if (!dirty && text === last) return true; // nothing changed
    try {
      if (last !== null) snapshot(file, name); // only a file that was loaded fine is copied (never a repaired or empty one)
      safefile.writeText(file, text);
      costMs = Date.now() - began;
      last = text;
      dirty = false;
      failures = 0;
      return true;
    } catch (err) {
      failures += 1;
      dirty = true; // keep the changes and try again
      if (failures === 1 || failures % 20 === 0) console.error(`Could not save ${name}:`, err.message);
      timer = setTimeout(write, Math.min(30000, 1000 * failures));
      if (timer.unref) timer.unref();
      return false;
    }
  };
  onFlushSync(write);

  // the safety net: a change that nobody announced with touch() is found and saved
  // (the check itself costs time for a big file: it is done at most about once for every 50 times its own cost)
  let nextNet = 0;
  const net = setInterval(() => {
    if (dirty || Date.now() < nextNet) return;
    try {
      const began = Date.now();
      const same = JSON.stringify(data) === last;
      const took = Date.now() - began;
      nextNet = Date.now() + took * 50;
      if (!same) write();
    } catch (err) {
      // not important
    }
  }, NET_EVERY);
  if (net.unref) net.unref();

  const store = {
    name,
    file,
    state: loaded.state, // 'ok' | 'recovered' | 'missing' | 'lost'
    get data() {
      return data;
    },
    // replaces the whole content (a restore, a reset the owner asked for)
    replace(next) {
      data = next;
      store.touch();
    },
    touch() {
      dirty = true;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          write();
        }, Math.max(delay, Math.min(60000, costMs * 20))); // a file that takes 300 ms to save is saved every 6 seconds at most
        if (timer.unref) timer.unref();
      }
    },
    // writes now (use it for changes that must not be lost: owner settings, money)
    save() {
      dirty = true;
      return write();
    },
    flush: write,
  };
  stores.set(name, store);
  return store;
}

const all = () => [...stores.values()];

module.exports = { open, fillDefaults, all };

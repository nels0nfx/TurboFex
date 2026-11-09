// Removes the leftovers of old versions every time the bot starts.
// Why: the self-updater only deletes old files when the bot that RUNS the update knows how (very old bots read a list that was never
// published), so some bots still had files of features that were removed (the Empire of Fex commands, for example).
// What it removes: (1) every file in removed-files.txt that is still on the disk, (2) any file of the old realm folder, and
// (3) any bot file that still loads the old realm folder (such a file can only come from the removed Empire).
// Nothing is lost: each file is first copied to data/legacy-removed/. Data, session, config and node_modules are never touched.
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['config.js', 'session_id.txt', 'config.env', 'session', 'data', 'node_modules', '.env', '.git', '.github', 'accounts', 'accounts.json']);
const OLD_FOLDER = ['core', 'realm'].join('/'); // written in pieces so this file never matches its own search
const LOADS_OLD_FOLDER = new RegExp(`require\\(\\s*['"][^'"]*${OLD_FOLDER.replace('/', '\\/')}/`);
const SCAN = ['commands', 'core', 'whatsapp'];

function listed(root) {
  const out = new Set();
  for (const name of ['removed-files.txt', 'removed.txt']) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(root, name), 'utf8');
    } catch (err) {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const rel = line.trim().replace(/\\/g, '/');
      if (!rel || rel.startsWith('#') || rel.startsWith('/') || rel.includes('..') || KEEP.has(rel.split('/')[0])) continue;
      out.add(rel);
    }
  }
  return [...out];
}

function walk(dir, base, out) {
  let items = [];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const it of items) {
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) walk(abs, `${base}/${it.name}`, out);
    else out.push(`${base}/${it.name}`);
  }
  return out;
}

function candidates(root) {
  const found = new Set(listed(root));
  for (const rel of walk(path.join(root, ...OLD_FOLDER.split('/')), OLD_FOLDER, [])) found.add(rel); // the whole old folder
  for (const dir of SCAN) {
    for (const it of safeList(path.join(root, dir))) {
      if (!it.endsWith('.js')) continue;
      const rel = `${dir}/${it}`;
      try {
        if (LOADS_OLD_FOLDER.test(fs.readFileSync(path.join(root, rel), 'utf8'))) found.add(rel);
      } catch (err) {
        // unreadable: left alone
      }
    }
  }
  return [...found];
}
const safeList = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
};

// Returns the files it removed. Never throws: a cleanup problem must never stop the bot from starting.
function run(root = path.join(__dirname, '..')) {
  const removed = [];
  try {
    const safe = path.join(root, 'data', 'legacy-removed');
    for (const rel of candidates(root)) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(path.resolve(root) + path.sep)) continue;
      let st;
      try {
        st = fs.statSync(file);
      } catch (err) {
        continue; // not there: nothing to do
      }
      if (!st.isFile()) continue;
      try {
        const copy = path.join(safe, rel);
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        if (!fs.existsSync(copy)) fs.copyFileSync(file, copy);
        fs.rmSync(file, { force: true });
        removed.push(rel);
      } catch (err) {
        console.error(`Could not remove the old file ${rel}:`, err.message);
      }
    }
    for (const dir of [path.join(root, ...OLD_FOLDER.split('/'))]) { // an emptied old folder goes too
      try {
        fs.rmdirSync(dir);
      } catch (err) {
        // not there or not empty
      }
    }
    if (removed.length) console.log(`🧹 Cleaned ${removed.length} old file${removed.length === 1 ? '' : 's'} left over from removed features (a copy is in data/legacy-removed).`);
  } catch (err) {
    console.error('Clean-up of old files failed:', err.message);
  }
  return removed;
}

module.exports = { run, candidates, listed };

// Backup of the bot's WhatsApp login. Linking a new device can be unreliable, so losing the login (a broken disk,
// a half-written file, a panel reinstall) could keep the bot offline. A rolling copy of the login is kept inside the
// bot's own data folder (never sent over WhatsApp: the login gives full access to the account).
//
//  - a copy is made at start and once a day, the last 3 are kept
//  - the copy holds creds.json plus the app-state and LID files; encryption sessions are rebuilt by WhatsApp itself
//  - if the session folder has files but creds.json is missing or damaged, the newest copy is restored at start
//  - an EMPTY or missing session folder is treated as "link a fresh device" (nothing is restored). To restore on
//    purpose start once with RESTORE_LOGIN=1
//  - after WhatsApp logs the bot out, the copies are deleted (they would be invalid)
const fs = require('fs');
const path = require('path');
const { flushAll } = require('./flush');
const { DATA } = require('./paths');

const DIR = path.join(DATA, 'session-backup');
const MARKER = path.join(DIR, '.loggedout');
const KEEP = 3;
const DAY = 24 * 3600 * 1000;

const wanted = (name) => name === 'creds.json' || name.startsWith('app-state-sync-') || name.startsWith('lid-mapping-');

function validCreds(file, needRegistered) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !!(c && c.noiseKey && c.signedIdentityKey && (!needRegistered || c.registered));
  } catch (err) {
    return false;
  }
}

function list() {
  try {
    return fs
      .readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch (err) {
    return [];
  }
}

// copies the login. Returns { name, files } or null (nothing to copy yet)
async function backupNow(sessionDir) {
  await flushAll(); // write anything still kept in memory first
  const creds = path.join(sessionDir, 'creds.json');
  if (!validCreds(creds, true)) return null; // never copy a login that is not linked
  fs.mkdirSync(DIR, { recursive: true });
  const name = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const tmp = path.join(DIR, `.tmp-${name}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  let files = 0;
  for (const f of fs.readdirSync(sessionDir)) {
    if (!wanted(f)) continue;
    try {
      fs.copyFileSync(path.join(sessionDir, f), path.join(tmp, f));
      files += 1;
    } catch (err) {
      // a file that changed while copying: the next backup gets it
    }
  }
  if (!validCreds(path.join(tmp, 'creds.json'), true)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  fs.rmSync(path.join(DIR, name), { recursive: true, force: true }); // two backups in the same second: the newer one wins
  fs.renameSync(tmp, path.join(DIR, name));
  for (const old of list().slice(KEEP)) fs.rmSync(path.join(DIR, old), { recursive: true, force: true });
  fs.rmSync(MARKER, { force: true });
  return { name, files };
}

// called before the login is read. Returns { name } when a copy was restored.
function restoreIfNeeded(sessionDir) {
  const force = process.env.RESTORE_LOGIN === '1';
  const creds = path.join(sessionDir, 'creds.json');
  const backups = list();
  if (!backups.length || fs.existsSync(MARKER)) return null;
  let folderHasFiles = false;
  try {
    folderHasFiles = fs.readdirSync(sessionDir).length > 0;
  } catch (err) {
    folderHasFiles = false;
  }
  const damaged = folderHasFiles && !validCreds(creds, false);
  if (!force && !damaged) {
    if (!folderHasFiles) console.log(`ℹ️ A login backup from ${backups[0]} exists. To use it instead of linking again, start once with RESTORE_LOGIN=1.`);
    return null;
  }
  for (const name of backups) {
    const src = path.join(DIR, name);
    if (!validCreds(path.join(src, 'creds.json'), true)) continue;
    fs.mkdirSync(sessionDir, { recursive: true });
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(sessionDir, f));
    console.log(`♻️ The saved login was ${force ? 'restored on request' : 'damaged and was restored'} from the backup of ${name}.`);
    return { name };
  }
  return null;
}

// WhatsApp logged the bot out: the copies are no longer valid and must not be restored
function markLoggedOut() {
  try {
    for (const name of list()) fs.rmSync(path.join(DIR, name), { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(MARKER, String(Date.now()));
  } catch (err) {
    // not important
  }
}

// Removes encryption files of chats that have been silent for a long time (WhatsApp rebuilds them on the next message).
// Never touches the login, app-state keys, LID mappings or pre-keys.
function cleanup(sessionDir, { sessionDays = 90, deviceDays = 30 } = {}) {
  const now = Date.now();
  const result = { removed: 0, kept: 0, bytes: 0 };
  let names = [];
  try {
    names = fs.readdirSync(sessionDir);
  } catch (err) {
    return result;
  }
  for (const f of names) {
    const limit = f.startsWith('session-') || f.startsWith('sender-key') ? sessionDays : f.startsWith('device-list-') ? deviceDays : 0;
    if (!limit) continue;
    try {
      const st = fs.statSync(path.join(sessionDir, f));
      if (!st.isFile()) continue;
      if (now - st.mtimeMs > limit * DAY) {
        fs.rmSync(path.join(sessionDir, f), { force: true });
        result.removed += 1;
        result.bytes += st.size;
      } else {
        result.kept += 1;
      }
    } catch (err) {
      // a file that vanished: fine
    }
  }
  return result;
}

// Daily backup and monthly cleanup. Called once the bot is connected.
let timer = null;
function schedule(sessionDir) {
  if (timer) return;
  const stateFile = path.join(DATA, 'maintenance.json');
  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (err) {
      return {};
    }
  };
  const tick = async () => {
    try {
      const b = await backupNow(sessionDir);
      if (b) console.log(`💾 Login backup saved (${b.name}, ${b.files} files).`);
      const st = readState();
      if (Date.now() - (st.lastCleanup || 0) > 30 * DAY) {
        const r = cleanup(sessionDir);
        fs.mkdirSync(DATA, { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify({ ...st, lastCleanup: Date.now() }));
        if (r.removed) console.log(`🧹 Cleaned ${r.removed} old encryption files (${Math.round(r.bytes / 1024)} KB).`);
      }
    } catch (err) {
      console.error('Maintenance error:', err.message);
    }
  };
  setTimeout(tick, 3 * 60 * 1000).unref(); // a few minutes after connecting: the login is settled
  timer = setInterval(tick, DAY);
  timer.unref();
}

module.exports = { backupNow, restoreIfNeeded, markLoggedOut, cleanup, list, schedule, validCreds, DIR };

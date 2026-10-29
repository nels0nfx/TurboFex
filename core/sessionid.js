// Linking with a session ID. A person links their number on the pairing site and gets an ID like TFX-K7M2-9QXA-4BNP.
// They paste it in the file session_id.txt (in the bot's main folder; the SESSION_ID variable of the host works too) and
// restart the bot, like with other WhatsApp bots. The bot downloads that
// login from the site (pairSiteUrl) and saves it as session/creds.json. After that the bot starts normally.
//
//  - The ID works once on the site, so the bot remembers (data/session-id.json, only a hash) which ID it has already used.
//    An old ID left in the settings does nothing; a NEW ID replaces the current login (the old one is kept aside once).
//  - The site may be asleep on a free host: the download waits up to a minute and tries three times.
//  - A problem here never throws: the caller decides what to do when there is no login (see core/setup.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./paths');

const ID_RE = /^TFX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const MARK = () => path.join(DATA, 'session-id.json');
const ASIDE = () => path.join(DATA, 'session-previous');

function normalize(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('TFX')) s = s.slice(3);
  if (s.length !== 12) return null;
  const id = `TFX-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  return ID_RE.test(id) ? id : null;
}

// ----- the session ID file: session_id.txt, one line  SESSION_ID=TFX-XXXX-XXXX-XXXX  (lines starting with # are notes)
const TEMPLATE = (site) =>
  [
    '# TURBOFEX SESSION ID',
    `# 1) Open ${site} and link your WhatsApp number.`,
    '# 2) Copy the session ID (it looks like TFX-K7M2-9QXA-4BNP).',
    '# 3) Paste it after the = sign on the line below, SAVE this file and RESTART the bot.',
    '# A session ID works once and expires after 24 hours.',
    'SESSION_ID=',
    '',
  ].join('\n');

// the ID written in the file ('' when empty or missing)
function readFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const v = t.replace(/^(export\s+)?SESSION_ID\s*[=:]/i, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      if (v) return v;
    }
  } catch (err) {
    // no file yet
  }
  return '';
}

// creates the file with the steps inside, so the person only has to paste the ID. Never overwrites.
function ensureFile(file, site) {
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATE(site));
    return true;
  } catch (err) {
    return false;
  }
}

const hashOf = (id) => crypto.createHash('sha256').update(id).digest('hex');

function alreadyLinked(sessionDir) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8'));
    return !!c.registered;
  } catch (err) {
    return false;
  }
}

function usedBefore(id) {
  try {
    return JSON.parse(fs.readFileSync(MARK(), 'utf8')).hash === hashOf(id);
  } catch (err) {
    return false;
  }
}

function markUsed(id) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(MARK(), JSON.stringify({ hash: hashOf(id), at: Date.now() }));
  } catch (err) {
    // not important: the worst case is one extra download attempt on the next start
  }
}

// forget the ID that was used (the login ended, so the same ID can never work again anyway)
function forget() {
  try {
    fs.rmSync(MARK(), { force: true });
  } catch (err) {
    // not important
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hasFiles = (dir) => {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch (err) {
    return false;
  }
};

// downloads the login. A sleeping site (cold start) or a short network problem is tried again; "not found" is final.
async function download(url, fetchFn, log, { timeoutMs, tries, pauseMs }) {
  let last = null;
  for (let i = 1; i <= tries; i += 1) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404 || res.status === 400) return { status: res.status };
      if (res.ok) return { status: 200, creds: await res.json() };
      last = new Error(`the site answered ${res.status}`);
    } catch (err) {
      last = err;
    }
    if (i < tries) {
      log(`⏳ The pairing site did not answer yet (${last.message}). Trying again...`);
      await wait(pauseMs * i);
    }
  }
  return { error: last };
}

// returns 'restored' | 'skipped' | 'failed'. Never throws: a problem here must not stop the normal start.
//   restored = a login from the site was saved      skipped = nothing to do (no ID, or this ID was already used)
//   failed   = an ID is set but could not be used (the caller shows what to do)
async function restore(config, log = console.log, fetchFn = globalThis.fetch, opts = {}) {
  const raw = String(config.sessionId || '').trim() || (config.sessionIdFile ? readFile(config.sessionIdFile) : ''); // the host variable first, then the file
  if (!raw) return 'skipped';

  const id = normalize(raw);
  if (!id) {
    log('⚠️ The session ID is not valid. It looks like TFX-XXXX-XXXX-XXXX: copy it again from the pairing site and paste it in session_id.txt.');
    return 'failed';
  }
  const linked = alreadyLinked(config.sessionDir);
  if (linked && usedBefore(id)) return 'skipped'; // this ID already gave the current login

  const base = String(config.pairSiteUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    log('⚠️ The bot does not know the pairing site address (pairSiteUrl in config.js).');
    return 'failed';
  }

  log('🔑 Getting your login from the pairing site...');
  const got = await download(`${base}/api/session/${encodeURIComponent(id)}`, fetchFn, log, { timeoutMs: 45000, tries: 3, pauseMs: 4000, ...opts });

  if (got.error) {
    log(`⚠️ Could not reach the pairing site (${got.error.message}).${linked ? ' Keeping the current login.' : ''}`);
    return 'failed';
  }
  if (got.status === 404 || got.status === 400) {
    if (linked) {
      markUsed(id); // an old ID that was used before this bot remembered it: the current login stays
      return 'skipped';
    }
    log('⚠️ The pairing site does not know this session ID. It expires after 24 hours and works only once. Link again on the site and use the NEW ID.');
    return 'failed';
  }

  const creds = got.creds;
  if (creds && creds.me && creds.me.id) creds.registered = true; // a login made by QR scan has "me" but no "registered" flag
  if (!creds || !creds.registered || !(creds.me && creds.me.id)) {
    log('⚠️ The login from the pairing site is not complete. Link again on the site.');
    return 'failed';
  }

  try {
    if (hasFiles(config.sessionDir)) {
      // a different login (or leftovers) is in the way: keep a copy aside, never mix two accounts in one folder
      fs.rmSync(ASIDE(), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(ASIDE()), { recursive: true });
      fs.cpSync(config.sessionDir, ASIDE(), { recursive: true });
      fs.rmSync(config.sessionDir, { recursive: true, force: true });
      try {
        require('./sessionbackup').markLoggedOut(); // copies of the old login must not come back
      } catch (err) {
        // not important
      }
    }
    fs.mkdirSync(config.sessionDir, { recursive: true });
    const file = path.join(config.sessionDir, 'creds.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(creds));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    log(`⚠️ The login was downloaded but could not be saved (${err.message}). Is the session folder writable?`);
    return 'failed';
  }
  markUsed(id);
  log('✅ Login restored from the session ID.');
  return 'restored';
}

module.exports = { restore, normalize, forget, alreadyLinked, readFile, ensureFile, TEMPLATE };

// Several WhatsApp accounts (several bots) on the same server.
// Every account is its own bot process with its own login, settings and data, started by the same launcher (index.js).
// Nothing is shared between accounts except the program files, so one account can never overwrite the data of another.
//
// How to turn it on (nothing changes for people who do not):
//   1) a file accounts.json in the main folder:   { "accounts": [ { "name": "main" }, { "name": "shop", "prefix": "!" } ] }
//   2) or the variable ACCOUNTS=main,shop   (for hosts where you cannot edit files)
// The account called "main" keeps using the old places (data/, session/, session_id.txt), so a bot that already runs is not
// linked again. Every other account has its own folder: accounts/<name>/ (data, session and its own session_id.txt).
const fs = require('fs');
const path = require('path');

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,19}$/;
const MAIN = 'main';

function readEntries(root, env) {
  const file = path.join(root, 'accounts.json');
  if (fs.existsSync(file)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return { entries: [], problems: [`accounts.json is not valid JSON (${err.message}). Fix it or delete it.`], source: 'accounts.json' };
    }
    const list = Array.isArray(json) ? json : Array.isArray(json?.accounts) ? json.accounts : [];
    return { entries: list, problems: [], source: 'accounts.json' };
  }
  const names = String(env.ACCOUNTS || '').split(/[\s,;]+/).filter(Boolean);
  if (names.length) return { entries: names, problems: [], source: 'ACCOUNTS' };
  return null;
}

const upper = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

// Returns null when the person did not set up accounts (the bot then starts exactly as before).
function load(root, env = process.env) {
  const read = readEntries(root, env);
  if (!read) return null;
  const problems = [...read.problems];
  const seen = new Set();
  const accounts = [];
  for (const raw of read.entries) {
    const e = typeof raw === 'string' ? { name: raw } : raw && typeof raw === 'object' ? raw : null;
    const name = String(e?.name || '').trim().toLowerCase();
    if (!e || !NAME_RE.test(name)) {
      problems.push(`Account name "${e?.name ?? raw}" is not allowed: use 1-20 letters, digits, - or _ (for example "shop").`);
      continue;
    }
    if (seen.has(name)) {
      problems.push(`Account "${name}" is listed twice: the second one is ignored.`);
      continue;
    }
    seen.add(name);
    if (e.enabled === false) continue;
    const main = name === MAIN;
    const dir = main ? root : path.join(root, 'accounts', name);
    accounts.push({
      name,
      main,
      dataDir: main ? path.join(root, 'data') : path.join(dir, 'data'),
      sessionDir: main ? path.join(root, 'session') : path.join(dir, 'session'),
      sessionIdFile: main ? path.join(root, 'session_id.txt') : path.join(dir, 'session_id.txt'),
      prefix: e.prefix ? String(e.prefix) : '',
      timezone: e.timezone ? String(e.timezone) : '',
      number: String(e.number || '').replace(/\D/g, ''),
      sessionId: String(e.sessionId || '').trim() || String(env[`SESSION_ID_${upper(name)}`] || '').trim(),
    });
  }
  if (!accounts.length) problems.push('No account is switched on, so the bot starts in the normal single way.');
  return { source: read.source, accounts: accounts.length ? accounts : null, problems };
}

// the environment of the bot process of one account (index = its place in the list; the first one updates the shared files)
function envFor(acc, index, base = process.env) {
  const env = {
    ...base,
    FLASH_CHILD: '1',
    ACCOUNT_NAME: acc.name,
    TURBOFEX_DATA: acc.dataDir,
    SESSION_DIR: acc.sessionDir,
    SESSION_ID_FILE: acc.sessionIdFile,
  };
  if (index > 0) env.TURBOFEX_NO_UPDATE = '1';
  if (!acc.main) {
    env.TURBOFEX_ISOLATED = '1'; // config.env must not hand this account the login or number of the main one
    env.SESSION_ID = acc.sessionId;
    env.NUMBER = acc.number;
    env.PAIRING_NUMBER = '';
    env.OWNER_NUMBER = '';
  } else if (acc.sessionId) {
    env.SESSION_ID = acc.sessionId;
  }
  if (acc.prefix) env.BOT_PREFIX = acc.prefix;
  if (acc.timezone) env.TIMEZONE = acc.timezone;
  return env;
}

function prepare(acc) {
  for (const d of [acc.dataDir, acc.sessionDir]) fs.mkdirSync(d, { recursive: true });
  try {
    require('./sessionid').ensureFile(acc.sessionIdFile, process.env.PAIR_SITE_URL || 'https://turbofex-pair.onrender.com');
  } catch (err) {
    // the bot makes the file itself when it starts
  }
}

module.exports = { load, envFor, prepare, NAME_RE, MAIN };

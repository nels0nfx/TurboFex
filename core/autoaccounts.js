// Accounts that are made BY THEMSELVES from the session IDs in session_id.txt.
// The person keeps the first session ID in the file and adds the next one on a new line below it; the bot sees the new ID,
// creates the account (its own folder, login and settings) and starts it. Nothing else has to be set up.
//
//   session_id.txt                         what the bot does
//   SESSION_ID=TFX-AAAA-BBBB-CCCC          the first account ("main"; it keeps its old data/ and session/)
//   SESSION_ID=TFX-DDDD-EEEE-FFFF          a new account called account2 (accounts/account2/)
//   shop=TFX-GGGG-HHHH-JJJJ                a new account called shop     (accounts/shop/)
//
// accounts/registry.json remembers which ID made which account, so the account keeps running (with its own login) even when
// its line is later removed from the file, and the same ID never makes a second account.
// A file with ONE new ID still replaces the login of the bot (the way it always worked); only a second ID adds an account.
const fs = require('fs');
const path = require('path');
const sessionid = require('./sessionid');

const regFile = (root) => path.join(root, 'accounts', 'registry.json');

function readRegistry(root) {
  try {
    const r = JSON.parse(fs.readFileSync(regFile(root), 'utf8'));
    return r && typeof r.accounts === 'object' && r.accounts ? r.accounts : {};
  } catch (err) {
    return {};
  }
}

function writeRegistry(root, accounts) {
  try {
    fs.mkdirSync(path.dirname(regFile(root)), { recursive: true });
    const tmp = `${regFile(root)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, accounts }, null, 2));
    fs.renameSync(tmp, regFile(root));
    return true;
  } catch (err) {
    return false;
  }
}

// what the main account already has: the hash of the ID it used, and whether it is linked
function mainState(root) {
  let hash = null;
  let linked = false;
  try {
    hash = JSON.parse(fs.readFileSync(path.join(root, 'data', 'session-id.json'), 'utf8')).hash || null;
  } catch (err) {
    hash = null;
  }
  try {
    linked = !!JSON.parse(fs.readFileSync(path.join(root, 'session', 'creds.json'), 'utf8')).registered;
  } catch (err) {
    linked = false;
  }
  return { hash, linked };
}

// every ID: the main file, and the SESSION_ID variable of the host (it may hold several IDs separated by a comma or a space)
function allIds(root, env) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, 'session_id.txt'), 'utf8');
  } catch (err) {
    text = '';
  }
  const fromHost = String(env.SESSION_ID || '').split(/[\s,;]+/).filter(Boolean).join('\n');
  return sessionid.parseIds(`${text}\n${fromHost}`);
}

// Returns null when this is not a "several IDs" setup. Otherwise:
//   names     every auto account (the registry), without main
//   assigned  { name: ID } for the IDs that are in the file now ("main" included)
//   news      the names of accounts made right now
function resolve(root, env, takenNames, nameOk, now = Date.now()) {
  const ids = allIds(root, env);
  const reg = readRegistry(root);
  if (ids.length < 2 && !Object.keys(reg).length) return null;

  const byHash = {};
  for (const [name, v] of Object.entries(reg)) if (v && v.hash) byHash[v.hash] = name;
  const main = mainState(root);
  const taken = new Set([...takenNames, ...Object.keys(reg), 'main']);
  const assigned = {};
  const news = [];
  let mainTaken = false;
  for (const { id, label } of ids) {
    const h = sessionid.hashOf(id);
    if (byHash[h]) {
      assigned[byHash[h]] = id;
    } else if (!mainTaken && (h === main.hash || (!main.linked && !main.hash))) {
      assigned.main = id; // the ID the main account used, or the first ID of a bot that is not linked yet
      mainTaken = true;
    } else {
      let name = label && label !== 'main' && nameOk(label) && !taken.has(label) ? label : '';
      for (let n = 2; !name; n += 1) if (!taken.has(`account${n}`)) name = `account${n}`;
      taken.add(name);
      reg[name] = { hash: h, at: now };
      byHash[h] = name;
      assigned[name] = id;
      news.push(name);
    }
  }
  if (news.length) writeRegistry(root, reg);
  return { names: Object.keys(reg), assigned, news };
}

module.exports = { resolve, readRegistry, allIds, regFile };

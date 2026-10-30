// Updates the bot from the bot author's GitHub repo.
//  1st choice: the repo's own files (package.json decides the version, the branch is downloaded as a zip by GitHub itself).
//              The author only has to push the files, no zip is needed.
//  2nd choice: the file  turbofex-latest.zip  in the main page of the repo (older way, still works)
//  3rd choice: a .zip attached to a GitHub Release
// Never touches: config.js, session/, data/, node_modules/
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const store = require('../whatsapp/store');
const brand = require('./brand');
const bootnote = require('./bootnote');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const KEEP = new Set(['config.js', 'session_id.txt', 'session', 'data', 'node_modules', '.env', '.git', '.github']);
const UA = 'TurboFex-Updater';
const REPO_ZIP = 'turbofex-latest.zip';
const VERSIONISH = /^v?\d+\.\d+/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch (err) {
    return null;
  }
}

function localVersion() {
  return readJson('package.json')?.version || '0.0.0';
}

function getRepo() {
  const fromFile = readJson('update.json')?.repo;
  return String(process.env.UPDATE_REPO || config.updateRepo || fromFile || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

function isNewer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

const cmpVersion = (a, b) => (isNewer(a, b) ? 1 : isNewer(b, a) ? -1 : 0);

function reasonText(reason) {
  if (reason === 'no-repo') {
    return 'No update source is set yet. The bot author must put the GitHub repo name in update.json.';
  }
  return reason;
}

function loadAdmZip() {
  try {
    return require('adm-zip');
  } catch (err) {
    throw new Error('A needed package (adm-zip) is missing. Restart the bot with npm install enabled, then try again.');
  }
}

// Opens a zip and reads its version and notes
function inspectZip(buffer) {
  const AdmZip = loadAdmZip();
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new Error('The update file is not a valid zip.');
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  const pkg = entries
    .filter((e) => /(^|\/)package\.json$/.test(e.entryName))
    .sort((a, b) => a.entryName.length - b.entryName.length)[0];
  if (!pkg) {
    const seen = entries.slice(0, 4).map((e) => e.entryName).join(', ') || 'nothing';
    throw new Error(`The update zip has no package.json at its top level (it contains: ${seen}).`);
  }
  const prefix = pkg.entryName.slice(0, pkg.entryName.length - 'package.json'.length);

  let version;
  try {
    version = String(JSON.parse(pkg.getData().toString('utf8')).version || '');
  } catch (err) {
    throw new Error('The update zip has a broken package.json.');
  }
  const log = entries.find((e) => e.entryName === `${prefix}changelog.txt`);
  return { entries, prefix, version, notes: log ? log.getData().toString('utf8').trim() : '' };
}

function makeInfo(repo, latest, notes, extra) {
  const current = localVersion();
  // the file in the repo is the truth: any different version counts as an update (this also allows going back)
  return { ok: true, repo, current, latest, notes, available: !!latest && latest !== current, ...extra };
}

// 1st choice: the files pushed to the repo. Only a tiny file is read to see the version; the branch zip is downloaded only
// when the version differs. (The download happens in applyUpdate, from info.url.)
async function fromRepoBranch(repo) {
  const wanted = String(readJson('update.json')?.branch || 'main');
  const branches = [...new Set([wanted, 'main', 'master'])];
  for (const branch of branches) {
    const raw = (file) => fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${file}?t=${Date.now()}`, { headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    const res = await raw('package.json');
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GitHub answered with error ${res.status}.`);
    let version = '';
    try {
      version = String(JSON.parse(await res.text()).version || '');
    } catch (err) {
      throw new Error('The package.json in the repo is broken.');
    }
    if (!version) throw new Error('The package.json in the repo has no version.');
    let notes = '';
    try {
      const log = await raw('changelog.txt');
      if (log.ok) notes = (await log.text()).trim();
    } catch (err) {
      notes = ''; // the notes are optional
    }
    return makeInfo(repo, version, notes, { source: 'branch', url: `https://codeload.github.com/${repo}/zip/refs/heads/${branch}` });
  }
  return null;
}

// 2nd choice: turbofex-latest.zip in the repo
async function fromRepoFile(repo) {
  const wanted = String(readJson('update.json')?.branch || 'main');
  const branches = [...new Set([wanted, 'main', 'master'])];

  for (const branch of branches) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${REPO_ZIP}?t=${Date.now()}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GitHub answered with error ${res.status}.`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const z = inspectZip(buffer);
    return makeInfo(repo, z.version, z.notes, { source: 'repo', buffer });
  }
  return null;
}

// 2nd choice: a zip attached to a GitHub Release (highest version that has one)
async function fromReleases(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;

  const hasZip = (r) => (r.assets || []).some((a) => /\.zip$/i.test(a.name));
  const list = (await res.json())
    .filter((r) => !r.draft && !r.prerelease && VERSIONISH.test(r.tag_name || '') && hasZip(r))
    .sort((a, b) => cmpVersion(b.tag_name, a.tag_name));
  if (!list.length) return null;

  const rel = list[0];
  const asset = rel.assets.find((a) => /\.zip$/i.test(a.name));
  return makeInfo(repo, String(rel.tag_name).replace(/^v/i, ''), String(rel.body || '').trim(), {
    source: 'release',
    url: asset.browser_download_url,
  });
}

async function getLatest() {
  const repo = getRepo();
  if (!repo) return { ok: false, reason: 'no-repo' };

  let branchError = null;
  try {
    const fromBranch = await fromRepoBranch(repo);
    if (fromBranch) return fromBranch;
  } catch (err) {
    branchError = err; // try the zip file and the releases before giving up
  }

  let fromFile = null;
  try {
    fromFile = await fromRepoFile(repo);
  } catch (err) {
    if (!branchError) branchError = err;
  }
  if (fromFile) return fromFile;

  let fromRel = null;
  try {
    fromRel = await fromReleases(repo);
  } catch (err) {
    fromRel = null;
  }
  if (fromRel) return fromRel;

  return {
    ok: false,
    reason: branchError ? branchError.message : `No update found. The public GitHub repo "${repo}" must contain the bot files (package.json in the main folder of the branch).`,
  };
}

// Copies the files from the update zip over the bot.
// A copy of every replaced file is kept in data/rollback so a crash can be undone.
// Checks a downloaded update BEFORE any file is replaced. A broken zip (a typo, a missing file) is rejected, so bots that
// update by themselves can never be left unable to start.
const REQUIRED = ['index.js', 'package.json', 'core/boot.js', 'core/brand.js', 'core/integrity.js', 'whatsapp/connection.js', 'whatsapp/handler.js'];

// relative requires of one file whose target is not among the update's files
function missingRequires(rel, source, files) {
  const missing = [];
  const re = /\brequire\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1\s*\)/g;
  let m;
  while ((m = re.exec(source))) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
    if (target.startsWith('..')) continue;
    const found = [target, `${target}.js`, `${target}.json`, `${target}/index.js`].some((c) => files.has(c));
    if (!found && !missing.includes(m[2])) missing.push(m[2]);
  }
  return missing;
}

function validateEntries(entries, prefix) {
  const problems = [];
  const files = new Map();
  for (const e of entries) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
    files.set(e.entryName.slice(prefix.length), e);
  }
  for (const rel of REQUIRED) if (!files.has(rel)) problems.push(`${rel} is missing`);
  for (const [rel, e] of files) {
    if (rel.split('/').some((p) => p === '..')) problems.push(`${rel} has an unsafe path`);
    if (!rel.endsWith('.js') || rel.startsWith('node_modules/')) continue;
    const source = e.getData().toString('utf8');
    try {
      new vm.Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, { filename: rel });
    } catch (err) {
      problems.push(`${rel} has a syntax error (${err.message})`);
      continue;
    }
    // a file that loads another file which is not in the update ("Cannot find module './market'") would crash the bot on start
    if (rel.startsWith('tests/')) continue; // tests may mention files inside text (they are not loaded when the bot starts)
    for (const missing of missingRequires(rel, source, files)) problems.push(`${rel} needs ${missing}, which is not in the update`);
  }
  try {
    const pj = JSON.parse(files.get('package.json').getData().toString('utf8'));
    if (typeof pj.version !== 'string' || !pj.version) problems.push('package.json has no version');
  } catch (err) {
    problems.push('package.json is not valid');
  }
  // the bot refuses to start when its name does not match the check in core/integrity.js
  try {
    const name = /botName:\s*'([^']*)'/.exec(files.get('core/brand.js').getData().toString('utf8'));
    const expected = /EXPECTED\s*=\s*'([0-9a-f]{64})'/.exec(files.get('core/integrity.js').getData().toString('utf8'));
    if (!name || !expected || crypto.createHash('sha256').update(name[1]).digest('hex') !== expected[1]) problems.push('the bot name does not match its integrity check');
  } catch (err) {
    // the files above are already reported as missing
  }
  if (problems.length) {
    throw new Error(`The update was rejected and nothing was changed: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}.`);
  }
}

// The paths in removed.txt that may be deleted. A path that the update itself contains is never deleted: removed.txt once listed
// commands/market.js (the old market) and so deleted the NEW market and herald commands on every bot that updated.
function filesToRemove(text, shipped = new Set()) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel || rel.startsWith('#') || rel.includes('..') || KEEP.has(rel.split('/')[0]) || shipped.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

async function applyUpdate(info) {
  let buffer = info.buffer;
  if (!buffer) {
    const res = await fetch(info.url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`Download failed (error ${res.status}).`);
    buffer = Buffer.from(await res.arrayBuffer());
  }

  const { entries, prefix } = inspectZip(buffer);
  validateEntries(entries, prefix);
  const depsOf = () => {
    const pj = readJson('package.json') || {};
    return JSON.stringify([pj.dependencies || {}, pj.optionalDependencies || {}]);
  };
  const depsBefore = depsOf();
  const before = localVersion();
  const rootDir = path.resolve(ROOT) + path.sep;

  const rbDir = path.join(ROOT, 'data', 'rollback');
  fs.rmSync(rbDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(rbDir, 'files'), { recursive: true });
  const created = [];
  let files = 0;

  for (const e of entries) {
    if (!e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    if (!rel || KEEP.has(rel.split('/')[0])) continue;

    const dest = path.resolve(ROOT, rel);
    if (!dest.startsWith(rootDir)) continue; // safety: never write outside the bot folder

    if (fs.existsSync(dest)) {
      const copy = path.join(rbDir, 'files', rel);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(dest, copy);
    } else {
      created.push(rel);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    files++;
  }

  // files that no longer exist in the new version are listed in removed.txt (never a file that this update ships itself)
  const removedList = entries.find((e) => e.entryName === `${prefix}removed.txt`);
  if (removedList) {
    const shipped = new Set(entries.filter((e) => !e.isDirectory && e.entryName.startsWith(prefix)).map((e) => e.entryName.slice(prefix.length)));
    for (const rel of filesToRemove(removedList.getData().toString('utf8'), shipped)) {
      const dest = path.resolve(ROOT, rel);
      if (!dest.startsWith(rootDir) || !fs.existsSync(dest) || fs.statSync(dest).isDirectory()) continue;
      const copy = path.join(rbDir, 'files', rel);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(dest, copy);
      fs.rmSync(dest, { force: true });
    }
  }

  const after = localVersion();
  fs.writeFileSync(path.join(rbDir, 'manifest.json'), JSON.stringify({ from: before, to: after, created }));
  fs.writeFileSync(path.join(rbDir, 'pending'), String(Date.now()));

  const depsAfter = depsOf();
  if (depsBefore !== depsAfter) {
    try {
      execSync('npm install --omit=dev --no-audit --no-fund', {
        cwd: ROOT,
        stdio: 'ignore',
        timeout: 5 * 60 * 1000,
      });
    } catch (err) {
      throw new Error('Files were updated, but installing packages failed. Restart the bot with npm install enabled.');
    }
  }

  return { files, version: after };
}

// Runs when the bot starts. Returns true if a restart is needed.
async function autoUpdateOnStart() {
  if (!store.getAutoUpdate()) {
    console.log('Auto-update is OFF.');
    return false;
  }
  try {
    const info = await getLatest();
    if (!info.ok) {
      if (info.reason !== 'no-repo') console.log(`Update check skipped: ${reasonText(info.reason)}`);
      return false;
    }
    if (!info.available) {
      console.log(`✅ ${brand.botName} v${info.current} is up to date.`);
      return false;
    }
    let skip = '';
    try {
      skip = fs.readFileSync(path.join(ROOT, 'data', 'rollback', 'skip-version'), 'utf8').trim();
    } catch (err) {
      skip = '';
    }
    if (skip && skip === info.latest) {
      console.log(`Skipping v${info.latest}: it crashed on this bot before.`);
      return false;
    }
    console.log(`⬇️ Updating v${info.current} -> v${info.latest}...`);
    const result = await applyUpdate(info);
    if (result.version === info.current) return false;
    // the new copy tells the owner "update complete" as soon as it is connected
    bootnote.write({ type: 'update', from: info.current, to: result.version, notes: info.notes });
    return true;
  } catch (err) {
    console.log('Auto-update skipped:', err.message);
    return false;
  }
}

module.exports = {
  fromRepoBranch, filesToRemove, validateEntries, getLatest, applyUpdate, autoUpdateOnStart, reasonText, isNewer };

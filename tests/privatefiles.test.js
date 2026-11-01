// The five private AI files (AGENTS.md, CLAUDE.md, GEMINI.md, PROJECT_GUIDE.md, removed.txt) stay on the owner's phone and in
// his development ZIP, and must never reach GitHub or a public release ZIP. These tests run the owner's real workflow with a
// real Git repository and a real "GitHub" (a bare repository): extract the ZIP, commit, push, build the release ZIP.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRIVATE = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'PROJECT_GUIDE.md', 'removed.txt'];
const ALL_PRIVATE = [...PRIVATE, 'OWNER_PREFERENCES.private.md'];
const have = (cmd, args = ['--version']) => spawnSync(cmd, args).status === 0;
const canRun = have('git') && have('sh', ['-c', 'true']) && have('unzip', ['-v']);
const sh = (cwd, cmd) => spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

// the project files that GitHub shows (everything except the private files and live data)
function publicFiles() {
  const out = [];
  const skip = new Set(['node_modules', 'session', 'data', '.git', '.github']);
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip.has(e.name) || ALL_PRIVATE.includes(r) || e.name === '.env' || e.name === 'config.env' || e.name === 'session_id.txt') continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  })(ROOT, '');
  return out;
}

// builds a development ZIP the way it is handed over: every project file + the six private files (dummy text if absent)
function makeDevZip(dir) {
  const stage = path.join(dir, 'stage');
  for (const f of publicFiles()) {
    fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(stage, f));
  }
  for (const f of ALL_PRIVATE) fs.writeFileSync(path.join(stage, f), `PRIVATE ${f}\n`);
  const zip = path.join(dir, 'dev.zip');
  const r = sh(stage, `zip -qr "${zip}" . `);
  return r.status === 0 ? zip : null;
}

test('.gitignore and .gitattributes name all five files (and match nested copies), and the helper scripts exist', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
  for (const f of PRIVATE) {
    assert.ok(ignore.includes(f), `${f} is in .gitignore (no slash, so nested copies match too)`);
    assert.match(attrs, new RegExp(`^${f.replace('.', '\\.')} export-ignore$`, 'm'), `${f} is export-ignored`);
  }
  assert.ok(ignore.includes('OWNER_PREFERENCES.private.md'));
  for (const f of ['tools/protect-private.sh', 'tools/make-release.sh']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('what the bot needs to install and run is not ignored or excluded', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const needed = ['index.js', 'package.json', 'update.json', 'config.js', 'README.md', 'changelog.txt', 'removed-files.txt', '.gitattributes', '.gitignore', 'tools/make-release.sh'];
  for (const f of needed) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  for (const f of needed) assert.ok(!ignore.includes(f) && !ignore.includes(path.basename(f)), `${f} is not ignored`);
  assert.ok(!/^(commands|core|whatsapp|tests|tools)\/?$/m.test(ignore.join('\n')));
});

test('the self-updater still removes old files with the public removed-files.txt (and still reads an old removed.txt)', () => {
  const { removeOldFiles } = require('../core/updater');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-upd-'));
  try {
    const rootDir = path.join(dir, 'bot') + path.sep;
    fs.mkdirSync(path.join(rootDir, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'commands', 'old.js'), 'x');
    fs.writeFileSync(path.join(rootDir, 'commands', 'older.js'), 'y');
    fs.writeFileSync(path.join(rootDir, 'commands', 'keep.js'), 'z');
    const entry = (name, text) => ({ entryName: `TurboFex-main/${name}`, isDirectory: false, getData: () => Buffer.from(text) });
    const entries = [entry('removed-files.txt', '# old\ncommands/old.js\ncommands/keep.js\n'), entry('removed.txt', 'commands/older.js\n'), entry('commands/keep.js', 'new')];
    const removed = removeOldFiles(entries, 'TurboFex-main/', rootDir, path.join(dir, 'rb'));
    assert.deepStrictEqual(removed.sort(), ['commands/old.js', 'commands/older.js']);
    assert.ok(fs.existsSync(path.join(rootDir, 'commands', 'keep.js')), 'a file the update ships is never deleted');
    assert.ok(fs.existsSync(path.join(dir, 'rb', 'files', 'commands', 'old.js')), 'a copy is kept for the rollback');
    assert.deepStrictEqual(removeOldFiles([entry('package.json', '{}')], 'TurboFex-main/', rootDir, path.join(dir, 'rb')), [], 'no list: nothing is removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the whole Termux workflow: extract the ZIP, commit, push, build the release', { skip: canRun ? false : 'git, sh or unzip is not available here' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-flow-'));
  try {
    const zip = makeDevZip(dir);
    if (!zip) return; // "zip" is not installed here: the stage folder is used directly below
    const home = path.join(dir, 'home');
    const repo = path.join(home, 'TurboFex');
    const remote = path.join(dir, 'github.git');
    fs.mkdirSync(repo, { recursive: true });
    assert.strictEqual(sh(dir, `git init -q --bare "${remote}"`).status, 0);
    assert.strictEqual(sh(repo, `git init -q -b main && git remote add origin "${remote}"`).status, 0);

    // OLD STATE (before this change): the private files were committed and pushed, also one nested copy
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    for (const f of PRIVATE) fs.writeFileSync(path.join(repo, f), `OLD ${f}\n`);
    fs.writeFileSync(path.join(repo, 'docs', 'AGENTS.md'), 'OLD nested\n');
    fs.writeFileSync(path.join(repo, 'index.js'), '// old\n');
    assert.strictEqual(sh(repo, 'git add -A && git commit -qm old && git push -q origin main').status, 0);

    // the owner's push command, step by step
    assert.strictEqual(sh(repo, `unzip -qo "${zip}" -d "${repo}"`).status, 0);
    fs.writeFileSync(path.join(repo, 'docs', 'AGENTS.md'), 'my nested private copy\n'); // a nested copy is still there
    const protect = sh(repo, 'sh tools/protect-private.sh');
    assert.strictEqual(protect.status, 0, protect.stderr);
    assert.match(protect.stdout, /Removed 6 private file/); // 5 root + 1 nested
    assert.strictEqual(sh(repo, 'git add -A').status, 0);
    assert.strictEqual(sh(repo, 'git commit -qm "v-test"').status, 0);
    assert.strictEqual(sh(repo, 'git push -q origin main').status, 0);

    // 1) the local copies are all still there, with their content
    for (const f of PRIVATE) assert.strictEqual(fs.readFileSync(path.join(repo, f), 'utf8'), `PRIVATE ${f}\n`, `${f} is still on the phone`);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'docs', 'AGENTS.md'), 'utf8'), 'my nested private copy\n');
    assert.ok(fs.existsSync(path.join(repo, 'OWNER_PREFERENCES.private.md')));
    // 2) Git tracks none of them
    const tracked = sh(repo, 'git ls-files').stdout.split('\n');
    for (const f of [...ALL_PRIVATE, 'docs/AGENTS.md']) assert.ok(!tracked.includes(f), `${f} is not tracked`);
    assert.ok(tracked.includes('index.js') && tracked.includes('package.json') && tracked.includes('removed-files.txt') && tracked.includes('tools/make-release.sh'));
    // 3) GitHub (the bare remote) does not have them in its newest version
    const remoteFiles = sh(dir, `git --git-dir="${remote}" ls-tree -r --name-only main`).stdout.split('\n');
    for (const f of [...ALL_PRIVATE, 'docs/AGENTS.md']) assert.ok(!remoteFiles.includes(f), `${f} is not on GitHub`);
    assert.ok(remoteFiles.includes('index.js'));
    // 4) the release ZIP: checked, has no private file, has the files the bot needs
    const out = path.join(home, 'TurboFex-hosting.zip');
    const rel = sh(repo, `sh tools/make-release.sh "${out}"`);
    assert.strictEqual(rel.status, 0, rel.stdout + rel.stderr);
    const listed = sh(dir, `unzip -Z1 "${out}"`).stdout.split('\n');
    for (const f of [...ALL_PRIVATE, 'docs/AGENTS.md']) assert.ok(!listed.includes(f), `${f} is not in the release ZIP`);
    for (const f of ['index.js', 'package.json', 'update.json', 'removed-files.txt', 'core/boot.js', 'whatsapp/connection.js']) assert.ok(listed.includes(f), `${f} is in the release ZIP`);
    // 5) the history check only looks: the old commit is reported, nothing is rewritten
    const before = sh(repo, 'git rev-list --all').stdout;
    const hist = sh(repo, 'sh tools/protect-private.sh --history');
    assert.match(hist.stdout, /AGENTS\.md/);
    assert.strictEqual(sh(repo, 'git rev-list --all').stdout, before, 'history is untouched');

    // 6) later commits: forcing a private file in does not work, and the next ZIP leaves them out again
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'changed again\n');
    sh(repo, 'git add -f AGENTS.md CLAUDE.md');
    sh(repo, 'git commit -qm forced');
    assert.ok(!sh(repo, 'git ls-files').stdout.split('\n').includes('AGENTS.md'), 'the pre-commit guard dropped it');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), 'changed again\n', 'and the file on the phone was not touched');
    sh(repo, 'git update-index --add --cacheinfo 100644,$(git hash-object -w AGENTS.md),AGENTS.md');
    const push = sh(repo, 'git commit --no-verify -qm sneaky && git push origin main');
    assert.notStrictEqual(push.status, 0, 'the pre-push guard stops a push that has a private file');

    // 7) even then, the release ZIP leaves the private file out (export-ignore), and a release that would still carry
    //    something private or secret is refused and deleted
    const safe = path.join(home, 'safe.zip');
    assert.strictEqual(sh(repo, `sh tools/make-release.sh "${safe}"`).status, 0);
    assert.ok(!sh(dir, `unzip -Z1 "${safe}"`).stdout.split('\n').includes('AGENTS.md'), 'export-ignore keeps it out of the ZIP');
    fs.writeFileSync(path.join(repo, 'session_id.txt'), 'SESSION_ID=secret\n');
    sh(repo, 'git add -f session_id.txt && git commit -q --no-verify -m secret');
    const bad = sh(repo, `sh tools/make-release.sh "${path.join(home, 'bad.zip')}"`);
    assert.notStrictEqual(bad.status, 0);
    assert.ok(!fs.existsSync(path.join(home, 'bad.zip')), 'the bad ZIP is deleted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

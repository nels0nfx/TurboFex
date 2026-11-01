// AGENTS.md is read first by every new AI helper: it must carry the owner's push command and the ZIP name rule.
require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const agents = fs.readFileSync(path.join(__dirname, '..', 'AGENTS.md'), 'utf8');

test('AGENTS.md has the push command template, and says to send it with every ZIP', () => {
  assert.ok(agents.includes('cd ~/TurboFex && unzip -o ~/storage/downloads/TurboFex-hosting-vX_Y_Z.zip -d ~/TurboFex && git add -A && (git commit -m "vX.Y.Z - short summary" || true) && git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z && git archive --format=zip -o ~/TurboFex-hosting.zip HEAD && gh release create vX.Y.Z ~/TurboFex-hosting.zip --title "TurboFex vX.Y.Z" --notes "short summary" --latest && rm ~/TurboFex-hosting.zip'));
  assert.match(agents, /Every time you hand the owner a ZIP, finish your reply with his push command/);
  assert.match(agents, /TurboFex-hosting-vX_Y_Z\.zip/);
});

test('AGENTS.md: the example matches the package version style, and the old wipe-everything command is gone', () => {
  const example = /TurboFex-hosting-v(\d+)_(\d+)_(\d+)\.zip -d/.exec(agents);
  assert.ok(example, 'there is a filled-in example');
  const version = `${example[1]}.${example[2]}.${example[3]}`;
  assert.ok(agents.includes(`git tag v${version} && git push origin v${version}`), 'the example uses the same version everywhere');
  assert.ok(agents.includes(`--title "TurboFex v${version}"`));
  assert.ok(!agents.includes('find . -mindepth 1 -maxdepth 1'), 'the wipe-first command is not the owner\'s command');
});

// ---- the private owner preferences system
const root = path.join(__dirname, '..');
const PRIVATE = 'OWNER_PREFERENCES.private.md';

test('private preferences: git ignores the file, and AGENTS.md says every agent must read it first', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(ignore.includes(PRIVATE), 'the file is in .gitignore, so GitHub never shows it');
  assert.ok(agents.includes(PRIVATE));
  assert.match(agents, /STEP 0/);
  assert.match(agents, /save it in that file at once/i);
  assert.match(agents, /Never delete earlier lines/);
});

test('private preferences: every AI instruction file points to it (and holds no preferences itself)', () => {
  for (const f of ['CLAUDE.md', 'GEMINI.md', '.cursorrules', 'AGENTS.md', 'PROJECT_GUIDE.md']) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(text.includes(PRIVATE), `${f} points to the private file`);
  }
  for (const f of ['CLAUDE.md', 'GEMINI.md', '.cursorrules']) {
    assert.ok(fs.readFileSync(path.join(root, f), 'utf8').length < 1200, `${f} is only a pointer`);
  }
});

test('private preferences: when the file is present it has all the sections and never says to commit it', () => {
  const file = path.join(root, PRIVATE);
  if (!fs.existsSync(file)) return; // a clean clone from GitHub does not have it, on purpose
  const text = fs.readFileSync(file, 'utf8');
  for (const h of ['## 1. User preferences', '## 2. UI/UX and design standards', '## 3. Coding and development rules', '## 4. Bot behaviour and functionality', '## 5. Things that must never be changed without permission', '## 6. New decisions and updated requirements']) {
    assert.ok(text.includes(h), h);
  }
  assert.match(text, /SUPERSEDED/);
  assert.match(text, /never delete or overwrite/i);
});

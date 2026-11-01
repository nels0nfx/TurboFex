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

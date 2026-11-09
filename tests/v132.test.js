require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const legacy = require('../core/legacyclean');

const ROOT = path.join(__dirname, '..');
const write = (root, rel, text = '// x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

test('v1.3.2: old Empire files that an old updater left behind are removed at start, with a copy kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-legacy-'));
  write(root, 'removed-files.txt', '# old\ncommands/estates.js\ncore/realm/ticker.js\n../evil.js\nsession/creds.json\n');
  write(root, 'commands/estates.js');                 // in the list
  write(root, 'core/realm/ticker.js');                // in the list
  write(root, 'core/realm/never-listed.js');          // old folder, not in the list
  write(root, 'commands/mystery-empire.js', "const x = require('../core/realm/state');\n"); // loads the old folder, not in the list
  write(root, 'commands/ping.js', "module.exports = [];\n");                                  // a normal command
  write(root, 'session/creds.json', 'secret');        // never touched, even if listed
  write(root, 'data/realm-data.json', '{}');          // saved data is never touched
  const removed = legacy.run(root).sort();
  assert.deepStrictEqual(removed, ['commands/estates.js', 'commands/mystery-empire.js', 'core/realm/never-listed.js', 'core/realm/ticker.js']);
  for (const rel of removed) {
    assert.ok(!fs.existsSync(path.join(root, rel)), `${rel} is gone`);
    assert.ok(fs.existsSync(path.join(root, 'data', 'legacy-removed', rel)), `${rel} has a copy`);
  }
  assert.ok(fs.existsSync(path.join(root, 'commands/ping.js')));
  assert.ok(fs.existsSync(path.join(root, 'session/creds.json')));
  assert.ok(fs.existsSync(path.join(root, 'data/realm-data.json')));
  assert.ok(!fs.existsSync(path.join(root, 'core/realm')), 'the empty old folder is removed');
  assert.deepStrictEqual(legacy.run(root), [], 'a second start has nothing left to do');
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.2: the clean-up never removes anything this version ships, and runs before the bot loads', () => {
  assert.deepStrictEqual(legacy.candidates(ROOT).filter((rel) => fs.existsSync(path.join(ROOT, rel))), [], 'the project contains no file that the clean-up would remove');
  const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  assert.strictEqual(idx.split("legacyclean').run(__dirname)").length - 1, 2, 'in the supervisor and in the bot process (an update restarts only the bot process)');
  assert.ok(idx.indexOf("legacyclean').run", idx.indexOf('FLASH_CHILD')) < idx.indexOf("require('./core/boot')"), 'before the commands load');
});

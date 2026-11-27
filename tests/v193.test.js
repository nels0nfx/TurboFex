// v1.9.3 / v1.9.4: the bot never clears ALL chat keys by itself. Only one failing chat is repaired (see v194.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('boot.js repairs one chat at a time, never every chat', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'core/boot.js'), 'utf8');
  assert.ok(/onChatStorm/.test(boot));
  assert.ok(!/onStorm\(|clearSessions/.test(boot));
});

test('the owner .repair command is still there', () => {
  const cmd = require('../commands/repair.js');
  assert.strictEqual(cmd.name, 'repair');
  assert.strictEqual(cmd.ownerOnly, true);
});

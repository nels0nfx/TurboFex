// Every JavaScript file of the bot must compile: a typo is caught here, before it reaches anybody.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'data', 'session', '.git']);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (skip.has(d.name) ? [] : d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}

test('all files compile', () => {
  const files = walk(root);
  assert.ok(files.length > 50);
  for (const f of files) {
    assert.doesNotThrow(() => new vm.Script(`(function (exports, require, module, __filename, __dirname) {${fs.readFileSync(f, 'utf8')}\n})`, { filename: f }), `${path.relative(root, f)} does not compile`);
  }
});

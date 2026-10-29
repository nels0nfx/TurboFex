require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { info } = require('../whatsapp/categories');

const dir = path.join(__dirname, '..', 'commands');
const all = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  for (const cmd of [].concat(require(path.join(dir, file)))) all.push({ file, cmd });
}

test('every command file loads and has the required fields', () => {
  assert.ok(all.length > 100);
  for (const { file, cmd } of all) {
    assert.ok(typeof cmd.name === 'string' && /^[a-z0-9]+$/.test(cmd.name), `${file}: the name must be lowercase letters and digits`);
    assert.ok(typeof cmd.run === 'function', `${file}: ${cmd.name} has no run function`);
    assert.ok(typeof cmd.description === 'string' && cmd.description.trim(), `${file}: ${cmd.name} has no description`);
    assert.ok(typeof cmd.category === 'string', `${file}: ${cmd.name} has no category`);
  }
});
test('every category exists in the menu', () => {
  for (const { file, cmd } of all) assert.ok(info[cmd.category], `${file}: ${cmd.name} uses the unknown category "${cmd.category}"`);
});
test('no name or alias is used twice', () => {
  const seen = new Map();
  for (const { file, cmd } of all) {
    for (const n of [cmd.name, ...(cmd.aliases || [])]) {
      assert.ok(!seen.has(n), `"${n}" is used by ${seen.get(n)} and ${file}`);
      seen.set(n, file);
    }
  }
});

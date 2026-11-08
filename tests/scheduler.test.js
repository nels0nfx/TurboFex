require('./_setup');
const test = require('node:test');
const assert = require('node:assert');

test('every module the bot loads at start can be loaded (no missing files)', () => {
  for (const m of ['../core/scheduler', '../core/boot', '../core/sessionid', '../core/setup', '../core/updater']) assert.doesNotThrow(() => require(m), m);
});

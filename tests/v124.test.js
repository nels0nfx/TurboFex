// v1.2.4: no more "Finished syncing" notices from automatic placeholder resend requests.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const placeholder = require('../core/placeholder');

test('the version is 1.2.4', () => {
  assert.strictEqual(require('../package.json').version, '1.2.4');
});

test('the library is told every message was already asked for (nothing reaches the phone)', async () => {
  assert.strictEqual(await placeholder.cache.get('ABC123'), true);
  placeholder.cache.set('ABC123', { a: 1 }); // the library tries to remember it: ignored
  assert.strictEqual(await placeholder.cache.get('ABC123'), true);
});

test('the view-once watcher may ask a few times per hour, then the limit says no', async () => {
  const before = placeholder.used();
  const granted = [];
  for (let i = 0; i < placeholder.PER_HOUR + 3; i++) granted.push(placeholder.allow(`VO${i}`));
  assert.strictEqual(granted.filter(Boolean).length, Math.max(0, placeholder.PER_HOUR - before));
  const ok = `VO0`;
  if (granted[0]) {
    assert.strictEqual(await placeholder.cache.get(ok), undefined, 'the allowed message really goes to the phone');
    placeholder.cache.set(ok, { a: 1 });
    assert.deepStrictEqual(await placeholder.cache.get(ok), { a: 1 }, 'and the library can follow it');
    placeholder.cache.del(ok);
    assert.strictEqual(await placeholder.cache.get(ok), true);
  }
});

test('the socket is created with that cache', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../whatsapp/connection.js'), 'utf8');
  assert.match(src, /placeholderResendCache: placeholder\.cache/);
});

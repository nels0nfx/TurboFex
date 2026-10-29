require('./_setup');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');
const { validateEntries, isNewer } = require('../core/updater');

const entry = (name, text) => ({ entryName: `bot/${name}`, isDirectory: false, getData: () => Buffer.from(text) });
const good = () => {
  const hash = crypto.createHash('sha256').update('TurboFex').digest('hex');
  return [
    entry('index.js', 'module.exports = 1;'), entry('package.json', '{"version":"1.0.0"}'), entry('core/boot.js', ''),
    entry('core/brand.js', "module.exports = { botName: 'TurboFex' };"), entry('core/integrity.js', `const EXPECTED = '${hash}';`),
    entry('whatsapp/connection.js', ''), entry('whatsapp/handler.js', ''),
  ];
};

test('a complete update is accepted', () => {
  assert.doesNotThrow(() => validateEntries(good(), 'bot/'));
});
test('a syntax error, a missing file, a bad package.json or a changed name is rejected', () => {
  assert.throws(() => validateEntries([...good(), entry('commands/x.js', 'const = ;')], 'bot/'), /syntax error/);
  assert.throws(() => validateEntries(good().slice(1), 'bot/'), /index\.js is missing/);
  assert.throws(() => validateEntries([...good().filter((e) => !e.entryName.endsWith('package.json')), entry('package.json', '{oops')], 'bot/'), /package\.json/);
  assert.throws(() => validateEntries([...good().filter((e) => !e.entryName.endsWith('brand.js')), entry('core/brand.js', "module.exports = { botName: 'Other' };")], 'bot/'), /integrity/);
});
test('an update that loads a file it does not contain is rejected (Cannot find module)', () => {
  const broken = [...good(), entry('core/scheduler.js', "const market = require('./market');"), entry('core/clock.js', 'module.exports = 1;')];
  assert.throws(() => validateEntries(broken, 'bot/'), /scheduler\.js needs \.\/market/);
  const fine = [...good(), entry('core/scheduler.js', "const c = require('./clock'); const b = require('../whatsapp/handler'); require('fs'); const x = require('./realm/ticker');"), entry('core/clock.js', ''), entry('core/realm/ticker.js', '')];
  assert.doesNotThrow(() => validateEntries(fine, 'bot/'));
});
test('versions are compared', () => {
  assert.ok(isNewer('0.2.10', '0.2.9'));
  assert.ok(!isNewer('0.2.9', '0.2.10'));
});

test('the update is found from the pushed files of the repo, no zip needed', async () => {
  const { getLatest } = require('../core/updater');
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const u = String(url);
    if (u.includes('/main/package.json')) return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 });
    if (u.includes('/main/changelog.txt')) return new Response('TurboFex v9.9.9\nnotes', { status: 200 });
    return new Response('nope', { status: 404 });
  };
  try {
    process.env.UPDATE_REPO = 'someone/Bot';
    const info = await getLatest();
    assert.strictEqual(info.ok, true);
    assert.strictEqual(info.latest, '9.9.9');
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.source, 'branch');
    assert.strictEqual(info.url, 'https://codeload.github.com/someone/Bot/zip/refs/heads/main');
    assert.match(info.notes, /notes/);
    assert.ok(!asked.some((u) => u.includes('turbofex-latest.zip')), 'the zip file is not even looked at');

    // nothing on the main branch: the old zip file way still works as a fallback (404 for package.json, zip is not valid here, so it ends clearly)
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const none = await getLatest();
    assert.strictEqual(none.ok, false);
  } finally {
    globalThis.fetch = real;
    delete process.env.UPDATE_REPO;
  }
});

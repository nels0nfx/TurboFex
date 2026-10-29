const { dir } = require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const sb = require('../core/sessionbackup');

const session = path.join(dir, 'session');
const creds = (registered = true) => JSON.stringify({ noiseKey: { a: 1 }, signedIdentityKey: { b: 2 }, registered });
const reset = () => {
  fs.rmSync(session, { recursive: true, force: true });
  fs.rmSync(sb.DIR, { recursive: true, force: true });
  fs.mkdirSync(session, { recursive: true });
};

test('a linked login is backed up (only what is needed) and old copies are pruned', async () => {
  reset();
  fs.writeFileSync(path.join(session, 'creds.json'), creds());
  fs.writeFileSync(path.join(session, 'app-state-sync-key-1.json'), '{}');
  fs.writeFileSync(path.join(session, 'session-123.0.json'), '{}');
  const b = await sb.backupNow(session);
  assert.ok(b && b.files === 2);
  assert.ok(!fs.existsSync(path.join(sb.DIR, b.name, 'session-123.0.json')));
  for (let i = 0; i < 4; i++) {
    fs.mkdirSync(path.join(sb.DIR, `2020010${i}T000000`), { recursive: true });
    fs.writeFileSync(path.join(sb.DIR, `2020010${i}T000000`, 'creds.json'), creds());
  }
  await sb.backupNow(session);
  assert.ok(sb.list().length <= 3);
});
test('a login that is not linked is never backed up', async () => {
  reset();
  fs.writeFileSync(path.join(session, 'creds.json'), creds(false));
  assert.strictEqual(await sb.backupNow(session), null);
});
test('a damaged login is restored, an empty folder is not', async () => {
  reset();
  fs.writeFileSync(path.join(session, 'creds.json'), creds());
  await sb.backupNow(session);
  fs.writeFileSync(path.join(session, 'creds.json'), '{broken');
  assert.ok(sb.restoreIfNeeded(session));
  assert.ok(sb.validCreds(path.join(session, 'creds.json'), true));
  fs.rmSync(session, { recursive: true, force: true });
  fs.mkdirSync(session, { recursive: true });
  assert.strictEqual(sb.restoreIfNeeded(session), null); // a fresh link on purpose
});
test('after a WhatsApp logout the backups are deleted and not restored', async () => {
  reset();
  fs.writeFileSync(path.join(session, 'creds.json'), creds());
  await sb.backupNow(session);
  sb.markLoggedOut();
  assert.strictEqual(sb.list().length, 0);
  fs.writeFileSync(path.join(session, 'creds.json'), '{broken');
  assert.strictEqual(sb.restoreIfNeeded(session), null);
});
test('cleanup removes only old chat files and never the login', () => {
  reset();
  const old = Date.now() / 1000 - 200 * 86400;
  for (const f of ['creds.json', 'session-old.0.json', 'sender-key-old.json', 'app-state-sync-key-1.json', 'lid-mapping-1.json', 'session-new.0.json']) fs.writeFileSync(path.join(session, f), 'x');
  for (const f of ['creds.json', 'session-old.0.json', 'sender-key-old.json', 'app-state-sync-key-1.json', 'lid-mapping-1.json']) fs.utimesSync(path.join(session, f), old, old);
  const r = sb.cleanup(session);
  assert.strictEqual(r.removed, 2);
  assert.deepStrictEqual(fs.readdirSync(session).sort(), ['app-state-sync-key-1.json', 'creds.json', 'lid-mapping-1.json', 'session-new.0.json']);
});

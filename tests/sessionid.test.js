require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sessionid = require('../core/sessionid');
const { DATA } = require('../core/paths');

const ID = 'TFX-K7M2-9QXA-4BNP';
const ID2 = 'TFX-ABCD-EFGH-JKLM';
const CREDS = (n) => ({ registered: true, me: { id: `${n}:5@s.whatsapp.net` }, noiseKey: {}, signedIdentityKey: {}, advSecretKey: 'abc' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sid-test-'));
const quiet = () => {};
const fast = { timeoutMs: 2000, tries: 3, pauseMs: 5 };
const reset = () => fs.rmSync(path.join(DATA, 'session-id.json'), { force: true });

// stands in for the pairing site (same contract as pairsite/server.js: GET /api/session/<id>, one use, 404 when unknown)
async function site(vault, opts = {}) {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (opts.failFirst && hits <= opts.failFirst) return res.writeHead(503).end('{}');
    const id = decodeURIComponent(req.url.replace('/api/session/', ''));
    const creds = vault.get(id);
    if (!creds) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not found"}');
    vault.delete(id);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(creds));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits: () => hits, close: () => server.close() };
}
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'));

test('a session ID restores the login once, and an ID that was used is not downloaded again', async () => {
  reset();
  const s = await site(new Map([[ID, CREDS('2348012345678')]]));
  const dir = tmp();
  const cfg = { sessionId: ID.toLowerCase(), pairSiteUrl: s.url + '/', sessionDir: dir };
  assert.strictEqual(await sessionid.restore(cfg, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir).me.id, '2348012345678:5@s.whatsapp.net');
  const hits = s.hits();
  assert.strictEqual(await sessionid.restore(cfg, quiet, fetch, fast), 'skipped');
  assert.strictEqual(s.hits(), hits, 'the site is not asked again on later starts');
  s.close();
});

test('an old ID left in the settings does not replace or break a login that already works', async () => {
  reset();
  const s = await site(new Map()); // the site no longer knows the ID (used before this bot remembered it)
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify(CREDS('2348011111111')));
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'skipped');
  assert.strictEqual(read(dir).me.id, '2348011111111:5@s.whatsapp.net');
  const hits = s.hits();
  await sessionid.restore({ sessionId: ID, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast);
  assert.strictEqual(s.hits(), hits, 'remembered: not asked again');
  s.close();
});

test('a NEW session ID replaces the current login and keeps the old one aside', async () => {
  reset();
  const s = await site(new Map([[ID2, CREDS('2348022222222')]]));
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify(CREDS('2348011111111')));
  fs.writeFileSync(path.join(dir, 'session-123.0.json'), '{}');
  assert.strictEqual(await sessionid.restore({ sessionId: ID2, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir).me.id, '2348022222222:5@s.whatsapp.net');
  assert.ok(!fs.existsSync(path.join(dir, 'session-123.0.json')), 'files of the other account are gone');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'session-previous', 'creds.json'), 'utf8')).me.id, '2348011111111:5@s.whatsapp.net');
  s.close();
});

test('a sleeping site (errors first) is tried again', async () => {
  reset();
  const s = await site(new Map([[ID, CREDS('2348012345678')]]), { failFirst: 2 });
  const dir = tmp();
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'restored');
  assert.strictEqual(s.hits(), 3);
  s.close();
});

test('a login made by QR scan (no "registered" flag) is accepted', async () => {
  reset();
  const qr = CREDS('2348012345678');
  delete qr.registered;
  const s = await site(new Map([[ID, qr]]));
  const dir = tmp();
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir).registered, true);
  s.close();
});

test('problems never throw and never write a login', async () => {
  reset();
  const dir = tmp();
  const logs = [];
  const log = (m) => logs.push(m);
  assert.strictEqual(await sessionid.restore({ sessionId: '', sessionDir: dir }, log), 'skipped');
  assert.strictEqual(await sessionid.restore({ sessionId: 'hello', pairSiteUrl: 'http://x', sessionDir: dir }, log), 'failed');
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: '', sessionDir: dir }, log), 'failed');
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: 'http://127.0.0.1:1', sessionDir: dir }, log, fetch, fast), 'failed');
  const s = await site(new Map());
  assert.strictEqual(await sessionid.restore({ sessionId: ID, pairSiteUrl: s.url, sessionDir: dir }, log, fetch, fast), 'failed'); // unknown / used / expired
  s.close();
  assert.ok(!fs.existsSync(path.join(dir, 'creds.json')));
  assert.ok(logs.some((l) => /does not know this session ID/.test(l)));
});

// the real pairing site, when its folder is next to the bot (the bot zip does not carry it)
const sitePath = ['../pairsite/server', '../../pair/server'].map((p) => path.join(__dirname, p)).find((p) => {
  try {
    if (!fs.existsSync(p + '.js')) return false;
    require(p);
    return true;
  } catch (err) {
    return false; // the site's own packages are not installed here
  }
});
test('works with the real pairing site: store.put on the site, restore on the bot', { skip: !sitePath && 'pairing site folder not present' }, async () => {
  reset();
  const { createApp } = require(sitePath);
  const dataDir = tmp();
  const app = createApp({ engine: { start: () => ({ cancel() {} }) }, dataDir, env: {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const id = app.store.put(CREDS('2348012345678'));
  const dir = tmp();
  const cfg = { sessionId: id, pairSiteUrl: `http://127.0.0.1:${app.server.address().port}`, sessionDir: dir };
  assert.strictEqual(await sessionid.restore(cfg, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir).me.id, '2348012345678:5@s.whatsapp.net');
  assert.strictEqual(await sessionid.restore({ ...cfg, sessionDir: tmp() }, quiet, fetch, fast), 'failed', 'the site gave the ID out only once');
  app.close();
});

// ----- the session ID file (session_id.txt)
test('the session ID file: created with the steps, empty means nothing, the pasted ID is found', () => {
  const file = path.join(tmp(), 'session_id.txt');
  assert.strictEqual(sessionid.readFile(file), '', 'no file yet');
  assert.ok(sessionid.ensureFile(file, 'https://pair.example.com'));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /https:\/\/pair\.example\.com/);
  assert.strictEqual(sessionid.readFile(file), '', 'the steps and an empty SESSION_ID= are not an ID');
  fs.writeFileSync(file, text.replace('SESSION_ID=', `SESSION_ID="${ID.toLowerCase()}"  `));
  assert.strictEqual(sessionid.normalize(sessionid.readFile(file)), ID);
  fs.writeFileSync(file, `\n  ${ID}\n`);
  assert.strictEqual(sessionid.readFile(file), ID, 'a bare ID on a line works too');
  assert.ok(sessionid.ensureFile(file, 'x') && fs.readFileSync(file, 'utf8').includes(ID), 'an existing file is never overwritten');
});

test('the bot logs in with the ID pasted in the file; the host variable wins when both are set', async () => {
  reset();
  const s = await site(new Map([[ID, CREDS('2348012345678')], [ID2, CREDS('2348055555555')]]));
  const dir = tmp();
  const file = path.join(tmp(), 'session_id.txt');
  fs.writeFileSync(file, `# note\nSESSION_ID=${ID}\n`);
  assert.strictEqual(await sessionid.restore({ sessionId: '', sessionIdFile: file, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir).me.id, '2348012345678:5@s.whatsapp.net');
  assert.strictEqual(await sessionid.restore({ sessionId: '', sessionIdFile: file, pairSiteUrl: s.url, sessionDir: dir }, quiet, fetch, fast), 'skipped');
  const dir2 = tmp();
  assert.strictEqual(await sessionid.restore({ sessionId: ID2, sessionIdFile: file, pairSiteUrl: s.url, sessionDir: dir2 }, quiet, fetch, fast), 'restored');
  assert.strictEqual(read(dir2).me.id, '2348055555555:5@s.whatsapp.net');
  s.close();
});

test('an empty or missing file is not an error: nothing happens', async () => {
  reset();
  const file = path.join(tmp(), 'session_id.txt');
  assert.strictEqual(await sessionid.restore({ sessionId: '', sessionIdFile: file, sessionDir: tmp() }, quiet), 'skipped');
  sessionid.ensureFile(file, 'x');
  assert.strictEqual(await sessionid.restore({ sessionId: '', sessionIdFile: file, sessionDir: tmp() }, quiet), 'skipped');
});

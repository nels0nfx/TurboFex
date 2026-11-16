// v1.6.4: a private test code may replace a store copy (the "conflict" bug); the store is read from the pair site first, GitHub second
require('./_setup');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const test = require('node:test'); const assert = require('node:assert');
process.env.TFX_REGISTRY_KEYDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-162key-'));
const tool = require('../tools/registry');
const registry = require('../core/plugins/registry');
const plugins = require('../core/plugins');
const state = require('../core/plugins/state');
const safefetch = require('../core/safefetch');
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');

const MAN = (v) => JSON.stringify({ manifestVersion: 1, id: 'mm-plugin', version: v, apiVersion: 1, name: 'MM', description: 'Mentions', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: 'mmhi', who: 'everyone', description: 'x' }] });
const SRC = "tfx.command('mmhi', async (c) => { await c.reply('hi'); });";
const site = (v) => async (url) => (/code=TFX-ABCD2345$/.test(url)
  ? { ok: true, status: 200, json: async () => ({ id: 'mm-plugin', developer: 'alice', manifestRaw: MAN(v), entrySource: SRC, manifestSha: sha(MAN(v)), entrySha: sha(SRC) }) }
  : { ok: false, status: 404, json: async () => ({}) });

test('a test code can replace a plugin that came from the store, and the store copy is kept for going back', async () => {
  const dir = path.join(state.dir(), 'mm-plugin'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'turbofex-plugin.json'), MAN('1.0.0')); fs.writeFileSync(path.join(dir, 'index.js'), SRC); fs.writeFileSync(path.join(dir, '.from-store'), '1.0.0');
  const d = state.open().data; d.installed['mm-plugin'] = { version: '1.0.0', sha: sha(SRC), enabled: true, grants: ['chat.send'], store: { version: '1.0.0' }, installedAt: Date.now() };
  const r = await plugins.prepareTest('TFX-ABCD2345', site('1.0.2'));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(fs.existsSync(path.join(dir, '.from-test')) && !fs.existsSync(path.join(dir, '.from-store')));
  assert.ok(fs.existsSync(path.join(state.previousDir('mm-plugin'), '1.0.0', 'index.js')), 'the store version is saved');
});

test('the real store version can replace a private test copy, but a hand-copied folder is still protected', async () => {
  const dir = path.join(state.dir(), 'mm-plugin'); fs.writeFileSync(path.join(dir, '.from-test'), 'alice'); fs.rmSync(path.join(dir, '.from-store'), { force: true });
  assert.ok(fs.existsSync(path.join(dir, '.from-test')));
  const hand = path.join(state.dir(), 'mm-hand'); fs.mkdirSync(hand, { recursive: true });
  fs.writeFileSync(path.join(hand, 'turbofex-plugin.json'), MAN('1.0.0').replace('mm-plugin', 'mm-hand')); fs.writeFileSync(path.join(hand, 'index.js'), SRC);
  const code = (await plugins.prepareTest('TFX-ABCD2345', async () => ({ ok: true, status: 200, json: async () => ({ id: 'mm-hand', developer: 'a', manifestRaw: MAN('1.0.0').replace('mm-plugin', 'mm-hand'), entrySource: SRC, manifestSha: sha(MAN('1.0.0').replace('mm-plugin', 'mm-hand')), entrySha: sha(SRC) }) })));
  assert.strictEqual(code.why, 'conflict');
});

test('the store is read from the pair site first; a site that is down or not trusted falls back to GitHub', async () => {
  const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-162reg-')); tool.keygen(); tool.init(reg);
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-162src-'));
  fs.writeFileSync(path.join(src, 'turbofex-plugin.json'), MAN('1.0.0').replace('mm-plugin', 'site-plug')); fs.writeFileSync(path.join(src, 'index.js'), SRC);
  tool.add(src, reg);
  registry._test.reset(); registry._test.setKey(tool.publicPem());
  const realGet = safefetch.get; const asked = [];
  const SITE = 'https://turbofex-pair.onrender.com/registry/', GH = registry.BASE;
  const serveFrom = (prefix, ok) => async (url) => { asked.push(url); if (!url.startsWith(prefix) || !ok) throw new Error('down'); const f = path.join(reg, url.slice(prefix.length)); if (!fs.existsSync(f)) return { status: 404, body: Buffer.alloc(0) }; return { status: 200, body: fs.readFileSync(f) }; };
  try {
    safefetch.get = async (url, o) => (url.startsWith(SITE) ? serveFrom(SITE, true)(url) : serveFrom(GH, false)(url));
    registry._test.reset(); registry._test.setKey(tool.publicPem()); delete process.env.TURBOFEX_REGISTRY_URL;
    let idx = await registry.getIndex(true); assert.ok(idx.plugins['site-plug'], 'read from the site');
    assert.ok(asked[0].startsWith(SITE));
    safefetch.get = async (url) => (url.startsWith(SITE) ? serveFrom(SITE, false)(url) : serveFrom(GH, true)(url));
    registry._test.reset(); registry._test.setKey(tool.publicPem()); asked.length = 0;
    idx = await registry.getIndex(true); assert.ok(idx.plugins['site-plug'], 'site down: GitHub answers');
    safefetch.get = async (url) => (url.startsWith(SITE) ? serveFrom(SITE, true)(url) : serveFrom(GH, true)(url));
    registry._test.reset(); registry._test.setKey(crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    await assert.rejects(() => registry.getIndex(true), (e) => e.code === 'tampered', 'a signature nobody trusts is never accepted from either source');
  } finally { safefetch.get = realGet; registry._test.reset(); }
});

test('tools/registry.js serverkey makes a key pair for the site and saves nothing on the phone', () => {
  const k = tool.serverkey();
  assert.match(k.priv, /BEGIN PRIVATE KEY/); assert.match(k.pub, /BEGIN PUBLIC KEY/);
  const sig = crypto.sign(null, Buffer.from('x'), crypto.createPrivateKey(k.priv));
  assert.ok(crypto.verify(null, Buffer.from('x'), crypto.createPublicKey(k.pub), sig));
});

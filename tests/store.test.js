// v1.4.0: the plugin store (signed registry, the bot's checks, install/update/withdraw) and the registry maintenance tool
const { dir } = require('./_setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');

process.env.TFX_REGISTRY_KEYDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-key-'));
const tool = require('../tools/registry');
const registry = require('../core/plugins/registry');
const plugins = require('../core/plugins');
const pluginCmd = require('../commands/plugin');

const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-reg-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-work-'));
const commands = new Map(); const commandList = [];
plugins.attach(commands, commandList);
const sent = []; const sock = { sendMessage: async (to, m) => { sent.push(m.text); } };

function devPlugin(id, version, extra = {}, source) {
  const d = fs.mkdtempSync(path.join(work, id + '-')); const cmd = id.replace(/-/g, '');
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify({ manifestVersion: 1, id, version, apiVersion: 1, name: 'Store ' + id, description: 'Test plugin', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: cmd, who: 'everyone', description: 'x' }], ...extra }));
  fs.writeFileSync(path.join(d, 'index.js'), source || `tfx.command('${cmd}', (c) => c.reply('v${version}'));`);
  return d;
}
const run = async (line, over) => { const r = []; await pluginCmd.run({ args: line.split(/\s+/).slice(1), rest: line.split(/\s+/).slice(1).join(' '), reply: async (t) => { r.push(t); }, prefix: '.', jid: '1203630000000@g.us', isGroup: false, ...over }); return r.join('\n'); };
const serve = () => registry._test.setFetcher(async (url) => { const f = path.join(reg, url.slice(registry.BASE.length)); if (!fs.existsSync(f)) throw new Error('404'); return fs.readFileSync(f); });
const resign = () => { const b = fs.readFileSync(path.join(reg, 'index.json')); fs.writeFileSync(path.join(reg, 'index.json.sig'), crypto.sign(null, b, crypto.createPrivateKey(fs.readFileSync(path.join(process.env.TFX_REGISTRY_KEYDIR, 'key.pem')))).toString('base64')); };

test('the store is closed until a public key is set, and the bot says so', async () => {
  assert.strictEqual(registry.configured(), false);
  await run('plugin on', {});
  assert.match(await run('plugin store', {}), /not open yet/);
  assert.match(await run('plugin install nothing-here', {}), /not open yet|could not find/);
});

test('tool: keygen, backup and restore of the signing key', () => {
  const pub = tool.keygen(); assert.match(pub, /BEGIN PUBLIC KEY/);
  assert.throws(() => tool.keygen(), /already exists/);
  process.env.TFX_PASSPHRASE = 'short'; assert.throws(() => tool.backup(path.join(work, 'b.json')), /at least 8/);
  process.env.TFX_PASSPHRASE = 'a long secret phrase'; const file = path.join(work, 'b.json'); tool.backup(file);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('PRIVATE'));
  const keyfile = path.join(process.env.TFX_REGISTRY_KEYDIR, 'key.pem'); const original = fs.readFileSync(keyfile, 'utf8');
  assert.throws(() => tool.restore(file), /already exists/);
  fs.rmSync(keyfile); process.env.TFX_PASSPHRASE = 'wrong wrong wrong'; assert.throws(() => tool.restore(file), /wrong or the file/);
  process.env.TFX_PASSPHRASE = 'a long secret phrase'; tool.restore(file); assert.strictEqual(fs.readFileSync(keyfile, 'utf8'), original);
  registry._test.setKey(tool.publicPem());
});

test('tool: add signs, published versions never change, tampering is found, revoke withdraws', () => {
  tool.init(reg);
  tool.add(devPlugin('store-one', '1.0.0'), reg);
  assert.strictEqual(tool.verify(reg), 1);
  assert.throws(() => tool.add(devPlugin('store-one', '1.0.0'), reg), /already published/);
  assert.throws(() => tool.add(path.join(work, 'nope'), reg), /not valid/);
  const entry = path.join(reg, 'plugins', 'store-one', '1.0.0', 'index.js'); const good = fs.readFileSync(entry);
  fs.appendFileSync(entry, '\n// sneaky'); assert.throws(() => tool.verify(reg), /fingerprint/); assert.throws(() => tool.build(reg), /changed after it was published/);
  fs.writeFileSync(entry, good); assert.strictEqual(tool.verify(reg), 1);
});

test('bot: the index must be signed; a changed index, a wrong signature or no connection is refused', async () => {
  serve(); const index = await registry.getIndex(); assert.ok(index.plugins['store-one']);
  assert.strictEqual(registry.latestOf(index, 'store-one'), '1.0.0');
  const f = path.join(reg, 'index.json'); const good = fs.readFileSync(f);
  fs.writeFileSync(f, good.toString().replace('Store store-one', 'Store evil'));
  registry._test.setFetcher(registry._test.setFetcher && (async (url) => fs.readFileSync(path.join(reg, url.slice(registry.BASE.length)))));
  await assert.rejects(() => registry.getIndex(true), (e) => e.code === 'tampered');
  fs.writeFileSync(f, good);
  const sig = path.join(reg, 'index.json.sig'); const goodSig = fs.readFileSync(sig);
  fs.writeFileSync(sig, Buffer.alloc(64).toString('base64')); await assert.rejects(() => registry.getIndex(true), (e) => e.code === 'tampered'); fs.writeFileSync(sig, goodSig);
  registry._test.setFetcher(async () => { throw new Error('offline'); }); await assert.rejects(() => registry.getIndex(true), (e) => e.code === 'unreachable');
  serve(); assert.ok(await registry.getIndex(true));
});

test('bot: downloads are checked against the signed fingerprints and the announced permissions', async () => {
  const entry = path.join(reg, 'plugins', 'store-one', '1.0.0', 'index.js'); const good = fs.readFileSync(entry);
  fs.writeFileSync(entry, good + '\n// swapped'); // a swapped file on GitHub, index and signature untouched
  assert.deepStrictEqual(await registry.fetchPlugin('store-one'), { ok: false, why: 'tampered' });
  assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'store-one')));
  fs.writeFileSync(entry, good);
  const idxFile = path.join(reg, 'index.json'); const idxGood = fs.readFileSync(idxFile); const sigGood = fs.readFileSync(path.join(reg, 'index.json.sig'));
  const lie = JSON.parse(idxGood); lie.plugins['store-one'].versions['1.0.0'].permissions = []; // a signed index that hides a permission
  fs.writeFileSync(idxFile, JSON.stringify(lie)); resign(); registry._test.setFetcher(registry._test.setFetcher && (async (u) => fs.readFileSync(path.join(reg, u.slice(registry.BASE.length)))));
  assert.deepStrictEqual(await registry.fetchPlugin('store-one'), { ok: false, why: 'tampered' });
  fs.writeFileSync(idxFile, idxGood); fs.writeFileSync(path.join(reg, 'index.json.sig'), sigGood); serve();
  fs.mkdirSync(path.join(dir, 'plugins', 'store-one'), { recursive: true }); fs.writeFileSync(path.join(dir, 'plugins', 'store-one', 'mine.txt'), 'x');
  assert.deepStrictEqual(await registry.fetchPlugin('store-one'), { ok: false, why: 'conflict' });
  fs.rmSync(path.join(dir, 'plugins', 'store-one'), { recursive: true });
  assert.deepStrictEqual(await registry.fetchPlugin('nothing'), { ok: false, why: 'unknown' });
});

test('commands: store, install from the store, update, withdraw', async () => {
  assert.match(await run('plugin store', {}), /Store store-one\* 1.0.0/);
  assert.match(await run('plugin store store-one', {}), /Asks for:\* chat.send/);
  assert.match(await run('plugin store zzzz', {}), /Nothing in the store matches/);
  const screen = await run('plugin install store-one', {}); assert.match(screen, /Install Store store-one 1.0.0\?/);
  assert.match(await run('plugin confirm ' + screen.match(/confirm (\w{4})/)[1], {}), /is ready/);
  assert.strictEqual(plugins.overview().installed['store-one'].store.version, '1.0.0');
  assert.ok(commands.has('storeone'));
  assert.match(await run('plugin updates', {}), /up to date/);
  assert.match(await run('plugin update store-one', {}), /already installed and up to date/);
  tool.add(devPlugin('store-one', '1.1.0'), reg); // the developer publishes a new version
  assert.match(await run('plugin updates', {}), /store-one\* 1.0.0 → 1.1.0/);
  const up = await run('plugin update store-one', {}); assert.match(up, /Update Store store-one 1.1.0\?/);
  assert.match(await run('plugin confirm ' + up.match(/confirm (\w{4})/)[1], {}), /is ready/);
  assert.strictEqual(plugins.overview().installed['store-one'].store.version, '1.1.0');
  assert.match(await run('plugin update nothing', {}), /Only plugins from the store/);
  // withdrawn for safety: switched off, the owner is told, it cannot be turned on or installed again
  plugins.start(sock);
  tool.revoke('store-one', '1.1.0', 'found a problem', reg);
  await plugins.checkWithdrawn();
  assert.ok(!commands.has('storeone'));
  assert.ok(sent.some((t) => /switched off/.test(t) && /withdrawn/.test(t)));
  assert.match(await run('plugin list', {}), /withdrawn/);
  assert.match(await run('plugin enable store-one', {}), /could not turn it on/);
  assert.match(await run('plugin update store-one', {}), /Update Store store-one 1.0.0\?|withdrawn|up to date/);
});

test('an offline store changes nothing for installed plugins', async () => {
  tool.add(devPlugin('store-two', '1.0.0'), reg);
  const s = await run('plugin install store-two', {}); await run('plugin confirm ' + s.match(/confirm (\w{4})/)[1], {});
  assert.ok(commands.has('storetwo'));
  registry._test.setFetcher(async () => { throw new Error('offline'); });
  await plugins.checkWithdrawn();
  assert.ok(commands.has('storetwo'));
  assert.match(await run('plugin store', {}), /not available[\s\S]*could not reach/);
  plugins.turnOff();
});

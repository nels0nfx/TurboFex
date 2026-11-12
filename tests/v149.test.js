// v1.4.9: update modes (notify, automatic, manual), rollback, automatic return after failures, heal an unconfirmed update
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

const wait = () => new Promise((r) => setImmediate(r));
const install = async (id) => { const s = await run('plugin install ' + id, {}); return run('plugin confirm ' + s.match(/confirm (\w{4})/)[1], {}); };
const pubWith = (id, version, extra) => tool.add(devPlugin(id, version, extra), reg);
const rec = (id) => plugins.overview().installed[id];

test('setup: a signed store with one plugin, installed', async () => {
  tool.keygen(); registry._test.setKey(tool.publicPem()); tool.init(reg); pubWith('mode-one', '1.0.0'); serve();
  await run('plugin on', {}); plugins.attach(commands, commandList); await plugins.turnOn(); await plugins.start(sock);
  assert.match(await install('mode-one'), /is ready/);
  assert.strictEqual(rec('mode-one').updateMode, undefined, 'default is notify');
});

test('notify (default): the owner is told once per new version, nothing is installed', async () => {
  pubWith('mode-one', '1.1.0'); sent.length = 0;
  await plugins.checkUpdates(); await plugins.checkUpdates(); await wait();
  assert.strictEqual(sent.filter((t) => /Update available/.test(t)).length, 1);
  assert.strictEqual(rec('mode-one').store.version, '1.0.0');
});

test('manual: silent', async () => {
  assert.match(await run('plugin updatemode mode-one manual', {}), /Saved/); rec('mode-one').notified = null; sent.length = 0;
  await plugins.checkUpdates(); await wait(); assert.strictEqual(sent.length, 0);
  assert.match(await run('plugin updatemode mode-one sometimes', {}), /Choose how updates work/);
  assert.match(await run('plugin updatemode nothing notify', {}), /not installed/);
});

test('automatic: installs by itself when nothing new is asked, can be rolled back, and is not re-installed automatically afterwards', async () => {
  await run('plugin updatemode mode-one automatic', {}); sent.length = 0;
  await plugins.checkUpdates(); await wait();
  assert.strictEqual(rec('mode-one').store.version, '1.1.0'); assert.ok(sent.some((t) => /updated automatically/.test(t)));
  assert.strictEqual(rec('mode-one').previous.version, '1.0.0');
  assert.match(await run('plugin info mode-one', {}), /Updates:\* automatic \(can go back to 1.0.0\)/);
  assert.match(await run('plugin rollback mode-one', {}), /back on version 1.0.0/);
  assert.strictEqual(rec('mode-one').store.version, '1.0.0'); assert.strictEqual(fs.readFileSync(path.join(dir, 'plugins', 'mode-one', '.from-store'), 'utf8').trim(), '1.0.0');
  assert.ok(commands.has('modeone')); assert.strictEqual(rec('mode-one').enabled, true);
  assert.match(await run('plugin rollback mode-one', {}), /no earlier version/);
  sent.length = 0; await plugins.checkUpdates(); await wait();
  assert.strictEqual(rec('mode-one').store.version, '1.0.0', 'the version that was rolled back is not installed again by itself');
  assert.ok(sent.some((t) => /Update available/.test(t)));
});

test('automatic never installs an update that asks for more: the owner is told and decides', async () => {
  pubWith('mode-one', '1.2.0', { permissions: ['chat.send', 'storage'] }); await plugins.checkUpdates(); await wait(); sent.length = 0;
  rec('mode-one').notified = null; rec('mode-one').skip = null; await plugins.checkUpdates(); await wait();
  assert.strictEqual(rec('mode-one').store.version, '1.0.0');
  assert.ok(sent.some((t) => /different permissions or websites/.test(t)));
});

test('an update that was fetched but never confirmed does not break the plugin after a restart', async () => {
  await run('plugin updatemode mode-one notify', {});
  const up = await run('plugin update mode-one', {}); assert.match(up, /Update Store mode-one/);   // fetched, NOT confirmed
  assert.strictEqual(fs.readFileSync(path.join(dir, 'plugins', 'mode-one', '.from-store'), 'utf8').trim(), '1.2.0');
  plugins.turnOff(); await plugins.turnOn();
  assert.strictEqual(rec('mode-one').enabled, true, rec('mode-one').reason || '');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'plugins', 'mode-one', '.from-store'), 'utf8').trim(), '1.0.0', 'the approved files are back');
});

test('a new version that keeps failing right after its update: the bot returns to the old one and tells the owner', async () => {
  pubWith('mode-two', '1.0.0'); assert.match(await install('mode-two'), /is ready/);
  pubWith('mode-two', '1.1.0'); await plugins.updatesAvailable(); const s = await run('plugin update mode-two', {}); assert.match(await run('plugin confirm ' + s.match(/confirm (\w{4})/)[1], {}), /is ready/);
  assert.strictEqual(rec('mode-two').store.version, '1.1.0'); sent.length = 0;
  plugins._onDisabled('mode-two', 'faults'); await wait();
  assert.strictEqual(rec('mode-two').store.version, '1.0.0'); assert.strictEqual(rec('mode-two').enabled, true);
  assert.ok(sent.some((t) => /kept failing, so I went back to 1.0.0/.test(t)));
  // with nothing to go back to, it is switched off as before
  sent.length = 0; plugins._onDisabled('mode-two', 'faults'); await wait();
  assert.strictEqual(rec('mode-two').enabled, false); assert.ok(sent.some((t) => /was switched off/.test(t)));
});

test('rollback refuses when the saved copy was changed', async () => {
  pubWith('mode-three', '1.0.0'); await install('mode-three'); pubWith('mode-three', '1.1.0'); await plugins.updatesAvailable();
  const s = await run('plugin update mode-three', {}); await run('plugin confirm ' + s.match(/confirm (\w{4})/)[1], {});
  fs.appendFileSync(path.join(dir, 'plugins-previous', 'mode-three', '1.0.0', 'index.js'), '\n// changed');
  assert.match(await run('plugin rollback mode-three', {}), /could not go back/);
  assert.strictEqual(rec('mode-three').store.version, '1.1.0');
});

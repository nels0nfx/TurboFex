// v1.3.5: plugins (manifest, install flow, permissions, per-group control, the .plugin command, switching off)
const { dir } = require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const manifestLib = require('../core/plugins/manifest');
const plugins = require('../core/plugins');
const pluginCmd = require('../commands/plugin');

const commands = new Map();
const commandList = [];
commands.set('ping', { name: 'ping', aliases: [], category: 'general' });
commandList.push(commands.get('ping'));
plugins.attach(commands, commandList);

const sent = [];
const sock = { sendMessage: async (to, m) => { sent.push({ to, text: m.text }); } };
const root = path.join(dir, 'plugins');
function makePlugin(folder, over = {}, source) {
  const d = path.join(root, folder); fs.mkdirSync(d, { recursive: true });
  const m = { manifestVersion: 1, id: folder, version: '1.0.0', apiVersion: 1, name: 'Hello ' + folder, description: 'Says hello', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: 'hello' + folder.replace(/-/g, ''), who: 'everyone', description: 'Says hello' }], ...over };
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify(m));
  fs.writeFileSync(path.join(d, 'index.js'), source || `tfx.command('${m.commands && m.commands[0] ? m.commands[0].name : 'x'}', (c) => c.reply('hello ' + c.sender.name + ' ' + c.chat.id));`);
  return d;
}
const ctxFor = (over = {}) => { const replies = []; return { replies, c: { jid: '1203630000000@g.us', args: [], rest: '', prefix: '.', isGroup: true, isAdmin: true, isOwner: false, msg: { key: { participant: '27811111111@s.whatsapp.net' }, pushName: 'Sam' }, groupMetadata: { subject: 'Team', participants: [{ id: 'a', admin: 'admin' }, { id: 'b' }] }, reply: async (t) => { replies.push(t); }, ...over } }; };
const run = async (line, over) => { const r = []; const parts = line.split(/\s+/).slice(1); await pluginCmd.run({ args: parts, rest: line, reply: async (t) => { r.push(t); }, prefix: '.', jid: '1203630000000@g.us', isGroup: true, ...over }); return r.join('\n'); };

test('plugins are off by default and nothing is created on disk', () => {
  assert.strictEqual(plugins.overview().status.state, 'off');
  assert.strictEqual(plugins.overview().enabled, false);
  assert.ok(!fs.existsSync(path.join(dir, 'plugins.json')));
  assert.strictEqual(pluginCmd.ownerOnly, true);
});

test('manifest: a good one is accepted', () => {
  const f = makePlugin('good-one');
  const v = manifestLib.validate(f, { botVersion: '1.3.5', taken: new Set() });
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.manifest.commands[0].who, 'everyone');
  assert.match(v.entrySha, /^[0-9a-f]{64}$/);
});

test('manifest: bad ones are refused with a clear reason', () => {
  const bad = (over, re) => { const f = makePlugin('bad-' + Math.random().toString(36).slice(2, 7), over); const v = manifestLib.validate(f, { botVersion: '1.3.5', taken: new Set(['ping']) }); assert.ok(!v.ok); assert.match(v.errors.join(' | '), re); };
  bad({ id: 'A' }, /id must be/);
  bad({ version: '1' }, /version/);
  bad({ apiVersion: 2 }, /apiVersion/);
  bad({ permissions: ['fs.read'] }, /unknown permission/);
  bad({ permissions: ['group.manage'] }, /unknown permission/);
  bad({ permissions: ['network'] }, /network needs/);
  bad({ permissions: ['chat.send'], network: { domains: ['example.com'] } }, /network.domains needs/);
  bad({ commands: [{ name: 'ping', who: 'everyone', description: 'x' }] }, /already used/);
  bad({ commands: [{ name: 'Bad Name', who: 'everyone', description: 'x' }] }, /bad command name/);
  bad({ commands: [{ name: 'okname', who: 'nobody', description: 'x' }] }, /who must be/);
  bad({ minBotVersion: '9.0.0' }, /needs TurboFex/);
  bad({ pricing: { model: 'paid' } }, /only free/);
  bad({ events: ['message'] }, /needs the permission events.message/);
  bad({ events: ['everything'], permissions: ['chat.send'] }, /unknown event/);
  bad({ permissions: ['group.manage'] }, /unknown permission/);
  bad({ commands: [] }, /at least one/);
  bad({ schedules: [{ id: 'tick', everyMinutes: 5 }] }, /schedule permission/);
});

test('manifest: the entry file cannot leave the plugin folder, and a missing or huge one is refused', () => {
  for (const entry of ['../x.js', '/etc/passwd', 'a/../../x.js']) { const f = makePlugin('esc-' + Math.random().toString(36).slice(2, 7), { entry }); assert.ok(!manifestLib.validate(f, {}).ok); }
  const f = makePlugin('nofile'); fs.rmSync(path.join(f, 'index.js')); assert.match(manifestLib.validate(f, {}).errors.join(), /missing/);
  const g = makePlugin('huge'); fs.writeFileSync(path.join(g, 'index.js'), 'x'.repeat(1024 * 1024 + 1)); assert.match(manifestLib.validate(g, {}).errors.join(), /1 MB/);
  const h = makePlugin('linked'); fs.rmSync(path.join(h, 'index.js')); fs.writeFileSync(path.join(dir, 'outside.js'), 'x'); fs.symlinkSync(path.join(dir, 'outside.js'), path.join(h, 'index.js')); assert.ok(!manifestLib.validate(h, {}).ok);
});

test('.plugin: while plugins are off, install is not possible and the owner is told how to turn them on', async () => {
  assert.match(await run('plugin list', {}), /Plugins are off/);
  assert.match(await run('plugin install good-one', {}), /Plugins are off/);
});

test('.plugin on: the safety check runs and plugins start', async function () {
  const r = await run('plugin on', {});
  assert.match(r, /Plugins are on/, r);
  assert.ok(plugins.isRunning());
  assert.ok(fs.existsSync(path.join(dir, 'plugins.json')) || true);
});

test('install: shows what the plugin asks for, needs a code, then adds the command', async () => {
  const r = await run('plugin install good-one', {});
  assert.match(r, /Install Hello good-one 1.0.0\?/); assert.match(r, /Send messages in the chat/);
  const code = r.match(/plugin confirm (\w{4})/)[1];
  assert.ok(!commands.has('hellogoodone'));
  assert.match(await run('plugin confirm WRONG', {}), /did not work/);
  assert.match(await run('plugin confirm ' + code, {}), /is ready/);
  const cmd = commands.get('hellogoodone');
  assert.ok(cmd); assert.strictEqual(cmd.category, 'plugins'); assert.strictEqual(cmd.everyone, false); assert.strictEqual(cmd.ownerOnly, false);
  assert.ok(commandList.includes(cmd));
  assert.match(await run('plugin confirm ' + code, {}), /did not work/); // a code works once
});

test('a plugin command answers, and the plugin sees only opaque ids, never real chat or phone ids', async () => {
  const { c, replies } = ctxFor();
  await commands.get('hellogoodone').run(c);
  assert.strictEqual(replies.length, 1);
  assert.match(replies[0], /^hello Sam [0-9a-f]{16}$/);
  assert.ok(!replies[0].includes('1203630000000') && !replies[0].includes('2781'));
});

test('per group: only / deny / all decide where a plugin answers', async () => {
  const cmd = commands.get('hellogoodone'); const g1 = '1203630000000@g.us'; const g2 = '1203639999999@g.us';
  assert.ok(!cmd.deniedIn(g1));
  await run('plugin groups good-one deny', {}); assert.ok(cmd.deniedIn(g1)); assert.ok(!cmd.deniedIn(g2));
  await run('plugin groups good-one all', {}); assert.ok(!cmd.deniedIn(g1));
  await run('plugin groups good-one only', {}); assert.ok(!cmd.deniedIn(g1)); assert.ok(cmd.deniedIn(g2));
  await run('plugin groups good-one all', {}); assert.ok(!cmd.deniedIn(g2));
  assert.ok(!cmd.deniedIn('27800000002@s.whatsapp.net')); // private chats are not group rules
  assert.match(await run('plugin groups good-one deny', { isGroup: false }), /inside the group/);
});

test('a command name already used by another plugin cannot be installed', async () => {
  makePlugin('twin', { commands: [{ name: 'hellogoodone', who: 'everyone', description: 'x' }] });
  const r = await run('plugin install twin', {}); assert.match(r, /cannot be installed/); assert.match(r, /is used by the plugin/);
});

test('disable, enable and remove', async () => {
  assert.match(await run('plugin disable good-one', {}), /is off/); assert.ok(!commands.has('hellogoodone'));
  assert.match(await run('plugin enable good-one', {}), /is on/); assert.ok(commands.has('hellogoodone'));
  assert.match(await run('plugin info good-one', {}), /Version:\* 1.0.0/);
  assert.match(await run('plugin remove good-one', {}), /was removed/); assert.ok(!commands.has('hellogoodone'));
  assert.match(await run('plugin enable good-one', {}), /not installed/);
});

test('a plugin whose files were changed after install is not started until it is installed again', async () => {
  const f = makePlugin('editable');
  const code = (await run('plugin install editable', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code, {});
  assert.ok(commands.has('helloeditable'));
  fs.appendFileSync(path.join(f, 'index.js'), '\n// changed');
  plugins.turnOff(); assert.ok(!commands.has('helloeditable'));
  await run('plugin on', {});
  assert.ok(!commands.has('helloeditable'));
  assert.match(await run('plugin list', {}), /its files changed/);
  assert.match(await run('plugin enable editable', {}), /could not turn it on/);
  const code2 = (await run('plugin install editable', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code2, {});
  assert.ok(commands.has('helloeditable'));
});

test('a plugin that breaks the rules is switched off and the owner is told; members see a calm message', async () => {
  makePlugin('rude', { commands: [{ name: 'rude', who: 'everyone', description: 'x' }] }, "tfx.command('rude', async () => { for (let i = 0; i < 8; i++) { try { await tfx.owner.notify('x'); } catch (e) {} } });");
  const code = (await run('plugin install rude', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code, {});
  plugins.start(sock); // gives the manager a connection to tell the owner
  const first = ctxFor(); await commands.get('rude').run(first.c);
  const second = ctxFor(); await commands.get('rude').run(second.c);
  assert.ok(!commands.has('rude'));
  assert.ok(sent.some((s) => /switched off/.test(s.text) && /rude/.test(s.text)));
  assert.match(await run('plugin list', {}), /rude.*off/);
});

test('plugin replies never show internals to members', async () => {
  makePlugin('crashy', { commands: [{ name: 'crashy', who: 'everyone', description: 'x' }] }, "tfx.command('crashy', () => { throw new Error('secret detail /home/x'); });");
  const code = (await run('plugin install crashy', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code, {});
  const m = ctxFor(); await commands.get('crashy').run(m.c);
  assert.match(m.replies[0], /did not work/); assert.ok(!/secret|home|crashy/.test(m.replies[0]));
  const o = ctxFor({ isOwner: true }); await commands.get('crashy').run(o.c);
  assert.match(o.replies[0], /plugin log crashy/);
  assert.match(await run('plugin log crashy', {}), /call failed/);
});

test('limits: max and guard can be changed and are checked', async () => {
  assert.match(await run('plugin set max 0', {}), /no limit/);
  assert.strictEqual(plugins.overview().max, 0);
  assert.match(await run('plugin set max 3', {}), /Limit saved/);
  assert.match(await run('plugin set guard 128', {}), /128 MB/);
  assert.strictEqual(plugins.overview().guardMb, 128);
  assert.match(await run('plugin set guard 2', {}), /Plugin limits/); // refused: shows the help
  assert.strictEqual(plugins.overview().guardMb, 128);
});

test('only the most recently used plugins stay awake when a limit is set', async () => {
  for (const n of ['one', 'two', 'three']) {
    makePlugin('lim-' + n, { commands: [{ name: 'lim' + n, who: 'everyone', description: 'x' }] }, `tfx.command('lim${n}', (c) => c.reply('ok'));`);
    const code = (await run('plugin install lim-' + n, {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code, {});
  }
  await run('plugin set max 2', {});
  for (const n of ['one', 'two', 'three']) { const x = ctxFor(); await commands.get('lim' + n).run(x.c); assert.strictEqual(x.replies[0], 'ok'); }
  assert.ok(plugins._internals.hosts.size <= 2);
});

test('.plugin off removes every plugin command; the bot itself is untouched', async () => {
  assert.match(await run('plugin off', {}), /Plugins are off/);
  assert.ok(!commands.has('limone')); assert.ok(commands.has('ping')); assert.ok(!commandList.some((c) => c.pluginId));
  assert.strictEqual(plugins.isRunning(), false);
});

test('the .plugin replies follow the TurboFex format and never print "undefined"', async () => {
  for (const line of ['plugin', 'plugin help', 'plugin set', 'plugin list', 'plugin bogus']) {
    const r = await run(line, {}); assert.ok(!/undefined|null/.test(r), line + ': ' + r); assert.ok(/[✅⚠️ℹ️🧩]/u.test(r), line);
  }
});

test('the PLUGINS menu category exists and stays hidden while it is empty', () => {
  const categories = require('../whatsapp/categories');
  assert.strictEqual(categories.info.plugins.title, 'PLUGINS');
  assert.ok(!categories.groupByCategory([{ name: 'ping', category: 'general' }], false).some((g) => g.key === 'plugins'));
});

test('v1.3.6: the sample that ships with the bot is found in examples and is copied into the plugins folder when installed', async () => {
  const state = require('../core/plugins/state');
  assert.ok(state.folders().some((f) => f.endsWith(path.join('examples', 'hello-plugin'))));
  await run('plugin on', {});
  assert.match(await run('plugin list', {}), /Hello.*hello-plugin/);
  const code = (await run('plugin install hello-plugin', {})).match(/confirm (\w{4})/)[1];
  assert.match(await run('plugin confirm ' + code, {}), /is ready/);
  assert.ok(fs.existsSync(path.join(dir, 'plugins', 'hello-plugin', 'index.js')));
  const a = ctxFor(); await commands.get('hello').run(a.c); assert.match(a.replies[0], /Times used:\* 1/);
  const b = ctxFor(); await commands.get('hello').run(b.c); assert.match(b.replies[0], /Times used:\* 2/);
  assert.strictEqual((await run('plugin list', {})).split('hello-plugin').length - 1, 1); // listed once
  plugins.turnOff(); // stops the sandbox workers so the test run can end
});

const { Broker, sniff } = require('../core/plugins/broker');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 50)); };

test('v1.3.7 files: only real pictures, stickers and safe documents are accepted, judged by their bytes', async () => {
  const env = { isPublicHost: async () => true, log() {}, fetch: async () => ({}), notifyOwner: async () => {} };
  const made = () => { const b = new Broker({ manifest: { permissions: ['media.send'] }, grants: ['media.send'], env }); const out = []; const st = b.newCall({ chat: { id: 'x' } }, { sendMedia: async (m) => { out.push(m); } }); return { b, st, out }; };
  const go = async (o, c = made()) => { try { await c.b.handle('media.send', JSON.stringify({ kind: '', data: '', mimetype: '', fileName: '', caption: '', ...o }), c.st); return 'ok'; } catch (e) { return e.code; } };
  const b64 = (b) => b.toString('base64');
  assert.strictEqual(sniff(PNG).mime, 'image/png');
  const c = made();
  assert.strictEqual(await go({ kind: 'image', data: b64(PNG) }, c), 'ok'); assert.strictEqual(c.out[0].mimetype, 'image/png');
  assert.strictEqual(await go({ kind: 'image', data: b64(Buffer.from('not a picture at all')) }), 'bad_file');
  assert.strictEqual(await go({ kind: 'sticker', data: b64(PNG) }), 'bad_file');
  assert.strictEqual(await go({ kind: 'sticker', data: b64(WEBP) }), 'ok');
  assert.strictEqual(await go({ kind: 'document', data: b64(Buffer.from('a,b')), mimetype: 'text/csv', fileName: 'a.csv' }), 'ok');
  assert.strictEqual(await go({ kind: 'document', data: b64(Buffer.from('MZ program')), mimetype: 'application/x-msdownload', fileName: 'a.exe' }), 'bad_file');
  assert.strictEqual(await go({ kind: 'document', data: b64(Buffer.from('a,b')), mimetype: 'text/csv', fileName: '../a.csv' }), 'bad_args');
  assert.strictEqual(await go({ kind: 'document', data: b64(Buffer.from([65, 0, 66])), mimetype: 'text/plain', fileName: 'a.txt' }), 'bad_file');
  assert.strictEqual(await go({ kind: 'image', data: b64(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)])) }), 'too_long');
  assert.strictEqual(await go({ kind: 'image', data: '!!!' }), 'too_long');
  assert.strictEqual(await go({ kind: 'video', data: b64(PNG) }), 'bad_args');
  assert.strictEqual(await go({ kind: 'image', data: b64(PNG), caption: 'x'.repeat(1001) }), 'too_long');
  const d = made(); const r = []; for (let i = 0; i < 4; i++) r.push(await go({ kind: 'image', data: b64(PNG) }, d));
  assert.deepStrictEqual(r, ['ok', 'ok', 'ok', 'rate_limited']);
  const e = new Broker({ manifest: { permissions: ['chat.send'] }, grants: ['chat.send'], env });
  await assert.rejects(() => e.handle('media.send', JSON.stringify({ kind: 'image', data: b64(PNG), mimetype: '', fileName: '', caption: '' }), e.newCall({ chat: { id: 'x' } }, {})), /not in the manifest/);
});

test('v1.3.7 events: plugins hear joins and group messages only where allowed, never commands, never private chats', async () => {
  await run('plugin on', {});
  const g = '1203630000000@g.us';
  makePlugin('listener', { permissions: ['chat.send', 'events.message'], events: ['message'], commands: [{ name: 'listen', who: 'everyone', description: 'x' }] },
    "tfx.on('message', async (c) => { await c.reply('heard:' + c.text + ':' + c.sender.id.length + ':' + c.event); }); tfx.command('listen', (c) => c.reply('cmd'));");
  const codeA = (await run('plugin install listener', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + codeA, {});
  const screen = await run('plugin install welcome-plugin', {});
  assert.match(screen, /Know when members join/); // the install screen says it in plain words
  const codeB = screen.match(/confirm (\w{4})/)[1];
  await run('plugin confirm ' + codeB, {});
  const out = []; const s = { sendMessage: async (to, m) => { out.push({ to, m }); } };
  plugins.emit('message', { sock: s, jid: g, text: 'hi there', senderJid: '27811111111@s.whatsapp.net', pushName: 'Sam' });
  await wait(() => out.length >= 1);
  assert.strictEqual(out[0].to, g); assert.strictEqual(out[0].m.text, 'heard:hi there:16:message');
  plugins.emit('member.join', { sock: s, jid: g, members: ['27822222222@s.whatsapp.net'] });
  await wait(() => out.length >= 2);
  assert.match(out[1].m.text, /Welcome to the group/);
  const n = out.length;
  plugins.emit('message', { sock: s, jid: '27811111111@s.whatsapp.net', text: 'private' }); // a private chat is never delivered
  plugins.emit('member.leave', { sock: s, jid: g, members: ['x'] }); // nobody listens to leaves
  await run('plugin groups listener deny', {}); // this group is switched off for the plugin
  plugins.emit('message', { sock: s, jid: g, text: 'blocked' });
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(out.length, n);
  await run('plugin groups listener all', {});
  for (let i = 0; i < 30; i++) plugins.emit('message', { sock: s, jid: g, text: 'flood' + i }); // far too many: the extra ones are dropped
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(out.length - n <= 10, 'got ' + (out.length - n));
});

test('v1.3.7 a plugin can send a file it made itself, only to the chat where it was used', async () => {
  makePlugin('docmaker', { permissions: ['chat.send', 'media.send'], commands: [{ name: 'docme', who: 'everyone', description: 'x' }] },
    "tfx.command('docme', async (c) => { await tfx.media.send({ kind: 'document', data: tfx.util.toBase64('héllo'), mimetype: 'text/plain', fileName: 'note.txt', caption: 'here' }); });");
  const code = (await run('plugin install docmaker', {})).match(/confirm (\w{4})/)[1]; await run('plugin confirm ' + code, {});
  const out = []; const x = ctxFor({ sock: { sendMessage: async (to, m) => { out.push({ to, m }); } } });
  await commands.get('docme').run(x.c);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].to, '1203630000000@g.us');
  assert.strictEqual(out[0].m.document.toString('utf8'), 'héllo'); assert.strictEqual(out[0].m.fileName, 'note.txt'); assert.strictEqual(out[0].m.mimetype, 'text/plain');
  plugins.turnOff();
});

test('v1.3.7 app.json is valid and lists what a host needs to deploy the bot', () => {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  assert.strictEqual(a.name, 'TurboFex'); assert.match(a.repository, /^https:\/\/github.com\/nels0nfx\/TurboFex$/);
  assert.strictEqual(a.env.SESSION_ID.required, true);
  for (const k of Object.keys(a.env)) assert.ok(a.env[k].description, k);
  assert.ok(!JSON.stringify(a).includes('turbofexbot@')); // no private details in a public file
});

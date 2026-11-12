// v1.5.0: plugin settings (typed options the owner changes with .plugin set)
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
const G1 = '1203630000000@g.us'; const G2 = '1203639999999@g.us';
const ctxIn = (jid) => { const replies = []; return { replies, c: { jid, args: [], rest: '', prefix: '.', isGroup: true, isAdmin: true, isOwner: false, msg: { key: { participant: '27811111111@s.whatsapp.net' }, pushName: 'Sam' }, groupMetadata: { subject: 'T', participants: [{ id: 'a', admin: 'admin' }] }, reply: async (t) => { replies.push(t); }, sock } }; };
const SETTINGS = [
  { key: 'greeting', type: 'text', label: 'Greeting', default: 'hello', maxLength: 20, perGroup: true },
  { key: 'times', type: 'number', label: 'Repeat', default: 1, min: 1, max: 5 },
  { key: 'shout', type: 'toggle', label: 'Shout', default: false },
  { key: 'mood', type: 'choice', label: 'Mood', default: 'calm', options: ['calm', 'happy'] },
];
const bad = (settings, re) => { const f = makePlugin('bad-set', { settings }); const v = manifestLib.validate(f, { botVersion: '1.5.0', taken: new Set() }); assert.ok(!v.ok, 'accepted: ' + JSON.stringify(settings)); assert.match(v.errors.join(' | '), re); };

test('manifest: settings are checked (types, defaults, limits)', () => {
  const f = makePlugin('set-plug', { settings: SETTINGS }, `tfx.command('hellosetplug', async (c) => { const s = c.settings; await c.reply(s.greeting + ' ' + s.times + ' ' + s.shout + ' ' + s.mood); });`);
  const v = manifestLib.validate(f, { botVersion: '1.5.0', taken: new Set() }); assert.ok(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.manifest.settings.length, 4); assert.strictEqual(v.manifest.settings[0].perGroup, true);
  bad('nope', /settings must be a list/);
  bad([{ key: 'Bad', type: 'text', label: 'x', default: '' }], /own key/);
  bad([{ key: 'aa', type: 'text', label: 'x', default: 'a' }, { key: 'aa', type: 'text', label: 'x', default: 'a' }], /own key/);
  bad([{ key: 'aa', type: 'file', label: 'x', default: 'a' }], /type must be/);
  bad([{ key: 'aa', type: 'number', label: 'x', default: 9, min: 1, max: 5 }], /default must be a number/);
  bad([{ key: 'aa', type: 'toggle', label: 'x', default: 'yes' }], /true or false/);
  bad([{ key: 'aa', type: 'choice', label: 'x', default: 'c', options: ['a', 'b'] }], /one of the options/);
  bad([{ key: 'aa', type: 'choice', label: 'x', default: 'a', options: ['a'] }], /2 to 10/);
  bad([{ key: 'aa', type: 'text', label: 'x', default: 'long text here', maxLength: 5 }], /plain text/);
  bad([{ key: 'aa', type: 'text', label: '', default: 'a' }], /label is required/);
  bad(Array.from({ length: 11 }, (_, i) => ({ key: 'k' + i + 'x', type: 'toggle', label: 'x', default: true })), /too many settings/);
  fs.rmSync(path.join(root, 'bad-set'), { recursive: true, force: true });
});

test('setup: plugins on, plugin installed', async () => {
  await run('plugin on', {}); assert.ok(plugins.isRunning());
  const r = await run('plugin install set-plug', {}); assert.match(await run('plugin confirm ' + r.match(/confirm (\w{4})/)[1], {}), /is ready/);
});

test('the plugin sees the defaults, then the values the owner set; per-group values only in their group', async () => {
  const cmd = commands.get('hellosetplug'); const ask = async (jid) => { const x = ctxIn(jid); await cmd.run(x.c); return x.replies[0]; };
  assert.strictEqual(await ask(G1), 'hello 1 false calm');
  assert.match(await run('plugin options set-plug', {}), /greeting:\* hello[\s\S]*times:\* 1[\s\S]*shout:\* off[\s\S]*mood:\* calm/);
  assert.match(await run('plugin option set-plug times 3', {}), /Saved/); assert.match(await run('plugin option set-plug shout on', {}), /Saved/); assert.match(await run('plugin option set-plug mood HAPPY', {}), /Saved/);
  assert.strictEqual(await ask(G1), 'hello 3 true happy');
  // per group text: set inside G1 only
  assert.match(await run('plugin option set-plug greeting good day', { jid: G1, isGroup: true }), /Only in this group/);
  assert.strictEqual(await ask(G1), 'good day 3 true happy'); assert.strictEqual(await ask(G2), 'hello 3 true happy');
  assert.match(await run('plugin option set-plug greeting reset', { jid: G1, isGroup: true }), /back to the default/);
  assert.strictEqual(await ask(G1), 'hello 3 true happy');
  // a setting that is not per group is global even when set inside a group
  assert.doesNotMatch(await run('plugin option set-plug times 2', { jid: G1, isGroup: true }), /Only in this group/); assert.strictEqual(await ask(G2), 'hello 2 true happy');
  // not per group + outside a group: global default of the per-group setting
  assert.match(await run('plugin option set-plug greeting hey', { jid: 'x@s.whatsapp.net', isGroup: false }), /Saved/); assert.strictEqual(await ask(G2), 'hey 2 true happy');
});

test('wrong values and options are refused with a plain message and change nothing', async () => {
  const before = JSON.stringify(plugins.settingsFor('set-plug', G1));
  for (const line of ['times 9', 'times abc', 'times 1e3', 'shout maybe', 'mood angry', 'greeting ' + 'x'.repeat(21)]) assert.match(await run('plugin option set-plug ' + line, {}), /does not fit/, line);
  assert.match(await run('plugin option set-plug nothing 1', {}), /does not exist/);
  assert.match(await run('plugin option set-plug', {}), /Which option/);
  assert.match(await run('plugin set maxrunning', {}), /./);   // the old limits command is untouched
  assert.match(await run('plugin option no-such times 1', {}), /not installed/);
  assert.strictEqual(JSON.stringify(plugins.settingsFor('set-plug', G1)), before);
});

test('settings survive an update; a value that no longer fits is ignored', async () => {
  const d = require('../core/plugins/state').open().data; assert.ok(d.installed['set-plug'].settings);
  makePlugin('set-plug', { version: '1.1.0', settings: [{ ...SETTINGS[0] }, { ...SETTINGS[1], max: 1 }, SETTINGS[2], SETTINGS[3]] }, `tfx.command('hellosetplug', async (c) => { const s = c.settings; await c.reply(s.greeting + ' ' + s.times + ' ' + s.shout + ' ' + s.mood); });`);
  const r = await run('plugin install set-plug', {}); assert.match(await run('plugin confirm ' + r.match(/confirm (\w{4})/)[1], {}), /is ready/);
  const x = ctxIn(G2); await commands.get('hellosetplug').run(x.c);
  assert.strictEqual(x.replies[0], 'hey 1 true happy', 'times=2 no longer fits (max is 1 now): default 1; the rest kept');
});

test('cleanup', () => { plugins.turnOff(); });

// v1.5.8: the plugin test tool runs a plugin in the real sandbox with a pretend chat
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tool = require('../tools/plugin-test');

function plugin(manifestExtra, code) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
  fs.writeFileSync(path.join(d, 'turbofex-plugin.json'), JSON.stringify({ manifestVersion: 1, id: 'try-plugin', version: '1.0.0', apiVersion: 1, name: 'Try', description: 'Test', author: { name: 'Me' }, permissions: ['chat.send'], commands: [{ name: 'hi', who: 'everyone', description: 'Say hi' }], ...manifestExtra }));
  fs.writeFileSync(path.join(d, 'index.js'), code); return d;
}
test('runs the commands and shows what the bot would say', async () => {
  const d = plugin({}, "tfx.command('hi', async (ctx) => { await ctx.reply('Hi ' + ctx.sender.name + ' ' + ctx.args.join(',')); });");
  const rep = await tool.test(d, { command: 'hi a b' });
  assert.strictEqual(rep.ok, true, JSON.stringify(rep)); assert.deepStrictEqual(rep.runs[0].sends, ['Hi Sam a,b']);
  assert.match(tool.show(rep), /bot says: Hi Sam a,b/);
});
test('a plugin that uses a permission it did not declare is reported, not run silently', async () => {
  const d = plugin({}, "tfx.command('hi', async (ctx) => { await ctx.react('👍'); await ctx.reply('x'); });");
  const rep = await tool.test(d, {});
  assert.deepStrictEqual(rep.runs[0].reactions, [], 'the reaction never happened');
  assert.strictEqual(rep.ok, false); assert.match(rep.runs[0].error, /refused something/);
});
test('bad files and unknown commands are explained', async () => {
  const d = plugin({ permissions: ['nope'] }, "tfx.command('hi', async () => {});");
  assert.strictEqual((await tool.test(d, {})).ok, false);
  const e = plugin({}, "tfx.command('hi', async () => {});");
  assert.match((await tool.test(e, { command: 'zzz' })).errors[0], /no command called "zzz"/);
});
test('a plugin that crashes is reported as a problem', async () => {
  const d = plugin({}, "tfx.command('hi', async () => { throw new Error('boom'); });");
  const rep = await tool.test(d, {}); assert.strictEqual(rep.ok, false); assert.ok(rep.runs[0].error);
});

// v1.6.0: collections and bundles (curated sets of store plugins, signed inside the index, installed set-wide through the normal approval)
require('./_setup');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const test = require('node:test'); const assert = require('node:assert');
process.env.TFX_REGISTRY_KEYDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-ckey-'));
process.env.TFX_SITE_TOKEN = 't'.repeat(40);
const tool = require('../tools/registry');
const registry = require('../core/plugins/registry');
const plugins = require('../core/plugins');
const pluginCmd = require('../commands/plugin');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-creg-')); tool.keygen(); tool.init(reg);
const commands = new Map(); plugins.attach(commands, []);
const run = async (line) => { const r = []; await pluginCmd.run({ args: line.split(/\s+/).slice(1), rest: line.split(/\s+/).slice(1).join(' '), reply: async (t) => { r.push(t); }, prefix: '.', jid: '1203630000000@g.us', isGroup: false }); return r; };
const mk = (id) => {
  const manifestRaw = JSON.stringify({ manifestVersion: 1, id, version: '1.0.0', apiVersion: 1, name: 'P ' + id, description: 'Test', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: id.replace(/-/g, ''), who: 'everyone', description: 'x' }] });
  const entrySource = `tfx.command('${id.replace(/-/g, '')}', (c) => c.reply('v'));`;
  return { submission: crypto.randomBytes(4).toString('hex'), id, version: '1.0.0', manifestRaw, entrySource, manifestSha: sha(manifestRaw), entrySha: sha(entrySource), developer: 'alice', githubId: 42, verified: false };
};
const site = (plugins, collections) => async (url, o) => (o.headers.authorization !== 'Bearer ' + process.env.TFX_SITE_TOKEN ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ plugins, revocations: [], ...(collections ? { collections } : {}) }) });
const serve = () => registry._test.setFetcher(async (url) => { const f = path.join(reg, url.slice(registry.BASE.length)); if (!fs.existsSync(f)) throw new Error('404'); return fs.readFileSync(f); });

test('cleanCollections keeps only well-formed sets of 2 to 8 plugins', () => {
  const ok = { id: 'starter-set', name: 'Starter', description: 'Good first plugins', plugins: ['aaa-one', 'bbb-two'] };
  const out = tool.cleanCollections([ok, { ...ok, id: 'starter-set' }, { id: 'x', name: 'bad id', plugins: ['aaa-one', 'bbb-two'] }, { id: 'one-only', name: 'One', plugins: ['aaa-one'] }, { id: 'no-name', name: ' ', plugins: ['aaa-one', 'bbb-two'] }, { id: 'too-many', name: 'T', plugins: Array.from({ length: 9 }, (_, i) => 'plug-' + i) }, { id: 'dupes', name: 'D', plugins: ['aaa-one', 'aaa-one'] }, { id: 'evil', name: 'E', plugins: ['../x', 'aaa-one', 'bbb-two'] }, 7, null]);
  assert.deepStrictEqual(out.map((c) => c.id), ['starter-set', 'evil']);
  assert.deepStrictEqual(out[1].plugins, ['aaa-one', 'bbb-two'], 'a bad plugin id is dropped');
  assert.deepStrictEqual(tool.cleanCollections('nope'), []);
});

test('pull signs the collections from the site into the index; an old site that sends none changes nothing; an empty list clears them', async () => {
  const a = mk('col-one'), b = mk('col-two'), c = mk('col-three');
  const cols = [{ id: 'starter-set', name: 'Starter set', description: 'Three good ones', plugins: ['col-one', 'col-two', 'col-three', 'gone-one'] }];
  let o = await tool.pull(reg, site([a, b, c], cols));
  assert.strictEqual(o.added.length, 3); assert.strictEqual(o.collections, 1);
  let idx = JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8'));
  assert.strictEqual(idx.collections[0].id, 'starter-set'); assert.strictEqual(tool.verify(reg), 3, 'still signed correctly');
  o = await tool.pull(reg, site([], cols)); assert.strictEqual(o.collections, null, 'same list: nothing to sign again');
  o = await tool.pull(reg, site([])); assert.strictEqual(o.collections, null);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8')).collections.length, 1, 'a site without the field keeps the old list');
  o = await tool.pull(reg, site([], [])); assert.strictEqual(o.collections, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8')).collections, undefined);
  await tool.pull(reg, site([], cols));   // put it back for the next test
});

test('bot: collectionsOf drops odd shapes; the commands list, show and prepare a whole set; each plugin still needs its own OK', async () => {
  registry._test.setKey(tool.publicPem()); serve();
  assert.deepStrictEqual(registry.collectionsOf({}), []);
  assert.deepStrictEqual(registry.collectionsOf({ collections: [{ id: 'ok-set', name: 'N', plugins: ['aaa', 'bbb'] }, { id: 'ok-set', name: 'dupe', plugins: ['aaa'] }, { id: 'X', plugins: ['aaa'] }, { id: 'no-list', name: 'x' }] }).map((x) => x.id), ['ok-set']);
  await run('plugin on');
  const list = (await run('plugin collections')).join('\n');
  assert.match(list, /Starter set\* `starter-set` \(3 plugins\)/, 'the missing plugin is not counted');
  const one = (await run('plugin collection starter-set')).join('\n');
  assert.match(one, /P col-one\* 1.0.0 `col-one`/); assert.match(one, /gone-one.*not in the store/); assert.match(one, /bundle starter-set/);
  assert.match((await run('plugin collection nothing-here')).join('\n'), /could not find that collection/);
  assert.match((await run('plugin bundle')).join('\n'), /Which collection/);
  // install the first one by hand, so the bundle skips it
  const first = (await run('plugin install col-one')).join('\n'); await run('plugin confirm ' + first.match(/confirm (\w{4})/)[1]);
  assert.match((await run('plugin collection starter-set')).join('\n'), /col-one.*already installed/);
  const msgs = await run('plugin bundle starter-set');
  assert.match(msgs[0], /Ready to approve:\* 2/); assert.match(msgs[0], /already installed/); assert.match(msgs[0], /gone-one \(not in the store\)/);
  assert.strictEqual(msgs.length, 3, 'a summary and one approval screen per plugin');
  assert.match(msgs[1], /Install P col-two 1.0.0\?/); assert.match(msgs[2], /Install P col-three 1.0.0\?/);
  assert.match(msgs[1], /It asks to:/); assert.match(msgs[1], /plugin confirm \w{4}/);
  // nothing is installed until the owner confirms each one
  assert.strictEqual(plugins.overview().installed['col-two'], undefined);
  assert.match((await run('plugin confirm ' + msgs[2].match(/confirm (\w{4})/)[1])).join('\n'), /is ready/);
  assert.ok(plugins.overview().installed['col-three']); assert.strictEqual(plugins.overview().installed['col-two'], undefined, 'the one skipped by the owner stays out');
  assert.match((await run('plugin help')).join('\n'), /bundle <name>/);
});

test('bot: a collection with a bad signature is not trusted; without collections the commands say so', async () => {
  const keep = fs.readFileSync(path.join(reg, 'index.json'));
  const idx = JSON.parse(keep.toString('utf8')); idx.collections[0].plugins.push('col-evil'); fs.writeFileSync(path.join(reg, 'index.json'), JSON.stringify(idx));
  registry._test.reset(); registry._test.setKey(tool.publicPem()); serve();
  assert.match((await run('plugin collections')).join('\n'), /safety check|did not pass/);
  fs.writeFileSync(path.join(reg, 'index.json'), keep);
  await tool.pull(reg, site([], [])); registry._test.reset(); registry._test.setKey(tool.publicPem()); serve();
  assert.match((await run('plugin collections')).join('\n'), /No collections yet/);
});

test('the bot version is 1.6.0', () => { assert.strictEqual(require('../package.json').version, '1.6.0'); });

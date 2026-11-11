// v1.4.2: "node tools/registry.js pull" / "published" (the phone command that collects plugins approved on the pair site)
require('./_setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');

process.env.TFX_REGISTRY_KEYDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-pkey-'));
process.env.TFX_SITE_TOKEN = 't'.repeat(40);
const tool = require('../tools/registry');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-preg-'));
tool.keygen(); tool.init(reg);

const mk = (id, version, o = {}, code) => {
  const manifestRaw = JSON.stringify({ manifestVersion: 1, id, version, apiVersion: 1, name: 'P ' + id, description: 'Test', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: id.replace(/-/g, ''), who: 'everyone', description: 'x' }], ...o });
  const entrySource = code || `tfx.command('${id.replace(/-/g, '')}', (c) => c.reply('v${version}'));`;
  return { submission: crypto.randomBytes(4).toString('hex'), id, version, manifestRaw, entrySource, manifestSha: sha(manifestRaw), entrySha: sha(entrySource), developer: 'alice', githubId: 42, verified: false };
};
function site(plugins, status = 200) {
  const calls = [];
  const f = async (url, o) => { calls.push({ url, o }); if (o.headers.authorization !== 'Bearer ' + process.env.TFX_SITE_TOKEN) return { ok: false, status: 401, json: async () => ({}) }; if (status !== 200) return { ok: false, status, json: async () => ({}) }; return { ok: true, status: 200, json: async () => (url.endsWith('approved') ? { plugins } : { ok: true, marked: JSON.parse(o.body).ids.length }) }; };
  f.calls = calls; return f;
}

test('pull adds approved plugins, signs them and remembers them until "published"', async () => {
  const a = mk('pull-one', '1.0.0'); const b = mk('pull-two', '2.0.0');
  const f = site([a, b]);
  const o = await tool.pull(reg, f);
  assert.deepStrictEqual(o.added, ['pull-one 1.0.0', 'pull-two 2.0.0']); assert.deepStrictEqual(o.skipped, []);
  assert.strictEqual(tool.verify(reg), 2);
  assert.ok(fs.existsSync(path.join(reg, 'plugins/pull-one/1.0.0/index.js')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(reg, 'owners.json'), 'utf8'))['pull-one'], 42);
  assert.match(f.calls[0].url, /\/api\/registry\/approved$/);
  // running it again after a failed push is harmless, and the ids are kept
  const again = await tool.pull(reg, f); assert.match(again.added[0], /already in the folder/);
  assert.strictEqual(await tool.markPublished(site([])), 2, 'two ids reported once');
  assert.strictEqual(await tool.markPublished(site([])), 0, 'nothing left to report');
});

test('pull refuses what does not match: changed code, another owner, a different version with the same number, invalid plugins', async () => {
  const bad = mk('pull-bad', '1.0.0'); bad.entrySource += '\n// changed after the announcement';
  const other = mk('pull-one', '1.1.0'); other.githubId = 99;
  const same = mk('pull-two', '2.0.0', {}, "tfx.command('pulltwo', (c) => c.reply('different'));");
  const invalid = mk('pull-inv', '1.0.0', { permissions: ['nope'] });
  const o = await tool.pull(reg, site([bad, other, same, invalid]));
  assert.deepStrictEqual(o.added, []);
  const why = Object.fromEntries(o.skipped.map((x) => [x.id + x.version, x.reason]));
  assert.match(why['pull-bad1.0.0'], /fingerprints/); assert.match(why['pull-one1.1.0'], /another developer/); assert.match(why['pull-two2.0.0'], /different code/); assert.match(why['pull-inv1.0.0'], /refused/);
  assert.strictEqual(tool.verify(reg), 2, 'nothing was added');
  assert.ok(!fs.existsSync(path.join(reg, 'plugins/pull-bad')));
});

test('pull explains a missing or wrong token and a site without the download', async () => {
  await assert.rejects(() => tool.pull(reg, site([], 404)), /no download set up/);
  const t = process.env.TFX_SITE_TOKEN; process.env.TFX_SITE_TOKEN = 'x'.repeat(40);
  await assert.rejects(() => tool.pull(reg, async () => ({ ok: false, status: 401, json: async () => ({}) })), /did not accept the token/);
  process.env.TFX_SITE_TOKEN = 'short'; await assert.rejects(() => tool.pull(reg, site([])), /Set TFX_SITE_TOKEN/);
  process.env.TFX_SITE_TOKEN = t;
});

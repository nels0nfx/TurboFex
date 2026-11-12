// v1.5.2: README.md and CHANGELOG.md of a plugin version travel through pull into the signed index
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
  const f = async (url, o) => { calls.push({ url, o }); if (o.headers.authorization !== 'Bearer ' + process.env.TFX_SITE_TOKEN) return { ok: false, status: 401, json: async () => ({}) }; if (status !== 200) return { ok: false, status, json: async () => ({}) }; return { ok: true, status: 200, json: async () => (url.endsWith('approved') ? { plugins, revocations: f.revocations || [] } : { ok: true, marked: JSON.parse(o.body).ids.length, revoked: (JSON.parse(o.body).revoked || []).length }) }; };
  f.calls = calls; return f;
}


const withDocs = (p, readme, changelog) => { if (readme !== undefined) { p.readme = readme; p.readmeSha = sha(readme); } if (changelog !== undefined) { p.changelog = changelog; p.changelogSha = sha(changelog); } return p; };
const idx = () => JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8'));

test('pull: README and CHANGELOG are verified, stored with the version and fingerprinted in the signed index', async () => {
  const a = withDocs(mk('doc-one', '1.0.0'), '# Doc one\nDoes things.\n', '1.0.0 first version\n');
  const none = mk('doc-none', '1.0.0');
  const o = await tool.pull(reg, site([a, none])); assert.deepStrictEqual(o.skipped, []); assert.strictEqual(o.added.length, 2);
  assert.strictEqual(tool.verify(reg), 2);
  const e = idx().plugins['doc-one'].versions['1.0.0'];
  assert.strictEqual(e.readmeSha, sha('# Doc one\nDoes things.\n')); assert.strictEqual(e.changelogSha, sha('1.0.0 first version\n'));
  assert.strictEqual(fs.readFileSync(path.join(reg, 'plugins/doc-one/1.0.0/README.md'), 'utf8'), '# Doc one\nDoes things.\n');
  assert.strictEqual(idx().plugins['doc-none'].versions['1.0.0'].readmeSha, undefined, 'no document: no field');
});

test('pull refuses documents that do not match, are too big or are not plain text', async () => {
  const wrong = withDocs(mk('doc-bad', '1.0.0'), 'hello'); wrong.readme = 'changed after the announcement';
  const big = withDocs(mk('doc-big', '1.0.0'), 'x'.repeat(16 * 1024 + 1));
  const ctl = withDocs(mk('doc-ctl', '1.0.0'), 'a\u0000b');
  const miss = withDocs(mk('doc-miss', '1.0.0'), 'hello'); delete miss.readme;
  const o = await tool.pull(reg, site([wrong, big, ctl, miss])); assert.deepStrictEqual(o.added, []);
  assert.strictEqual(o.skipped.length, 4); for (const x of o.skipped) assert.match(x.reason, /README\.md/);
  for (const id of ['doc-bad', 'doc-big', 'doc-ctl', 'doc-miss']) assert.ok(!fs.existsSync(path.join(reg, 'plugins', id)), id);
});

test('add with files in the folder; a published version cannot get a document later or lose one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-doc-')); const p = mk('doc-two', '1.0.0');
  fs.writeFileSync(path.join(dir, 'turbofex-plugin.json'), p.manifestRaw); fs.writeFileSync(path.join(dir, 'index.js'), p.entrySource); fs.writeFileSync(path.join(dir, 'README.md'), 'readme');
  tool.add(dir, reg); assert.strictEqual(idx().plugins['doc-two'].versions['1.0.0'].readmeSha, sha('readme'));
  fs.writeFileSync(path.join(reg, 'plugins/doc-two/1.0.0/CHANGELOG.md'), 'sneaked in'); assert.throws(() => tool.build(reg), /was changed after it was published/);
  fs.rmSync(path.join(reg, 'plugins/doc-two/1.0.0/CHANGELOG.md')); fs.writeFileSync(path.join(reg, 'plugins/doc-two/1.0.0/README.md'), 'edited'); assert.throws(() => tool.build(reg), /was changed after it was published/);
  fs.writeFileSync(path.join(reg, 'plugins/doc-two/1.0.0/README.md'), 'readme'); assert.doesNotThrow(() => tool.build(reg));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-doc-')); const q = mk('doc-three', '1.0.0');
  fs.writeFileSync(path.join(d2, 'turbofex-plugin.json'), q.manifestRaw); fs.writeFileSync(path.join(d2, 'index.js'), q.entrySource); fs.writeFileSync(path.join(d2, 'README.md'), Buffer.from([0x68, 0xff, 0xfe]));
  assert.throws(() => tool.add(d2, reg), /plain text/); assert.ok(!fs.existsSync(path.join(reg, 'plugins/doc-three')));
});

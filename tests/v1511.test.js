// v1.5.11: icon.png (a square PNG logo) travels through pull into the signed index
require('./_setup');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const test = require('node:test'); const assert = require('node:assert');
process.env.TFX_REGISTRY_KEYDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-ikey-'));
process.env.TFX_SITE_TOKEN = 't'.repeat(40);
const tool = require('../tools/registry');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-ireg-')); tool.keygen(); tool.init(reg);
const png = (w, h, len = 80) => { const b = Buffer.alloc(len); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const mk = (id, icon, iconSha) => {
  const manifestRaw = JSON.stringify({ manifestVersion: 1, id, version: '1.0.0', apiVersion: 1, name: 'P ' + id, description: 'Test', author: { name: 'Dev' }, permissions: ['chat.send'], commands: [{ name: id.replace(/-/g, ''), who: 'everyone', description: 'x' }] });
  const entrySource = `tfx.command('${id.replace(/-/g, '')}', (c) => c.reply('v'));`;
  return { submission: crypto.randomBytes(4).toString('hex'), id, version: '1.0.0', manifestRaw, entrySource, manifestSha: sha(manifestRaw), entrySha: sha(entrySource), developer: 'alice', githubId: 42, verified: false, ...(icon ? { icon: icon.toString('base64'), iconSha } : {}) };
};
const site = (plugins) => async (url, o) => (o.headers.authorization !== 'Bearer ' + process.env.TFX_SITE_TOKEN ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ plugins }) });
test('pull stores a good logo, fingerprints it, and skips one that does not match or is not a small square PNG', async () => {
  const good = png(64, 64);
  const o = await tool.pull(reg, site([mk('logo-ok', good, sha(good)), mk('logo-liar', good, sha(Buffer.from('other'))), mk('logo-wide', png(64, 128), sha(png(64, 128))), mk('logo-none')]));
  assert.deepStrictEqual(o.added.map((x) => x.id || x).sort().map(String).length, 2);
  const idx = JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8'));
  assert.strictEqual(idx.plugins['logo-ok'].versions['1.0.0'].iconSha, sha(good));
  assert.ok(fs.readFileSync(path.join(reg, 'plugins/logo-ok/1.0.0/icon.png')).equals(good));
  assert.strictEqual(idx.plugins['logo-none'].versions['1.0.0'].iconSha, undefined);
  assert.ok(!idx.plugins['logo-liar'] && !idx.plugins['logo-wide']);
  assert.strictEqual(o.skipped.length, 2); assert.strictEqual(tool.verify(reg), 2);
});

const pngS = (w, h) => png(w, h, 120);
test('pull stores up to 3 screenshots in order, fingerprints them in the signed index, skips bad ones', async () => {
  const a = pngS(400, 300), c = pngS(500, 300);
  const withShots = (p, shots, shas) => ({ ...p, shots: shots.map((x) => x.toString('base64')), shotShas: shas || shots.map(sha) });
  const o = await tool.pull(reg, site([withShots(mk('shot-ok'), [a, c]), withShots(mk('shot-liar'), [a], [sha(Buffer.from('x'))]), withShots(mk('shot-tiny'), [pngS(50, 50)]), withShots(mk('shot-four'), [a, a, a, a])]));
  const idx = JSON.parse(fs.readFileSync(path.join(reg, 'index.json'), 'utf8'));
  assert.deepStrictEqual(idx.plugins['shot-ok'].versions['1.0.0'].shotShas, [sha(a), sha(c)]);
  assert.ok(fs.readFileSync(path.join(reg, 'plugins/shot-ok/1.0.0/screenshot2.png')).equals(c));
  assert.ok(!idx.plugins['shot-liar'] && !idx.plugins['shot-tiny'] && !idx.plugins['shot-four']);
  assert.strictEqual(o.skipped.length, 3); assert.ok(tool.verify(reg) >= 1);
});

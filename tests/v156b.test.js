require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const tool = require('../tools/registry');
test('sitebackup writes the file the site sends and refuses anything else', async () => {
  process.env.TFX_SITE_TOKEN = 't'.repeat(30);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')), 'b.json');
  const calls = [];
  const ok = async (u, o) => { calls.push([u, o.headers.authorization]); return { ok: true, status: 200, json: async () => ({ format: 'turbofex-devcentre-backup-1', developers: [{}], submissions: [{}, {}] }) }; };
  assert.deepStrictEqual(await tool.siteBackup(f, ok), { submissions: 2, developers: 1 });
  assert.ok(calls[0][0].endsWith('/api/registry/backup')); assert.strictEqual(calls[0][1], 'Bearer ' + 't'.repeat(30));
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).format, 'turbofex-devcentre-backup-1');
  await assert.rejects(() => tool.siteBackup(f, async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })), /did not send a backup/);
});

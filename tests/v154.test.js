// v1.5.4: a spare signing key is trusted too (key rotation)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const registry = require('../core/plugins/registry');

test('an index signed by a spare key is accepted; by an unknown key is not', async () => {
  const mk = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey }; };
  const main = mk(), spare = mk(), other = mk();
  const bytes = Buffer.from('{"plugins":{}}');
  const sig = (k) => crypto.sign(null, bytes, k.priv).toString('base64');
  registry._test.setKey(main.pub, [spare.pub]);
  try {
    assert.ok(registry._test.verifyIndex(bytes, sig(main)));
    assert.ok(registry._test.verifyIndex(bytes, sig(spare)));
    assert.ok(!registry._test.verifyIndex(bytes, sig(other)));
    registry._test.setKey(main.pub);
    assert.ok(!registry._test.verifyIndex(bytes, sig(spare)), 'without the spare listed it is refused');
  } finally { registry._test.setKey(null); }
});

test('the shipped key file lists a spare key that is different from the main one', () => {
  const j = require('../core/plugins/registry-key.json');
  assert.strictEqual(j.backupKeys.length, 1);
  assert.notStrictEqual(j.backupKeys[0].trim(), j.publicKey.trim());
  assert.strictEqual(crypto.createPublicKey(j.backupKeys[0]).asymmetricKeyType, 'ed25519');
});

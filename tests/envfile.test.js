require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const envfile = require('../core/envfile');

const tmpFile = (text) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-env-')), 'config.env');
  fs.writeFileSync(f, text);
  return f;
};

test('parse: spaces around =, quotes, notes, export', () => {
  const out = envfile.parse(['# note', 'SESSION_ID = TFX-AAAA-BBBB-CCCC', 'PREFIX="!"', "export TIMEZONE='Africa/Lagos' # lagos", 'EMPTY=', 'NUMBER=2348012345678 # mine', 'bad line'].join('\n'));
  assert.deepStrictEqual(out, { SESSION_ID: 'TFX-AAAA-BBBB-CCCC', PREFIX: '!', TIMEZONE: 'Africa/Lagos', NUMBER: '2348012345678' });
});

test('load: fills missing settings, never overwrites the host, ignores a missing file', () => {
  const env = { PREFIX: '#' };
  const applied = envfile.load(tmpFile('PREFIX=.\nSESSION_ID=TFX-AAAA-BBBB-CCCC\r\n'), env);
  assert.deepStrictEqual(applied, ['SESSION_ID']);
  assert.strictEqual(env.PREFIX, '#');
  assert.strictEqual(env.SESSION_ID, 'TFX-AAAA-BBBB-CCCC');
  assert.deepStrictEqual(envfile.load(path.join(os.tmpdir(), 'nope-config.env'), {}), []);
});

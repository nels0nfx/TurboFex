require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const store = require('../whatsapp/store');
const { isCommandText } = require('../whatsapp/utils');

test('defaults: prefix "." and private mode', () => {
  assert.strictEqual(store.effectivePrefix(), '.');
  assert.strictEqual(store.getMode(), 'private');
  assert.strictEqual(store.getCmdReact(), 'on');
});
test('AFK: each person is told once per session, a new session starts again', () => {
  const rec = store.afkSet(['27811111111'], 'lunch');
  const record = store.afkGet(['27811111111']);
  assert.ok(record && record.reason === 'lunch');
  assert.ok(!store.afkWasTold(record, 'alice'));
  store.afkMarkTold(record, 'alice');
  assert.ok(store.afkWasTold(record, 'alice') && !store.afkWasTold(record, 'bob'));
  store.afkSet(['27811111111'], 'again');
  assert.ok(!store.afkWasTold(store.afkGet(['27811111111']), 'alice'));
  store.afkDel(['27811111111']);
  assert.ok(!store.afkGet(['27811111111']));
});
test('what is a command', () => {
  assert.ok(isCommandText('.menu', '.'));
  assert.ok(isCommandText('.8ball will it', '.'));
  assert.ok(!isCommandText('...', '.'));
  assert.ok(!isCommandText('. hello', '.'));
  assert.ok(!isCommandText('hello .menu', '.'));
});
test('settings are saved: reactions, sticker credit, status limit', () => {
  store.setCmdReact('smart');
  assert.strictEqual(store.getCmdReact(), 'smart');
  store.updateSticker((s) => { s.pack = 'P'; });
  assert.strictEqual(store.stickerCfg().pack, 'P');
  assert.strictEqual(store.statusCfg().dailyLikeLimit, 200);
});

require('./_setup');
const test = require('node:test');
const assert = require('assert');
const watchers = require('../whatsapp/watchers');
const store = require('../whatsapp/store');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(messages) {
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  const asked = [];
  const lines = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, requestPlaceholderResend: async (k) => asked.push(k.id), sendMessage: async () => ({}) };
  const real = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    for (const m of messages) {
      watchers.early(sock, m);
      await watchers.noContent(sock, m);
    }
    await wait(50);
  } finally {
    console.log = real;
  }
  return { asked, lines };
}
const empty = (id, params) => ({ key: { remoteJid: '27811111111@s.whatsapp.net', id, fromMe: false }, messageStubType: 2, messageStubParameters: params });

test('v1.8.9: messages that could not be decrypted print nothing and the phone is not asked', async () => {
  const r = await run([empty('A1', ['No session found to decrypt message']), empty('A2', ['Invalid PreKey ID']), empty('A3', ['Bad MAC'])]);
  assert.deepStrictEqual(r.asked, []);
  assert.deepStrictEqual(r.lines, []);
});

test('v1.8.9: another empty message still asks the phone and prints one line', async () => {
  const r = await run([empty('B1', [])]);
  assert.deepStrictEqual(r.asked, ['B1']);
  assert.strictEqual(r.lines.length, 1);
});

test('v1.8.9: a missing chat session never counts towards the automatic repair', () => {
  require('../core/quiet');
  const health = require('../core/health');
  const before = health.stats().total;
  console.error('No session found to decrypt message');
  console.error('Session error: No session record');
  assert.strictEqual(health.stats().total, before);
  console.error('Session error: Bad MAC');
  assert.strictEqual(health.stats().total, before + 1);
});

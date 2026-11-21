require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const capacity = require('../core/capacity');
const backoff = require('../core/backoff');
const crashguard = require('../core/crashguard');
const { createQueues } = require('../core/chatqueue');

baileys.setForTests({});
console.log = () => {}; // keeps Node's test output clean

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. reconnect: the wait grows, is capped, and the caller never gives up
test('v1.7.3: the wait before starting the connection again grows to one minute and stays there', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 50].map(backoff.delayAfter), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.strictEqual(backoff.delayAfter(0), 5000, 'a bad number still gives the first wait');
});
test('v1.7.3: connection.js retries a failed start again and again (no dead end after two tries)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'whatsapp', 'connection.js'), 'utf8');
  assert.ok(/function scheduleStart\(/.test(src) && /scheduleStart\(wait\)/.test(src), 'a failed start schedules the next try');
  assert.ok(!/setTimeout\(\(\) => startWhatsApp\(\)\.catch\(console\.error\), 10000\)/.test(src), 'the old last-try-only code is gone');
});

// ---- 2. a stuck command frees its slot
test('v1.7.3: a command that hangs frees its slot when its time is up', async () => {
  const cmd = handler.resolveCommand('ping');
  cmd.capacity = { needs: [], weight: 'medium' };
  cmd.maxMs = 120;
  cmd.run = () => new Promise(() => {}); // never answers
  const sent = [];
  const sock = {
    user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sendMessage: async (j, c) => { sent.push(c); return { key: { id: `K${sent.length}` } }; },
    sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {}, readMessages: async () => {},
  };
  store.setGuard(true);
  const p = store.effectivePrefix();
  const msg = { key: { remoteJid: '27800000001@s.whatsapp.net', id: 'HANG1', fromMe: false }, message: { conversation: `${p}ping` }, messageTimestamp: Math.floor(Date.now() / 1000) };
  const run = handler.handleMessage(sock, msg);
  await sleep(40);
  assert.strictEqual(capacity.snapshot().active.medium, 1, 'while it runs it holds one slot');
  await run;
  assert.strictEqual(capacity.snapshot().active.medium, 0, 'the slot is free again after the time limit');
  assert.ok(sent.some((c) => c.text && /not answering|went wrong/.test(c.text)), 'the person is told it failed');
});

// ---- 3. repeated crashes restart the bot
test('v1.7.3: one fatal error is survived, three in ten minutes ask for a restart', () => {
  crashguard.reset();
  const t = 1_000_000;
  assert.strictEqual(crashguard.record(t), false);
  assert.strictEqual(crashguard.record(t + 1000), false);
  assert.strictEqual(crashguard.record(t + 2000), true);
});
test('v1.7.3: old crashes are forgotten after ten minutes', () => {
  crashguard.reset();
  const t = 5_000_000;
  crashguard.record(t);
  crashguard.record(t + 1000);
  assert.strictEqual(crashguard.record(t + crashguard.WINDOW_MS + 5000), false, 'the first two are too old to count');
});

// ---- 4. a chat's waiting line has a limit
test('v1.7.3: messages of one chat are still handled in order', async () => {
  const q = createQueues(100);
  const out = [];
  for (let i = 0; i < 5; i++) q.enqueue('A', async () => { await sleep(5 - i); out.push(i); });
  await sleep(60);
  assert.deepStrictEqual(out, [0, 1, 2, 3, 4]);
  assert.strictEqual(q.size(), 0, 'an empty line is forgotten (no memory left behind)');
});
test('v1.7.3: different chats do not wait for each other', async () => {
  const q = createQueues(100);
  const out = [];
  q.enqueue('slow', async () => { await sleep(80); out.push('slow'); });
  q.enqueue('fast', async () => { out.push('fast'); });
  await sleep(120);
  assert.deepStrictEqual(out, ['fast', 'slow']);
});
test('v1.7.3: a flooded chat keeps only the newest messages and drops the oldest', async () => {
  const q = createQueues(3);
  const out = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  q.enqueue('F', () => gate); // the first message is busy
  let dropped = 0;
  for (let i = 1; i <= 6; i++) dropped += q.enqueue('F', async () => { out.push(i); });
  assert.strictEqual(dropped, 3);
  assert.strictEqual(q.waiting('F'), 3, 'never more than the limit waits');
  release();
  await sleep(30);
  assert.deepStrictEqual(out, [4, 5, 6], 'the newest are kept, in order');
});
test('v1.7.3: a task that fails never stops the line', async () => {
  const q = createQueues(10);
  const out = [];
  q.enqueue('E', async () => { throw new Error('boom'); });
  q.enqueue('E', async () => { out.push('after'); });
  await sleep(20);
  assert.deepStrictEqual(out, ['after']);
});

require('./_setup');
const test = require('node:test');
const assert = require('node:assert');

// the bot crashed on start with "Cannot find module './market'" because the scheduler loaded a removed file
test('the scheduler loads and runs the realm jobs of the ticker', async () => {
  const scheduler = require('../core/scheduler');
  const ticker = require('../core/realm/ticker');
  const posted = [];
  ticker.register('scheduler-test', async (post) => post('120363000000000000@g.us', { text: 'hello' }));
  const sock = { sendMessage: async (jid, content) => { posted.push([jid, content.text]); return {}; }, groupMetadata: async () => ({ participants: [] }) };
  await scheduler.checkRealms(sock);
  assert.ok(posted.some(([, t]) => t === 'hello'), 'the job of the ticker ran and posted');
});

test('every module the bot loads at start can be loaded (no missing files)', () => {
  for (const m of ['../core/scheduler', '../core/boot', '../core/sessionid', '../core/setup', '../core/updater']) assert.doesNotThrow(() => require(m), m);
});

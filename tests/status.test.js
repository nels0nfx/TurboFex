require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const status = require('../whatsapp/status');

baileys.setForTests({ generateMessageIDV2: () => 'ID' + Math.random().toString(36).slice(2, 10).toUpperCase() });

const post = (id) => ({ key: { remoteJid: 'status@broadcast', id, participant: '222488650874994@lid', fromMe: false }, message: { imageMessage: {} }, messageTimestamp: Math.floor(Date.now() / 1000) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const makeSock = (refuse = 'none') => {
  const ws = new EventEmitter();
  const log = [];
  const sock = {
    ws, user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sendReceipt: async () => { log.push('view'); }, readMessages: async () => {},
    sendMessage: async (to, c, o) => {
      const list = o.statusJidList;
      log.push(to === 'status@broadcast' ? `list[${list.map((x) => x.split('@')[1]).join(',')}]` : 'direct');
      const bad = (refuse === 'lid' && list && list.every((x) => x.endsWith('@lid'))) || (refuse === 'all' && !!list);
      setTimeout(() => ws.emit(`CB:ack,id:${o.messageId}`, { attrs: { error: bad ? '479' : undefined } }), 5);
      return { key: { id: o.messageId } };
    },
  };
  return { sock, log };
};

test('the view goes out at once, also when a delay is set, and the like uses a LID-only list first', async () => {
  const cfg = store.statusCfg();
  cfg.view = true; cfg.like = true; cfg.delayMin = 1; cfg.delayMax = 1;
  status.settings.likeGapMs = 0;
  const { sock, log } = makeSock();
  const t = Date.now();
  await status.handleStatus(sock, post('S1'));
  await wait(1800);
  assert.strictEqual(log[0], 'view');
  assert.ok(Date.now() - t >= 1000);
  assert.strictEqual(log[1], 'list[lid,lid]');
  assert.strictEqual(status.stats.route, 'status (lid list)');
});
test('when WhatsApp refuses the LID-only list, the next list is tried', async () => {
  const cfg = store.statusCfg();
  cfg.delayMin = 0; cfg.delayMax = 0; cfg.dailyLikeLimit = 0;
  const { sock, log } = makeSock('lid');
  await status.handleStatus(sock, post('S2'));
  await wait(3200);
  assert.strictEqual(log[1], 'list[lid,lid]');
  assert.ok(log[2].startsWith('list[') && log[2] !== 'list[lid,lid]');
  assert.strictEqual(status.stats.route, 'status (mixed list)');
  assert.ok(status.stats.rejected >= 1);
});
test('when every list is refused, the like goes straight to the poster', async () => {
  const { sock, log } = makeSock('all');
  await status.handleStatus(sock, post('S2b'));
  await wait(3200);
  assert.ok(log.includes('direct'));
  assert.strictEqual(status.stats.route, 'direct');
});
test('the daily like limit stops likes but not views', async () => {
  const cfg = store.statusCfg();
  const before = status.likeToday();
  cfg.dailyLikeLimit = before + 1;
  const { sock, log } = makeSock();
  await status.handleStatus(sock, post('S3'));
  await wait(2500);
  await status.handleStatus(sock, post('S4'));
  await wait(2500);
  assert.strictEqual(status.likeToday(), before + 1);
  assert.ok(log.filter((x) => x === 'view').length >= 2);
});
test('statuses older than a day are ignored', async () => {
  const { sock, log } = makeSock();
  const old = post('S5');
  old.messageTimestamp = Math.floor(Date.now() / 1000) - 90000;
  await status.handleStatus(sock, old);
  assert.strictEqual(log.length, 0);
});

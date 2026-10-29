require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const store = require('../whatsapp/store');
const cmdreact = require('../whatsapp/cmdreact');

const make = () => {
  const sent = [];
  return { sent, sock: { sendMessage: async (j, c) => { sent.push(c.react.text); return {}; } }, msg: { key: { remoteJid: 'a@s.whatsapp.net', id: '1' } } };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('on: a quick command gets a tick, a slow one an hourglass first', async () => {
  store.setCmdReact('on');
  let t = make();
  cmdreact.begin(t.sock, t.msg).finish('ok');
  await wait(30);
  assert.deepStrictEqual(t.sent, ['✅']);
  t = make();
  const r = cmdreact.begin(t.sock, t.msg);
  await wait(1100);
  r.finish('ok');
  await wait(30);
  assert.deepStrictEqual(t.sent, ['⏳', '✅']);
});
test('smart: quick commands get nothing, slow ones the hourglass and tick, problems always show', async () => {
  store.setCmdReact('smart');
  let t = make();
  cmdreact.begin(t.sock, t.msg).finish('ok');
  await wait(30);
  assert.deepStrictEqual(t.sent, []);
  t = make();
  cmdreact.begin(t.sock, t.msg).finish('fail');
  await wait(30);
  assert.deepStrictEqual(t.sent, ['❌']);
  t = make();
  const r = cmdreact.begin(t.sock, t.msg);
  await wait(1100);
  r.finish('ok');
  await wait(30);
  assert.deepStrictEqual(t.sent, ['⏳', '✅']);
});
test('off: no reactions at all', async () => {
  store.setCmdReact('off');
  const t = make();
  cmdreact.begin(t.sock, t.msg).finish('fail');
  await wait(30);
  assert.deepStrictEqual(t.sent, []);
});

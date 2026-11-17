require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const context = require('../whatsapp/context');
const intent = require('../whatsapp/intent');
const resilience = require('../core/resilience');

baileys.setForTests({});
store.setCmdReact('off');

const OWNER = '27800000001@s.whatsapp.net';
const sent = [];
const sock = {
  user: { id: '27899999999:1@s.whatsapp.net' },
  sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
  groupMetadata: async () => ({ subject: 'G', participants: [] }),
};
let n = 0;
const msg = (from, text) => ({ key: { remoteJid: from, id: `V${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
const texts = () => sent.filter((s) => s.c.text).map((s) => s.c.text);
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 60)); };
const say = async (from, text) => { await handler.handleMessage(sock, msg(from, text)); await settle(); };
const stranger = (i) => `2781000${String(1000 + i)}@s.whatsapp.net`;
const reset = () => { sent.length = 0; context.reset(); resilience.reset(); };

test('spelling: a mistyped command finds the real one, nothing close finds nothing, two equal guesses find nothing', () => {
  const names = new Map([['menu', { name: 'menu' }], ['ping', { name: 'ping' }], ['pong', { name: 'pong' }], ['weather', { name: 'weather' }]]);
  assert.strictEqual(intent.suggest('mneu', names, () => true).name, 'menu'); // two letters swapped
  assert.strictEqual(intent.suggest('weathr', names, () => true).name, 'weather'); // a letter missing
  assert.strictEqual(intent.suggest('menuu', names, () => true).name, 'menu'); // a letter too many
  assert.strictEqual(intent.suggest('xyzabc', names, () => true), null);
  assert.strictEqual(intent.suggest('pang', names, () => true), null, 'ping and pong are equally close');
  assert.strictEqual(intent.suggest('mneu', names, (c) => c.name !== 'menu'), null, 'a command the person may not use is never suggested');
  assert.strictEqual(intent.suggest('me', names, () => true), null, 'too short to guess');
  assert.strictEqual(intent.suggest('menu', names, () => true), null, 'a real command is not corrected');
  assert.strictEqual(intent.distance('kitten', 'sitting'), 3);
});

test('a mistyped command: the owner is asked, answers yes without a prefix, and the corrected command runs', async () => {
  reset();
  await say(OWNER, '.mneu');
  const q = texts().find((t) => t.includes('Did you mean'));
  assert.ok(q && q.includes('.menu') && /yes/.test(q) && /no/.test(q), q);
  assert.ok(!texts().some((t) => t.includes('ᴘɪɴɢ')), 'nothing ran before the answer');
  sent.length = 0;
  await say(OWNER, 'yes');
  assert.ok(texts().some((t) => t.includes('ᴘɪɴɢ')), 'the menu ran after yes');
});

test('answering no cancels, and a yes with nothing waiting is just chat', async () => {
  reset();
  await say(OWNER, '.pnig');
  assert.ok(texts().some((t) => t.includes('.ping')));
  sent.length = 0;
  await say(OWNER, 'no');
  assert.ok(texts().some((t) => /leave it/.test(t)));
  assert.ok(!texts().some((t) => t.includes('Pong')));
  sent.length = 0;
  await say(OWNER, 'yes'); // nothing is waiting any more
  assert.strictEqual(sent.length, 0);
});

test('the question expires, and the correction keeps the rest of the command', async () => {
  reset();
  await say(OWNER, '.pnig now');
  assert.ok(texts().some((t) => t.includes('.ping now')));
  sent.length = 0;
  await say(OWNER, 'yes');
  assert.ok(texts().some((t) => t.includes('Pong')));
  reset();
  await say(OWNER, '.pnig');
  const realNow = Date.now; Date.now = () => realNow() + 120000;
  try { sent.length = 0; await say(OWNER, 'yes'); } finally { Date.now = realNow; }
  assert.strictEqual(sent.length, 0, 'a yes after a minute does nothing');
});

test('permissions: strangers get no suggestion in private mode, members get one without yes/no, owner-only commands are never offered', async () => {
  reset();
  store.setMode('private');
  await say(stranger(1), '.pnig');
  assert.strictEqual(sent.length, 0, 'private mode: no answer at all');
  store.setMode('public');
  await say(stranger(2), '.pnig');
  const t = texts().find((x) => x.includes('Did you mean'));
  assert.ok(t && t.includes('.ping') && !/yes/i.test(t), t);
  sent.length = 0; context.reset();
  await say(stranger(3), '.updat'); // update is owner only
  assert.strictEqual(sent.length, 0);
  store.setMode('private');
});

test('it stays quiet when nothing is close, when switched off, and it cannot be made to talk a lot', async () => {
  reset();
  await say(OWNER, '.qwertyzx');
  assert.strictEqual(sent.length, 0);
  await say(OWNER, '.autocorrect off');
  sent.length = 0;
  await say(OWNER, '.mneu');
  assert.strictEqual(sent.length, 0, 'autocorrect off');
  await say(OWNER, '.autocorrect on');
  reset();
  await say(OWNER, '.mneu'); await say(OWNER, '.pnig'); await say(OWNER, '.mneu');
  assert.strictEqual(texts().filter((x) => x.includes('Did you mean')).length, 1, 'one offer every few seconds per chat');
});

test('again repeats the last command, says so when there is nothing to repeat, and refuses commands that change things', async () => {
  reset();
  await say(OWNER, '.again');
  assert.ok(texts().some((x) => /Nothing to repeat/.test(x)));
  sent.length = 0;
  await say(OWNER, '.ping');
  await say(OWNER, '.again');
  assert.strictEqual(texts().filter((x) => x.includes('Pong')).length, 2, 'ping ran twice');
  sent.length = 0;
  await say(OWNER, '.autocorrect on'); // an owner setting: not repeatable
  await say(OWNER, '.redo');
  assert.ok(texts().some((x) => /cannot be repeated/.test(x)));
});

test('again uses the checks of the real command: a stranger cannot repeat his way into private mode', async () => {
  reset();
  store.setMode('private');
  await say(stranger(4), '.again');
  assert.strictEqual(sent.length, 0);
});

test('failures: temporary and real problems are told apart', () => {
  assert.strictEqual(resilience.classify(new Error('connect ETIMEDOUT 1.2.3.4:443')), 'temporary');
  assert.strictEqual(resilience.classify(Object.assign(new Error('x'), { status: 503 })), 'temporary');
  assert.strictEqual(resilience.classify(new Error('fetch failed')), 'temporary');
  assert.strictEqual(resilience.classify(new Error('Cannot read properties of undefined')), 'bug');
});

test('a lookup that fails for a temporary reason is tried once more, quietly; a real bug is not', async () => {
  reset();
  resilience.configure({ retryMs: 5 });
  const cmd = handler.resolveCommand('weather'); const real = cmd.run; let calls = 0;
  try {
    cmd.run = async ({ reply }) => { calls++; if (calls === 1) throw new Error('fetch failed'); await reply('sunny'); };
    await say(OWNER, '.weather lagos');
    assert.strictEqual(calls, 2); assert.deepStrictEqual(texts().filter((x) => /sunny|went wrong|not answering/.test(x)), ['sunny']);
    calls = 0; sent.length = 0;
    cmd.run = async () => { calls++; throw new Error('Cannot read properties of undefined'); };
    await say(OWNER, '.weather lagos');
    assert.strictEqual(calls, 1); assert.ok(texts().some((x) => /Something went wrong/.test(x)));
    calls = 0; sent.length = 0;
    cmd.run = async () => { calls++; throw new Error('connect ETIMEDOUT'); };
    await say(OWNER, '.weather lagos');
    assert.strictEqual(calls, 2); assert.ok(texts().some((x) => /not answering/.test(x)), 'a calm message for a temporary problem');
  } finally { cmd.run = real; resilience.configure({ retryMs: 1200 }); }
});

test('a command that fails again and again rests; the owner is told once and can still use it; it recovers by itself', async () => {
  reset();
  resilience.configure({ restMs: 900 });
  store.setMode('public');
  const cmd = handler.resolveCommand('reverse'); const real = cmd.run; let boom = true; let calls = 0;
  try {
    cmd.run = async ({ reply }) => { calls++; if (boom) throw new Error('Cannot read properties of undefined'); await reply('ok-again'); };
    for (let i = 0; i < 5; i++) await say(stranger(10 + i), '.reverse hello');
    const toOwner = sent.filter((s) => s.j !== stranger(10) && s.c.text && /resting for/.test(s.c.text));
    assert.ok(sent.some((s) => /resting for/.test(s.c.text || '') && s.j.startsWith('27800000001')) || toOwner.length >= 1, 'the owner was told');
    assert.strictEqual(calls, 5);
    sent.length = 0;
    await say(stranger(20), '.reverse hello'); await say(stranger(21), '.reverse hello');
    assert.strictEqual(calls, 5, 'it did not run while resting');
    assert.strictEqual(texts().filter((x) => /resting/.test(x)).length, 1, 'only the first person is told');
    assert.deepStrictEqual(resilience.summary().resting.map((x) => x.name), ['reverse']);
    await say(OWNER, '.reverse hello'); assert.strictEqual(calls, 6, 'the owner can still use it');
    boom = false; calls = 0; sent.length = 0;
    await new Promise((r) => setTimeout(r, 1000));
    await say(stranger(22), '.reverse hello');
    assert.strictEqual(calls, 1); assert.ok(texts().includes('ok-again'), 'it works again after the rest');
    assert.deepStrictEqual(resilience.summary().resting, []);
  } finally { cmd.run = real; resilience.configure({ restMs: 3 * 60 * 1000 }); store.setMode('private'); }
});

test('the status command shows what is failing right now', async () => {
  reset();
  resilience.fail('weather', 'bug', 'boom one'); resilience.fail('weather', 'bug', 'boom two');
  await say(OWNER, '.status');
  assert.ok(texts().some((x) => /Failing lately: weather ×2/.test(x)));
});

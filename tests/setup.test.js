require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setup = require('../core/setup');

const fresh = () => ({ sessionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tfx-session-')), number: '', ownerNumber: '', pairingNumber: '', pairMethod: '', legacyOwner: false, consoleLink: true });
const talk = (answers, asked = []) => ({ ask: async (q) => { asked.push(q); return answers.length ? answers.shift() : null; }, close() {} });

test('first start: asks for the number, then for pairing code or QR, and the number is both the bot and the owner', async () => {
  const cfg = fresh();
  const asked = [];
  await setup.ensure(cfg, talk(['+234 801 234 5678', '1'], asked));
  assert.deepStrictEqual(asked, ['Number: ', 'Choose 1 or 2: ']);
  assert.strictEqual(cfg.number, '2348012345678');
  assert.strictEqual(cfg.ownerNumber, '2348012345678', 'the owner is the same number');
  assert.strictEqual(cfg.pairingNumber, '2348012345678');
  assert.strictEqual(cfg.pairMethod, 'code');
  assert.strictEqual(JSON.parse(fs.readFileSync(setup.FILE, 'utf8')).number, '2348012345678', 'saved for the next start');
});
test('first start: choosing 2 means the QR code', async () => {
  const cfg = fresh();
  await setup.ensure(cfg, talk(['27821234567', 'x', '2']));
  assert.strictEqual(cfg.pairMethod, 'qr');
});
test('first start: a wrong number is asked again', async () => {
  const cfg = fresh();
  const asked = [];
  await setup.ensure(cfg, talk(['123', 'abc', '27821234567', '2'], asked));
  assert.strictEqual(cfg.number, '27821234567');
  assert.strictEqual(asked.filter((q) => q === 'Number: ').length, 3);
});
test('a number from the settings is not asked again, only the method', async () => {
  const cfg = { ...fresh(), number: '27821234567', ownerNumber: '27821234567', pairingNumber: '27821234567' };
  const asked = [];
  await setup.ensure(cfg, talk(['1'], asked));
  assert.deepStrictEqual(asked, ['Choose 1 or 2: ']);
  assert.strictEqual(cfg.pairMethod, 'code');
});
test('number and method both set: nothing is asked', async () => {
  const cfg = { ...fresh(), number: '27821234567', pairMethod: 'qr' };
  const asked = [];
  await setup.ensure(cfg, talk([], asked));
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(cfg.ownerNumber, '27821234567');
});
test('a bot that is already linked asks nothing, and learns its number from the login', async () => {
  const cfg = fresh();
  fs.writeFileSync(path.join(cfg.sessionDir, 'creds.json'), JSON.stringify({ registered: true, me: { id: '27831112222:5@s.whatsapp.net' } }));
  const asked = [];
  await setup.ensure(cfg, talk([], asked));
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(cfg.number, '27831112222');
  assert.strictEqual(cfg.ownerNumber, '27831112222');
});
test('nobody can answer: the bot still starts (QR, no owner)', async () => {
  const cfg = fresh();
  await setup.ensure(cfg, talk([]));
  assert.strictEqual(cfg.number, '');
  assert.strictEqual(cfg.pairMethod, '');
});
test('an older setup with its own OWNER_NUMBER keeps that owner', async () => {
  const cfg = { ...fresh(), legacyOwner: true, ownerNumber: '27800000001' };
  await setup.ensure(cfg, talk(['27821234567', '2']));
  assert.strictEqual(cfg.ownerNumber, '27800000001');
  assert.strictEqual(cfg.number, '27821234567');
});

// ----- the normal way: the pairing site. Nothing is asked in the console.
test('site mode: no login and no console link -> nothing is asked, the bot waits for a session ID', async () => {
  const cfg = { ...fresh(), consoleLink: false };
  const asked = [];
  const res = await setup.ensure(cfg, talk(['27821234567', '1'], asked));
  assert.deepStrictEqual(asked, [], 'no question about a number or a pairing code');
  assert.strictEqual(res.needsSession, true);
  assert.strictEqual(cfg.number, '');
  assert.strictEqual(cfg.pairMethod, '');
});
test('site mode: a linked bot starts as before', async () => {
  const cfg = { ...fresh(), consoleLink: false };
  fs.writeFileSync(path.join(cfg.sessionDir, 'creds.json'), JSON.stringify({ registered: true, me: { id: '27831112222:5@s.whatsapp.net' } }));
  const res = await setup.ensure(cfg, talk([]));
  assert.strictEqual(res.linked, true);
  assert.strictEqual(cfg.ownerNumber, '27831112222');
});
test('a login from the site decides the number and the owner, also when an older number was saved', () => {
  const cfg = { ...fresh(), consoleLink: false, number: '27800000009', ownerNumber: '27800000009', pairingNumber: '27800000009' };
  fs.writeFileSync(path.join(cfg.sessionDir, 'creds.json'), JSON.stringify({ registered: true, me: { id: '27831112222:5@s.whatsapp.net' } }));
  assert.strictEqual(setup.adoptLinkedNumber(cfg), true);
  assert.strictEqual(cfg.number, '27831112222');
  assert.strictEqual(cfg.ownerNumber, '27831112222');
  assert.strictEqual(JSON.parse(fs.readFileSync(setup.FILE, 'utf8')).number, '27831112222');
});
test('the instructions name the site and the SESSION_ID setting, and never ask for a number', () => {
  const t = setup.helpText({ pairSiteUrl: 'https://pair.example.com/', sessionIdFile: '/bot/session_id.txt' }, 'logged-out');
  assert.match(t, /https:\/\/pair\.example\.com(?!\/)/);
  assert.match(t, /SESSION_ID/);
  assert.match(t, /session_id\.txt/);
  assert.match(t, /RESTART/);
  assert.match(t, /logged this bot out/);
  assert.doesNotMatch(t, /Number:|Choose 1 or 2/);
});
test('the config only allows console linking when CONSOLE_LINK is set', () => {
  const { execFileSync } = require('child_process');
  const read = (env) => JSON.parse(execFileSync(process.execPath, ['-e', "const c=require('./config');console.log(JSON.stringify({l:c.consoleLink,m:c.pairMethod}))"], { cwd: path.join(__dirname, '..'), env: { ...process.env, TURBOFEX_DATA: require('os').tmpdir(), ...env } }).toString());
  assert.deepStrictEqual(read({ PAIR_METHOD: 'code', CONSOLE_LINK: '' }), { l: false, m: '' });
  assert.deepStrictEqual(read({ PAIR_METHOD: 'code', CONSOLE_LINK: '1' }), { l: true, m: 'code' });
});

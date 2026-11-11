require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const accounts = require('../core/accounts');
const sessionid = require('../core/sessionid');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-auto-'));
const A = 'TFX-K7M2-9QXA-4BNP';
const B = 'TFX-AB2C-DE3F-GH4J';
const C = 'TFX-ZZ22-3344-5566';

test('v1.4.2: every session ID in a text is found, with the name written before it', () => {
  const found = sessionid.parseIds(`# note\nSESSION_ID=${A}\nshop=${B}\n${B}\nexport SESSION_ID_TWO="${C}"\nnonsense\n`);
  assert.deepStrictEqual(found, [{ id: A, label: '' }, { id: B, label: 'shop' }, { id: C, label: 'two' }]);
  assert.strictEqual(sessionid.readFile(path.join(tmp(), 'none.txt')), '', 'a missing file is no ID');
});

test('v1.4.2: a second session ID in session_id.txt makes a new account by itself, and it is remembered', () => {
  const root = tmp();
  const file = path.join(root, 'session_id.txt');
  fs.writeFileSync(file, `SESSION_ID=${A}\n`);
  assert.strictEqual(accounts.load(root, {}), null, 'one ID: the bot works as before');

  fs.writeFileSync(file, `SESSION_ID=${A}\nshop=${B}\n${C}\n`);
  const plan = accounts.load(root, {});
  assert.deepStrictEqual(plan.accounts.map((a) => a.name), ['main', 'shop', 'account2']);
  assert.strictEqual(plan.notes.length, 2, 'the person is told about each new account');
  const [main, shop, two] = plan.accounts;
  assert.strictEqual(main.sessionId, A);
  assert.strictEqual(shop.sessionDir, path.join(root, 'accounts', 'shop', 'session'));
  const envMain = accounts.envFor(main, 0, { SESSION_ID: 'x' });
  assert.strictEqual(envMain.SESSION_ID, A);
  assert.strictEqual(envMain.TURBOFEX_ID_ASSIGNED, '1', 'main does not read the lines of the other accounts');
  const envShop = accounts.envFor(shop, 1, {});
  assert.strictEqual(envShop.SESSION_ID, '', 'the ID of shop goes in its own file, not in the environment');
  accounts.prepare(shop);
  accounts.prepare(two);
  assert.strictEqual(sessionid.readFile(shop.sessionIdFile), B);
  assert.strictEqual(sessionid.readFile(two.sessionIdFile), C);

  // the next start: nothing new, the same accounts, nobody is told again
  const again = accounts.load(root, {});
  assert.deepStrictEqual(again.accounts.map((a) => a.name), ['main', 'shop', 'account2']);
  assert.deepStrictEqual(again.notes, []);

  // a line removed from the file: that account keeps running with its own saved login
  fs.writeFileSync(file, `SESSION_ID=${A}\n`);
  assert.deepStrictEqual(accounts.load(root, {}).accounts.map((a) => a.name), ['main', 'shop', 'account2']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.4.2: the ID the main account already used stays main, a bot that is not linked yet gives its first ID to main', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'session'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'session-id.json'), JSON.stringify({ hash: sessionid.hashOf(B) }));
  fs.writeFileSync(path.join(root, 'session', 'creds.json'), JSON.stringify({ registered: true }));
  // main is linked with B; the person puts a NEW ID above it
  fs.writeFileSync(path.join(root, 'session_id.txt'), `${A}\n${B}\n`);
  const plan = accounts.load(root, {});
  assert.strictEqual(plan.accounts.find((a) => a.main).sessionId, B);
  assert.strictEqual(plan.accounts.find((a) => a.name === 'account2').sessionId, A);
  fs.rmSync(root, { recursive: true, force: true });

  const fresh = tmp();
  fs.writeFileSync(path.join(fresh, 'session_id.txt'), `${A}\n${B}\n`);
  const p2 = accounts.load(fresh, {});
  assert.strictEqual(p2.accounts.find((a) => a.main).sessionId, A, 'nothing linked yet: the first ID is the main account');
  assert.deepStrictEqual(p2.accounts.map((a) => a.name), ['main', 'account2']);
  fs.rmSync(fresh, { recursive: true, force: true });
});

test('v1.4.2: several IDs in the SESSION_ID variable of a host work too', () => {
  const root = tmp();
  const plan = accounts.load(root, { SESSION_ID: `${A}, ${B}` });
  assert.deepStrictEqual(plan.accounts.map((a) => a.name), ['main', 'account2']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.4.2: main only uses its own ID when the file has several (a new ID can never replace the main login)', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'session_id.txt'), `${B}\n${A}\n`);
  const cfg = { sessionId: '', sessionIdFile: path.join(dir, 'session_id.txt'), sessionDir: path.join(dir, 'session'), pairSiteUrl: 'https://pair.test' };
  process.env.TURBOFEX_ID_ASSIGNED = '1';
  const logs = [];
  try {
    assert.strictEqual(await sessionid.restore(cfg, (t) => logs.push(t), async () => { throw new Error('must not ask the site'); }), 'skipped');
  } finally {
    delete process.env.TURBOFEX_ID_ASSIGNED;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// the real launcher with a stand-in bot: the file gets a second line while it runs, then a third
test('v1.4.2: the launcher starts a new account when an ID is added while it runs, without restarting the others', { timeout: 120000 }, async () => {
  const dir = tmp();
  for (const f of ['index.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.cpSync(path.join(ROOT, 'core'), path.join(dir, 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'core', 'integrity.js'), 'module.exports = { enforce() {} };\n');
  fs.writeFileSync(path.join(dir, 'core', 'boot.js'), `
exports.start = async () => {
  console.log('HELLO ' + (process.env.ACCOUNT_NAME || 'single') + ' id=' + (process.env.SESSION_ID || '-') + ' assigned=' + (process.env.TURBOFEX_ID_ASSIGNED || '0') + ' pid=' + process.pid);
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => process.exit(0));
};
`);
  const file = path.join(dir, 'session_id.txt');
  fs.writeFileSync(file, `SESSION_ID=${A}\n`);
  const child = spawn(process.execPath, ['index.js'], { cwd: dir, env: { PATH: process.env.PATH, TURBOFEX_DATA: '' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const until = async (re, ms = 60000) => { const t = Date.now(); while (!re.test(out)) { if (Date.now() - t > ms) throw new Error(`timeout waiting for ${re}\n${out}`); await new Promise((r) => setTimeout(r, 200)); } };
  try {
    await until(/HELLO single/);
    await new Promise((r) => setTimeout(r, 1200)); // the file time changes (a file watcher compares times)
    fs.appendFileSync(file, `shop=${B}\n`);
    await until(/\[shop\] HELLO shop id=- assigned=0/); // one account became two
    assert.match(out, /Several accounts now/);
    assert.match(out, /\[main\] HELLO main id=TFX-K7M2-9QXA-4BNP assigned=1/);
    assert.strictEqual(sessionid.readFile(path.join(dir, 'accounts', 'shop', 'session_id.txt')), B);
    const mainPid = /\[main\] HELLO main .* pid=(\d+)/.exec(out)[1];
    await new Promise((r) => setTimeout(r, 1200));
    fs.appendFileSync(file, `${C}\n`);
    await until(/\[account2\] HELLO account2/);
    assert.ok(!/Restarting all accounts/.test(out), 'the running accounts were not restarted');
    assert.strictEqual(out.match(/\[main\] HELLO main/g).length, 1, 'main was started once');
    assert.ok(mainPid);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

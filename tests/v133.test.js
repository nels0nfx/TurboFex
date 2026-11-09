require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const accounts = require('../core/accounts');
const envfile = require('../core/envfile');
const hostport = require('../core/hostport');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'turbofex-acc-'));

test('v1.3.3: no accounts set up = the bot starts the old single way', () => {
  const root = tmp();
  assert.strictEqual(accounts.load(root, {}), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.3: accounts from accounts.json: main keeps the old places, the others get their own folders', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'accounts.json'), JSON.stringify({ accounts: [{ name: 'Main' }, { name: 'shop', prefix: '!', timezone: 'Africa/Lagos' }, 'bad name', { name: 'shop' }, { name: 'off', enabled: false }] }));
  const plan = accounts.load(root, { SESSION_ID_SHOP: 'TFX-AAAA-BBBB-CCCC' });
  assert.deepStrictEqual(plan.accounts.map((a) => a.name), ['main', 'shop']);
  assert.strictEqual(plan.problems.length, 2, 'the bad name and the double name are reported');
  const [main, shop] = plan.accounts;
  assert.strictEqual(main.dataDir, path.join(root, 'data'));
  assert.strictEqual(main.sessionDir, path.join(root, 'session'));
  assert.strictEqual(main.sessionIdFile, path.join(root, 'session_id.txt'));
  assert.strictEqual(shop.dataDir, path.join(root, 'accounts', 'shop', 'data'));
  assert.strictEqual(shop.sessionDir, path.join(root, 'accounts', 'shop', 'session'));
  assert.strictEqual(shop.sessionId, 'TFX-AAAA-BBBB-CCCC', 'the SESSION_ID_SHOP variable is the login of "shop"');
  const base = { SESSION_ID: 'TFX-MAIN-MAIN-MAIN', NUMBER: '27800000001', PATH: process.env.PATH };
  const em = accounts.envFor(main, 0, base);
  const es = accounts.envFor(shop, 1, base);
  assert.strictEqual(em.SESSION_ID, 'TFX-MAIN-MAIN-MAIN', 'main keeps its own login variables');
  assert.strictEqual(em.TURBOFEX_NO_UPDATE, undefined, 'the first account updates the shared files');
  assert.strictEqual(es.SESSION_ID, 'TFX-AAAA-BBBB-CCCC');
  assert.strictEqual(es.NUMBER, '', 'the number of main is never handed to shop');
  assert.strictEqual(es.TURBOFEX_NO_UPDATE, '1');
  assert.strictEqual(es.BOT_PREFIX, '!');
  assert.strictEqual(es.TIMEZONE, 'Africa/Lagos');
  assert.strictEqual(es.TURBOFEX_DATA, shop.dataDir);
  accounts.prepare(shop);
  assert.ok(fs.existsSync(shop.sessionIdFile), 'every account gets its own session_id.txt, ready to paste in');
  assert.ok(fs.existsSync(shop.sessionDir));
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.3: accounts from the ACCOUNTS variable, and a broken accounts.json is reported', () => {
  const root = tmp();
  assert.deepStrictEqual(accounts.load(root, { ACCOUNTS: 'main, two;three' }).accounts.map((a) => a.name), ['main', 'two', 'three']);
  fs.writeFileSync(path.join(root, 'accounts.json'), '{ nope');
  const plan = accounts.load(root, {});
  assert.strictEqual(plan.accounts, null);
  assert.match(plan.problems[0], /not valid JSON/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.3: config.env never gives an extra account the login of the main one', () => {
  const root = tmp();
  const file = path.join(root, 'config.env');
  fs.writeFileSync(file, 'SESSION_ID=TFX-MAIN-MAIN-MAIN\nNUMBER=27800000001\nTIMEZONE=Africa/Lagos\n');
  const env = { TURBOFEX_ISOLATED: '1', SESSION_ID: '', NUMBER: '' };
  envfile.load(file, env);
  assert.strictEqual(env.SESSION_ID, '');
  assert.strictEqual(env.NUMBER, '');
  assert.strictEqual(env.TIMEZONE, 'Africa/Lagos', 'the other settings still apply');
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.3: Termux sets PREFIX to a folder path; the bot ignores it and BOT_PREFIX / config.env still work', () => {
  const run = (env) => require('child_process').execFileSync(process.execPath, ['-e', "console.log(require('./config').prefix)"], { cwd: ROOT, env: { PATH: process.env.PATH, TURBOFEX_DATA: process.env.TURBOFEX_DATA, ...env } }).toString().trim();
  assert.strictEqual(run({ PREFIX: '/data/data/com.termux/files/usr' }), '.');
  assert.strictEqual(run({ PREFIX: '/data/data/com.termux/files/usr', BOT_PREFIX: '!' }), '!');
  assert.strictEqual(run({ PREFIX: '#' }), '#');
  const env = { PREFIX: '/data/data/com.termux/files/usr' };
  const root = tmp();
  const file = path.join(root, 'config.env');
  fs.writeFileSync(file, 'PREFIX=!\n');
  envfile.load(file, env);
  assert.strictEqual(env.BOT_PREFIX, '!', 'PREFIX in config.env becomes BOT_PREFIX on Termux');
  fs.rmSync(root, { recursive: true, force: true });
});

test('v1.3.3: the status page for hosts that need an open port', async () => {
  assert.strictEqual(hostport.start({ port: '' }), null, 'no PORT: nothing is opened');
  assert.strictEqual(hostport.start({ port: 'abc' }), null);
  const server = hostport.start({ port: 38417, info: () => ({ bot: 'TurboFex', accounts: 2 }) });
  await new Promise((r) => setTimeout(r, 200));
  const body = await new Promise((resolve, reject) => http.get('http://127.0.0.1:38417/', (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d)); }).on('error', reject));
  assert.deepStrictEqual(JSON.parse(body), { status: 'running', bot: 'TurboFex', accounts: 2 });
  server.close();
});

// the real launcher (index.js) with a small stand-in for the bot: every account becomes its own process with its own folders
test('v1.3.3: the launcher runs every account as its own process and restarts all of them together', { timeout: 60000 }, async () => {
  const dir = tmp();
  for (const f of ['index.js', 'package.json']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.cpSync(path.join(ROOT, 'core'), path.join(dir, 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'core', 'integrity.js'), 'module.exports = { enforce() {} };\n');
  fs.writeFileSync(path.join(dir, 'core', 'boot.js'), `
const fs = require('fs');
exports.start = async () => {
  const n = process.env.ACCOUNT_NAME;
  const marker = process.env.TURBOFEX_DATA + '/runs.txt';
  fs.mkdirSync(process.env.TURBOFEX_DATA, { recursive: true });
  const runs = (fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0) + 1;
  fs.writeFileSync(marker, String(runs));
  console.log('HELLO ' + n + ' run ' + runs + ' noupdate=' + (process.env.TURBOFEX_NO_UPDATE || '0') + ' session=' + process.env.SESSION_DIR.split('/').slice(-2).join('/'));
  if (n === 'two' && runs === 1) setTimeout(() => process.exit(42), 800); // asks for a restart (an update)
  else setInterval(() => {}, 1000);
  process.on('SIGTERM', () => process.exit(0));
};
`);
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify(['main', 'two']));
  const child = spawn(process.execPath, ['index.js'], { cwd: dir, env: { PATH: process.env.PATH, TURBOFEX_DATA: '' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const until = async (re, ms = 40000) => { const t = Date.now(); while (!re.test(out)) { if (Date.now() - t > ms) throw new Error(`timeout waiting for ${re}\n${out}`); await new Promise((r) => setTimeout(r, 200)); } };
  try {
    await until(/\[two\] HELLO two run 2/); // two asked for a restart: BOTH start again
    assert.match(out, /\[main\] HELLO main run 1 noupdate=0/);
    assert.match(out, /\[two\] HELLO two run 1 noupdate=1 session=two\/session/);
    await until(/\[main\] HELLO main run 2/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  assert.ok(fs.existsSync(path.join(dir, 'accounts', 'two', 'session_id.txt')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'data', 'runs.txt'), 'utf8'), '2');
  fs.rmSync(dir, { recursive: true, force: true });
});

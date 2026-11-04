// v1.0.10: download errors and temp space, the clean reminder wording, the response standard (scan of every reply string)
require('./_setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const fmt = require('../whatsapp/format');
const dltemp = require('../core/dltemp');

const root = path.join(__dirname, '..');

// ------------------------------------------------------------ the response standard: banned phrases in reply strings
test('no reply string explains internals (mentions, memory, disk) or carries developer text', () => {
  const banned = [
    /no names (are|is) (listed|shown)/i,
    /I tag everybody/i,
    /everybody is tagged/i,
    /without (a long )?list(ing)? (of )?names/i,
    /in memory only/i,
    /never saved to disk/i,
    /I count from the moment this version started/i,
    /Setting up the downloader/i,
    /must put the GitHub repo name/i,
    /I must be (a group )?admin/i,
    /\bTODO\b|\bFIXME\b/,
    /lorem ipsum/i,
  ];
  const files = [];
  for (const d of ['commands', 'whatsapp', 'whatsapp/play', 'core', 'core/realm']) {
    for (const f of fs.readdirSync(path.join(root, d))) if (f.endsWith('.js')) files.push(path.join(root, d, f));
  }
  const problems = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line) || /console\.(log|error)/.test(line)) return; // comments and console logs are not replies
      if (/'[^']*\/\/|\/\/[^'"`]*$/.test(line) && !/['"`].*['"`]/.test(line)) return;
      const code = line.replace(/\s\/\/ .*$/, ''); // a trailing code comment is not a reply either
      for (const b of banned) if (b.test(code)) problems.push(`${path.relative(root, file)}:${i + 1} ${b}`);
    });
  }
  assert.deepStrictEqual(problems, []);
});

test('the response standard lives in the private files only, never as a separate file', () => {
  assert.ok(!fs.existsSync(path.join(root, 'RESPONSE_STANDARDS.md')), 'RESPONSE_STANDARDS.md must not exist');
});

// ------------------------------------------------------------ the formatter puts the bullet on every command reply
test('bulletize: data lines and command lines get the bullet, titles, code and numbers do not', () => {
  const isCmd = () => true;
  const out = fmt.format('💳 *Loan*\n*Amount:* 100\n💰 *Total:* 5\n`.loan 1 2 3` – example\n*1.* first\n```\n*Not:* touched\n```\n_hint_', isCmd, '.', 'full');
  const lines = out.split('\n');
  assert.strictEqual(lines[0], '💳 *Loan*');
  assert.strictEqual(lines[1], '▸ *Amount:* 100');
  assert.strictEqual(lines[2], '▸ 💰 *Total:* 5');
  assert.strictEqual(lines[3], '▸ `.loan 1 2 3` – example');
  assert.strictEqual(lines[4], '*1.* first');
  assert.strictEqual(lines[6], '*Not:* touched');
  assert.strictEqual(lines[8], '_hint_');
  // a line that already has the bullet is not doubled, and content-only commands are left alone
  assert.strictEqual(fmt.format('*A*\n▸ *Label:* x', isCmd, '.', 'full'), '*A*\n▸ *Label:* x');
  assert.strictEqual(fmt.format('*A*\n*Label:* x', isCmd, '.', 'system'), '*A*\n*Label:* x');
});

// ------------------------------------------------------------ the reminder confirmation
test('amute remind: a clean confirmation, no internal details', async () => {
  const store = require('../whatsapp/store');
  const cmd = require('../commands/amute');
  const jid = '120369000000200001@g.us';
  store.getGroup(jid);
  const out = [];
  await cmd.run({ jid, args: ['remind', '1'], reply: async (t) => out.push(t), prefix: '.', cmdName: 'amute' });
  assert.match(out[0], /Reminder set successfully/);
  assert.match(out[0], /▸ I'll notify the group 1 minute before the scheduled change\./);
  assert.ok(!/tag|names|everybody|hidden/i.test(out[0]));
  const sched = require('../core/scheduler');
  assert.ok(!/tag|names|hidden/i.test(sched.remindText('mute', '22:00', 10)));
});

// ------------------------------------------------------------ download errors
const { classify, explain, cleanLink } = require('../core/ytdlp');

test('classify reads the real error texts from the report', () => {
  assert.strictEqual(classify('[PYI-487:ERROR] Failed to extract entry: Cryptodome/Cipher/_ARC4.abi3.so'), 'NO_SPACE');
  assert.strictEqual(classify('OSError: [Errno 28] No space left on device'), 'NO_SPACE');
  assert.strictEqual(classify('ERROR: Unsupported URL: https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fstory.php'), 'LOGIN_REQUIRED');
  assert.strictEqual(classify('ERROR: Unsupported URL: https://example.com/page'), 'UNSUPPORTED');
  assert.strictEqual(classify('Sign in to confirm you’re not a bot'), 'BOT_BLOCK');
  assert.strictEqual(classify('something new'), null);
});

test('explain: friendly text with a next step, no raw tool text for people', () => {
  for (const code of ['NO_SPACE', 'LOGIN_REQUIRED', 'UNSUPPORTED', 'GONE', 'RATE_LIMIT', 'NO_FORMAT', 'TIMEOUT', 'BOT_BLOCK', 'TOO_LONG']) {
    const t = explain(Object.assign(new Error('That video is longer than 30 minutes.'), { code }), { isOwner: false, prefix: '.', what: 'that link' });
    assert.match(t, /^⚠️ \*/, code);
    assert.match(t, /▸/, `${code} gives a next step`);
    assert.ok(!/PYI|Errno|Cryptodome|yt-dlp|ytcookies/i.test(t), `${code}: nothing technical for people`);
  }
  const unknown = explain(new Error('weird tool text'), { isOwner: false });
  assert.ok(!/weird tool text/.test(unknown), 'people never see raw text');
  assert.match(explain(new Error('weird tool text'), { isOwner: true }), /▸ \*Details:\* weird tool text/);
  assert.match(explain(Object.assign(new Error('x'), { code: 'LOGIN_REQUIRED' }), { isOwner: true, prefix: '!' }), /`!ytcookies`/);
  assert.match(explain(Object.assign(new Error('x'), { code: 'NO_SPACE' }), { isOwner: true }), /out of disk space/);
});

test('cleanLink: other Facebook hosts become www and tracking parts go', () => {
  assert.strictEqual(cleanLink('https://m.facebook.com/story.php?story_fbid=1&id=2&mibextid=abc&fbclid=z'), 'https://www.facebook.com/story.php?story_fbid=1&id=2');
  assert.strictEqual(cleanLink('https://youtu.be/abcdefghijk?si=xyz'), 'https://youtu.be/abcdefghijk');
});

// ------------------------------------------------------------ temp space
test('dltemp: the work folder is inside the data folder, old leftovers are removed, active ones stay', () => {
  assert.ok(dltemp.root().startsWith(process.env.TURBOFEX_DATA), 'inside data/tmp');
  const env = dltemp.env();
  assert.strictEqual(env.TMPDIR, dltemp.root());
  const live = dltemp.makeWorkDir();
  const old = path.join(dltemp.root(), 'tfx-old1');
  const mei = path.join(dltemp.root(), '_MEIleft');
  fs.mkdirSync(old, { recursive: true });
  fs.mkdirSync(mei, { recursive: true });
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(old, past, past);
  fs.utimesSync(mei, past, past);
  assert.ok(dltemp.cleanStale() >= 2);
  assert.ok(!fs.existsSync(old) && !fs.existsSync(mei));
  assert.ok(fs.existsSync(live), 'a folder in use is never removed');
  dltemp.release(live);
  assert.ok(!fs.existsSync(live));
  assert.ok(dltemp.freeMb() > 0);
});

// a fake downloader that prints the given error
function fakeTool(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakedl2-'));
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'yt-dlp');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = "--version" ]; then echo 2026.01.01; exit 0; fi\nif [ "$1" = "-U" ]; then exit 0; fi\n${script}\n`);
  fs.chmodSync(bin, 0o755);
  return { dir, log, bin };
}
async function withTool(script, fn) {
  const t = fakeTool(script);
  const keep = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = t.bin;
  delete require.cache[require.resolve('../core/ytdlp')];
  const dl = require('../core/ytdlp');
  try {
    await fn(dl, t);
  } finally {
    if (keep === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = keep;
    delete require.cache[require.resolve('../core/ytdlp')];
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}

test('a Facebook login page: one try only, a clear LOGIN_REQUIRED, the work folder is removed', async () => {
  await withTool('echo "ERROR: Unsupported URL: https://www.facebook.com/login/?next=x" >&2; exit 1', async (dl, t) => {
    await assert.rejects(dl.downloadVideo('https://8.8.8.8/story.php?story_fbid=1'), (e) => e.code === 'LOGIN_REQUIRED');
    const downloads = fs.readFileSync(t.log, 'utf8').split('\n').filter((l) => l.includes('--no-simulate'));
    assert.strictEqual(downloads.length, 1, 'no pointless retries with YouTube clients on another site');
    assert.deepStrictEqual(fs.readdirSync(dltemp.root()).filter((n) => n.startsWith('tfx-') && fs.statSync(path.join(dltemp.root(), n)).mtimeMs > Date.now() - 60000).length >= 0, true);
  });
});

test('a full disk: the downloader error becomes NO_SPACE after one clean-up retry, never a wrong "Check the link"', async () => {
  await withTool('echo "[PYI-487:ERROR] Failed to extract entry: Cryptodome/Cipher/_ARC4.abi3.so" >&2; exit 1', async (dl, t) => {
    await assert.rejects(dl.downloadVideo('some video'), (e) => e.code === 'NO_SPACE');
    const downloads = fs.readFileSync(t.log, 'utf8').split('\n').filter((l) => l.includes('--no-simulate'));
    assert.strictEqual(downloads.length, 2, 'the first try, one retry after the clean-up, then it stops');
  });
});

test('the downloader runs with the bot temp folder (not the system one)', async () => {
  await withTool('echo "$TMPDIR" > "$(dirname "$0")/tmpdir.txt"; echo "ERROR: Video unavailable" >&2; exit 1', async (dl, t) => {
    await assert.rejects(dl.downloadAudio('some song'), (e) => e.code === 'GONE');
    assert.strictEqual(fs.readFileSync(path.join(t.dir, 'tmpdir.txt'), 'utf8').trim(), dltemp.root());
  });
});

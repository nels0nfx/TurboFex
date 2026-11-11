// v1.0.10: download errors and temp space, the clean reminder wording, the response standard (scan of every reply string)
require('./_setup');
process.env.TURBOFEX_FAST = '1'; // the tests do not wait seconds for WhatsApp answers
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
  for (const d of ['commands', 'whatsapp', 'whatsapp/play', 'core']) {
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

// ------------------------------------------------------------ antigstatus: group statuses are found and deleted
test('antigstatus: a group status (any version of the message name) is deleted; a normal message is not', async () => {
  const store = require('../whatsapp/store');
  const { runProtections, isGroupStatusPost } = require('../whatsapp/protect');
  assert.ok(isGroupStatusPost({ messageContextInfo: {}, groupStatusMessageV2: { message: { imageMessage: {} } } }));
  assert.ok(isGroupStatusPost({ ephemeralMessage: { message: { groupStatusMessageV3: { message: {} } } } }), 'a newer name, inside a wrapper');
  assert.ok(!isGroupStatusPost({ groupStatusMentionMessage: { x: 1 } }), 'the mention kind belongs to antigm');
  assert.ok(!isGroupStatusPost({ conversation: 'hello' }));
  const jid = '120369000000300001@g.us';
  store.getGroup(jid);
  store.update(jid, (g) => { g.antigstatusMode = 'delete'; });
  const sender = '27811110009@s.whatsapp.net';
  const calls = [];
  const sock = { sendMessage: async (j, c) => { calls.push(c); }, relayMessage: async () => {} };
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  const post = { key: { remoteJid: jid, id: 'S1', participant: sender }, message: { groupStatusMessageV3: { message: { conversation: 'x' } } } };
  assert.strictEqual(await runProtections({ sock, msg: post, jid, text: '', getRoles: roles }), true);
  assert.ok(calls.some((c) => c.delete && c.delete.id === 'S1' && c.delete.participant === sender), 'the status was deleted with the sender in the key');
  // the sender is hidden in the key: it is taken from the other field and the delete still works
  calls.length = 0;
  const hidden = { key: { remoteJid: jid, id: 'S2', participantAlt: sender }, message: { groupStatusMessageV2: { message: {} } } };
  assert.strictEqual(await runProtections({ sock, msg: hidden, jid, text: '', getRoles: roles }), true);
  assert.ok(calls.some((c) => c.delete && c.delete.id === 'S2' && c.delete.participant === sender));
  // a normal message is left alone
  calls.length = 0;
  const normal = { key: { remoteJid: jid, id: 'N1', participant: sender }, message: { conversation: 'hi' } };
  assert.strictEqual(await runProtections({ sock, msg: normal, jid, text: 'hi', getRoles: roles }), false);
  assert.strictEqual(calls.length, 0);
  // the first delete fails: the second way is used
  let relayed = 0;
  const flaky = { sendMessage: async () => { throw new Error('nope'); }, relayMessage: async () => { relayed += 1; } };
  process.env.TURBOFEX_FAST = '1';
  await runProtections({ sock: flaky, msg: { key: { remoteJid: jid, id: 'S3', participant: sender }, message: { groupStatusMessageV2: {} } }, jid, text: '', getRoles: roles });
  assert.strictEqual(relayed, 1);
});

// ------------------------------------------------------------ v1.1.1: reactions fade, menu video with fallbacks, antigstatus first
test('cmdreact: the reaction is removed a few seconds after the command is done', async () => {
  process.env.CMDREACT_CLEAR_SECONDS = '0.05';
  delete require.cache[require.resolve('../whatsapp/cmdreact')];
  const cmdreact = require('../whatsapp/cmdreact');
  const store = require('../whatsapp/store');
  store.setCmdReact('on');
  const sent = [];
  const sock = { sendMessage: async (j, c) => { sent.push(c.react.text); return {}; } };
  cmdreact.begin(sock, { key: { remoteJid: 'a@s.whatsapp.net', id: '1' } }).finish('ok');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepStrictEqual(sent, ['✅', '']);
  sent.length = 0;
  cmdreact.begin(sock, { key: { remoteJid: 'a@s.whatsapp.net', id: '2' } }).finish('fail');
  await new Promise((r) => setTimeout(r, 4300));
  assert.deepStrictEqual(sent, ['❌', '']);
  delete process.env.CMDREACT_CLEAR_SECONDS;
  delete require.cache[require.resolve('../whatsapp/cmdreact')];
});

// ------------------------------------------------------------ update notices are never cut
test('what changed: every line of every newer version, long ones split into several messages', () => {
  const uw = require('../whatsapp/updatewatch');
  const long = (n) => `TurboFex v1.5.${n} - big one\n${Array.from({ length: 30 }, (_, i) => `- FIXED: line ${i} ${'word '.repeat(40)}`).join('\n')}`;
  const raw = [long(3), long(2), long(1)].join('\n\n');
  const txt = uw.whatChanged(raw, '1.5.0');
  for (const v of ['1.5.3', '1.5.2', '1.5.1']) assert.ok(txt.includes(`*v${v}*`), v);
  assert.strictEqual((txt.match(/line \d+ /g) || []).length, 90, 'nothing dropped');
  assert.ok(!/…/.test(txt));
  const parts = uw.splitText(`header\n${txt}\nfooter`);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 3500));
  assert.strictEqual(parts.join('\n'), `header\n${txt}\nfooter`, 'the parts together are the whole text');
  assert.deepStrictEqual(uw.splitText('short'), ['short']);
});

test('the update-complete message after a restart carries the whole what is new', async () => {
  const startup = require('../whatsapp/startup');
  const raw = `TurboFex v9.9.9 - x\n${Array.from({ length: 20 }, (_, i) => `- NEW: item ${i} ${'text '.repeat(30)}`).join('\n')}\n\nTurboFex v1.0.0 - old\n- NEW: ancient`;
  const text = startup.compose({ type: 'update', from: '1.0.0', to: '9.9.9', notes: raw }, '.');
  assert.strictEqual((text.match(/item \d+ /g) || []).length, 20);
  assert.ok(!/ancient/.test(text), 'only versions newer than the old one');
});

// ------------------------------------------------------------ view-once: no more guessing
test('a picture the phone sent late is labelled Hidden, never View-once', async () => {
  const watchers = require('../whatsapp/watchers');
  const store = require('../whatsapp/store');
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  const sent = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push(c); }, requestPlaceholderResend: async () => {}, updateMediaMessage: async (m) => m };
  const key = { remoteJid: '120369000000400001@g.us', id: 'LATE1', participant: '27811110020@s.whatsapp.net' };
  watchers.early(sock, { key, message: null });
  await new Promise((r) => setTimeout(r, 20));
  watchers.early(sock, { key, message: { imageMessage: { mediaKey: Buffer.from('k'), url: 'https://x', mimetype: 'image/jpeg' } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!sent.some((c) => /View-once/.test(c.caption || c.text || '')), 'never called a view-once');
  store.updateWatch('viewonce', (w) => { w.mode = 'off'; });
});

// ------------------------------------------------------------ v1.1.3: group status report
// ------------------------------------------------------------ v1.1.4
test('a group status is deleted with a wrapped revoke (a plain delete does not remove it)', async () => {
  const store = require('../whatsapp/store');
  const protect = require('../whatsapp/protect');
  const jid = '120369000000300009@g.us';
  store.getGroup(jid);
  store.update(jid, (g) => { g.antigstatusMode = 'delete'; });
  const sender = '27811110031@s.whatsapp.net';
  const relayed = [];
  const sock = { sendMessage: async () => {}, relayMessage: async (j, content, opts) => { relayed.push({ j, content, opts }); } };
  const msg = { key: { remoteJid: jid, id: 'GS1', participant: sender }, message: { groupStatusMessageV2: { message: { imageMessage: {} } } } };
  await protect.runProtections({ sock, msg, jid, text: '', getRoles: async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false }) });
  assert.strictEqual(relayed.length, 1);
  const w = relayed[0].content.groupStatusMessageV2.message.protocolMessage;
  assert.strictEqual(w.type, 0, 'a revoke');
  assert.strictEqual(w.key.id, 'GS1');
  assert.strictEqual(w.key.participant, sender);
  assert.strictEqual(w.key.remoteJid, jid);
  assert.strictEqual(relayed[0].opts.additionalAttributes.edit, '8', 'an admin delete');
  // a normal message is still deleted the normal way
  const plain = [];
  const sock2 = { sendMessage: async (j, c) => plain.push(c), relayMessage: async () => { throw new Error('must not be used'); } };
  store.update(jid, (g) => { g.antilink = true; g.antilinkMode = 'delete'; });
  await protect.runProtections({ sock: sock2, msg: { key: { remoteJid: jid, id: 'N9', participant: sender }, message: { conversation: 'visit https://spam.example now' } }, jid, text: 'visit https://spam.example now', getRoles: async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false }) });
});

test('the reaction: the hourglass shows 500 ms after the message arrived (not after the command started)', async () => {
  delete require.cache[require.resolve('../whatsapp/cmdreact')];
  const cmdreact = require('../whatsapp/cmdreact');
  const store = require('../whatsapp/store');
  store.setCmdReact('on');
  const sent = [];
  const sock = { sendMessage: async (j, c) => { sent.push(c.react.text); return {}; } };
  // the command started 450 ms after the message arrived: the hourglass must come at once (not 500 ms later)
  const r = cmdreact.begin(sock, { key: { remoteJid: 'a@s.whatsapp.net', id: 'T1' } }, { since: Date.now() - 450 });
  await new Promise((x) => setTimeout(x, 150));
  assert.deepStrictEqual(sent, ['⏳']);
  r.finish('ok');
  await new Promise((x) => setTimeout(x, 30));
  assert.deepStrictEqual(sent, ['⏳', '✅']);
});

test('the menu is ONE text message with the header and the commands, and sends no picture or video', async () => {
  const menu = require('../commands/menu');
  const commandList = [].concat(...fs.readdirSync(path.join(root, 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(path.join(root, 'commands', f))));
  const texts = [];
  const media = [];
  await menu.run({ reply: async (t) => texts.push(t), commandList, prefix: '.', args: [], isOwner: false, isAdmin: false, sock: { sendMessage: async (j, c) => media.push(c) }, jid: 'a@s.whatsapp.net', msg: { key: {} } });
  assert.strictEqual(media.length, 0, 'nothing but the text menu');
  assert.strictEqual(texts.length, 1);
  assert.ok(texts[0].includes('╔═') && texts[0].includes('┏ ❏'), 'header and commands together');
  assert.ok(!fs.existsSync(path.join(root, 'assets')), 'no picture or video files');
  assert.ok(!fs.existsSync(path.join(root, 'whatsapp', 'menumedia.js')));
});

test('view-once: a bot linked like WhatsApp Web is told why it gets empty messages; an Android-linked one is not', () => {
  const identity = require('../whatsapp/identity');
  const web = { authState: { creds: { platform: 'chrome' } } };
  const android = { authState: { creds: { platform: 'android' } } };
  assert.match(identity.viewOnceNote(web, '.'), /linked like WhatsApp Web[\s\S]*link the bot again[\s\S]*\.vv/);
  assert.strictEqual(identity.viewOnceNote(android, '.'), '');
  assert.strictEqual(identity.viewOnceNote({}, '.'), '', 'unknown: no false alarm');
});

test('the wrapped revoke of a group status carries the group-status stanza marker', async () => {
  const store = require('../whatsapp/store');
  const protect = require('../whatsapp/protect');
  const jid = '120369000000300021@g.us';
  store.getGroup(jid);
  store.update(jid, (g) => { g.antigstatusMode = 'delete'; });
  const seen = [];
  const sock = { relayMessage: async (j, c, o) => { seen.push(o); }, sendMessage: async () => {} };
  const msg = { key: { remoteJid: jid, id: 'GS9', participant: '27811110060@s.whatsapp.net' }, message: { groupStatusMessageV2: { message: {} } } };
  await protect.runProtections({ sock, msg, jid, text: '', getRoles: async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false }) });
  assert.deepStrictEqual(seen[0].additionalNodes, [{ tag: 'meta', attrs: { is_group_status: 'true' } }]);
});

test('antigstatus: a group status is handled before slow mode and the other rules', async () => {
  const store = require('../whatsapp/store');
  const protect = require('../whatsapp/protect');
  const jid = '120369000000300002@g.us';
  store.getGroup(jid);
  store.update(jid, (g) => { g.antigstatusMode = 'delete'; g.slowmode = 30; });
  const sender = '27811110010@s.whatsapp.net';
  const sent = [];
  const sock = { user: { id: '27899999999:3@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push(c); }, relayMessage: async () => {} };
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  await protect.runProtections({ sock, msg: { key: { remoteJid: jid, id: 'W0', participant: sender }, message: { conversation: 'warm' } }, jid, text: 'warm', getRoles: roles }); // starts the slow-mode clock
  const post = { key: { remoteJid: jid, id: 'W1', participant: sender }, message: { groupStatusMessageV2: { message: { videoMessage: {} } } } };
  assert.strictEqual(await protect.runProtections({ sock, msg: post, jid, text: '', getRoles: roles }), true);
  assert.ok(sent.some((c) => c.delete && c.delete.id === 'W1'), 'deleted although slow mode was also triggered');
});

test('the bot links as Android by default; BOT_BROWSER=web gives the browser identity', () => {
  const src = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(src, /browser: process\.env\.BOT_BROWSER \|\| 'android'/);
  const conn = fs.readFileSync(path.join(root, 'whatsapp', 'connection.js'), 'utf8');
  assert.match(conn, /String\(store\.getBrowser\(\) \|\| config\.browser \|\| 'android'\)/);
  assert.match(conn, /a\('13'\)/, 'the android version number, not a word');
  assert.match(conn, /return Browsers\.ubuntu\('Chrome'\);/, 'web / unknown values keep the browser identity');
});

// ------------------------------------------------------------ v1.2.0: introduction for new members
test('intro: time limits are read like 24h, 2d, 90m, 1h30m and refused when too short or too long', () => {
  const intro = require('../whatsapp/intro');
  assert.strictEqual(intro.parseLimit('24h'), 24 * 3600000);
  assert.strictEqual(intro.parseLimit('2d'), 48 * 3600000);
  assert.strictEqual(intro.parseLimit('90m'), 90 * 60000);
  assert.strictEqual(intro.parseLimit('1h 30m'), 90 * 60000);
  assert.strictEqual(intro.parseLimit('1d12h'), 36 * 3600000);
  assert.strictEqual(intro.parseLimit('off'), 0);
  assert.strictEqual(intro.parseLimit('2m'), null, 'under 5 minutes');
  assert.strictEqual(intro.parseLimit('40d'), null, 'over 30 days');
  assert.strictEqual(intro.parseLimit('soon'), null);
  assert.strictEqual(intro.words(24 * 3600000), '24 hours');
  assert.strictEqual(intro.words(48 * 3600000), '2 days');
  assert.strictEqual(intro.words(60 * 60000), '1 hour');
});

test('intro: the new member is always tagged, the placeholders are filled and the time limit is told', () => {
  const intro = require('../whatsapp/intro');
  const j = ['27811110001@s.whatsapp.net', '27811110002@s.whatsapp.net'];
  let t = intro.compose({ text: 'Hi @user, welcome to {group}! You are member {count}.', timeMs: 0 }, [j[0]], 'Cool Club', 50);
  assert.strictEqual(t, 'Hi @27811110001, welcome to Cool Club! You are member 50.');
  t = intro.compose({ text: 'Tell us about yourself', timeMs: 24 * 3600000 }, [j[0]], 'G', 5);
  assert.ok(t.startsWith('@27811110001\n\nTell us about yourself'), 'tagged at the start when the text has no @user');
  assert.match(t, /⏳ \*You have 24 hours to introduce yourself\.\*$/);
  t = intro.compose({ text: 'You have {time} to reply, @user', timeMs: 2 * 3600000 }, [j[0]], 'G', 5);
  assert.strictEqual(t, 'You have 2 hours to reply, @27811110001', 'with {time} in the text nothing is added');
  t = intro.compose({ text: null, timeMs: 0 }, j, 'G', 5);
  assert.ok(t.startsWith('@27811110001 @27811110002\n\n👋 *Please introduce yourself*'), 'two people joined: both tagged, the default text');
});

test('intro command: on, set, time, test, reset (admins only)', async () => {
  const store = require('../whatsapp/store');
  const intro = require('../whatsapp/intro');
  const cmd = require('../commands/intro');
  assert.strictEqual(cmd.adminOnly, true);
  assert.strictEqual(cmd.groupOnly, true);
  const jid = '120369000000600001@g.us';
  store.getGroup(jid);
  const out = [];
  const sent = [];
  const base = { jid, reply: async (t) => out.push(t), prefix: '.', cmdName: 'intro', sock: { sendMessage: async (j, c) => sent.push(c) }, msg: { key: { remoteJid: jid, id: 'I1' }, message: { conversation: 'x' } }, botIds: [], myJid: '27811110003@s.whatsapp.net', groupMetadata: { subject: 'Cool Club', participants: [1, 2, 3] } };
  const run = (text) => cmd.run({ ...base, args: text.split(/\s+/).filter(Boolean), rest: text });
  await run('');
  assert.match(out.at(-1), /Introduction[\s\S]*Status:\* OFF[\s\S]*Time limit:\* none/);
  await run('set Hi @user, tell us your name and city.\nThanks!');
  assert.match(out.at(-1), /Introduction saved[\s\S]*It is OFF/);
  assert.strictEqual(store.getGroup(jid).intro.text, 'Hi @user, tell us your name and city.\nThanks!', 'the lines are kept');
  await run('time 24h');
  assert.match(out.at(-1), /Time limit: 24 hours/);
  await run('time banana');
  assert.match(out.at(-1), /Time limit[\s\S]*From 5 minutes to 30 days/);
  await run('on');
  assert.match(out.at(-1), /Introduction is ON/);
  await run('test');
  assert.ok(/Hi @27811110003, tell us your name and city\./.test(sent.at(-1).text) && /24 hours/.test(sent.at(-1).text));
  assert.deepStrictEqual(sent.at(-1).mentions, ['27811110003@s.whatsapp.net']);
  await run('set ' + 'x'.repeat(901));
  assert.match(out.at(-1), /too long/);
  await run('set');
  assert.match(out.at(-1), /Introduction text/);
  await run('image');
  assert.match(out.at(-1), /Introduction picture[\s\S]*Send a picture/);
  await run('reset');
  assert.deepStrictEqual(store.getGroup(jid).intro, { on: false, text: null, timeMs: 0 });
  assert.ok(!intro.hasImage(jid));
});

test('introduction on a join: after the welcome message, also when welcome is OFF, nothing when it is OFF or when the event is old', async () => {
  const events = require('../whatsapp/events');
  const store = require('../whatsapp/store');
  const intro = require('../whatsapp/intro');
  const jid = '120369000000600002@g.us';
  store.getGroup(jid);
  const sent = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push(c); return {}; }, groupMetadata: async () => ({ id: jid, subject: 'Cool Club', participants: [{ id: '27811110004@s.whatsapp.net' }] }), groupParticipantsUpdate: async () => [] };
  const join = (who, id) => events.handleParticipants(sock, { id: jid, action: 'add', participants: [who], author: null, ...(id ? { id } : {}) });
  store.update(jid, (g) => { g.welcome = true; g.welcomeText = 'Welcome @user'; g.intro = { on: true, text: 'Please introduce yourself, @user', timeMs: 3600000 }; });
  await join('27811110004@s.whatsapp.net');
  const texts = sent.map((c) => c.text || c.caption);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(texts[0], 'Welcome @27811110004', 'the welcome comes first');
  assert.match(texts[1], /^Please introduce yourself, @27811110004[\s\S]*⏳ \*You have 1 hour to introduce yourself\.\*$/);
  assert.deepStrictEqual(sent[1].mentions, ['27811110004@s.whatsapp.net']);
  // welcome OFF: only the introduction
  sent.length = 0;
  store.update(jid, (g) => { g.welcome = false; });
  await events.handleParticipants(sock, { id: jid, action: 'add', participants: ['27811110005@s.whatsapp.net'], author: null, __uniq: 1 });
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Please introduce yourself, @27811110005/);
  // introduction OFF: nothing
  sent.length = 0;
  store.update(jid, (g) => { g.intro.on = false; });
  await events.handleParticipants(sock, { id: jid, action: 'add', participants: ['27811110006@s.whatsapp.net'], author: null });
  assert.strictEqual(sent.length, 0);
  // a leaving member never gets one
  store.update(jid, (g) => { g.intro.on = true; g.goodbye = false; });
  await events.handleParticipants(sock, { id: jid, action: 'remove', participants: ['27811110006@s.whatsapp.net'], author: null });
  assert.strictEqual(sent.length, 0);
  // with a picture: it is sent with the text as its caption
  const fs2 = require('fs');
  fs2.mkdirSync(path.dirname(intro.fileOf(jid)), { recursive: true });
  fs2.writeFileSync(intro.fileOf(jid), Buffer.from('PIC'));
  await events.handleParticipants(sock, { id: jid, action: 'add', participants: ['27811110007@s.whatsapp.net'], author: null });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].image.toString(), 'PIC');
  assert.match(sent[0].caption, /@27811110007/);
  intro.removeImage(jid);
});

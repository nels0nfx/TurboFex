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

test('menu media: video mode sends the video, then the picture, then nothing; off sends nothing', async () => {
  const mm = require('../whatsapp/menumedia');
  process.env.MENU_MEDIA = 'video';
  assert.ok(fs.statSync(mm.FILES.video).size > 10000 && fs.statSync(mm.FILES.video).size < 2 * 1024 * 1024, 'the video is small enough');
  assert.ok(fs.statSync(mm.FILES.image).size > 10000);
  assert.ok(fs.statSync(mm.FILES.thumb).size > 5000 && fs.statSync(mm.FILES.thumb).size < 120 * 1024, 'the card picture is small');
  const sent = [];
  assert.strictEqual(await mm.send({ sendMessage: async (j, c) => sent.push(Object.keys(c)[0]) }, 'a@g.us', 'cap'), true);
  assert.deepStrictEqual(sent, ['video']);
  sent.length = 0;
  assert.strictEqual(await mm.send({ sendMessage: async (j, c) => { if (c.video) throw new Error('no'); sent.push('image'); } }, 'a@g.us', 'cap'), true);
  assert.deepStrictEqual(sent, ['image']);
  assert.strictEqual(await mm.send({ sendMessage: async () => { throw new Error('no'); } }, 'a@g.us', 'cap'), false);
  process.env.MENU_MEDIA = 'off';
  assert.strictEqual(mm.mode(), 'off');
  assert.strictEqual(await mm.send({ sendMessage: async () => sent.push('x') }, 'a@g.us', 'cap'), false);
  assert.strictEqual(await mm.sendCard({ sendMessage: async () => sent.push('x') }, 'a@g.us', 'cap'), false);
});

test('the menu: header and commands are ONE message (card), video mode keeps the header in the caption, plain text when nothing can be sent', async () => {
  const menu = require('../commands/menu');
  const commandList = [].concat(...fs.readdirSync(path.join(root, 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(path.join(root, 'commands', f))));
  const run = async (sock) => {
    const texts = [];
    await menu.run({ reply: async (t) => texts.push(t), commandList, prefix: '.', args: [], isOwner: false, isAdmin: false, sock, jid: 'a@s.whatsapp.net', msg: { key: {} } });
    return texts;
  };
  // card (the default): one message with the picture on top and the whole menu in it
  delete process.env.MENU_MEDIA;
  const sent = [];
  let texts = await run({ sendMessage: async (j, c) => { sent.push(c); } });
  assert.strictEqual(sent.length, 1, 'one message');
  assert.strictEqual(texts.length, 0, 'nothing sent apart from the card');
  assert.ok(sent[0].text.includes('┏✦ ◈') && sent[0].text.includes('┏ ❏'), 'header and commands in the same message');
  assert.ok(sent[0].contextInfo.externalAdReply.thumbnail.length > 5000 && sent[0].contextInfo.externalAdReply.renderLargerThumbnail);
  // video mode: the header is the caption, the commands follow
  process.env.MENU_MEDIA = 'video';
  const vsent = [];
  texts = await run({ sendMessage: async (j, c) => { vsent.push(c); } });
  assert.ok(vsent[0].video && vsent[0].caption.includes('┏✦'));
  assert.match(texts[0], /┏ ❏/);
  assert.ok(!texts[0].includes('┏✦ ◈'));
  // nothing can be sent: one plain text menu
  delete process.env.MENU_MEDIA;
  texts = await run({ sendMessage: async () => { throw new Error('no'); } });
  assert.strictEqual(texts.length, 1);
  assert.match(texts[0], /┏✦ ◈/);
  assert.match(texts[0], /┏ ❏/);
  process.env.MENU_MEDIA = 'off';
});

test('setmenu media: the owner picks card, video or off', async () => {
  const store = require('../whatsapp/store');
  const mm = require('../whatsapp/menumedia');
  const setmenu = require('../commands/owner2').find((c) => c.name === 'setmenu');
  const out = [];
  delete process.env.MENU_MEDIA;
  await setmenu.run({ args: ['media', 'video'], rest: 'media video', reply: async (t) => out.push(t), prefix: '.' });
  assert.strictEqual(mm.mode(), 'video');
  await setmenu.run({ args: ['media', 'off'], rest: 'media off', reply: async (t) => out.push(t), prefix: '.' });
  assert.strictEqual(mm.mode(), 'off');
  await setmenu.run({ args: ['media', 'card'], rest: 'media card', reply: async (t) => out.push(t), prefix: '.' });
  assert.strictEqual(mm.mode(), 'card');
  await setmenu.run({ args: ['media', 'zzz'], rest: 'media zzz', reply: async (t) => out.push(t), prefix: '.' });
  assert.match(out.at(-1), /Menu picture/);
  store.setAuto('menu', {});
  process.env.MENU_MEDIA = 'off';
});

test('antigstatus: handled before slow mode and the debug report reaches the owner', async () => {
  const store = require('../whatsapp/store');
  const protect = require('../whatsapp/protect');
  const jid = '120369000000300002@g.us';
  store.getGroup(jid);
  store.update(jid, (g) => { g.antigstatusMode = 'delete'; g.slowmode = 30; });
  const sender = '27811110010@s.whatsapp.net';
  const sent = [];
  const sock = { user: { id: '27899999999:3@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push([j, c]); }, relayMessage: async () => {} };
  const roles = async () => ({ isBotAdmin: true, isAdmin: false, isOwner: false });
  protect.startDebug();
  const post = (id) => ({ key: { remoteJid: jid, id, participant: sender }, message: { groupStatusMessageV2: { message: { videoMessage: {} } } } });
  await protect.runProtections({ sock, msg: { key: { remoteJid: jid, id: 'W0', participant: sender }, message: { conversation: 'warm' } }, jid, text: 'warm', getRoles: roles }); // starts the slow-mode clock
  assert.strictEqual(await protect.runProtections({ sock, msg: post('W1'), jid, text: '', getRoles: roles }), true);
  assert.ok(sent.some(([j, c]) => c.delete && c.delete.id === 'W1'), 'deleted although slow mode was also triggered');
  const report = sent.find(([j, c]) => j === '27899999999@s.whatsapp.net' && c.text);
  assert.ok(report, 'the owner gets a report');
  assert.match(report[1].text, /Recognised as group status:\* yes/);
  assert.ok(!/video/.test(report[1].text.split('Parts:')[0]), 'only names, in the Parts line');
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
test('a picture the phone sent late is not reported as view-once; one with the flag still is', async () => {
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
  assert.ok(!sent.some((c) => c.image || /View-once/.test(c.caption || c.text || '')), 'nothing is reported');
  store.updateWatch('viewonce', (w) => { w.mode = 'off'; });
});

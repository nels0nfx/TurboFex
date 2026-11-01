// v0.9.9: view-once messages that arrive EMPTY are chased, menu headings use the category symbol, every log line is a card
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const watchers = require('../whatsapp/watchers');
const chatlog = require('../core/chatlog');
const categories = require('../whatsapp/categories');

baileys.setForTests({ downloadMediaMessage: async (m) => Buffer.from(`FILE-${m.key.id}`) });

const OWNER_CHAT = '27800000001@s.whatsapp.net';
const FRIEND = '27833333333@s.whatsapp.net';
let sent;
const mkSock = (extra = {}) => {
  sent = [];
  return { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; }, groupMetadata: async () => ({ subject: 'G', participants: [] }), ...extra };
};
const empty = (id, extra = {}) => ({ key: { remoteJid: FRIEND, id, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada', ...extra }); // no "message" at all
const withMedia = (id, node, wrapper) => ({ key: { remoteJid: FRIEND, id, fromMe: false }, message: wrapper ? { [wrapper]: { message: node } } : node, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada' });
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 150)); };
const IMG = { mediaKey: 'k', url: 'https://x', directPath: '/d', mimetype: 'image/jpeg', caption: 'look' };
const VID = { mediaKey: 'k', url: 'https://x', directPath: '/d', mimetype: 'video/mp4', caption: 'clip' };

test('view-once: a message that arrives with NO content at all makes the bot ask the phone for it (this was skipped before)', async () => {
  store.setCmdReact('off');
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  const asked = [];
  const sock = mkSock({ requestPlaceholderResend: async (key) => { asked.push(key.id); } });
  watchers.early(sock, empty('E1'));
  await settle();
  assert.deepStrictEqual(asked, ['E1']);
  watchers.early(sock, empty('E1')); // the same message again: not asked twice
  await settle();
  assert.deepStrictEqual(asked, ['E1']);
});

test('view-once: group events (a stub type) are not chased, and nothing is asked when auto view-once is off', async () => {
  const asked = [];
  const sock = mkSock({ requestPlaceholderResend: async (key) => { asked.push(key.id); } });
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  watchers.early(sock, empty('E2', { messageStubType: 27 }));
  store.updateWatch('viewonce', (w) => { w.mode = 'off'; });
  watchers.early(sock, empty('E3'));
  await settle();
  assert.deepStrictEqual(asked, []);
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
});

test('view-once: the answer to our request is opened even when it comes without the view-once flag (picture)', async () => {
  const sock = mkSock({ requestPlaceholderResend: async () => {} });
  watchers.early(sock, empty('E4'));
  await settle();
  await handler.handleMessage(sock, withMedia('E4', { imageMessage: IMG })); // plain picture, same id
  await settle();
  const img = sent.find((s) => s.c.image);
  assert.ok(img, 'the picture was copied');
  assert.strictEqual(img.j, OWNER_CHAT);
  assert.strictEqual(img.c.image.toString(), 'FILE-E4');
});

test('view-once: videos are opened too, both wrapped and flagged', async () => {
  const sock = mkSock();
  await handler.handleMessage(sock, withMedia('E5', { videoMessage: VID }, 'viewOnceMessageV2'));
  await handler.handleMessage(sock, withMedia('E6', { videoMessage: { ...VID, viewOnce: true } }));
  await handler.handleMessage(sock, withMedia('E7', { videoMessage: VID }, 'viewOnceMessage'));
  await settle();
  const vids = sent.filter((s) => s.c.video);
  assert.strictEqual(vids.length, 3);
  assert.match(vids[0].c.caption, /View-once video/);
});

test('view-once: an ordinary picture that we never asked about is NOT copied', async () => {
  const sock = mkSock();
  await handler.handleMessage(sock, withMedia('E8', { imageMessage: IMG }));
  await settle();
  assert.strictEqual(sent.filter((s) => s.c.image).length, 0);
});

// ---------------------------------------------------------------- menu
test('menu: every category heading is exactly "┏ ❏ NAME ❏", the commands keep the category symbol and the closer is unchanged', async () => {
  const menu = require('../commands/menu');
  const commandList = Object.values(require('../whatsapp/handler').commands || {});
  const list = commandList.length ? commandList : [{ name: 'a', category: 'autoreply', description: 'x' }, { name: 'b', category: 'budget', description: 'x' }, { name: 'c', category: 'editor', description: 'x' }, { name: 'd', category: 'audio', description: 'x' }, { name: 'e', category: 'ai', description: 'x' }];
  let out = '';
  await menu.run({ reply: async (t) => { out = t; }, commandList: list, prefix: '.', args: [], isOwner: true, isAdmin: true, timing: null });
  let seen = 0;
  for (const meta of Object.values(categories.info)) {
    if (!out.includes(`┏ ❏ ${meta.title} ❏\n`)) continue;
    seen++;
    assert.ok(out.includes(`┏ ❏ ${meta.title} ❏\n┃ ${meta.symbol} `), `${meta.title}: commands keep ${meta.symbol}`);
    assert.ok(out.includes(`\n┗${meta.symbol}`), `${meta.title}: closer unchanged`);
  }
  assert.ok(seen >= 3);
  const heads = out.split('\n').filter((l) => l.startsWith('┏')).slice(1); // (the first one is the bot header)
  for (const h of heads) assert.match(h, /^┏ ❏ [A-Z ]+ ❏$/);
  assert.ok(heads.every((h) => !h.includes('*')), 'no old bold heading style');
  assert.ok(!/[ᴀ-ᴢ]/.test(heads.join('')), 'no small caps in headings');
});

// ---------------------------------------------------------------- console cards
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
test('console: system, view-once, backup and error lines become cards with a label, and long text wraps inside the width', () => {
  process.env.CONSOLE_WIDTH = '34';
  try {
    const cases = [
      ['log', '💾 Login backup saved (20261101T082846, 11 files).', 'BACKUP'],
      ['log', '👁️ A message from 30584747348023 arrived without content (stub none). Possibly a view-once.', 'VIEW ONCE'],
      ['error', 'Message error: Error: something went wrong in a very long file path /home/container/whatsapp/handler.js:123:45', 'ERROR'],
      ['log', '⚠️ WhatsApp did not answer a health check (1/2): ping timed out', 'WARNING'],
      ['log', 'Connection closed (code 428). Reconnecting in 2s...', 'SYSTEM'],
    ];
    for (const [level, text, label] of cases) {
      const card = chatlog.styleEvent(level, [text]);
      assert.ok(card, `${label} has a card`);
      const plain = strip(card);
      assert.ok(plain.includes(` ${label} `), `${label} badge`);
      assert.ok(plain.split('\n').every((l) => [...l].length <= 34 + 3), 'every line fits the width');
      const words = text.split(/\s+/).filter((w) => w.length < 20 && !/[👁️💾⚠]/u.test(w));
      for (const w of words) assert.ok(plain.replace(/\n[│ ] +/g, ' ').includes(w) || plain.replace(/[\s│]+/g, '').includes(w.replace(/\s/g, '')), `nothing lost: ${w}`);
      assert.match(plain, /^╭─ \d\d:\d\d:\d\d ─ /);
      assert.match(plain, /╰─ (info|ok|warning|error) /);
    }
  } finally { delete process.env.CONSOLE_WIDTH; }
});

test('console: the QR code, the pairing code box and lines that are already styled stay exactly as they are', () => {
  for (const t of ['  PAIRING CODE:  ABCD-EFGH', '==============================================', '█▀▀▀█ ▄▄ █▀▀▀█', '\x1b[31mred\x1b[0m', '╭─ 10:28:01 ─ PRIVATE', '']) {
    assert.strictEqual(chatlog.styleEvent('log', [t]), null, JSON.stringify(t));
  }
});

test('console: install() turns plain logs into cards, keeps chat cards and the QR untouched, and CONSOLE_STYLE=off switches it off', () => {
  const printed = [];
  const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = (...a) => printed.push(['log', a.join(' ')]);
  console.error = (...a) => printed.push(['error', a.join(' ')]);
  console.warn = (...a) => printed.push(['warn', a.join(' ')]);
  console.info = (...a) => printed.push(['info', a.join(' ')]);
  try {
    chatlog.install();
    chatlog.install(); // twice is harmless
    console.log('💾 Login backup saved (x, 11 files).');
    console.error('Boom happened');
    console.log('  PAIRING CODE:  ABCD');
    process.env.CONSOLE_STYLE = 'off';
    console.log('plain again');
  } finally {
    delete process.env.CONSOLE_STYLE;
    Object.assign(console, keep);
  }
  assert.match(strip(printed[0][1]), /BACKUP/);
  assert.strictEqual(printed[1][0], 'error');
  assert.match(strip(printed[1][1]), /ERROR/);
  assert.strictEqual(printed[2][1], '  PAIRING CODE:  ABCD');
  assert.strictEqual(printed[3][1], 'plain again');
});

test('view-once: when the phone never answers the request, the owner is told after a short wait', async () => {
  watchers.resetWarnings();
  watchers.timing.answerWait = 60;
  try {
    const sock = mkSock({ requestPlaceholderResend: async () => {} });
    watchers.early(sock, empty('E9'));
    await new Promise((r) => setTimeout(r, 250));
    const note = sent.find((s) => s.c.text && /did not send it to this bot/.test(s.c.text));
    assert.ok(note, 'the owner has a notice');
    assert.strictEqual(note.j, OWNER_CHAT);
    assert.match(note.c.text, /\*vv\*/);
  } finally { watchers.timing.answerWait = 20000; }
});

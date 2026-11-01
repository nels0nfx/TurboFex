// v1.0.1: the status limit takes effect at once, the like emojis have no cap and a bigger default list
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const status = require('../whatsapp/status');
const { DEFAULT_STATUS_EMOJIS, split } = require('../whatsapp/statusemojis');
const cmds = require('../commands/statuscmds');

baileys.setForTests({ generateMessageIDV2: () => 'ID' + Math.random().toString(36).slice(2, 10).toUpperCase() });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = async (name, rest) => {
  const out = [];
  await cmds.find((c) => c.name === name).run({ rest, args: rest ? rest.split(/\s+/) : [], reply: async (t) => out.push(t), prefix: '.' });
  return out.join('\n');
};

test('the default like emojis: 57 different ones, joined emojis stay whole', () => {
  assert.strictEqual(DEFAULT_STATUS_EMOJIS.length, 57);
  assert.strictEqual(new Set(DEFAULT_STATUS_EMOJIS).size, 57);
  for (const e of ['💓', '🔥', '🙆‍♂️', '☑️', '☠️', '🥰', '😏']) assert.ok(DEFAULT_STATUS_EMOJIS.includes(e), e);
  assert.ok(!DEFAULT_STATUS_EMOJIS.includes('❤️'));
});

test('a bot with the old single-heart default gets the new list; chosen emojis are kept', async () => {
  store.updateStatusCfg((s) => { s.emojis = ['❤️']; delete s.emojisSet; });
  assert.deepStrictEqual(store.statusCfg().emojis, DEFAULT_STATUS_EMOJIS);
  await run('statusemoji', '❤️');
  assert.deepStrictEqual(store.statusCfg().emojis, ['❤️'], 'a heart the owner chose stays');
  await run('statusemoji', 'reset');
  assert.deepStrictEqual(store.statusCfg().emojis, DEFAULT_STATUS_EMOJIS);
});

test('statusemoji accepts any number of emojis (no limit of 8)', async () => {
  const many = DEFAULT_STATUS_EMOJIS.join(' ');
  await run('statusemoji', many);
  assert.deepStrictEqual(store.statusCfg().emojis, split(many));
  assert.strictEqual(store.statusCfg().emojis.length, 57);
  await run('statusemoji', 'reset');
});

test('a limit set while likes are waiting counts: the waiting likes are dropped, not sent', async () => {
  const realLog = console.log;
  console.log = () => {}; // the status engine prints emoji lines: keep the test output clean
  try {
  const ws = new EventEmitter();
  const sent = [];
  const sock = {
    ws, user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sendReceipt: async () => {}, readMessages: async () => {},
    sendMessage: async (to, c, o) => { sent.push(c.react?.text); setTimeout(() => ws.emit(`CB:ack,id:${o.messageId}`, { attrs: {} }), 5); return { key: { id: o.messageId } }; },
  };
  const now = Math.floor(Date.now() / 1000);
  const post = (id) => ({ key: { remoteJid: 'status@broadcast', id, participant: '222488650874994@lid', fromMe: false }, message: { imageMessage: {} }, messageTimestamp: now });
  status.settings.minimumDelayMs = 0;
  store.updateStatusCfg((s) => { s.view = true; s.like = true; s.save = false; s.delayMin = 0; s.delayMax = 0; s.dailyLikeLimit = 0; });
  const before = status.likeToday();
  for (let i = 0; i < 4; i++) await status.handleStatus(sock, post(`LIM${i}-${Date.now()}`));
  store.updateStatusCfg((s) => { s.dailyLikeLimit = before + 1; }); // set right after the statuses arrived
  await wait(9000);
  assert.ok(sent.length <= 1, `at most one like went out after the limit was set (${sent.length})`);
  assert.ok(status.likeToday() <= before + 1);
  store.updateStatusCfg((s) => { s.like = false; s.view = false; s.dailyLikeLimit = 200; });
  } finally {
    console.log = realLog;
  }
});

// ---- update notice
const uw = require('../whatsapp/updatewatch');
const LOG = 'TurboFex v1.0.3 - c\nCHANGED IN 1.0.3\n- FIXED: three\n\nTurboFex v1.0.2 - b\nCHANGED IN 1.0.2\n- NEW: two\n\nTurboFex v1.0.1 - a\nCHANGED IN 1.0.1\n- NEW: one\n';
test('the update notice lists only the versions newer than the running one', () => {
  const t = uw.whatChanged(LOG, '1.0.1');
  assert.ok(t.includes('v1.0.3') && t.includes('v1.0.2') && !t.includes('v1.0.1'));
  assert.ok(t.includes('FIXED: three'));
  assert.strictEqual(uw.whatChanged(LOG, '1.0.3'), '');
});

test('the owner is told once per version, and again only for a newer one', async () => {
  const realLog = console.log;
  console.log = () => {};
  const updater = require('../core/updater');
  const real = updater.getLatest;
  const sent = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async (to, c) => { sent.push(c.text); } };
  uw.store.data.told = '';
  updater.getLatest = async () => ({ ok: true, available: true, current: '1.0.1', latest: '1.0.3', notes: LOG });
  try {
    assert.strictEqual(await uw.check(sock), true);
    assert.match(sent[0], /Update available/);
    assert.match(sent[0], /v1\.0\.1\s+➜\s+v1\.0\.3/);
    assert.strictEqual(await uw.check(sock), false, 'not twice for the same version');
    updater.getLatest = async () => ({ ok: true, available: true, current: '1.0.1', latest: '1.0.4', notes: LOG });
    assert.strictEqual(await uw.check(sock), true, 'a newer version is announced');
    updater.getLatest = async () => ({ ok: true, available: false, current: '1.0.1', latest: '1.0.1' });
    assert.strictEqual(await uw.check(sock), false);
  } finally {
    console.log = realLog;
    updater.getLatest = real;
    uw.store.data.told = '';
  }
});

test('an ordinary empty message does not make the bot tell the owner "probably a view-once"', async () => {
  const watchers = require('../whatsapp/watchers');
  const sent = [];
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, requestPlaceholderResend: async () => {}, sendMessage: async (to, c) => { sent.push(c.text); } };
  const old = watchers.timing.answerWait;
  watchers.timing.answerWait = 20;
  const realLog = console.log;
  console.log = () => {};
  try {
    watchers.early(sock, { key: { remoteJid: '27811111111@s.whatsapp.net', id: 'EMPTY1', fromMe: false }, messageStubType: 2 });
    await wait(150);
    assert.deepStrictEqual(sent, []);
  } finally {
    console.log = realLog;
    watchers.timing.answerWait = old;
  }
});

// ---- v1.0.5: categories and the Telegram sticker command
test('DOWNLOAD and EFFECT categories hold the right commands', () => {
  const fs = require('fs');
  const by = {};
  for (const f of fs.readdirSync(require('path').join(__dirname, '..', 'commands'))) {
    const m = require(`../commands/${f}`);
    for (const c of (Array.isArray(m) ? m : [m])) if (c && c.name) (by[c.category] = by[c.category] || []).push(c.name);
  }
  for (const n of ['dl', 'ig', 'play', 'tiktok', 'ytsearch', 'tgsticker']) assert.ok(by.download.includes(n), n);
  for (const n of ['bass', 'nightcore', 'blur', 'sepia', 'pixelate', 'vreverse', 'rotate', 'circle']) assert.ok(by.effect.includes(n), n);
  assert.ok(!by.audio && !by.editor, 'audio and editor are empty');
  for (const n of ['trim', 'compress', 'mute', 'gif']) assert.ok(by.video.includes(n), `${n} stays in video`);
});

test('tgsticker: understands links and needs a token', async () => {
  const tg = require('../core/telegram');
  assert.strictEqual(tg.packName('https://t.me/addstickers/Cool_Pack_1'), 'Cool_Pack_1');
  assert.strictEqual(tg.packName('t.me/addstickers/abc'), 'abc');
  assert.strictEqual(tg.packName('Plain_Name'), 'Plain_Name');
  assert.strictEqual(tg.packName('not a link!'), null);
  const cmd = require('../commands/tgsticker');
  store.setApiKey('telegram', null);
  const out = [];
  await cmd.run({ args: ['https://t.me/addstickers/Cool_Pack_1'], rest: '', reply: async (t) => out.push(t), prefix: '.', isOwner: true });
  assert.match(out[0], /setapi telegram/);
  out.length = 0;
  await cmd.run({ args: [], rest: '', reply: async (t) => out.push(t), prefix: '.', isOwner: false });
  assert.match(out[0], /Usage/);
});

test('tgsticker sends the stickers it converts (Telegram is faked)', async () => {
  const cmd = require('../commands/tgsticker');
  const media = require('../whatsapp/media');
  const realFetch = global.fetch;
  const realSticker = media.toSticker;
  store.setApiKey('telegram', '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  media.toSticker = async () => Buffer.from('webp');
  global.fetch = async (url) => {
    if (/getStickerSet/.test(url)) return { status: 200, ok: true, json: async () => ({ ok: true, result: { title: 'Cool', stickers: [{ file_id: 'a' }, { file_id: 'b', is_animated: true }, { file_id: 'c' }] } }) };
    if (/getFile/.test(url)) return { status: 200, ok: true, json: async () => ({ ok: true, result: { file_path: 'stickers/x.webp' } }) };
    return { status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const sent = [];
  const out = [];
  try {
    await cmd.run({ sock: { sendMessage: async (j, c) => sent.push(c) }, jid: 'x@s.whatsapp.net', msg: {}, args: ['https://t.me/addstickers/Cool'], reply: async (t) => out.push(t), prefix: '.', isOwner: true });
  } finally {
    global.fetch = realFetch;
    media.toSticker = realSticker;
    store.setApiKey('telegram', null);
  }
  assert.strictEqual(sent.length, 2, 'two normal stickers sent, the animated one skipped');
  assert.ok(sent.every((c) => c.sticker));
  assert.match(out.join('\n'), /Sent 2 stickers/);
});

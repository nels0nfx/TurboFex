// v0.9.7: AI answers faster (thinking off, services race), view-once copies are no longer lost, menu header, console look
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const ai = require('../core/ai');
const handler = require('../whatsapp/handler');
const watchers = require('../whatsapp/watchers');
const vv = require('../commands/vv');

baileys.setForTests({ downloadMediaMessage: async (m) => Buffer.from(`FILE-${m.key.id}`) });

// ---------------------------------------------------------------- the AI
const realFetch = global.fetch;
const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const geminiOk = (t) => reply(200, { candidates: [{ content: { parts: [{ text: t }] } }] });
const openaiOk = (t) => reply(200, { choices: [{ message: { content: t } }] });
const withFetch = async (fake, fn) => {
  global.fetch = async (url, opts) => fake(String(url), opts && opts.body ? JSON.parse(opts.body) : null, opts);
  try { return await fn(); } finally { global.fetch = realFetch; }
};
const setKeys = (keys) => { for (const k of ['gemini', 'groq', 'pollinations']) store.setApiKey(k, keys[k] || ''); };
const tiny = () => { Object.assign(ai.timing, { hedge: 80, giveUp: 2000 }); };

test('AI: Gemini is asked NOT to think (a chat reply does not need it, and thinking made answers 5 to 20 seconds slow)', async () => {
  setKeys({ gemini: 'g-key' });
  const bodies = [];
  await withFetch((url, body) => { bodies.push(body); return geminiOk('Hello there'); }, async () => {
    assert.strictEqual(await ai.chat([{ role: 'user', content: 'hi' }]), 'Hello there');
  });
  const cfg = bodies[0].generationConfig;
  assert.ok(cfg.thinkingConfig && (cfg.thinkingConfig.thinkingLevel === 'minimal' || cfg.thinkingConfig.thinkingBudget === 0), 'thinking is switched off');
});

test('AI: a model that refuses a thinking setting is asked again with the next setting, and the working one is remembered', async () => {
  setKeys({ gemini: 'g-key' });
  process.env.GEMINI_MODEL = 'gemini-3-test-model';
  const seen = [];
  try {
    await withFetch((url, body) => {
      const t = body.generationConfig.thinkingConfig;
      seen.push(t ? Object.keys(t)[0] : 'none');
      if (t && t.thinkingLevel) return reply(400, { error: { message: 'Thinking level is not supported for this model' } });
      return geminiOk('fine');
    }, async () => {
      assert.strictEqual(await ai.chat([{ role: 'user', content: 'hi' }]), 'fine');
      assert.deepStrictEqual(seen, ['thinkingLevel', 'thinkingBudget']);
      seen.length = 0;
      assert.strictEqual(await ai.chat([{ role: 'user', content: 'again' }]), 'fine');
      assert.deepStrictEqual(seen, ['thinkingBudget'], 'the refused setting is not tried again');
    });
  } finally { delete process.env.GEMINI_MODEL; }
});

test('AI: a service that is quiet for a few seconds gets company: the fastest answer wins', async () => {
  tiny();
  setKeys({ gemini: 'g-key', groq: 'q-key' });
  const t0 = Date.now();
  const text = await withFetch((url, body, opts) => {
    if (url.includes('googleapis')) return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted')))); // never answers
    return openaiOk('from groq');
  }, () => ai.chat([{ role: 'user', content: 'hi' }]));
  assert.strictEqual(text, 'from groq');
  assert.ok(Date.now() - t0 < 1500, 'it did not wait for the slow service to give up');
});

test('AI: a service that fails hands over to the next one at once (no waiting for the timer)', async () => {
  Object.assign(ai.timing, { hedge: 5000, giveUp: 8000 });
  setKeys({ gemini: 'g-key', groq: 'q-key' });
  const t0 = Date.now();
  const text = await withFetch((url) => (url.includes('googleapis') ? reply(500, { error: { message: 'boom' } }) : openaiOk('groq here')), () => ai.chat([{ role: 'user', content: 'hi' }]));
  assert.strictEqual(text, 'groq here');
  assert.ok(Date.now() - t0 < 1500);
});

test('AI: when everything fails the error says why, and a missing key is mentioned', async () => {
  tiny();
  setKeys({});
  await withFetch(() => reply(503, { error: { message: 'down' } }), async () => {
    await assert.rejects(() => ai.chat([{ role: 'user', content: 'hi' }]), (e) => e.noKey === true && /No AI key is set/.test(e.message) && /Free service/.test(e.message));
  });
});

test('chatbot: the person sees "typing..." while the AI thinks, then it stops', async () => {
  tiny();
  setKeys({ gemini: 'g-key' });
  const chatbot = require('../whatsapp/chatbot');
  chatbot.save({ on: true, scope: 'all' });
  const presence = [];
  const sent = [];
  const sock = { sendPresenceUpdate: async (state) => { presence.push(state); }, sendMessage: async (j, c) => { sent.push(c); return {}; } };
  await withFetch(() => geminiOk('Hi, I am NelsonFx'), async () => {
    await chatbot.maybeReply({ sock, msg: { key: { remoteJid: '27833333333@s.whatsapp.net', id: 'C1', fromMe: false } }, jid: '27833333333@s.whatsapp.net', text: 'hello', botIds: [], isOwner: async () => false });
  });
  assert.deepStrictEqual(presence, ['composing', 'paused']);
  assert.strictEqual(sent[0].text, 'Hi, I am NelsonFx');
});

// ---------------------------------------------------------------- view once
const OWNER_CHAT = '27800000001@s.whatsapp.net'; // the owner's chat (tests/_setup.js sets the owner number)
const FRIEND = '27833333333@s.whatsapp.net';
let sent;
const mkSock = (extra = {}) => {
  sent = [];
  return { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; }, groupMetadata: async () => ({ subject: 'G', participants: [] }), ...extra };
};
const once = (id, node, wrapper = 'viewOnceMessageV2') => ({ key: { remoteJid: FRIEND, id, fromMe: false }, message: { [wrapper]: { message: { imageMessage: node } } }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada' });
const FULL = { mediaKey: 'k', url: 'https://x', directPath: '/d', mimetype: 'image/jpeg', caption: 'look' };
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 120)); };
const copies = () => sent.filter((s) => s.c.image);
const notices = () => sent.filter((s) => s.c.text && /did not send its content/.test(s.c.text));

test('view-once: a complete message is copied to the owner chat with its caption', async () => {
  store.setCmdReact('off');
  store.updateWatch('viewonce', (w) => { w.mode = 'all'; });
  const sock = mkSock();
  await handler.handleMessage(sock, once('V1', FULL));
  await settle();
  assert.strictEqual(copies().length, 1);
  assert.strictEqual(copies()[0].j, OWNER_CHAT);
  assert.match(copies()[0].c.caption, /View-once picture/);
  assert.match(copies()[0].c.caption, /look/);
  assert.strictEqual(copies()[0].c.image.toString(), 'FILE-V1');
});

test('view-once: the same message delivered twice is copied once', async () => {
  const sock = mkSock();
  await handler.handleMessage(sock, once('V2', FULL));
  await handler.handleMessage(sock, once('V2', FULL));
  await settle();
  assert.strictEqual(copies().length, 1);
});

test('view-once: a message that first arrives WITHOUT its file and then complete (same id) is no longer thrown away as a duplicate', async () => {
  const asked = [];
  const sock = mkSock({ requestPlaceholderResend: async (key) => { asked.push(key.id); } });
  await handler.handleMessage(sock, once('V3', { viewOnce: true })); // placeholder: no media key, no url
  await settle();
  assert.deepStrictEqual(asked, ['V3'], 'the phone is asked for the file');
  assert.strictEqual(copies().length, 0);
  await handler.handleMessage(sock, once('V3', FULL)); // the complete one, same id
  await settle();
  assert.strictEqual(copies().length, 1, 'the complete message was copied');
  assert.strictEqual(notices().length, 0, 'no "WhatsApp did not send its content" notice, the file did come');
  assert.ok(watchers.stats.viewOnceAsked >= 1);
});

test('view-once: when the file never comes the owner is told what to do (reply with vv), after the phone had a moment to answer', async () => {
  watchers.resetWarnings();
  watchers.timing.resendWait = 150;
  try {
    const sock = mkSock({ requestPlaceholderResend: async () => {} });
    await handler.handleMessage(sock, once('V4', { viewOnce: true }));
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(notices().length, 0, 'not at once: the phone gets a moment to answer');
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(notices().length, 1);
    assert.match(notices()[0].c.text, /\*vv\*/);
  } finally { watchers.timing.resendWait = 12000; }
});

test('view-once: without the resend call in the library the owner is told straight away', async () => {
  watchers.resetWarnings();
  const sock = mkSock();
  await handler.handleMessage(sock, once('V5', { viewOnce: true }));
  await settle();
  assert.strictEqual(notices().length, 1);
});

test('view-once: a failed download is told to the owner and a later delivery may try again', async () => {
  let fail = true;
  baileys.setForTests({ downloadMediaMessage: async (m) => { if (fail) throw new Error('decrypt failed'); return Buffer.from(`FILE-${m.key.id}`); } });
  try {
    const sock = mkSock();
    await handler.handleMessage(sock, once('V6', FULL));
    await new Promise((r) => setTimeout(r, 2200)); // the library call is tried twice, 1.5 s apart
    assert.strictEqual(copies().length, 0);
    fail = false;
    await handler.handleMessage(sock, once('V6', FULL));
    await settle();
    assert.strictEqual(copies().length, 1, 'the second delivery was copied');
  } finally {
    baileys.setForTests({ downloadMediaMessage: async (m) => Buffer.from(`FILE-${m.key.id}`) });
  }
});

test('vv: when the quoted copy lost its file details, the complete message the bot saw lately is used', async () => {
  store.updateWatch('viewonce', (w) => { w.mode = 'off' }); // vv works with the automatic copy switched off
  const sock = mkSock();
  await handler.handleMessage(sock, once('V7', FULL));
  await settle();
  assert.ok(watchers.recentViewOnce('V7'), 'the complete message was kept for a while');
  const out = [];
  await vv.run({
    sock, jid: FRIEND, args: [], botIds: [], prefix: '.', reply: async (t) => out.push(t),
    msg: { key: { remoteJid: FRIEND, id: 'CMD1' }, message: { extendedTextMessage: { text: '.vv', contextInfo: { stanzaId: 'V7', participant: FRIEND, quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { viewOnce: true } } } } } } } },
  });
  const img = sent.find((s) => s.c.image && /View-once opened/.test(s.c.caption));
  assert.ok(img, 'the picture was opened');
  assert.strictEqual(img.c.image.toString(), 'FILE-V7');
  assert.match(img.c.caption, /look/);
  assert.deepStrictEqual(out, []);
});

// ---------------------------------------------------------------- slow replies
test('link preview: a reply with a link is never held back for long', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'core', 'linkpreview.js'), 'utf8');
  assert.match(src, /BUDGET_MS = 1500/);
  assert.match(src, /UPLOAD_MS = 1200/);
});

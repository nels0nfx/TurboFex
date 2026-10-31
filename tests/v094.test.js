// v0.9.4: new menu header, gold/white/black console lines, recipe steps on separate lines, anime fallback, chatbot that answers (or says why not)
require('./_setup');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const web = require('../core/web');
const store = require('../whatsapp/store');
const chatlog = require('../core/chatlog');
const ai = require('../core/ai');
const chatbot = require('../whatsapp/chatbot');
const lookups = require('../commands/lookups3');
const aiCmds = require('../commands/ai');
const menu = require('../commands/menu');

const find = (list, name) => list.find((c) => c.name === name);
const all = () => [].concat(...fs.readdirSync(path.join(__dirname, '..', 'commands')).filter((f) => f.endsWith('.js')).map((f) => require(`../commands/${f}`)));
const GROUP = '120363000000000101@g.us';

async function run(cmd, text = '', extra = {}) {
  const out = { replies: [], sent: [] };
  await cmd.run({
    jid: GROUP, args: text.split(/\s+/).filter(Boolean), rest: text, prefix: '.', isOwner: !!extra.isOwner, isAdmin: false,
    msg: { key: { remoteJid: GROUP, participant: '27811111111@s.whatsapp.net', id: 'Y1' }, message: { conversation: text } },
    reply: async (t) => out.replies.push(t),
    sock: { sendMessage: async (j, c) => { out.sent.push(c); return {}; } },
    ...(extra.ctx || {}),
  });
  out.text = out.replies.join('\n');
  return out;
}
const withFakeWeb = async (fake, fn) => {
  const keep = { j: web.getJson, b: web.getBuffer };
  web.getJson = async (url, opts) => fake(url, opts);
  web.getBuffer = async () => Buffer.from('pic');
  try { return await fn(); } finally { web.getJson = keep.j; web.getBuffer = keep.b; }
};

// ---------------------------------------------------------------- menu
test('the menu has a new header, no spaced-out letters, and the commands sit right under the category name', async () => {
  const out = [];
  await menu.run({ reply: async (t) => out.push(t), commandList: all(), prefix: '.', args: [], isOwner: false, isAdmin: false });
  const text = out[0];
  assert.match(text, /^╭━+╮\n┃  ✦ \*TURBOFEX\* ✦\n┃  _WhatsApp Assistant_\n┣━+\n┃ User ▸ Member  ·  Mode ▸ \w+\n/);
  assert.ok(!text.includes('```'), 'no code block (WhatsApp pads it with empty space)');
  assert.ok(/\n╰━+╯\n\n┏━ /.test(text), 'the first category follows the header after one empty line only');
  assert.ok(!/\d{1,2}:\d{2}\s?(AM|PM)/i.test(text.split('\n┏━ ')[0]), 'no clock time in the header (WhatsApp underlines it)');
  assert.ok(!/T U R B O/.test(text), 'the name is not spaced out');
  const lines = text.split('\n');
  const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^┏━ /.test(l));
  assert.ok(heads.length >= 10);
  for (const [, i] of heads) {
    assert.ok(/^┃ \S/.test(lines[i + 1]), `a command line follows straight after the category name (line ${i + 1})`);
    assert.ok(lines[i + 1].trim() !== '', 'no empty line after the category name');
  }
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(text), 'no emoji in the menu');
});

test('menu <category> puts the name and the description on one line', async () => {
  const out = [];
  await menu.run({ reply: async (t) => out.push(t), commandList: all(), prefix: '.', args: ['group'], isOwner: false, isAdmin: false });
  const line = out[0].split('\n').find((l) => l.includes('*listonline*'));
  assert.ok(line && line.includes('–'), 'name and description share a line');
});

// ---------------------------------------------------------------- console lines
test('console lines: gold badge for the time, white badge for GROUP / PRIVATE, no colour codes from people, and a plain mode', () => {
  const was = { c: process.env.CONSOLE_COLOR, n: process.env.NO_COLOR };
  delete process.env.CONSOLE_COLOR; delete process.env.NO_COLOR;
  try {
    const line = chatlog.format({ time: '21:35', group: true, chat: 'Fex Squad', who: 'Ada', text: 'hello \x1b[31mRED\x1b[0m\nsecond', isCommand: false });
    assert.ok(line.includes('\x1b[48;5;220m') && line.includes('\x1b[30m'), 'black text on a gold badge');
    assert.ok(line.includes('\x1b[107m'), 'black text on a white badge');
    assert.ok(line.includes('\x1b[38;5;220m'), 'gold chat name');
    assert.ok(line.includes('\x1b[97m'), 'white text');
    assert.ok(/GROUP/.test(line) && /Fex Squad/.test(line) && /Ada/.test(line));
    assert.ok(!line.includes('\x1b[31m'), 'a colour code typed by a person is removed');
    assert.ok(line.includes('second') && line.includes('⏎'), 'a new line in a message becomes one line');
    const dm = chatlog.format({ time: '21:36', group: false, chat: '', who: 'Tunde', text: '', kind: 'image' });
    assert.ok(/PRIVATE/.test(dm) && /\[image\]/.test(dm));
    process.env.CONSOLE_COLOR = 'off';
    const plain = chatlog.format({ time: '21:36', group: true, chat: 'G', who: 'Ada', text: 'hi' });
    assert.ok(!plain.includes('\x1b'), 'no colour codes when colours are off');
    assert.match(plain, /21:36\s+GROUP\s+G › Ada │ hi/);
    const long = chatlog.format({ time: '1:00', group: false, chat: '', who: 'X', text: 'a'.repeat(500) });
    assert.ok(long.length < 260, 'long messages are cut');
  } finally {
    if (was.c === undefined) delete process.env.CONSOLE_COLOR; else process.env.CONSOLE_COLOR = was.c;
    if (was.n !== undefined) process.env.NO_COLOR = was.n;
  }
});

test('the handler prints one line for each message when the console log is on, and nothing when it is off', async () => {
  const baileys = require('../core/baileys');
  baileys.setForTests({});
  const handler = require('../whatsapp/handler');
  const lines = [];
  const keep = console.log;
  const sock = { user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' }, sendMessage: async () => ({ key: { id: 'K' } }), groupMetadata: async () => ({ subject: 'Fex Squad', participants: [] }) };
  let n = 0;
  const send = async (text, group = true) => {
    const jid = group ? GROUP : '27833333333@s.whatsapp.net';
    await handler.handleMessage(sock, { key: { remoteJid: jid, participant: group ? '27833333333@s.whatsapp.net' : undefined, id: `L${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada' });
    await handler.idle();
  };
  process.env.CONSOLE_COLOR = 'off';
  try {
    process.env.CONSOLE_CHAT = 'on';
    console.log = (...a) => lines.push(a.join(' '));
    await send('hello there');
    await send('second message');
    await send('a private hello', false);
    process.env.CONSOLE_CHAT = 'off';
    await send('this one is not shown');
  } finally {
    console.log = keep;
    process.env.CONSOLE_CHAT = 'off';
    delete process.env.CONSOLE_COLOR;
  }
  const mine = lines.filter((l) => /GROUP|PRIVATE/.test(l));
  assert.strictEqual(mine.length, 3, 'three messages, three lines');
  assert.ok(mine.some((l) => /hello there/.test(l) && /Ada/.test(l)));
  assert.ok(mine.some((l) => /Fex Squad/.test(l)), 'the group name shows once it is known');
  assert.ok(mine.some((l) => /PRIVATE/.test(l) && /a private hello/.test(l)));
  assert.ok(!mine.some((l) => /not shown/.test(l)));
});

// ---------------------------------------------------------------- recipes
const SEAFOOD = { meals: [{ idMeal: '52772', strMeal: 'Seafood rice', strCategory: 'Seafood', strArea: 'Spanish', strIngredient1: 'Olive Oil', strMeasure1: '1 tbsp', strInstructions: 'step 1 Heat the oil in a deep frying pan, then soften the leek for 5 mins without browning. Add the chorizo. step 2 Tip in the peas and cook for 5 mins, then stir in the seafood. Check for seasoning and serve immediately with lemon wedges.', strYoutube: 'https://www.youtube.com/watch?v=abc', strMealThumb: 'https://img.example/m.jpg' }] };

test('meal: every step is on its own numbered line, the picture carries the name, and the recipe is a separate message', async () => {
  await withFakeWeb(() => SEAFOOD, async () => {
    const out = await run(find(lookups, 'meal'), 'seafood rice');
    assert.match(out.sent[0].caption, /Seafood rice/);
    assert.match(out.sent[0].caption, /Seafood • Spanish/);
    const lines = out.text.split('\n');
    assert.ok(lines.includes('*1.* Heat the oil in a deep frying pan, then soften the leek for 5 mins without browning. Add the chorizo.'), 'step 1 is one line');
    assert.ok(lines.some((l) => l.startsWith('*2.* Tip in the peas')), 'step 2 is its own line');
    assert.ok(!/step 1|step 2/i.test(out.text), 'the "step 1" words from the source are gone');
    assert.match(out.text, /▶️ https:\/\/www\.youtube\.com/);
  });
});

test('meal: without a picture the name and the recipe go together; a very long method is cut between steps, never in the middle', async () => {
  const keep = web.getBuffer;
  const long = { meals: [{ ...SEAFOOD.meals[0], strInstructions: Array.from({ length: 40 }, (_, i) => `step ${i + 1} Do the thing number ${i + 1} carefully and slowly for a long time so it takes space.`).join(' ') }] };
  try {
    await withFakeWeb(() => long, async () => {
      web.getBuffer = async () => { throw new Error('no picture'); };
      const out = await run(find(lookups, 'meal'), 'x');
      assert.strictEqual(out.sent.length, 0);
      assert.match(out.text, /^🍽️ \*Seafood rice\*/);
      assert.match(out.text, /\.\.\.and \d+ more steps?: https:\/\/www\.themealdb\.com\/meal\/52772/);
      const steps = out.text.split('\n').filter((l) => /^\*\d+\.\*/.test(l));
      assert.ok(steps.length > 5 && steps.length < 40);
      assert.ok(steps.every((l) => l.endsWith('.')), 'no step is cut in the middle');
    });
  } finally { web.getBuffer = keep; }
});

test('cocktail steps are numbered on separate lines too', async () => {
  const drink = { drinks: [{ strDrink: 'Mojito', strCategory: 'Cocktail', strAlcoholic: 'Alcoholic', strGlass: 'Highball', strIngredient1: 'Mint', strMeasure1: '4 leaves', strInstructions: 'Muddle mint leaves with sugar and lime juice. Add a splash of soda water and fill the glass with cracked ice. Pour the rum over the ice and stir gently.', strDrinkThumb: 'https://img.example/d.jpg' }] };
  await withFakeWeb(() => drink, async () => {
    const out = await run(find(lookups, 'cocktail'), 'mojito');
    const steps = out.text.split('\n').filter((l) => /^\*\d+\.\*/.test(l));
    assert.ok(steps.length >= 2, 'more than one step line');
  });
});

// ---------------------------------------------------------------- anime
const JIKAN = { data: [{ title: 'Naruto', title_english: 'Naruto', type: 'TV', episodes: 220, status: 'Finished Airing', score: 8.0, genres: [{ name: 'Action' }], synopsis: 'A ninja story.', url: 'https://mal.example/1', images: { jpg: { image_url: 'https://img.example/a.jpg' } } }] };
const KITSU = { data: [{ attributes: { canonicalTitle: 'Naruto', titles: { en: 'Naruto', en_jp: 'Naruto' }, subtype: 'TV', episodeCount: 220, status: 'finished', startDate: '2002-10-03', averageRating: '79.9', synopsis: 'Kitsu story.', slug: 'naruto', posterImage: { medium: 'https://img.example/k.jpg' } } }], included: [{ type: 'genres', attributes: { name: 'Ninja' } }] };

test('anime: Jikan works; when Jikan is down Kitsu answers; when both are down the owner sees why and members do not', async () => {
  const calls = [];
  await withFakeWeb((url) => { calls.push(url); return JIKAN; }, async () => {
    assert.match((await run(find(lookups, 'anime'), 'naruto')).sent[0].caption, /Episodes:\* 220/);
  });
  calls.length = 0;
  await withFakeWeb((url) => { calls.push(url); if (url.includes('jikan')) throw new Error('the service answered 503'); return KITSU; }, async () => {
    const out = await run(find(lookups, 'anime'), 'naruto');
    assert.match(out.sent[0].caption, /Kitsu story/);
    assert.match(out.sent[0].caption, /Genres:\* Ninja/);
    assert.match(out.sent[0].caption, /Score:\* 8/);
    assert.match(out.sent[0].caption, /Finished Airing/);
    assert.ok(calls.filter((u) => u.includes('jikan')).length === 2, 'Jikan gets a second try');
  });
  await withFakeWeb(() => { throw new Error('the service answered 503'); }, async () => {
    const member = await run(find(lookups, 'anime'), 'naruto');
    assert.match(member.text, /not answering/);
    assert.ok(!/Reason|503/.test(member.text), 'members do not see the technical reason');
    const owner = await run(find(lookups, 'anime'), 'naruto', { isOwner: true });
    assert.match(owner.text, /Reason: Jikan: the service answered 503/);
    assert.match(owner.text, /Kitsu/);
  });
  await withFakeWeb((url) => (url.includes('jikan') ? { data: [] } : KITSU), async () => {
    assert.match((await run(find(lookups, 'anime'), 'zzzz')).text, /could not find an anime/);
  });
});

// ---------------------------------------------------------------- the AI and the chatbot
const okReply = (text) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
const geminiReply = (text) => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
const errReply = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }) });
async function withFetch(handlerFn, fn) {
  const keep = global.fetch;
  const log = [];
  global.fetch = async (url, opts) => { log.push({ url: String(url), opts }); return handlerFn(String(url), opts, log); };
  try { return await fn(log); } finally { global.fetch = keep; }
}
const setKeys = (keys) => { for (const k of ['gemini', 'groq', 'pollinations']) store.setApiKey(k, keys[k] || null); };

test('AI: a retired Gemini model is skipped and the next one answers (and is remembered)', async () => {
  setKeys({ gemini: 'AIza-test-key-0000000000' });
  try {
    await withFetch((url) => (/gemini-flash-latest/.test(url) ? errReply(404, 'models/gemini-flash-latest is not found') : geminiReply('Hello from Gemini')), async (log) => {
      assert.strictEqual(await ai.chat([{ role: 'user', content: 'hi' }]), 'Hello from Gemini');
      assert.ok(log[0].url.includes('gemini-flash-latest') && log[1].url.includes('gemini-3.5-flash'), 'the next model was tried');
      assert.ok(!log.some((l) => l.url.includes('key=')), 'the key is not put in the address');
      assert.strictEqual(log[0].opts.headers['x-goog-api-key'], 'AIza-test-key-0000000000');
      log.length = 0;
      await ai.chat([{ role: 'user', content: 'again' }]);
      assert.ok(log[0].url.includes('gemini-3.5-flash'), 'the model that worked is tried first next time');
    });
  } finally { setKeys({}); }
});

test('AI: when the Gemini key is refused the other services are tried; Groq answers; a model that thinks out loud is cleaned', async () => {
  setKeys({ gemini: 'bad-key-000000000000', groq: 'gsk_test_000000000000' });
  try {
    await withFetch((url) => {
      if (url.includes('generativelanguage')) return errReply(400, 'API key not valid. Please pass a valid API key.');
      if (url.includes('groq.com')) return okReply('<think>hmm</think>Hi from Groq');
      throw new Error('unexpected ' + url);
    }, async (log) => {
      assert.strictEqual(await ai.chat([{ role: 'user', content: 'hi' }]), 'Hi from Groq');
      assert.strictEqual(log.filter((l) => l.url.includes('generativelanguage')).length, 1, 'a refused key stops that service at once');
      assert.strictEqual(ai.status().lastUsed.service, 'Groq');
    });
  } finally { setKeys({}); }
});

test('AI: with no key and a dead free service the error says so', async () => {
  setKeys({});
  await withFetch(() => errReply(401, 'Authentication required'), async () => {
    await assert.rejects(() => ai.chat([{ role: 'user', content: 'hi' }]), (e) => /Free service/.test(e.message) && /No AI key is set/.test(e.message) && e.noKey === true);
  });
});

test('the chatbot says it could not answer (it used to stay silent); only the owner sees the reason', async () => {
  store.setAuto('chatbot', { on: true, scope: 'all', chats: [] });
  const sent = [];
  const sock = { sendMessage: async (j, c) => { sent.push(c.text); return {}; } };
  const dm = (id) => ({ key: { remoteJid: `27833333333${id}@s.whatsapp.net`, id: `C${id}`, fromMe: false }, message: { conversation: 'hello' }, pushName: 'Ada' });
  try {
    await withFetch(() => errReply(401, 'Authentication required'), async () => {
      const m = dm(1);
      await chatbot.maybeReply({ sock, msg: m, jid: m.key.remoteJid, text: 'hello', botIds: ['27899999999'], isOwner: async () => false });
      assert.strictEqual(sent.length, 1);
      assert.match(sent[0], /could not think of an answer/);
      assert.ok(!/Reason|Authentication/.test(sent[0]), 'members see no technical text');
      const o = dm(2);
      await chatbot.maybeReply({ sock, msg: o, jid: o.key.remoteJid, text: 'hello', botIds: ['27899999999'], isOwner: async () => true });
      assert.match(sent[1], /Reason:/);
      assert.match(sent[1], /setapi gemini/);
      // not twice in a row in the same chat
      const again = dm(2);
      again.key.id = 'C99';
      await new Promise((r) => setTimeout(r, 3100));
      await chatbot.maybeReply({ sock, msg: again, jid: o.key.remoteJid, text: 'hello again', botIds: ['27899999999'], isOwner: async () => true });
      assert.strictEqual(sent.length, 2, 'the same chat is not nagged again so soon');
    });
    // and it answers when the service works
    setKeys({ gemini: 'AIza-test-key-0000000000' });
    await withFetch(() => geminiReply('I am NelsonFx!'), async () => {
      const m = dm(3);
      await chatbot.maybeReply({ sock, msg: m, jid: m.key.remoteJid, text: 'who are you', botIds: ['27899999999'], isOwner: async () => false });
      assert.strictEqual(sent[sent.length - 1], 'I am NelsonFx!');
    });
  } finally {
    store.setAuto('chatbot', { on: false, scope: 'dms', chats: [] });
    setKeys({});
  }
});

test('chatbot test reports each service (owner command), and setapi knows groq and pollinations', async () => {
  const bot = find(aiCmds, 'chatbot');
  setKeys({ groq: 'gsk_test_000000000000' });
  try {
    await withFetch((url) => (url.includes('groq.com') ? okReply('OK') : errReply(401, 'Authentication required')), async () => {
      const out = await run(bot, 'test', { isOwner: true });
      assert.match(out.text, /✅ \*Groq\* works/);
      assert.match(out.text, /❌ \*Free service:\*/);
      assert.match(out.text, /The chatbot can answer/);
    });
    assert.match((await run(bot, '', { isOwner: true })).text, /Keys:\* groq/);
  } finally { setKeys({}); }
  assert.ok(store.apiKeyNames().includes('groq') && store.apiKeyNames().includes('pollinations'));
  const setapi = require('../commands/setapi');
  assert.match((await run(setapi, '', { isOwner: true })).text, /console\.groq\.com/);
});

test('.ai tells the owner why it failed and members only that it is busy', async () => {
  setKeys({});
  const ask = find(aiCmds, 'ai');
  await withFetch(() => errReply(500, 'down'), async () => {
    const member = await run(ask, 'hello');
    assert.match(member.text, /not answering/);
    assert.ok(!/Reason/.test(member.text));
    const owner = await run(ask, 'hello', { isOwner: true });
    assert.match(owner.text, /Reason:/);
    assert.match(owner.text, /chatbot test/);
  });
});

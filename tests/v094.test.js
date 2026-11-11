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
test('the menu header and categories open and close with a symbol, one detail per line, no "WhatsApp Assistant"', async () => {
  const out = [];
  await menu.run({ reply: async (t) => out.push(t), commandList: all(), prefix: '.', args: [], isOwner: false, isAdmin: false, timing: { receivedAt: Date.now() } });
  const text = out[0];
  assert.match(text, /^╔═+\n║ +✦ ◈ \*TURBOFEX\* ◈ ✦\n╠═+\n║ 👤 \*ᴜꜱᴇʀ\* ▸ Member\n╟─+\n║ ⌨️ \*ᴘʀᴇꜰɪx\* ▸ \[ \. \]\n║ (?:🔒|🌍) \*ᴍᴏᴅᴇ\* ▸ \w+\n║ 📋 \*ᴄᴏᴍᴍᴀɴᴅꜱ\* ▸ \d+\n║ 🏷️ \*ᴠᴇʀꜱɪᴏɴ\* ▸ v\d+\.\d+\.\d+\n╟─+\n║ ⚡ \*ꜱᴘᴇᴇᴅ\* ▸ \d+ ms\n║ ⏱️ \*ᴜᴘᴛɪᴍᴇ\* ▸ [^\n]+\n╚═+\n\n┏/);
  assert.ok(!/WhatsApp Assistant/.test(text) && !/ʜᴏꜱᴛ/.test(text), 'no subtitle; host and memory are for the owner only');
  assert.ok(!text.includes('```'), 'no code block (WhatsApp pads it with empty space)');
  const lines = text.split('\n');
  const heads = lines.map((l, i) => [l, i]).filter(([l]) => /^┏ ❏ [A-Z ]+ ❏$/.test(l)).slice(1); // (the first one is the header)
  assert.ok(heads.length >= 10);
  for (const [l, i] of heads) {
    const sym = [...lines[i + 1]][2]; // the commands keep the category's own symbol; the heading is always ┏ ❏ NAME ❏
    assert.ok(new RegExp(`^┃ ${sym} \\S`).test(lines[i + 1]), 'a command line, starting with the category symbol, follows the name');
    let j = i + 1; while (lines[j] && lines[j] !== `┗${sym}`) j++;
    assert.strictEqual(lines[j], `┗${sym}`, 'the category closes with the same symbol its commands use');
  }
  assert.ok(new Set(heads.map(([, i]) => [...lines[i + 1]][2])).size > 8, 'categories have different symbols');
  const owner = [];
  await menu.run({ reply: async (t) => owner.push(t), commandList: all(), prefix: '.', args: [], isOwner: true, isAdmin: true, timing: { receivedAt: Date.now() } });
  assert.match(owner[0], /║ 🖥️ \*ʜᴏꜱᴛ\* ▸ .+\n║ 💾 \*ᴜꜱᴀɢᴇ\* ▸ \d+ MB of .+\n║ 📊 \*ʀᴀᴍ\* ▸ \[[█░]{10}\] \d+%\n╚═/);
});

test('menu <category> is the old look: the name, then the description under it', async () => {
  const out = [];
  await menu.run({ reply: async (t) => out.push(t), commandList: all(), prefix: '.', args: ['group'], isOwner: false, isAdmin: false });
  const lines = out[0].split('\n');
  const i = lines.findIndex((l) => l.includes('*listonline*'));
  assert.ok(i > 0 && /^┃    _/.test(lines[i + 1]), 'the description sits under the name');
});

// ---------------------------------------------------------------- console lines
const cardOf = (extra = {}) => chatlog.card({ time: '21:35:07', group: true, chat: 'Fex Squad', members: 128, who: 'Ada', role: 'Admin', number: '+27833333333', kind: 'text', isCommand: false, command: '', text: 'hello', ms: 48, ...extra });
const plain = (t) => t.replace(/\x1b\[[0-9;]*m/g, '');

test('console card: gradient colours, readable badges, every field there, wraps long text, and fits a phone screen', () => {
  const was = { c: process.env.CONSOLE_COLOR, n: process.env.NO_COLOR, w: process.env.CONSOLE_WIDTH };
  delete process.env.CONSOLE_COLOR; delete process.env.NO_COLOR; delete process.env.CONSOLE_WIDTH;
  try {
    const coloured = cardOf({ isCommand: true, command: 'menu', text: '.menu' });
    assert.ok(/\x1b\[38;2;\d+;\d+;\d+m/.test(coloured), 'full (24-bit) colours');
    assert.ok(/\x1b\[48;2;\d+;\d+;\d+m\x1b\[38;2;12;12;28m/.test(coloured), 'a badge has an explicit dark text colour (the basic "black" is redrawn by some panels and was unreadable)');
    assert.ok(!coloured.includes('\x1b[30m') && !coloured.includes('\x1b[107m'), 'no basic black or white');
    const lines = plain(coloured).split('\n');
    assert.match(lines[0], /^╭─ 21:35:07 ─  GROUP  ─  CMD  ─+$/);
    for (const label of ['Chat    Fex Squad (128)', 'From    Ada · Admin', 'Number  +27833333333', 'Kind    text · command menu', 'Text    .menu']) assert.ok(lines.some((l) => l === `│ ${label}`), label);
    assert.match(lines[lines.length - 2], /^│ Speed   ▰{8} 48 ms$/);
    assert.match(lines[lines.length - 1], /^╰─ instant ─+$/);
    const long = plain(cardOf({ text: 'word '.repeat(80) })).split('\n');
    assert.ok(long.filter((l) => /^│ (Text    |        )\S/.test(l)).length === 3, 'a long message is cut after three lines');
    assert.ok(long.some((l) => l.endsWith('…')));
    for (const l of [...lines, ...long]) assert.ok([...l].length <= 36, `fits a phone: ${l}`);
    // a colour code typed by a person is removed
    assert.ok(!cardOf({ text: 'hello \x1b[31mRED\x1b[0m' }).includes('\x1b[31m'));
    // other kinds
    const dm = plain(cardOf({ group: false, chat: '', members: 0, role: '', kind: 'reaction', text: '❤️', ms: 1700 }));
    assert.ok(/PRIVATE/.test(dm) && /Chat    Private chat/.test(dm) && /Kind    reaction/.test(dm) && /Text    ❤️/.test(dm) && /Speed   ▰{3}▱{5} 1\.70 s/.test(dm) && /╰─ slowish/.test(dm));
    const mine = plain(cardOf({ group: false, who: 'You', fromMe: true, number: '', kind: 'image', text: '', ms: 3200 }));
    assert.ok(/From    You · bot account/.test(mine) && !/Number/.test(mine) && !/Text/.test(mine) && /╰─ slow /.test(mine));
    // themes and the 256-colour mode
    process.env.CONSOLE_THEME = 'aurora';
    assert.notStrictEqual(cardOf(), coloured.replace(/menu/g, 'hello'));
    process.env.CONSOLE_COLOR = '256';
    assert.ok(/\x1b\[38;5;\d+m/.test(cardOf()) && !/\x1b\[38;2/.test(cardOf()), 'old terminals get 256 colours');
    delete process.env.CONSOLE_THEME;
    // the width follows CONSOLE_WIDTH
    process.env.CONSOLE_COLOR = 'off';
    process.env.CONSOLE_WIDTH = '50';
    assert.ok(plain(cardOf()).split('\n')[0].length >= 48, 'a wider card');
    process.env.CONSOLE_WIDTH = '36';
    assert.ok(!cardOf().includes('\x1b'), 'no colour codes when colours are off');
  } finally {
    delete process.env.CONSOLE_THEME;
    delete process.env.CONSOLE_WIDTH;
    if (was.c === undefined) delete process.env.CONSOLE_COLOR; else process.env.CONSOLE_COLOR = was.c;
    if (was.n !== undefined) process.env.NO_COLOR = was.n;
  }
});

test('console card: the number shows one + (it used to show ++)', () => {
  const names = require('../whatsapp/names');
  const idmap = require('../whatsapp/idmap');
  const jid = '2349138567333@s.whatsapp.net';
  assert.ok(idmap.isPn(jid));
  assert.strictEqual(names.phoneOf(jid), '+2349138567333');
  process.env.CONSOLE_COLOR = 'off';
  try {
    const base = { time: '09:35:58', group: false, chat: '', members: 0, who: 'X', role: '', kind: 'text', isCommand: false, command: '', text: 'Hi', ms: 68 };
    const msg = { key: { remoteJid: jid, id: 'PL1', fromMe: false }, pushName: 'X' };
    const keep = console.log; const printed = [];
    console.log = (...a) => printed.push(a.join(' '));
    process.env.CONSOLE_CHAT = 'on';
    try { chatlog.incoming({ msg, jid, isGroup: false, text: 'Hi', content: { conversation: 'Hi' }, prefix: '.', isCommand: false }); chatlog.finish(msg); } finally { console.log = keep; process.env.CONSOLE_CHAT = 'off'; }
    assert.ok(/Number  \+2349138567333\b/.test(printed.join('\n')) && !/\+\+/.test(printed.join('\n')));
    assert.ok(base);
  } finally { delete process.env.CONSOLE_COLOR; }
});

test('console: the handler prints one card per message, with the group name, the real speed and the command; off and compact work', async () => {
  const baileys = require('../core/baileys');
  baileys.setForTests({});
  const handler = require('../whatsapp/handler');
  const prints = [];
  const keep = console.log;
  const sock = { user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' }, sendMessage: async () => ({ key: { id: 'K' } }), groupMetadata: async () => ({ subject: 'Fex Squad', participants: [{ id: '27833333333@s.whatsapp.net', admin: 'admin' }, { id: '27800000001@s.whatsapp.net' }] }) };
  let n = 0;
  const send = async (text, group = true, extra = {}) => {
    const jid = group ? GROUP : '27833333333@s.whatsapp.net';
    await handler.handleMessage(sock, { key: { remoteJid: jid, participant: group ? '27833333333@s.whatsapp.net' : undefined, id: `L${++n}`, fromMe: false }, message: extra.message || { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada' });
    await handler.idle();
  };
  process.env.CONSOLE_COLOR = 'off';
  try {
    process.env.CONSOLE_CHAT = 'on';
    console.log = (...a) => prints.push(a.join(' '));
    await send('hello there');
    await send('.menu');
    await send('a private hello', false);
    await send('', true, { message: { reactionMessage: { text: '❤️', key: { id: 'X' } } } });
    process.env.CONSOLE_CHAT = 'compact';
    await send('short line');
    process.env.CONSOLE_CHAT = 'off';
    await send('this one is not shown');
  } finally {
    console.log = keep;
    process.env.CONSOLE_CHAT = 'off';
    delete process.env.CONSOLE_COLOR;
  }
  const cards = prints.filter((p) => /╭─/.test(p));
  assert.strictEqual(cards.length, 4, 'four cards, one for each message');
  assert.ok(prints.every((p) => !/not shown/.test(p)));
  const first = cards[0];
  assert.match(first, /GROUP/); assert.match(first, /Text    hello there/); assert.match(first, /From    Ada/); assert.match(first, /Speed   [▰▱]{8} \d+ ms/);
  assert.match(cards[1], /Chat    Fex Squad \(2\)/, 'the group name and size show once the group is known');
  assert.match(cards[1], /From    Ada · Admin/);
  assert.match(cards[1], /Kind    text · command menu/);
  assert.match(cards[2], /PRIVATE/); assert.match(cards[2], /Chat    Private chat/);
  assert.match(cards[3], /Kind    reaction/); assert.match(cards[3], /Text    ❤️/);
  const short = prints.filter((p) => /short line/.test(p));
  assert.strictEqual(short.length, 1);
  assert.ok(!/╭─/.test(short[0]) && !short[0].includes('\n'), 'compact is one line');
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

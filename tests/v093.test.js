// v0.9.3: 49 new commands (fun, lookup, tools, group). The web services are replaced by fakes: no network is used.
require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const web = require('../core/web');
const safefetch = require('../core/safefetch');
const store = require('../whatsapp/store');
const names = require('../whatsapp/names');
const nicks = require('../whatsapp/nicknames');
const joined = require('../whatsapp/joined');
const recent = require('../whatsapp/recent');
const moon = require('../core/moon');
const fun = require('../commands/fun2');
const lookups = require('../commands/lookups3');
const tools = require('../commands/tools3');
const group = require('../commands/group3');

const find = (list, name) => list.find((c) => c.name === name);
const NEW = { fun: fun, lookup: lookups, tools: tools, group: group };
const ME = '27811111111@s.whatsapp.net';
const OTHER = '27822222222@s.whatsapp.net';
const GROUP = '120363000000000093@g.us';

// runs one command with a fake chat and returns what it said
async function run(cmd, text = '', extra = {}) {
  const out = { replies: [], sent: [], opts: [] };
  const args = text.split(/\s+/).filter(Boolean);
  const tagged = extra.tagged || [];
  const ctx = {
    jid: extra.jid || GROUP,
    msg: { key: { remoteJid: extra.jid || GROUP, participant: ME, id: 'X1' }, message: { extendedTextMessage: { text, contextInfo: { mentionedJid: tagged } } } },
    args, rest: text, prefix: '.', cmdName: cmd.name, myJid: ME, myIds: ['27811111111'], botIds: ['27899999999'],
    isAdmin: extra.isAdmin !== false, isOwner: !!extra.isOwner, isBotAdmin: true,
    groupMetadata: extra.meta || { participants: [] },
    reply: async (t, o) => { out.replies.push(t); out.opts.push(o); },
    sock: {
      user: { id: '27899999999:1@s.whatsapp.net' },
      sendMessage: async (j, c) => { out.sent.push(c); return { key: { id: 'K' } }; },
      groupParticipantsUpdate: extra.update || (async (j, ids) => ids.map(() => ({ status: '200' }))),
      groupMetadata: async () => extra.meta || { participants: [] },
    },
  };
  await cmd.run(ctx);
  out.text = out.replies.join('\n');
  return out;
}
const withFakeWeb = async (fake, fn) => {
  const keep = { j: web.getJson, b: web.getBuffer };
  web.getJson = async (url) => fake(url);
  web.getBuffer = async () => Buffer.from('fakepicture');
  try { return await fn(); } finally { web.getJson = keep.j; web.getBuffer = keep.b; }
};
const down = async (cmd, text = 'x') => withFakeWeb(() => { throw new Error('the service answered 500'); }, () => run(cmd, text));

test('the 49 new commands are all there, in the right categories, with a description', () => {
  let count = 0;
  for (const [cat, list] of Object.entries(NEW)) {
    for (const c of list) {
      count++;
      assert.strictEqual(c.category, cat, `${c.name} is in ${cat}`);
      assert.ok(c.description && c.description.length > 10, `${c.name} has a description`);
      assert.strictEqual(typeof c.run, 'function');
    }
  }
  assert.strictEqual(count, 49);
  assert.deepStrictEqual(group.map((c) => c.name), ['listonline', 'newmembers', 'staff', 'nickname', 'kickall', 'kicklist']);
});

test('every new command shows a helpful hint (with the prefix) when it is used with nothing', async () => {
  const needInput = ['hug', 'slap', 'kiss', 'love', 'country', 'pokemon', 'anime', 'book', 'npm', 'holiday', 'sunrise', 'isup', 'dns', 'wordcount', 'upper', 'lower', 'leet', 'zalgo', 'ascii', 'roman', 'color', 'tip', 'percent', 'discount', 'timer', 'kicklist'];
  const all = [...fun, ...lookups, ...tools, ...group];
  for (const name of needInput) {
    const out = await run(find(all, name), '');
    assert.ok(out.text.includes('.'), `${name} answers`);
    assert.ok(!/invalid input|undefined|NaN|\[object/i.test(out.text), `${name}: no ugly text`);
    assert.ok(out.text.length > 15, `${name}: says what to do`);
  }
});

// ---------------------------------------------------------------- fun
test('hug, slap and kiss tag both people and handle yourself', async () => {
  for (const name of ['hug', 'slap', 'kiss']) {
    const out = await run(find(fun, name), '', { tagged: [OTHER] });
    assert.ok(out.text.includes('@27811111111') && out.text.includes('@27822222222'), `${name} names both`);
    assert.deepStrictEqual(out.opts[0].mentions.sort(), [ME, OTHER].sort());
    const self = await run(find(fun, name), '', { tagged: [ME] });
    assert.ok(self.text.includes('@27811111111'));
  }
});

test('love: the same two names always give the same score, in any order', async () => {
  const a = await run(find(fun, 'love'), 'Ada & Tunde');
  const b = await run(find(fun, 'love'), 'Tunde & Ada');
  const c = await run(find(fun, 'love'), 'Ada and Tunde');
  const pct = (o) => /\*(\d+)%\*/.exec(o.text)[1];
  assert.strictEqual(pct(a), pct(b));
  assert.strictEqual(pct(a), pct(c));
  assert.ok(+pct(a) >= 0 && +pct(a) <= 100);
  const one = await run(find(fun, 'love'), '', { tagged: [OTHER] });
  assert.ok(one.text.includes('@27822222222'));
  const nameWithX = await run(find(fun, 'love'), 'Maxine');
  assert.ok(/Tag someone/.test(nameWithX.text), 'a single name with an x inside is not split');
});

test('pickup, fortune and bored work with no internet; the web ones fall back or say the service is down', async () => {
  for (const name of ['pickup', 'fortune', 'bored']) assert.ok((await run(find(fun, name))).text.length > 20);
  for (const name of ['dadjoke', 'catfact', 'dogfact']) assert.ok((await down(find(fun, name))).text.length > 20, `${name} falls back to its saved list`);
  assert.match((await down(find(fun, 'advice'))).text, /not answering/);
  assert.match((await down(find(fun, 'cat'))).text, /not answering/);
  assert.match((await down(find(fun, 'dog'))).text, /not answering/);
});

test('dadjoke, advice and catfact use the web answer when there is one', async () => {
  const fake = (url) => {
    if (url.includes('icanhazdadjoke')) return { joke: 'A test joke.' };
    if (url.includes('adviceslip')) return { slip: { advice: 'Test advice.' } };
    if (url.includes('catfact.ninja')) return { fact: 'Test cat fact.' };
    if (url.includes('dogapi')) return { data: [{ attributes: { body: 'Test dog fact.' } }] };
    throw new Error('the service answered 500');
  };
  await withFakeWeb(fake, async () => {
    assert.match((await run(find(fun, 'dadjoke'))).text, /A test joke/);
    assert.match((await run(find(fun, 'advice'))).text, /Test advice/);
    assert.match((await run(find(fun, 'catfact'))).text, /Test cat fact/);
    assert.match((await run(find(fun, 'dogfact'))).text, /Test dog fact/);
  });
});

test('cat and dog send a picture', async () => {
  const fake = (url) => (url.includes('thecatapi') ? [{ url: 'https://cdn.example/cat.jpg' }] : { message: 'https://images.example/dog.jpg' });
  await withFakeWeb(fake, async () => {
    for (const name of ['cat', 'dog']) {
      const out = await run(find(fun, name));
      assert.ok(Buffer.isBuffer(out.sent[0].image), `${name} sends an image`);
    }
  });
});

// ---------------------------------------------------------------- lookups
test('country: facts, the exact name wins, and not found is friendly', async () => {
  const list = [
    { name: { common: 'Niger', official: 'Republic of Niger' }, capital: ['Niamey'], region: 'Africa', subregion: 'Western Africa', population: 1, area: 1, languages: { fra: 'French' }, currencies: {}, flag: '🇳🇪', timezones: ['UTC+01:00'] },
    { name: { common: 'Nigeria', official: 'Federal Republic of Nigeria' }, capital: ['Abuja'], region: 'Africa', subregion: 'Western Africa', population: 223800000, area: 923768, languages: { eng: 'English' }, currencies: { NGN: { name: 'Nigerian naira', symbol: '₦' } }, flag: '🇳🇬', timezones: ['UTC+01:00'] },
  ];
  await withFakeWeb(() => list, async () => {
    const out = await run(find(lookups, 'country'), 'Nigeria');
    assert.match(out.text, /Abuja/);
    assert.match(out.text, /223,800,000/);
    assert.match(out.text, /Nigerian naira \(₦\)/);
  });
  await withFakeWeb(() => { throw new Error('the service answered 404'); }, async () => {
    assert.match((await run(find(lookups, 'country'), 'Zzzland')).text, /could not find a country/);
  });
});

test('pokemon, anime, meal, cocktail, book, quran and npm read their services', async () => {
  const fake = (url) => {
    if (url.includes('pokeapi')) return { id: 25, name: 'pikachu', types: [{ type: { name: 'electric' } }], height: 4, weight: 60, abilities: [{ ability: { name: 'static' } }], stats: [{ base_stat: 35, stat: { name: 'hp' } }], sprites: { other: { 'official-artwork': { front_default: 'https://img.example/p.png' } } } };
    if (url.includes('jikan')) return { data: [{ title: 'Naruto', title_english: 'Naruto', type: 'TV', episodes: 220, status: 'Finished Airing', score: 8.0, genres: [{ name: 'Action' }], synopsis: 'A ninja story.', url: 'https://mal.example/1', images: { jpg: { image_url: 'https://img.example/a.jpg' } } }] };
    if (url.includes('themealdb')) return { meals: [{ strMeal: 'Jollof Rice', strCategory: 'Side', strArea: 'Nigerian', strIngredient1: 'Rice', strMeasure1: '2 cups', strIngredient2: '', strInstructions: 'Cook it well.', strMealThumb: 'https://img.example/m.jpg' }] };
    if (url.includes('thecocktaildb')) return { drinks: [{ strDrink: 'Mojito', strCategory: 'Cocktail', strAlcoholic: 'Alcoholic', strGlass: 'Highball', strIngredient1: 'Mint', strMeasure1: '4 leaves', strInstructions: 'Muddle.', strDrinkThumb: 'https://img.example/d.jpg' }] };
    if (url.includes('openlibrary')) return { docs: [{ title: 'Things Fall Apart', author_name: ['Chinua Achebe'], first_publish_year: 1958, key: '/works/OL1W' }] };
    if (url.includes('alquran')) return { data: [{ text: 'ARABIC', numberInSurah: 255, surah: { number: 2, englishName: 'Al-Baqarah', name: 'x' } }, { text: 'English words', numberInSurah: 255, surah: { number: 2, englishName: 'Al-Baqarah' } }] };
    if (url.includes('registry.npmjs.org')) return { name: 'express', version: '5.0.0', description: 'Web framework', license: 'MIT', dependencies: { a: '1' } };
    if (url.includes('api.npmjs.org')) return { downloads: 123456 };
    throw new Error('unexpected ' + url);
  };
  await withFakeWeb(fake, async () => {
    const p = await run(find(lookups, 'pokemon'), 'Pikachu');
    assert.ok(p.sent[0].image && /#25/.test(p.sent[0].caption), 'pokemon sends the picture with the facts');
    assert.match((await run(find(lookups, 'anime'), 'naruto')).sent[0].caption, /Episodes:\* 220/);
    assert.match((await run(find(lookups, 'meal'), 'jollof')).sent[0].caption, /2 cups Rice/);
    assert.match((await run(find(lookups, 'meal'), '')).sent[0].caption, /Jollof/, 'random meal');
    assert.match((await run(find(lookups, 'cocktail'), 'mojito')).sent[0].caption, /4 leaves Mint/);
    assert.match((await run(find(lookups, 'book'), 'things fall apart')).text, /Chinua Achebe/);
    const q = await run(find(lookups, 'quran'), '2:255');
    assert.match(q.text, /Al-Baqarah.*2:255/);
    assert.match(q.text, /English words/);
    assert.match((await run(find(lookups, 'npm'), 'express')).text, /123,456/);
  });
  assert.match((await run(find(lookups, 'quran'), '999:1')).text, /1 to 114/);
  assert.match((await run(find(lookups, 'npm'), 'Bad!Name')).text, /package name/);
});

test('pokemon: the picture is optional, the text is still sent when the picture fails', async () => {
  const keep = web.getBuffer;
  web.getBuffer = async () => { throw new Error('no'); };
  try {
    await withFakeWeb(() => ({ id: 1, name: 'bulbasaur', types: [{ type: { name: 'grass' } }], height: 7, weight: 69, abilities: [], stats: [], sprites: { other: { 'official-artwork': { front_default: 'https://img.example/b.png' } } } }), async () => {
      web.getBuffer = async () => { throw new Error('no'); };
      const out = await run(find(lookups, 'pokemon'), 'bulbasaur');
      assert.match(out.text, /Bulbasaur/);
    });
  } finally { web.getBuffer = keep; }
});

test('iss, earthquake, holiday, sunrise and apod read their services', async () => {
  const fake = (url) => {
    if (url.includes('wheretheiss')) return { latitude: 12.3456, longitude: -45.6789, altitude: 420.2, velocity: 27600, visibility: 'daylight' };
    if (url.includes('4.5_day')) return { features: [{ properties: { mag: 5.1, place: '10 km N of Somewhere', time: Date.now() } }, { properties: { mag: 6.2, place: 'Offshore', time: Date.now() } }] };
    if (url.includes('nager.at')) return [{ date: '2026-12-25', name: 'Christmas Day', localName: 'Christmas Day' }];
    if (url.includes('geocoding-api')) return { results: [{ name: 'Lagos', country: 'Nigeria', latitude: 6.5, longitude: 3.4, timezone: 'Africa/Lagos' }] };
    if (url.includes('sunrise-sunset')) return { results: { sunrise: '2026-10-31T05:40:00+00:00', solar_noon: '2026-10-31T11:50:00+00:00', sunset: '2026-10-31T18:00:00+00:00', day_length: 44400 } };
    if (url.includes('nasa.gov')) return { title: 'A Galaxy', date: '2026-10-31', explanation: 'Far away.', media_type: 'image', url: 'https://img.example/g.jpg' };
    throw new Error('unexpected ' + url);
  };
  await withFakeWeb(fake, async () => {
    assert.match((await run(find(lookups, 'iss'))).text, /12\.346°, -45\.679°/);
    const eq = (await run(find(lookups, 'earthquake'))).text;
    assert.ok(eq.indexOf('M 6.2') < eq.indexOf('M 5.1'), 'strongest first');
    assert.match((await run(find(lookups, 'holiday'), 'ng')).text, /Christmas Day/);
    const sun = (await run(find(lookups, 'sunrise'), 'Lagos')).text;
    assert.match(sun, /Sunrise:\* 06:40/, 'shown in the city time zone (UTC+1)');
    assert.match(sun, /Daylight:\* 12h 20m/);
    assert.ok((await run(find(lookups, 'apod'))).sent[0].image);
  });
  assert.match((await run(find(lookups, 'holiday'), 'Nigeria')).text, /2-letter/);
});

test('moon is worked out by the bot (a known full moon and new moon)', async () => {
  assert.strictEqual(moon.info(new Date('2026-10-26T12:00:00Z')).emoji, '🌕');
  assert.ok(moon.info(new Date('2026-10-26T12:00:00Z')).lit >= 95);
  assert.strictEqual(moon.info(new Date('2026-11-09T22:00:00Z')).emoji, '🌑');
  assert.ok(moon.info(new Date('2026-11-09T22:00:00Z')).lit <= 5);
  const out = await run(find(lookups, 'moon'));
  assert.match(out.text, /Next full moon/);
});

test('isup: up, down, errors, and private addresses are refused', async () => {
  const keep = safefetch.get;
  try {
    safefetch.get = async () => ({ status: 200, body: Buffer.alloc(0) });
    assert.match((await run(find(lookups, 'isup'), 'https://Example.com/page')).text, /example\.com is UP/);
    safefetch.get = async () => ({ status: 503, body: Buffer.alloc(0) });
    assert.match((await run(find(lookups, 'isup'), 'example.com')).text, /error/);
    safefetch.get = async () => { throw Object.assign(new Error('The server took too long.'), { code: 'TIMEOUT' }); };
    const dead = await run(find(lookups, 'isup'), 'example.com');
    assert.match(dead.text, /looks DOWN/);
    assert.ok(!/took too long/.test(dead.text), 'members do not see the technical reason');
    assert.match((await run(find(lookups, 'isup'), 'example.com', { isOwner: true })).text, /Reason/);
    safefetch.get = async () => { throw Object.assign(new Error('That address is not allowed.'), { code: 'BLOCKED' }); };
    assert.match((await run(find(lookups, 'isup'), 'example.com')).text, /cannot check/);
  } finally { safefetch.get = keep; }
  assert.match((await run(find(lookups, 'isup'), 'not a site')).text, /Write a website/);
  assert.match((await run(find(lookups, 'isup'), '127.0.0.1')).text, /Write a website/);
});

test('dns lists records, handles missing domains and refuses bad types', async () => {
  await withFakeWeb((url) => (url.includes('type=MX') ? { Status: 0, Answer: [{ data: '10 mail.example.com.', TTL: 300 }] } : { Status: 3 }), async () => {
    assert.match((await run(find(lookups, 'dns'), 'example.com MX')).text, /mail\.example\.com/);
    assert.match((await run(find(lookups, 'dns'), 'nope.example')).text, /does not exist/);
  });
  assert.match((await run(find(lookups, 'dns'), 'example.com BOGUS')).text, /record type/);
});

// ---------------------------------------------------------------- tools
test('upper, lower, leet, wordcount, uuid, roman', async () => {
  assert.strictEqual((await run(find(tools, 'upper'), 'hello there')).text, 'HELLO THERE');
  assert.strictEqual((await run(find(tools, 'lower'), 'HELLO There')).text, 'hello there');
  assert.strictEqual((await run(find(tools, 'leet'), 'test')).text, '7357');
  const wc = (await run(find(tools, 'wordcount'), 'The quick brown fox. Jumps high!')).text;
  assert.match(wc, /Words:\* 6/);
  assert.match(wc, /Sentences:\* 2/);
  const ids = (await run(find(tools, 'uuid'), '3')).text.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g);
  assert.strictEqual(new Set(ids).size, 3);
  assert.match((await run(find(tools, 'roman'), '2026')).text, /MMXXVI/);
  assert.match((await run(find(tools, 'roman'), '1994')).text, /MCMXCIV/);
  assert.match((await run(find(tools, 'roman'), 'MMXXVI')).text, /2026/);
  assert.match((await run(find(tools, 'roman'), 'IIII')).text, /Write a number/);
  assert.match((await run(find(tools, 'roman'), '4000')).text, /1 to 3999/);
});

test('upper works on the message that was replied to', async () => {
  const cmd = find(tools, 'upper');
  const replies = [];
  await cmd.run({ rest: '', prefix: '.', reply: async (t) => replies.push(t), msg: { message: { extendedTextMessage: { text: '.upper', contextInfo: { quotedMessage: { conversation: 'quoted words' }, stanzaId: 'S', participant: OTHER } } } } });
  assert.strictEqual(replies[0], 'QUOTED WORDS');
});

test('zalgo keeps the letters, ascii draws block letters', async () => {
  const z = (await run(find(tools, 'zalgo'), 'hello')).text;
  assert.strictEqual(z.replace(/[\u0300-\u036f]/g, ''), 'hello');
  assert.ok(z.length > 5);
  const art = (await run(find(tools, 'ascii'), 'HI')).text;
  assert.match(art, /█/);
  assert.strictEqual(art.split('\n').filter((l) => l.includes('█')).length, 5, 'five rows tall');
  const long = (await run(find(tools, 'ascii'), 'ABCDEFGHIJ')).text;
  assert.ok(long.split('\n').every((l) => l.length <= 40), 'fits a phone screen');
  assert.match((await run(find(tools, 'ascii'), '###')).text, /only draw/);
});

test('color gives RGB and HSL, accepts short codes and names', async () => {
  // when the picture tool is installed the codes are the picture's caption, otherwise they are a plain reply
  const said = async (text) => { const o = await run(find(tools, 'color'), text); return o.text || (o.sent[0] && o.sent[0].caption) || ''; };
  const c = await said('#ff0000');
  assert.match(c, /RGB:\* 255, 0, 0/);
  assert.match(c, /HSL:\* 0°, 100%, 50%/);
  assert.match((await said('f00')), /#FF0000/);
  assert.match((await said('teal')), /#008080/);
  assert.match((await said('#12')), /colour code/);
});

test('tip, percent and discount do the sums', async () => {
  const t = (await run(find(tools, 'tip'), '50 15 3')).text;
  assert.match(t, /Tip \(15%\):\* 7\.50/);
  assert.match(t, /Total:\* 57\.50/);
  assert.match(t, /Each of 3:\* 19\.17/);
  assert.match((await run(find(tools, 'tip'), '-5')).text, /Example/);
  assert.match((await run(find(tools, 'percent'), '20 of 150')).text, /= \*30\*/);
  assert.match((await run(find(tools, 'percent'), '30 in 120')).text, /25%/);
  assert.match((await run(find(tools, 'percent'), '80 to 100')).text, /increase.*25%/);
  assert.match((await run(find(tools, 'percent'), '100 to 80')).text, /decrease.*20%/);
  assert.match((await run(find(tools, 'percent'), '5 in 0')).text, /zero/);
  const d = (await run(find(tools, 'discount'), '200 25')).text;
  assert.match(d, /-50\.00/);
  assert.match(d, /You pay:\* \*150\.00/);
  assert.match((await run(find(tools, 'discount'), '200 150')).text, /Example/);
});

test('timestamp converts both ways in the bot time zone', async () => {
  assert.match((await run(find(tools, 'timestamp'), '1767225600')).text, /2026-01-01T00:00:00\.000Z/);
  assert.match((await run(find(tools, 'timestamp'), '1767225600000')).text, /2026-01-01T00:00:00\.000Z/);
  const zone = require('../core/clock').zone();
  const at = (await run(find(tools, 'timestamp'), '2026-12-25 10:00')).text;
  const secs = Number(/Unix \(seconds\):\* (\d+)/.exec(at)[1]);
  const shown = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(secs * 1000));
  assert.strictEqual(shown, '25/12/2026, 10:00', 'a date typed in the bot time zone comes back the same');
  assert.match((await run(find(tools, 'timestamp'), '2026-02-31')).text, /Write a Unix number/);
  assert.match((await run(find(tools, 'timestamp'), '')).text, /Unix \(seconds\)/);
});

test('timer saves a reminder that tags the person, and refuses bad times', async () => {
  const before = store.reminders().length;
  const out = await run(find(tools, 'timer'), '10m pizza');
  assert.match(out.text, /Timer set for/);
  const list = store.reminders();
  assert.strictEqual(list.length, before + 1);
  const mine = list[list.length - 1];
  assert.match(mine.text, /pizza/);
  assert.ok(mine.at > Date.now() + 9 * 60000 && mine.at < Date.now() + 11 * 60000);
  store.removeReminder(mine.id);
  assert.match((await run(find(tools, 'timer'), 'soon')).text, /Say how long/);
  assert.match((await run(find(tools, 'timer'), '5s')).text, /Say how long/);
});

// ---------------------------------------------------------------- group
const P = (id, admin, extra = {}) => ({ id, admin: admin || null, ...extra });
const BIG = {
  subject: 'G',
  participants: [P('27811111111@s.whatsapp.net', 'admin'), P('27899999999@s.whatsapp.net', 'admin'), P('27833333333@s.whatsapp.net'), P('27844444444@s.whatsapp.net'), P('27855555555@s.whatsapp.net', 'superadmin')],
};

test('listonline shows who wrote lately, without tagging anybody', async () => {
  const g = '120363000000000094@g.us';
  assert.match((await run(find(group, 'listonline'), '', { jid: g })).text, /Nobody has written/);
  recent.touch(g, '27833333333@s.whatsapp.net', Date.now() - 2 * 60000);
  recent.touch(g, '27844444444@s.whatsapp.net', Date.now() - 30 * 60000);
  const out = await run(find(group, 'listonline'), '', { jid: g });
  assert.match(out.text, /\(1\)/);
  assert.match(out.text, /\+27833333333/);
  assert.ok(!/27844444444/.test(out.text), 'the one who wrote 30 minutes ago is not in the last 10');
  assert.ok(!out.opts[0], 'no tags (a long list must not ping everybody)');
  assert.match((await run(find(group, 'listonline'), '60', { jid: g })).text, /\(2\)/);
});

test('newmembers lists joins the bot saw, and forgets people who left', async () => {
  const g = '120363000000000095@g.us';
  assert.match((await run(find(group, 'newmembers'), '', { jid: g })).text, /Nobody new/);
  joined.record(g, ['27833333333@s.whatsapp.net'], Date.now() - 3600000);
  joined.record(g, ['27844444444@s.whatsapp.net'], Date.now() - 20 * 86400000);
  let out = await run(find(group, 'newmembers'), '', { jid: g });
  assert.match(out.text, /\(1\)/);
  assert.match(out.text, /\+27833333333/);
  out = await run(find(group, 'newmembers'), '30', { jid: g });
  assert.match(out.text, /\(2\)/);
  joined.forget(g, ['27833333333@s.whatsapp.net']);
  assert.match((await run(find(group, 'newmembers'), '', { jid: g })).text, /Nobody new/);
});

test('the join event records new members (and a removal forgets them)', async () => {
  const events = require('../whatsapp/events');
  const g = '120363000000000096@g.us';
  const sock = { user: { id: '27899999999:1@s.whatsapp.net' }, sendMessage: async () => ({}), groupMetadata: async () => BIG, groupParticipantsUpdate: async () => [] };
  await events.handleParticipants(sock, { id: g, action: 'add', participants: ['27866666666@s.whatsapp.net'], author: null });
  assert.strictEqual(joined.recent(g, 1).length, 1);
  await events.handleParticipants(sock, { id: g, action: 'remove', participants: ['27866666666@s.whatsapp.net'], author: null });
  assert.strictEqual(joined.recent(g, 1).length, 0);
});

test('staff lists the owner, sudo helpers and the admins', async () => {
  store.addSudo('27833333333');
  try {
    const out = await run(find(group, 'staff'), '', { meta: BIG });
    assert.match(out.text, /Bot owner/);
    assert.match(out.text, /Helpers \(sudo\)/);
    assert.match(out.text, /Group admins\* \(3\)/);
    assert.match(out.text, /\(creator\)/);
    assert.ok(!out.opts[0], 'no tags');
  } finally { store.removeSudo('27833333333'); }
});

test('nickname: set, show, reset, duplicates, limits, admin for others, silent for members', async () => {
  const g = '120363000000000097@g.us';
  const cmd = find(group, 'nickname');
  assert.match((await run(cmd, '', { jid: g })).text, /No nickname yet/);
  assert.match((await run(cmd, 'Boss', { jid: g })).text, /now \*Boss\*/);
  assert.strictEqual(nicks.get(g, ME), 'Boss');
  assert.match((await run(cmd, '', { jid: g })).text, /is \*Boss\*/);
  assert.match((await run(cmd, 'list', { jid: g })).text, /Boss/);
  // somebody else cannot take the same nickname
  nicks.set(g, OTHER, 'Chief');
  assert.match((await run(cmd, 'chief', { jid: g })).text, /already uses/);
  assert.match((await run(cmd, 'A'.repeat(25), { jid: g })).text, /too long/);
  assert.match((await run(cmd, '*@@*', { jid: g })).text, /cannot be used/);
  // an admin can change somebody else's nickname, a member cannot (and gets no answer at all)
  assert.match((await run(cmd, '@27822222222 Duke', { jid: g, tagged: [OTHER] })).text, /Duke/);
  assert.strictEqual(nicks.get(g, OTHER), 'Duke');
  const quiet = await run(cmd, '@27822222222 Hacked', { jid: g, tagged: [OTHER], isAdmin: false });
  assert.strictEqual(quiet.replies.length, 0);
  assert.strictEqual(nicks.get(g, OTHER), 'Duke');
  assert.match((await run(cmd, 'reset', { jid: g })).text, /removed/);
  assert.strictEqual(nicks.get(g, ME), null);
});

test('rank and top show nicknames', async () => {
  const levels = require('../whatsapp/levels');
  const g = '120363000000000098@g.us';
  store.update(g, (x) => { x.rank = true; });
  levels.award(g, ME);
  nicks.set(g, ME, 'Boss');
  const rank = require('../commands/rank');
  const top = rank.find((c) => c.name === 'top');
  const said = [];
  await top.run({ jid: g, prefix: '.', reply: async (t) => said.push(t) });
  assert.match(said[0], /Boss \(@27811111111\)/);
});

test('kickall: asks first, only the same admin can confirm, never removes admins, the bot or sudo', async () => {
  const g = '120363000000000099@g.us';
  const cmd = find(group, 'kickall');
  const removed = [];
  const update = async (j, ids) => { removed.push(...ids); return ids.map(() => ({ status: '200' })); };
  store.addSudo('27844444444');
  try {
    const ask = await run(cmd, '', { jid: g, meta: BIG, update });
    assert.match(ask.text, /remove 1 member/, 'only the one ordinary member who is not sudo');
    assert.match(ask.text, /kickall confirm/);
    assert.strictEqual(removed.length, 0, 'nothing is removed before the confirm');
    // somebody else cannot confirm (silent)
    const other = { ...cmd };
    const stranger = await (async () => {
      const out = { replies: [] };
      await other.run({ sock: { groupParticipantsUpdate: update, groupMetadata: async () => BIG }, jid: g, args: ['confirm'], reply: async (t) => out.replies.push(t), prefix: '.', myIds: ['27800000000'], botIds: ['27899999999'], groupMetadata: BIG });
      return out;
    })();
    assert.strictEqual(stranger.replies.length, 0);
    assert.strictEqual(removed.length, 0);
    const go = await run(cmd, 'confirm', { jid: g, meta: BIG, update });
    assert.deepStrictEqual(removed, ['27833333333@s.whatsapp.net']);
    assert.match(go.text, /Removed \*1\*/);
    // the confirm is used up
    assert.match((await run(cmd, 'confirm', { jid: g, meta: BIG, update })).text, /Nothing is waiting/);
    // cancel
    await run(cmd, '', { jid: g, meta: BIG, update });
    assert.match((await run(cmd, 'cancel', { jid: g, meta: BIG, update })).text, /Cancelled/);
    assert.match((await run(cmd, 'confirm', { jid: g, meta: BIG, update })).text, /Nothing is waiting/);
  } finally { store.removeSudo('27844444444'); }
});

test('kickall is admin-only and needs the bot to be admin (checked by the handler flags)', () => {
  for (const name of ['kickall', 'kicklist']) {
    const c = find(group, name);
    assert.ok(c.adminOnly && c.botAdminRequired && c.groupOnly, `${name} flags`);
  }
});

test('kicklist removes the listed people but skips admins, the owner and strangers', async () => {
  const removed = [];
  const update = async (j, ids) => { removed.push(...ids); return ids.map(() => ({ status: '200' })); };
  const out = await run(find(group, 'kicklist'), '@a @b @c @d', {
    meta: BIG, update,
    tagged: ['27833333333@s.whatsapp.net', '27855555555@s.whatsapp.net', '27899999999@s.whatsapp.net', '27800000009@s.whatsapp.net'],
  });
  assert.deepStrictEqual(removed, ['27833333333@s.whatsapp.net']);
  assert.match(out.text, /Removed \*1\*/);
  assert.match(out.text, /3 skipped/);
  const none = await run(find(group, 'kicklist'), '27855555555', { meta: BIG, update });
  assert.match(none.text, /nobody I can remove/);
  // a failed removal is reported honestly
  const failed = await run(find(group, 'kicklist'), '27833333333', { meta: BIG, update: async () => [{ status: '403' }] });
  assert.match(failed.text, /could not remove/);
});

// ---------------------------------------------------------------- through the real message handler
test('through the handler: the new commands are registered, and chatting is remembered for listonline', async () => {
  const baileys = require('../core/baileys');
  baileys.setForTests({});
  const handler = require('../whatsapp/handler');
  const g = '120363000000000100@g.us';
  const MEMBER = '27833333333@s.whatsapp.net';
  const sent = [];
  const sock = {
    user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' },
    sendMessage: async (j, c) => { sent.push(c); return { key: { id: `K${sent.length}` } }; },
    groupMetadata: async () => ({ subject: 'G', participants: [{ id: MEMBER }, { id: '27800000001@s.whatsapp.net', admin: 'admin' }] }),
  };
  let n = 0;
  const say = async (who, text) => {
    sent.length = 0;
    await handler.handleMessage(sock, { key: { remoteJid: g, participant: who, id: `H${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Ada' });
    await handler.idle();
    await new Promise((r) => setTimeout(r, 60));
    return sent.filter((s) => s.text).map((s) => s.text).join('\n');
  };
  store.setMode('public');
  try {
    assert.match(await say(MEMBER, '.roman 2026'), /MMXXVI/);
    assert.match(await say(MEMBER, '.upper hello'), /HELLO/);
    assert.match(await say(MEMBER, '.listonline'), /Ada|\+27833333333|Active in the last/, 'the earlier messages were remembered');
    assert.match(await say(MEMBER, '.love Ada & Tunde'), /Love meter/);
    // an admin-only command stays silent for a plain member
    assert.strictEqual(await say(MEMBER, '.kickall'), '');
    assert.strictEqual(await say(MEMBER, '.kicklist @27822222222'), '');
    // the menu lists the new commands
    for (const [cat, name] of [['fun', 'hug'], ['lookup', 'country'], ['tools', 'timer'], ['group', 'listonline']]) {
      assert.ok((await say(MEMBER, `.menu ${cat}`)).includes(name), `${name} is in the ${cat} menu`);
    }
    assert.match(await say(MEMBER, '.menu kickall'), /confirm/, 'help for one command');
  } finally {
    store.setMode('private');
  }
});

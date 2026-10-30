require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const settings = require('../core/realm/settings');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const stuff = require('../core/realm/stuff');
const careers = require('../core/realm/careers');
const estates = require('../core/realm/estates');
const craft = require('../core/realm/craft');
const shop = require('../core/realm/shop');
const godCore = require('../core/realm/god');
const ratelimit = require('../whatsapp/ratelimit');
require('../commands/god');

baileys.setForTests({});
const OWNER = '27800000001@s.whatsapp.net';
let gid = 0;
const newGroup = () => `1203660000001${String(++gid).padStart(5, '0')}@g.us`;
let uid = 0;
const person = () => `2787990${String(++uid).padStart(4, '0')}@s.whatsapp.net`;
const num = (j) => j.split('@')[0];
let n = 0;
const HOUR = 3600000;
const NOW = () => Date.now();

function fakeSock() {
  const sent = [];
  return {
    user: { id: '27899999999:1@s.whatsapp.net', lid: '999888777:1@lid' }, sent,
    texts: () => sent.filter((s) => s.c.text).map((s) => s.c.text),
    sendMessage: async (j, c) => { sent.push({ j, c }); return { key: { id: `K${sent.length}` } }; },
    groupMetadata: async () => ({ subject: 'G', participants: [{ id: OWNER, admin: 'admin' }] }),
    groupFetchAllParticipating: async () => ({}),
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, presenceSubscribe: async () => {},
  };
}
const settle = async () => { await handler.idle(); await new Promise((r) => setTimeout(r, 15)); };
async function say(sock, group, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: group, participant: from, id: `Q${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
async function dm(sock, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: from, id: `P${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
const last = (sock) => sock.texts().at(-1);
store.setMode('public');

// ------------------------------------------------------------------ goods and the bag
test('goods: values and the realm price are set by God, the bag has a size that grows with the rank', () => {
  const g = newGroup();
  const a = person();
  settings.set('market.on', false, g); // the market moves prices (see realm3.test.js); here the normal values are tested
  assert.strictEqual(stuff.valueOf(g, 'iron'), 32);
  assert.strictEqual(stuff.sellPrice(g, 'iron'), 28);
  settings.set('goods.value_iron', 100, g);
  assert.strictEqual(stuff.sellPrice(g, 'iron'), 90);
  settings.set('goods.sellPct', 50, g);
  assert.strictEqual(stuff.sellPrice(g, 'iron'), 50);
  stuff.addValueMod((grp, id) => (grp === g && id === 'iron' ? 2 : 1));
  assert.strictEqual(stuff.sellPrice(g, 'iron'), 100, 'the market of a later phase can move the value');
  assert.strictEqual(stuff.bagSize(g, a), 100);
  assert.deepStrictEqual(stuff.add(g, a, 'grain', 130), { added: 100, lost: 30 });
  A.add(g, a, 20000);
  assert.strictEqual(stuff.bagSize(g, a), 100 + 50 * 2, 'a Merchant carries more');
  assert.ok(stuff.sell(g, a, 'grain', -1).ok);
  assert.strictEqual(stuff.used(g, a), 0);
  assert.strictEqual(stuff.sell(g, a, 'grain', 5).why, 'few');
  stuff.add(g, a, 'ore', 10);
  assert.ok(A.netWorth(g, a) > A.balance(g, a), 'what is in the bag counts for the rank');
});

// ------------------------------------------------------------------ careers
test('careers: rank locks, switching has a waiting time, work pays with tool, meal and first-of-the-day bonus', () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(careers.work(g, a).why, 'nocareer');
  assert.strictEqual(careers.choose(g, a, 'smith').why, 'rank');
  assert.strictEqual(careers.choose(g, a, 'bandit').why, 'unknown');
  const t0 = 10 * 24 * HOUR;
  assert.ok(careers.choose(g, a, 'farmer', t0).ok);
  assert.strictEqual(careers.choose(g, a, 'farmer', t0).why, 'same');
  A.add(g, a, 2000);
  assert.strictEqual(careers.choose(g, a, 'scribe', t0 + HOUR).why, 'wait', 'a waiting time before changing');
  assert.ok(careers.choose(g, a, 'scribe', t0 + 25 * HOUR).ok);
  assert.ok(careers.choose(g, a, 'farmer', t0 + 50 * HOUR).ok);
  const w1 = careers.work(g, a, t0 + 51 * HOUR, () => 0.9);
  assert.ok(w1.ok && w1.first);
  const base = w1.pay;
  assert.strictEqual(careers.work(g, a, t0 + 51 * HOUR + 1000).why, 'wait');
  const w2 = careers.work(g, a, t0 + 53 * HOUR, () => 0.9);
  assert.ok(w2.pay < base, 'the first work of the day pays more');
  assert.ok(w2.goods.added >= 2);
  // a tool and a meal
  A.add(g, a, 5000);
  assert.ok(shop.buy(g, a, 'hoe').ok);
  assert.strictEqual(shop.buy(g, a, 'hoe').why, 'custom');
  stuff.add(g, a, 'bread', 1);
  assert.ok(craft.use(g, a, 'bread', t0 + 55 * HOUR).ok);
  const w3 = careers.work(g, a, t0 + 55 * HOUR + 5, () => 0.9);
  assert.ok(w3.tool && w3.meal && w3.pay > w2.pay * 1.3, `tool and meal pay more (${w3.pay} vs ${w2.pay})`);
  assert.strictEqual(S.citizen(g, a).tools.hoe, 24);
  // a tonic: no waiting
  stuff.add(g, a, 'tonic', 1);
  craft.use(g, a, 'tonic');
  assert.ok(careers.work(g, a, t0 + 55 * HOUR + 10, () => 0.9).ok, 'the tonic skips the waiting time');
  assert.strictEqual(careers.work(g, a, t0 + 55 * HOUR + 20).why, 'wait', 'and then the waiting starts again');
});

test('careers: levels go up, the smith needs Ore, the weekly bonus, and God changes pay and rank limits', () => {
  const g = newGroup();
  const a = person();
  careers.choose(g, a, 'miner');
  let t = 100 * 24 * HOUR;
  let levelUp = false;
  for (let i = 0; i < 12; i++) {
    t += 2 * HOUR;
    const r = careers.work(g, a, t, () => 0.1);
    levelUp = levelUp || r.levelUp;
  }
  assert.ok(levelUp && careers.status(g, a).level >= 2);
  // the weekly bonus
  const w = careers.weekly(g, a, t);
  assert.ok(w.ok && w.pay >= 2000 && w.goods.id === 'ore');
  assert.strictEqual(careers.weekly(g, a, t + HOUR).ok, false);
  // smith
  const s = person();
  godCore.setRank(g, s, 2);
  assert.ok(careers.choose(g, s, 'smith').ok);
  const noOre = careers.work(g, s, t + 10 * HOUR, () => 0.1);
  assert.ok(noOre.notes.length && !noOre.goods);
  stuff.add(g, s, 'ore', 4);
  const withOre = careers.work(g, s, t + 20 * HOUR, () => 0.1);
  assert.strictEqual(withOre.goods.id, 'iron');
  assert.strictEqual(stuff.countOf(g, s, 'ore'), 2);
  assert.ok(withOre.pay > noOre.pay);
  // God
  const b = person();
  settings.set('careers.minRank_smith', 0, g);
  assert.ok(careers.choose(g, b, 'smith').ok, 'God can open a career to everybody');
  settings.set('careers.payBase', 1000, g);
  const rich = careers.work(g, b, t + 30 * HOUR, () => 0.1);
  assert.ok(rich.pay > 1000);
  settings.set('careers.pay_miner', 3, g);
  const m = person();
  careers.choose(g, m, 'miner');
  assert.ok(careers.work(g, m, t + 30 * HOUR, () => 0.1).pay > 3000, 'the pay of one career can be changed');
});

// ------------------------------------------------------------------ estates
test('estates: buying needs rank, money and room; they produce, the realm keeps a tax, storage is limited', () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(estates.buy(g, a, 'farm').why, 'poor');
  A.add(g, a, 3000);
  const t0 = 1000000;
  assert.ok(estates.buy(g, a, 'farm', t0).ok);
  assert.strictEqual(estates.buy(g, a, 'farm', t0).why, 'owned');
  A.add(g, a, 5000);
  settings.set('estates.estatesPerRank', 0, g);
  assert.strictEqual(estates.buy(g, a, 'mine', t0).why, 'limit', 'God limits the number of estates');
  settings.reset('estates.estatesPerRank', g);
  assert.strictEqual(estates.buy(g, a, 'tavern', t0).why, 'rank');
  const c1 = estates.collect(g, a, t0 + 2 * HOUR);
  assert.strictEqual(c1.rows[0].made, 10);
  assert.strictEqual(c1.rows[0].tax, 1);
  assert.strictEqual(c1.rows[0].added, 9);
  assert.strictEqual(godCore.realmStock(g).grain, 1, 'the tax is kept in the realm granary');
  const c2 = estates.collect(g, a, t0 + 100 * HOUR);
  assert.strictEqual(c2.rows[0].made, 60, 'the storage holds 12 hours');
  // upgrade and sell
  A.add(g, a, 5000);
  const before = A.balance(g, a);
  const up = estates.upgrade(g, a, 'farm');
  assert.ok(up.ok && up.level === 2 && up.cost === 3000);
  assert.strictEqual(estates.outputOf(g, estates.byId('farm'), 2), 7.5);
  for (let i = 0; i < 5; i++) A.add(g, a, 20000), estates.upgrade(g, a, 'farm');
  assert.strictEqual(estates.upgrade(g, a, 'farm').why, 'max');
  const sold = estates.sell(g, a, 'farm');
  assert.ok(sold.ok && sold.back > 0);
  assert.strictEqual(estates.sell(g, a, 'farm').why, 'none');
  assert.ok(before > 0);
});

test('estates: the forge turns Ore from the bag into Iron; God changes prices, output, tax and the number of estates', () => {
  const g = newGroup();
  const a = person();
  godCore.setRank(g, a, 4);
  A.add(g, a, 200000);
  const t0 = 5000000;
  assert.ok(estates.buy(g, a, 'forge', t0).ok);
  const none = estates.collect(g, a, t0 + 4 * HOUR);
  assert.strictEqual(none.rows[0].added, 0, 'no Ore, no Iron');
  stuff.add(g, a, 'ore', 20);
  const r = estates.collect(g, a, t0 + 8 * HOUR);
  assert.strictEqual(r.rows[0].made, 8, '4 hours since the last collection');
  assert.strictEqual(stuff.countOf(g, a, 'ore'), 4, '8 Iron need 16 Ore');
  assert.strictEqual(stuff.countOf(g, a, 'iron'), 8, 'the 10% tax rounds down on a small batch');
  // God
  const b = person();
  A.add(g, b, 500);
  settings.set('estates.price_farm', 400, g);
  assert.ok(estates.buy(g, b, 'farm').ok, 'God made the farm cheaper');
  settings.set('estates.tax', 0, g);
  settings.set('estates.output_farm', 10, g);
  const c = estates.collect(g, b, Date.now() + 3 * HOUR);
  assert.strictEqual(c.rows[0].made, 30);
  assert.strictEqual(c.rows[0].tax, 0);
  settings.set('estates.estatesBase', 3, g);
  A.add(g, b, 20000);
  assert.ok(estates.buy(g, b, 'mine').ok, 'God allowed more estates');
  // the stock of one estate is full of a bag
  const f = person();
  settings.set('goods.bagBase', 10, g);
  A.add(g, f, 3000);
  estates.buy(g, f, 'farm');
  const full = estates.collect(g, f, Date.now() + 12 * HOUR);
  assert.ok(full.rows[0].lost > 0, 'the bag was too small');
});

// ------------------------------------------------------------------ crafting
test('crafting: recipes, missing goods, tools, batches, God can close a recipe', () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(craft.craft(g, a, 'bread').why, 'missing');
  assert.strictEqual(craft.craft(g, a, 'dragon').why, 'unknown');
  stuff.add(g, a, 'grain', 12);
  const r = craft.craft(g, a, 'bread', 3);
  assert.ok(r.ok && r.made === 6 && stuff.countOf(g, a, 'bread') === 6 && stuff.countOf(g, a, 'grain') === 3);
  stuff.add(g, a, 'iron', 4);
  stuff.add(g, a, 'cloth', 2);
  assert.ok(craft.craft(g, a, 'sword').ok);
  assert.ok(craft.craft(g, a, 'hoe').ok, 'a tool made from goods');
  assert.strictEqual(craft.craft(g, a, 'hoe').why, 'hastool');
  assert.strictEqual(S.citizen(g, a).tools.hoe, 25);
  settings.set('crafting.recipe_bread', false, g);
  assert.strictEqual(craft.craft(g, a, 'bread').why, 'off');
  settings.set('crafting.recipe_bread', true, g);
  settings.set('crafting.maxBatch', 2, g);
  stuff.add(g, a, 'grain', 30);
  assert.strictEqual(craft.craft(g, a, 'bread', 10).times, 2, 'God limits a batch');
  settings.set('crafting.minRank', 3, g);
  assert.strictEqual(craft.craft(g, a, 'bread').why, 'rank');
  assert.strictEqual(craft.use(g, a, 'sword').why, 'nouse');
  assert.strictEqual(craft.use(g, a, 'tonic').why, 'none');
});

// ------------------------------------------------------------------ commands
test('commands: the whole day of a citizen works through the handler', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  await say(sock, g, a, '.work');
  assert.match(last(sock), /no career/);
  await say(sock, g, a, '.career');
  assert.match(last(sock), /Careers/);
  await say(sock, g, a, '.career smith');
  assert.match(last(sock), /must be at least/);
  await say(sock, g, a, '.career farmer');
  assert.match(last(sock), /You are now a/);
  await say(sock, g, a, '.work');
  assert.match(last(sock), /Farmer at work/);
  assert.match(last(sock), /Grain/);
  await say(sock, g, a, '.work');
  assert.match(last(sock), /⏳/);
  await say(sock, g, a, '.weekly');
  assert.match(last(sock), /Weekly bonus/);
  await say(sock, g, a, '.inventory');
  assert.match(last(sock), /Your bag/);
  assert.match(last(sock), /Grain/);
  await say(sock, g, a, '.recipes');
  assert.match(last(sock), /The workbench/);
  A.add(g, a, 5000);
  await say(sock, g, a, '.estates');
  assert.match(last(sock), /Estates/);
  await say(sock, g, a, '.estates buy farm');
  assert.match(last(sock), /You bought a/);
  await say(sock, g, a, '.estates buy mine');
  assert.match(last(sock), /Mine costs/);
  await say(sock, g, a, '.estates farm');
  assert.match(last(sock), /Farm/);
  S.citizen(g, a).estates.farm.at -= 3 * HOUR;
  await say(sock, g, a, '.collect');
  assert.match(last(sock), /Collected/);
  await say(sock, g, a, '.estates upgrade farm');
  assert.match(last(sock), /level 2/);
  stuff.add(g, a, 'grain', 6);
  await say(sock, g, a, '.craft bread 2');
  assert.match(last(sock), /You made/);
  await say(sock, g, a, '.use bread');
  assert.match(last(sock), /You used/);
  await say(sock, g, a, '.sell bread 1');
  assert.match(last(sock), /Sold/);
  await say(sock, g, a, '.sell all');
  assert.match(last(sock), /Goods sold|no goods/);
  await say(sock, g, a, '.sell dragon');
  assert.match(last(sock), /do not know/);
  await say(sock, g, a, '.craft');
  assert.match(last(sock), /Craft/);
  await say(sock, g, a, '.shop');
  assert.match(last(sock), /Hoe/);
  await say(sock, g, a, '.buy hoe');
  assert.match(last(sock), /Bought/);
  await say(sock, g, a, '.profile');
  assert.match(last(sock), /Career:/);
  assert.match(last(sock), /Estates:/);
  await say(sock, g, a, '.realm guide');
  assert.match(last(sock), /\.career/);
});

test('realm off and God\'s feature switches stop the new commands too', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  S.setOn(g, false);
  for (const c of ['.career', '.work', '.weekly', '.estates', '.collect', '.inventory', '.recipes', '.craft bread', '.sell all', '.use bread']) {
    await say(sock, g, a, c);
    assert.match(last(sock), /realm is closed/, c);
  }
  S.setOn(g, true);
  settings.set('estates.on', false, g);
  await say(sock, g, a, '.estates');
  assert.match(last(sock), /Closed by God/);
  settings.set('careers.on', false, g);
  await say(sock, g, a, '.work');
  assert.match(last(sock), /Closed by God/);
  settings.set('crafting.on', false, g);
  await say(sock, g, a, '.craft bread');
  assert.match(last(sock), /Closed by God/);
  await say(sock, g, a, '.purse');
  assert.match(last(sock), /Your purse/, 'the rest still works');
});

test('God: give items, set estates and careers, see the granary, move the whole bag to another realm', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const h = newGroup();
  const a = person();
  await dm(sock, OWNER, `.god realm ${g}`);
  await dm(sock, OWNER, `.god item ${num(a)} bread 5`);
  assert.match(last(sock), /Item given/);
  assert.strictEqual(stuff.countOf(g, a, 'bread'), 5);
  await dm(sock, OWNER, `.god item ${num(a)} bread -2`);
  assert.match(last(sock), /Item taken/);
  assert.strictEqual(stuff.countOf(g, a, 'bread'), 3);
  await dm(sock, OWNER, `.god estate ${num(a)} tavern 3`);
  assert.match(last(sock), /Estate set/);
  assert.strictEqual(S.citizen(g, a).estates.tavern.lv, 3);
  await dm(sock, OWNER, `.god career ${num(a)} healer`);
  assert.match(last(sock), /Career set/);
  assert.strictEqual(S.citizen(g, a).career, 'healer');
  await dm(sock, OWNER, `.god career ${num(a)} none`);
  assert.strictEqual(S.citizen(g, a).career, null);
  await dm(sock, OWNER, '.god item');
  assert.match(last(sock), /Name a citizen/);
  S.realmOf(g).stock = { grain: 7 };
  await dm(sock, OWNER, '.god stock');
  assert.match(last(sock), /Grain.*7/s);
  await dm(sock, OWNER, '.god settings estates');
  assert.match(last(sock), /price_farm/);
  await dm(sock, OWNER, '.god set estates.tax 25 here');
  assert.strictEqual(settings.get('estates.tax', g), 25);
  await dm(sock, OWNER, '.god set estates.tax 95');
  assert.match(last(sock), /Allowed: 0 to 90/);
  await dm(sock, OWNER, `.god move ${g} to ${h}`);
  assert.match(last(sock), /Moved/);
  assert.strictEqual(stuff.countOf(h, a, 'bread'), 3);
  assert.strictEqual(S.citizen(h, a).estates.tavern.lv, 3);
  assert.strictEqual(stuff.countOf(g, a, 'bread'), 0);
});

test('rank grows with what you own, and the new commands are limited by the Empire spam limit', async () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(A.rank(g, a).name, 'Commoner');
  stuff.add(g, a, 'iron', 100);
  estates.buy(g, a, 'farm');
  A.add(g, a, 3000);
  estates.buy(g, a, 'farm');
  assert.ok(A.netWorth(g, a) >= 4500);
  assert.notStrictEqual(A.rank(g, a).name, 'Commoner');
  for (const name of ['career', 'work', 'weekly', 'estates', 'collect', 'inventory', 'recipes', 'craft', 'sell', 'use']) {
    const cmd = [].concat(require('../commands/careers'), require('../commands/estates'), require('../commands/inventory')).find((c) => c.name === name);
    assert.ok(cmd && cmd.category === 'economy' && cmd.description.length > 10, name);
  }
});

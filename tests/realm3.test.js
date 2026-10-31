require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const baileys = require('../core/baileys');
const store = require('../whatsapp/store');
const handler = require('../whatsapp/handler');
const settings = require('../core/realm/settings');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const stuff = require('../core/realm/stuff');
const market = require('../core/realm/market');
const trade = require('../core/realm/trade');
const auction = require('../core/realm/auction');
const ticker = require('../core/realm/ticker');
const godCore = require('../core/realm/god');
const ratelimit = require('../whatsapp/ratelimit');

baileys.setForTests({});
const OWNER = '27800000001@s.whatsapp.net';
let gid = 0;
const newGroup = () => `1203670000001${String(++gid).padStart(5, '0')}@g.us`;
let uid = 0;
const person = () => `2787110${String(++uid).padStart(4, '0')}@s.whatsapp.net`;
const num = (j) => j.split('@')[0];
const HOUR = 3600000;
const MIN = 60000;
let n = 0;
const flat = (v) => () => v; // a "random" that always gives the same number

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
  await handler.handleMessage(sock, { key: { remoteJid: group, participant: from, id: `M${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
async function dm(sock, from, text) {
  ratelimit.reset();
  await handler.handleMessage(sock, { key: { remoteJid: from, id: `N${++n}`, fromMe: false }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) });
  await settle();
}
const last = (sock) => sock.texts().at(-1);
const lastMsg = (sock) => sock.sent.filter((s) => s.c.text).at(-1).c; // the last message with text (a reaction may come after it)
store.setMode('public');

// ------------------------------------------------------------------ the price engine
test('market: prices start at the normal value, and every realm has its own', () => {
  const g = newGroup();
  const h = newGroup();
  for (const id of market.GOODS()) assert.strictEqual(market.price(g, id), market.baseOf(g, id));
  settings.set('goods.value_iron', 50, h);
  assert.strictEqual(market.price(h, 'iron'), 50);
  assert.strictEqual(market.price(g, 'iron'), 32);
});

test('market: selling pushes a price down, buying pushes it up, and the spread is the realm\'s income', () => {
  const g = newGroup();
  const a = person();
  A.add(g, a, 100000);
  const p0 = market.price(g, 'ore');
  assert.ok(market.buy(g, a, 'ore', 100).ok);
  const p1 = market.price(g, 'ore');
  assert.ok(p1 > p0, `buying raises the price (${p0} → ${p1})`);
  assert.ok(A.treasury(g) > 0, 'the markup goes to the treasury');
  assert.ok(stuff.sell(g, a, 'ore', 100).ok);
  assert.ok(market.price(g, 'ore') < p1, 'selling lowers it');
  assert.ok(stuff.sellPrice(g, 'ore') < market.buyPrice(g, 'ore'), 'you sell lower than you buy');
  // buying and selling back at once always loses money
  const b = person();
  A.add(g, b, 5000);
  const before = A.balance(g, b);
  market.buy(g, b, 'wine', 20);
  stuff.sell(g, b, 'wine', 20);
  assert.ok(A.balance(g, b) < before, 'no free money');
});

test('market: buying checks money and bag room, and an unknown good is refused', () => {
  const g = newGroup();
  const a = person();
  assert.strictEqual(market.buy(g, a, 'iron', 5).why, 'poor');
  A.add(g, a, 1000000);
  assert.strictEqual(market.buy(g, a, 'iron', 500).why, 'bag');
  assert.strictEqual(market.buy(g, a, 'bread', 1).why, 'unknown');
  assert.strictEqual(market.buy(g, a, 'iron', 0).why, 'amount');
});

test('market: a price comes back to the normal value, stays inside the limits, and has a random swing God controls', () => {
  const g = newGroup();
  settings.set('market.volatility', 0, g);
  settings.set('market.eventChance', 0, g);
  market.setPrice(g, 'grain', 12); // twice the normal value
  const m = market.market(g);
  for (let i = 0; i < 40; i++) market.step(g, m, flat(0.5));
  assert.ok(m.p.grain < 8, `it fell back towards 6 (${m.p.grain})`);
  // limits
  assert.strictEqual(market.setPrice(g, 'grain', 100000).price, 24, 'the highest price is 400% of the normal value');
  assert.strictEqual(market.setPrice(g, 'grain', 0.01).price, 1.5, 'the lowest is 25%');
  settings.set('market.ceil', 200, g);
  assert.strictEqual(market.setPrice(g, 'grain', 100000).price, 12);
  // the swing
  const h = newGroup();
  settings.set('market.eventChance', 0, h);
  settings.set('market.volatility', 10, h);
  const mh = market.market(h);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    market.step(h, mh, Math.random);
    seen.add(mh.p.iron);
  }
  assert.ok(seen.size > 5, 'a big swing moves the price');
});

test('market: updates are worked out when somebody looks, in whole steps, with a limit for a realm nobody looked at', () => {
  const g = newGroup();
  settings.set('market.eventChance', 0, g);
  const t0 = Date.now();
  market.market(g, t0);
  assert.strictEqual(market.advance(g, t0 + 10 * MIN).steps, 0);
  assert.strictEqual(market.advance(g, t0 + 31 * MIN).steps, 1);
  assert.strictEqual(market.advance(g, t0 + 40 * MIN).steps, 0, 'the same update is not played twice');
  assert.strictEqual(market.advance(g, t0 + 62 * MIN).steps, 1);
  const r = market.advance(g, t0 + 400 * HOUR);
  assert.strictEqual(r.steps, 96, 'at most 96 updates are played for a realm nobody looked at');
  assert.strictEqual(market.advance(g, t0 + 400 * HOUR + MIN).steps, 0, 'and it does not play the time it skipped');
  settings.set('market.tickMinutes', 5, g);
  assert.ok(market.advance(g, t0 + 400 * HOUR + 11 * MIN).steps >= 2, 'God can make updates faster');
});

test('market: events move prices at once and keep pushing for a few updates; God can start one', () => {
  const g = newGroup();
  settings.set('market.volatility', 0, g);
  settings.set('market.eventChance', 0, g);
  settings.set('market.reversion', 0, g);
  const m = market.market(g);
  const before = m.p.grain;
  const e = godCore.marketEvent(g, 'drought');
  assert.strictEqual(e.event.id, 'drought');
  assert.ok(m.p.grain > before * 1.15, 'the shock');
  const after = m.p.grain;
  market.step(g, m, flat(0.5));
  assert.ok(m.p.grain > after, 'and it keeps pushing');
  for (let i = 0; i < 10; i++) market.step(g, m, flat(0.5));
  assert.strictEqual(m.fx.length, 0, 'the push ends');
  assert.strictEqual(m.news.at(-1).id, 'drought');
  // God can make events weaker, stronger, or never happen
  settings.set('market.eventStrength', 0, g);
  const p = m.p.ore;
  godCore.marketEvent(g, 'collapse');
  assert.strictEqual(m.p.ore, p, 'strength 0: nothing moves');
  assert.strictEqual(godCore.marketEvent(g, 'nothing-like-this'), null);
  assert.ok(market.EVENTS.every((x) => x.ids.every((id) => stuff.get(id))), 'every event is about goods that exist');
});

test('market: a hand change (event, God, shock) shows in the change of the last day', () => {
  const g = newGroup();
  settings.set('market.eventChance', 0, g);
  assert.strictEqual(market.change24(g, 'grain'), 0);
  godCore.marketEvent(g, 'drought');
  assert.ok(market.change24(g, 'grain') > 15, 'the drought is in the change of the day');
  market.setPrice(g, 'ore', 20);
  assert.ok(market.change24(g, 'ore') > 90);
  market.shock(g, 'iron', -10);
  assert.ok(market.change24(g, 'iron') < -9);
  assert.strictEqual(market.history(g, 'iron').length, 2);
});

test('market: the value of goods follows the price, so the bag and the rank follow it too; God can switch the market off', () => {
  const g = newGroup();
  const a = person();
  stuff.add(g, a, 'wine', 50);
  const worth0 = A.netWorth(g, a);
  market.setPrice(g, 'wine', 72);
  assert.ok(A.netWorth(g, a) > worth0 * 1.8, 'the bag is worth more');
  assert.strictEqual(stuff.sellPrice(g, 'wine'), Math.floor(72 * 0.9));
  settings.set('market.on', false, g);
  assert.strictEqual(stuff.sellPrice(g, 'wine'), 32, 'with the market off every good has its normal value (36 × 90%)');
  assert.strictEqual(stuff.valueOf(g, 'wine'), 36);
});

// ------------------------------------------------------------------ the Herald
test('the Herald names the prices, tags the people who own what moved, and says what is cheap or dear', () => {
  const g = newGroup();
  const farmer = person();
  const trader = person();
  const nobody = person();
  settings.set('market.eventChance', 0, g);
  stuff.add(g, trader, 'iron', 20);
  S.citizen(g, farmer).estates = { farm: { lv: 1, at: Date.now(), spent: 3000 } };
  S.citizen(g, nobody);
  godCore.marketEvent(g, 'drought');
  godCore.marketEvent(g, 'war');
  const ed = market.edition(g, true);
  assert.match(ed.text, /Realm Herald/);
  assert.match(ed.text, /Breaking/);
  assert.ok(ed.mentions.includes(farmer), 'the owner of a farm is tagged when grain moves');
  assert.ok(ed.mentions.includes(trader), 'the holder of iron is tagged when iron moves');
  assert.ok(!ed.mentions.includes(nobody));
  assert.ok(ed.text.includes(`@${num(farmer)}`) && ed.text.includes(`@${num(trader)}`), 'the text names them the way the mentions list expects');
  assert.match(ed.text, /Dear:/);
  const second = market.edition(g, true);
  assert.doesNotMatch(second.text, /Breaking/, 'news is told once');
  assert.strictEqual(second.quiet, true, 'nothing new happened');
  settings.set('herald.maxTags', 0, g);
  assert.strictEqual(market.edition(g).mentions.length, 0, 'God can limit the tags');
});

test('the Herald job posts only in realms where an admin switched it on, once per update, and God\'s switches stop it', async () => {
  const g = newGroup();
  const off = newGroup();
  const a = person();
  for (const grp of [g, off]) {
    settings.set('market.eventChance', 0, grp);
    stuff.add(grp, a, 'grain', 10);
    market.market(grp, Date.now() - 2 * HOUR);
  }
  market.setHerald(g, true);
  const posts = [];
  const post = async (group, content) => posts.push({ group, content });
  const t = Date.now();
  await market.job(post, t + 61 * MIN);
  assert.strictEqual(posts.filter((p) => p.group === off).length, 0, 'no Herald where nobody asked');
  const mine = posts.filter((p) => p.group === g);
  assert.strictEqual(mine.length, 1);
  assert.match(mine[0].content.text, /Realm Herald/);
  assert.ok(Array.isArray(mine[0].content.mentions));
  await market.job(post, t + 61 * MIN + 30000);
  assert.strictEqual(posts.filter((p) => p.group === g).length, 1, 'not again before the next update');
  // closed realm, switched off feature
  S.setOn(g, false);
  await market.job(post, t + 3 * HOUR);
  assert.strictEqual(posts.filter((p) => p.group === g).length, 1, 'a closed realm gets no news');
  S.setOn(g, true);
  settings.set('herald.on', false, g);
  await market.job(post, t + 4 * HOUR);
  assert.strictEqual(posts.filter((p) => p.group === g).length, 1, 'God closed the Herald');
  settings.reset('herald.on', g);
  settings.set('herald.quiet', true, g);
  settings.set('market.volatility', 0, g);
  settings.set('market.reversion', 0, g);
  await market.job(post, t + 5 * HOUR);
  assert.strictEqual(posts.filter((p) => p.group === g).length, 1, 'quiet mode: nothing moved, nothing posted');
});

test('a post that fails does not stop the other realms', async () => {
  const g = newGroup();
  const h = newGroup();
  for (const grp of [g, h]) {
    settings.set('market.eventChance', 0, grp);
    market.market(grp, Date.now() - 3 * HOUR);
    market.setHerald(grp, true);
  }
  const got = [];
  const log = console.log;
  console.log = () => {};
  await market.job(async (group) => { if (group === g) throw new Error('offline'); got.push(group); }, Date.now() + 5 * HOUR);
  console.log = log;
  assert.ok(got.includes(h));
});

// ------------------------------------------------------------------ trading between citizens
test('trade: an offer, an answer, the fee, and checks when it is accepted', () => {
  const g = newGroup();
  const a = person();
  const b = person();
  stuff.add(g, a, 'cloth', 30);
  A.add(g, b, 1000);
  assert.strictEqual(trade.offer(g, a, a, 'cloth', 5, 50).why, 'self');
  assert.strictEqual(trade.offer(g, a, b, 'hoe', 1, 50).why, 'unknown');
  assert.strictEqual(trade.offer(g, a, b, 'cloth', 99, 50).why, 'few');
  assert.strictEqual(trade.offer(g, a, b, 'cloth', 5, 0).why, 'amount');
  const o = trade.offer(g, a, b, 'cloth', 10, 200);
  assert.ok(o.ok);
  assert.strictEqual(trade.forMe(g, b).length, 1);
  assert.strictEqual(trade.forMe(g, a).length, 0);
  const r = trade.accept(g, b);
  assert.ok(r.ok && r.fee === 4 && r.got === 196);
  assert.strictEqual(stuff.countOf(g, b, 'cloth'), 10);
  assert.strictEqual(stuff.countOf(g, a, 'cloth'), 20);
  assert.strictEqual(A.balance(g, b), 800);
  assert.strictEqual(A.balance(g, a), 196);
  assert.strictEqual(A.treasury(g), 4);
  assert.strictEqual(trade.accept(g, b).why, 'none', 'an offer is used once');
  // the seller sold the goods meanwhile; the buyer has no money; the bag is full
  trade.offer(g, a, b, 'cloth', 20, 100);
  stuff.take(g, a, 'cloth', 15);
  assert.strictEqual(trade.accept(g, b).why, 'gone');
  trade.offer(g, a, b, 'cloth', 5, 5000);
  assert.strictEqual(trade.accept(g, b).why, 'poor');
  A.add(g, b, 9000);
  settings.set('goods.bagBase', 12, g);
  settings.set('goods.bagPerRank', 0, g);
  assert.strictEqual(trade.accept(g, b).why, 'bag');
  assert.ok(trade.remove(g, b, 'buyer').ok, 'declined');
  trade.offer(g, a, b, 'cloth', 1, 10);
  assert.ok(trade.remove(g, a, 'seller').ok, 'taken back');
  assert.strictEqual(trade.remove(g, a, 'seller').why, 'none');
});

test('trade: offers expire, and God sets the fee, the time and the number of offers', () => {
  const g = newGroup();
  const a = person();
  const b = person();
  stuff.add(g, a, 'grain', 50);
  const t = Date.now();
  trade.offer(g, a, b, 'grain', 5, 30, t);
  assert.strictEqual(trade.forMe(g, b, t + 4 * MIN).length, 1);
  assert.strictEqual(trade.forMe(g, b, t + 6 * MIN).length, 0, 'five minutes');
  settings.set('trade.offerMinutes', 60, g);
  trade.offer(g, a, b, 'grain', 5, 30, t);
  assert.strictEqual(trade.forMe(g, b, t + 30 * MIN).length, 1);
  settings.set('trade.maxOffers', 1, g);
  assert.strictEqual(trade.offer(g, a, b, 'grain', 5, 30, t).why, 'many');
  settings.set('trade.fee', 50, g);
  A.add(g, b, 100);
  assert.strictEqual(trade.accept(g, b, null, t + MIN).fee, 15);
});

// ------------------------------------------------------------------ auctions
test('auction: bids, refunds, the minimum raise, no bidding on your own, the cut, and delivery', () => {
  const g = newGroup();
  const seller = person();
  const b1 = person();
  const b2 = person();
  stuff.add(g, seller, 'sword', 2);
  for (const w of [b1, b2]) A.add(g, w, 2000);
  const t = Date.now();
  assert.strictEqual(auction.create(g, seller, 'sword', 1, 5, null, t).why, 'start');
  assert.strictEqual(auction.create(g, seller, 'hoe', 1, 100, null, t).why, 'unknown');
  assert.strictEqual(auction.create(g, seller, 'sword', 5, 100, null, t).why, 'few');
  const made = auction.create(g, seller, 'sword', 1, 100, null, t);
  assert.ok(made.ok);
  const id = made.auction.id;
  assert.strictEqual(stuff.countOf(g, seller, 'sword'), 1, 'the sword is held by the auction');
  assert.strictEqual(auction.bid(g, seller, id, 500, t).why, 'seller');
  assert.strictEqual(auction.bid(g, b1, id, 50, t).why, 'low');
  assert.ok(auction.bid(g, b1, id, 100, t).ok);
  assert.strictEqual(A.balance(g, b1), 1900, 'a bid is paid at once');
  assert.strictEqual(auction.bid(g, b2, id, 102, t).why, 'low', 'at least 5% more');
  assert.strictEqual(auction.minBid(g, auction.find(g, id)), 105);
  const out = auction.bid(g, b2, id, 150, t);
  assert.ok(out.ok && out.outbid === b1);
  assert.strictEqual(A.balance(g, b1), 2000, 'the one who was outbid gets the Aurum back');
  assert.ok(auction.bid(g, b2, id, 300, t).ok);
  assert.strictEqual(A.balance(g, b2), 1700, 'raising your own bid only costs the difference');
  assert.strictEqual(auction.cancel(g, seller, id).why, 'bids');
  assert.strictEqual(auction.resolve(g, t + HOUR).length, 0, 'not over yet');
  // the bag of the winner is full: the sword still arrives
  stuff.setCount(g, b2, 'grain', 100);
  const done = auction.resolve(g, t + 7 * HOUR);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0].sold && done[0].cut === 15 && done[0].got === 285);
  assert.strictEqual(stuff.countOf(g, b2, 'sword'), 1);
  assert.strictEqual(A.balance(g, seller), 285);
  assert.strictEqual(A.treasury(g), 15);
  assert.strictEqual(auction.resolve(g, t + 8 * HOUR).length, 0, 'closed once');
  const msg = auction.message(done);
  assert.ok(msg.mentions.includes(seller) && msg.mentions.includes(b2));
  assert.ok(msg.text.includes(`@${num(b2)}`));
});

test('auction: nobody bids, the goods come back; the seller can cancel; limits, extra time for a late bid, God\'s numbers', () => {
  const g = newGroup();
  const s = person();
  const b = person();
  stuff.add(g, s, 'iron', 10);
  A.add(g, b, 1000);
  const t = Date.now();
  const a = auction.create(g, s, 'iron', 4, 50, 2, t).auction;
  assert.strictEqual(a.ends, t + 2 * HOUR);
  const r = auction.resolve(g, t + 3 * HOUR);
  assert.ok(!r[0].sold);
  assert.strictEqual(stuff.countOf(g, s, 'iron'), 10);
  assert.ok(auction.message(r).text.includes('no bids'));
  const c = auction.create(g, s, 'iron', 4, 50, null, t).auction;
  assert.ok(auction.cancel(g, s, c.id).ok);
  assert.strictEqual(stuff.countOf(g, s, 'iron'), 10);
  assert.strictEqual(auction.cancel(g, b, 12345).why, 'none');
  // too many, and the longest time
  settings.set('auction.maxListings', 1, g);
  const one = auction.create(g, s, 'iron', 1, 50, 100, t);
  assert.ok(one.ok && one.hours === 24, 'longer than the longest is cut');
  assert.strictEqual(auction.create(g, s, 'iron', 1, 50, null, t).why, 'many');
  // a bid in the last two minutes adds time
  const bid = auction.bid(g, b, one.auction.id, 50, t + 24 * HOUR - MIN);
  assert.ok(bid.ok && bid.extended);
  assert.strictEqual(one.auction.ends, t + 24 * HOUR - MIN + 2 * MIN);
  settings.set('auction.antiSnipe', 0, g);
  settings.set('auction.cut', 50, g);
  const o = auction.create(g, s, 'iron', 1, 100, null, t).auction;
  settings.set('auction.maxListings', 5, g);
});

test('auction: the job closes auctions by itself and tells the group, and only in realms that are open', async () => {
  const g = newGroup();
  const closed = newGroup();
  const s = person();
  const b = person();
  for (const grp of [g, closed]) {
    stuff.add(grp, s, 'cloth', 5);
    A.add(grp, b, 500);
    const a = auction.create(grp, s, 'cloth', 2, 20, 1).auction;
    auction.bid(grp, b, a.id, 40);
  }
  S.setOn(closed, false);
  const posts = [];
  await auction.job(async (group, content) => posts.push({ group, content }), Date.now() + 2 * HOUR);
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].group, g);
  assert.match(posts[0].content.text, /Auction closed/);
  assert.ok(posts[0].content.mentions.includes(b));
});

test('the market and the auctions register their jobs with the ticker; the scheduler does not know them', () => {
  assert.ok(ticker.names().includes('realm-market'));
  assert.ok(ticker.names().includes('realm-auctions'));
  const sched = fs.readFileSync(path.join(__dirname, '..', 'core', 'scheduler.js'), 'utf8');
  assert.doesNotMatch(sched, /realm\/market|realm\/auction|\.\/market/);
});

// ------------------------------------------------------------------ the commands
test('commands: market, market grain, market buy, sell, herald', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  A.add(g, a, 5000);
  await say(sock, g, a, '.market');
  assert.match(last(sock), /The Realm Market/);
  assert.match(last(sock), /Grain/);
  assert.match(last(sock), /Next update in/);
  await say(sock, g, a, '.market grain');
  assert.match(last(sock), /Normal value/);
  await say(sock, g, a, '.market buy grain 10');
  assert.match(last(sock), /Bought/);
  assert.strictEqual(stuff.countOf(g, a, 'grain'), 10);
  await say(sock, g, a, '.market buy grain');
  assert.match(last(sock), /Bought/);
  await say(sock, g, a, '.market buy dragon 3');
  assert.match(last(sock), /Name a good/);
  await say(sock, g, a, '.market buy iron 999');
  assert.match(last(sock), /room for|costs/);
  await say(sock, g, a, '.market sell');
  assert.match(last(sock), /sell command/);
  await say(sock, g, a, '.sell grain 5');
  assert.match(last(sock), /Sold/);
  await say(sock, g, a, '.herald');
  assert.match(last(sock), /Realm Herald/);
  assert.match(last(sock), /herald on/);
  const beforeHerald = sock.texts().length;
  await say(sock, g, a, '.herald on');
  assert.strictEqual(sock.texts().length, beforeHerald, 'a member who is not an admin gets no answer at all');
  assert.strictEqual(market.heraldOn(g), false, 'and the Herald stayed off');
  await say(sock, g, OWNER, '.herald on');
  assert.match(last(sock), /Herald is on/);
  assert.strictEqual(market.heraldOn(g), true);
  await say(sock, g, a, '.realm');
  assert.match(last(sock), /Herald \(market news\):\* ✅/);
  await say(sock, g, OWNER, '.herald off');
  assert.strictEqual(market.heraldOn(g), false);
});

test('commands: a trade between two citizens, and an auction with a bid', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  const b = person();
  const c = person();
  stuff.add(g, a, 'cloth', 20);
  A.add(g, b, 1000);
  A.add(g, c, 1000);
  await say(sock, g, a, '.trade');
  assert.match(last(sock), /Trading/);
  await say(sock, g, a, `.trade ${num(b)} cloth 10 200`);
  assert.match(last(sock), /Offer made/);
  await say(sock, g, b, '.trade list');
  assert.match(last(sock), /sells/);
  await say(sock, g, b, '.trade accept');
  assert.match(last(sock), /Trade done/);
  assert.strictEqual(stuff.countOf(g, b, 'cloth'), 10);
  const mention = lastMsg(sock).mentions;
  await say(sock, g, a, '.trade accept');
  assert.match(last(sock), /Nobody has an offer/);
  await say(sock, g, a, `.trade ${num(b)} cloth 5 50`);
  await say(sock, g, b, '.trade decline');
  assert.match(last(sock), /declined/);
  // auction
  stuff.add(g, a, 'sword', 1);
  await say(sock, g, a, '.auction');
  assert.match(last(sock), /Nothing is for sale/);
  await say(sock, g, a, '.auction sell sword 1 200');
  assert.match(last(sock), /Auction #1/);
  await say(sock, g, b, '.auction');
  assert.match(last(sock), /Sword/);
  await say(sock, g, b, '.auction bid 1 100');
  assert.match(last(sock), /lowest bid now is 200/);
  await say(sock, g, b, '.auction bid 1 250');
  assert.match(last(sock), /leads with/);
  await say(sock, g, c, '.bid 1 300');
  assert.match(last(sock), /was outbid/);
  assert.ok(lastMsg(sock).mentions.includes(b), 'the one who was outbid is tagged for real');
  await say(sock, g, c, '.auction info 1');
  assert.match(last(sock), /Best bid/);
  await say(sock, g, a, '.auction cancel 1');
  assert.match(last(sock), /already bid/);
  // time passes: the next command closes it and tells everybody
  auction.find(g, 1).ends = Date.now() - 1000;
  await say(sock, g, b, '.auction');
  assert.ok(sock.texts().some((t) => /Auction closed/.test(t)));
  assert.strictEqual(stuff.countOf(g, c, 'sword'), 1);
  assert.ok(mention.includes(a) && mention.includes(b));
});

test('commands: realm off and God\'s feature switches stop the new commands', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  S.setOn(g, false);
  for (const c of ['.market', '.market buy grain 1', '.herald', '.trade', '.auction', '.bid 1 5']) {
    await say(sock, g, a, c);
    assert.match(last(sock), /realm is closed/, c);
  }
  S.setOn(g, true);
  for (const [feature, cmd] of [['market', '.market'], ['herald', '.herald'], ['trade', '.trade'], ['auction', '.auction']]) {
    settings.set(`${feature}.on`, false, g);
    await say(sock, g, a, cmd);
    assert.match(last(sock), /Closed by God/, feature);
  }
  await say(sock, g, a, '.purse');
  assert.match(last(sock), /Your purse/);
});

test('God: set a price, start an event, post the Herald, reset the market, end or cancel an auction, from a private chat', async () => {
  const sock = fakeSock();
  const g = newGroup();
  const a = person();
  const b = person();
  stuff.add(g, a, 'grain', 12);
  await dm(sock, OWNER, `.god realm ${g}`);
  await dm(sock, OWNER, '.god price grain 12');
  assert.match(last(sock), /Price set/);
  assert.strictEqual(market.price(g, 'grain'), 12);
  await dm(sock, OWNER, '.god price grain nothing');
  assert.match(last(sock), /Set a price/);
  await dm(sock, OWNER, '.god event list');
  assert.match(last(sock), /drought/);
  sock.sent.length = 0;
  await dm(sock, OWNER, '.god event famine');
  assert.match(last(sock), /Event started/);
  const told = sock.sent.find((s) => s.j === g);
  assert.ok(told && /heavens have spoken/.test(told.c.text), 'the realm hears it');
  assert.ok(told.c.mentions.includes(a), 'and the owner of grain is tagged for real');
  await dm(sock, OWNER, '.god event nonsense');
  assert.match(last(sock), /do not know that event/);
  sock.sent.length = 0;
  await dm(sock, OWNER, '.god herald');
  assert.match(last(sock), /Herald was posted/);
  assert.ok(sock.sent.some((s) => s.j === g && /Realm Herald/.test(s.c.text || '') && Array.isArray(s.c.mentions)));
  await dm(sock, OWNER, '.god market reset');
  assert.match(last(sock), /confirm/);
  assert.strictEqual(market.price(g, 'grain') === market.baseOf(g, 'grain'), false);
  await dm(sock, OWNER, '.god market reset confirm');
  assert.match(last(sock), /Market reset/);
  assert.strictEqual(market.price(g, 'grain'), market.baseOf(g, 'grain'));
  // auctions
  stuff.add(g, b, 'sword', 2);
  A.add(g, a, 1000);
  const x = auction.create(g, b, 'sword', 1, 100).auction;
  const y = auction.create(g, b, 'sword', 1, 100).auction;
  auction.bid(g, a, x.id, 150);
  auction.bid(g, a, y.id, 150);
  await dm(sock, OWNER, '.god auction');
  assert.match(last(sock), /Auctions/);
  sock.sent.length = 0;
  await dm(sock, OWNER, `.god auction cancel ${x.id}`);
  assert.match(last(sock), /Auction cancelled/);
  assert.strictEqual(stuff.countOf(g, b, 'sword'), 1 + 0, 'the sword went back to the seller');
  assert.strictEqual(A.balance(g, a), 850, 'the bid went back to the bidder (one auction still holds 150)');
  await dm(sock, OWNER, `.god auction end ${y.id}`);
  assert.match(last(sock), /Auction closed/);
  assert.strictEqual(stuff.countOf(g, a, 'sword'), 1);
  assert.ok(sock.sent.some((s) => s.j === g && /Auction closed/.test(s.c.text || '')));
  await dm(sock, OWNER, '.god auction end 999');
  assert.match(last(sock), /Auctions|no such/);
  // the ledger has it
  await dm(sock, OWNER, '.god ledger 15');
  assert.match(last(sock), /price/);
  assert.match(last(sock), /market event/);
  assert.match(last(sock), /auction/);
  // others cannot
  const beforeGod = sock.texts().length;
  await say(sock, g, a, '.god price grain 1');
  assert.strictEqual(sock.texts().length, beforeGod, 'a stranger who tries God gets no answer at all');
});

test('God can see and change every number of the market, the Herald, trading and auctions', async () => {
  const sock = fakeSock();
  const g = newGroup();
  await dm(sock, OWNER, `.god realm ${g}`);
  for (const f of ['market', 'herald', 'trade', 'auction']) {
    await dm(sock, OWNER, `.god settings ${f}`);
    assert.match(last(sock), new RegExp(settings.one(f).title.split(' ')[0]));
  }
  await dm(sock, OWNER, '.god set market.volatility 5 here');
  assert.match(last(sock), /Setting changed/);
  assert.strictEqual(settings.get('market.volatility', g), 5);
  await dm(sock, OWNER, '.god set market.volatility 99');
  assert.match(last(sock), /Allowed: 0 to 30/);
  await dm(sock, OWNER, '.god set auction.cut 10');
  assert.strictEqual(settings.get('auction.cut', g), 10);
  settings.reset('auction.cut');
  await dm(sock, OWNER, '.god off auction here');
  await dm(sock, OWNER, '.auction');
  assert.match(last(sock), /Closed by God/);
});

test('moving a citizen to another realm leaves the prices of the realm where they are', async () => {
  const from = newGroup();
  const to = newGroup();
  const a = person();
  stuff.add(from, a, 'iron', 10);
  market.setPrice(from, 'iron', 60);
  godCore.moveRealm(from, to, S.keyOf(a), 'move');
  assert.strictEqual(stuff.countOf(to, a, 'iron'), 10);
  assert.strictEqual(market.price(to, 'iron'), 32, 'the new realm has its own price');
  assert.strictEqual(market.price(from, 'iron'), 60);
});

// Estates: buildings that produce goods while the citizen is away. Collect them, upgrade them, sell them.
// A part of what an estate makes is kept by the realm (the estate tax, stored in the realm's granary for the government of a later phase).
// God can change every price, every output, the rank needed, the tax, the storage and the number of estates.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');

const HOUR = 3600000;

settings.register('estates', {
  title: 'Estates',
  icon: '🏡',
  about: 'Farms, mines and other buildings that produce goods, with upgrades and a tax to the realm',
  settings: {
    estatesBase: { label: 'Estates a Commoner can own', def: 1, min: 0, max: 100, unit: 'estates' },
    estatesPerRank: { label: 'Extra estates for every rank step', def: 1, min: 0, max: 100, unit: 'estates' },
    tax: { label: 'Share of the goods the realm keeps', def: 10, min: 0, max: 90, kind: 'float', unit: '%' },
    storageHours: { label: 'Hours of production an estate can store', def: 12, min: 1, max: 720, unit: 'hours' },
    maxLevel: { label: 'Highest level of an estate', def: 5, min: 1, max: 50, unit: 'levels' },
    levelOutput: { label: 'Extra output for every level', def: 50, min: 0, max: 1000, kind: 'float', unit: '%' },
    upgradeCost: { label: 'Upgrade price compared to the buying price (× the new level)', def: 0.5, min: 0, max: 100, kind: 'float', unit: '×' },
    refund: { label: 'Share of the money paid that comes back when an estate is sold', def: 60, min: 0, max: 100, kind: 'float', unit: '%' },
  },
});
const get = (k, g) => settings.get(`estates.${k}`, g);

// "needs" = goods taken from the bag for each good made (the Forge turns Ore into Iron)
const ESTATES = [
  { id: 'farm', name: 'Farm', icon: '🌾', good: 'grain', out: 5, price: 3000, minRank: 0, about: 'grows Grain' },
  { id: 'mine', name: 'Mine', icon: '⛏️', good: 'ore', out: 3, price: 4500, minRank: 0, about: 'digs Ore' },
  { id: 'weaver', name: "Weaver's Hut", icon: '🧶', good: 'cloth', out: 2, price: 5500, minRank: 1, about: 'weaves Cloth' },
  { id: 'tavern', name: 'Tavern', icon: '🍺', good: 'wine', out: 1, price: 8000, minRank: 2, about: 'brews Wine' },
  { id: 'forge', name: 'Forge', icon: '🔨', good: 'iron', out: 2, price: 10000, minRank: 2, needs: { ore: 2 }, about: 'turns 2 Ore into 1 Iron (from your bag)' },
];
for (const e of ESTATES) {
  settings.extend('estates', `price_${e.id}`, { label: `Price of the ${e.name}`, def: e.price, min: 0, max: 1000000000, unit: 'Aurum' });
  settings.extend('estates', `output_${e.id}`, { label: `${stuff.get(e.good).name} the ${e.name} makes in an hour at level 1`, def: e.out, min: 0, max: 100000, unit: 'units' });
  settings.extend('estates', `minRank_${e.id}`, { label: `Rank needed for the ${e.name} (0 Commoner … 4 Lord)`, def: e.minRank, min: 0, max: 4, unit: 'rank' });
}
const byId = (id) => ESTATES.find((e) => e.id === id) || null;
const find = (t) => {
  const w = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  return ESTATES.find((e) => e.id === w || e.name.toLowerCase().replace(/[^a-z]/g, '') === w) || null;
};
const priceOf = (group, e) => settings.get(`estates.price_${e.id}`, group);
const minRankOf = (group, e) => settings.get(`estates.minRank_${e.id}`, group);
const outputOf = (group, e, level) => settings.get(`estates.output_${e.id}`, group) * (1 + ((level - 1) * get('levelOutput', group)) / 100);
const upgradeCost = (group, e, toLevel) => Math.round(priceOf(group, e) * toLevel * get('upgradeCost', group));

const owned = (c) => c.estates || (c.estates = {});
const maxEstates = (group, jid) => get('estatesBase', group) + A.rank(group, jid).index * get('estatesPerRank', group);

// what an estate has made since the last collection (before the tax)
function waiting(group, e, st, now = Date.now()) {
  const hours = Math.min(get('storageHours', group), Math.max(0, (now - st.at) / HOUR));
  return Math.floor(hours * outputOf(group, e, st.lv) * require('./civic').mult(group, 'output', now)); // a harvest law raises it while it is on
}

function buy(group, jid, id, now = Date.now()) {
  const e = byId(id);
  if (!e) return { ok: false, why: 'unknown' };
  const c = S.citizen(group, jid);
  if (owned(c)[id]) return { ok: false, why: 'owned', estate: e };
  const rank = A.rank(group, jid);
  const need = minRankOf(group, e);
  if (rank.index < need) return { ok: false, why: 'rank', estate: e, need: A.RANKS[need] };
  if (Object.keys(owned(c)).length >= maxEstates(group, jid)) return { ok: false, why: 'limit', max: maxEstates(group, jid) };
  const price = priceOf(group, e);
  if (c.coins < price) return { ok: false, why: 'poor', estate: e, price, need: price - c.coins };
  c.coins -= price;
  owned(c)[id] = { lv: 1, at: now, spent: price };
  S.touch();
  return { ok: true, estate: e, price };
}
function upgrade(group, jid, id) {
  const e = byId(id);
  if (!e) return { ok: false, why: 'unknown' };
  const c = S.citizen(group, jid);
  const st = owned(c)[id];
  if (!st) return { ok: false, why: 'none', estate: e };
  if (st.lv >= get('maxLevel', group)) return { ok: false, why: 'max', estate: e };
  const cost = upgradeCost(group, e, st.lv + 1);
  if (c.coins < cost) return { ok: false, why: 'poor', estate: e, price: cost, need: cost - c.coins };
  collectOne(group, jid, id, Date.now()); // what it made so far is kept before it grows
  c.coins -= cost;
  st.lv += 1;
  st.spent += cost;
  S.touch();
  return { ok: true, estate: e, level: st.lv, cost };
}
function sell(group, jid, id) {
  const e = byId(id);
  const c = S.citizen(group, jid);
  const st = e && owned(c)[id];
  if (!st) return { ok: false, why: 'none' };
  collectOne(group, jid, id, Date.now());
  const back = Math.floor((st.spent * get('refund', group)) / 100);
  delete owned(c)[id];
  A.add(group, jid, back);
  S.touch();
  return { ok: true, estate: e, back };
}

// collects one estate: returns { made, tax, added, lost, used }
function collectOne(group, jid, id, now) {
  const e = byId(id);
  const c = S.citizen(group, jid);
  const st = owned(c)[id];
  let made = waiting(group, e, st, now);
  let usedGoods = null;
  if (e.needs && made > 0) {
    const [need, per] = Object.entries(e.needs)[0]; // per = how many it takes for one good
    const can = Math.floor(stuff.countOf(group, jid, need) / per);
    const makes = Math.min(made, can);
    if (makes > 0) stuff.take(group, jid, need, makes * per);
    usedGoods = { id: need, n: makes * per };
    made = makes;
  }
  st.at = now;
  const tax = Math.min(made, Math.floor((made * get('tax', group)) / 100));
  const net = made - tax;
  const r = stuff.add(group, jid, e.good, net);
  if (tax) {
    const realm = S.realmOf(group);
    realm.stock = realm.stock || {};
    realm.stock[e.good] = (realm.stock[e.good] || 0) + tax;
  }
  S.touch();
  return { estate: e, made, tax, added: r.added, lost: r.lost, used: usedGoods, good: e.good };
}
function collect(group, jid, now = Date.now()) {
  const c = S.citizen(group, jid);
  const ids = Object.keys(owned(c));
  if (!ids.length) return { ok: false, why: 'none' };
  const rows = ids.map((id) => collectOne(group, jid, id, now));
  return { ok: true, rows };
}

function view(group, jid, now = Date.now()) {
  const c = S.citizen(group, jid);
  return Object.entries(owned(c)).map(([id, st]) => {
    const e = byId(id);
    return { estate: e, lv: st.lv, waiting: waiting(group, e, st, now), perHour: outputOf(group, e, st.lv), full: now - st.at >= get('storageHours', group) * HOUR, next: st.lv < get('maxLevel', group) ? upgradeCost(group, e, st.lv + 1) : null };
  });
}

// the estates are part of the net worth (at what the realm pays back)
A.registerWorth((group, key) => {
  const c = S.js.data.citizens[S.slot(group, key)];
  if (!c || !c.estates) return 0;
  return Object.values(c.estates).reduce((t, st) => t + Math.floor((st.spent * get('refund', group)) / 100), 0);
});

module.exports = { ESTATES, byId, find, priceOf, minRankOf, outputOf, upgradeCost, maxEstates, waiting, buy, upgrade, sell, collect, view, owned };

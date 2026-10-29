// Goods (grain, ore, iron, wine, cloth) and items (bread, sword...): what citizens carry in their bag.
// Everything has a value (God can change it, and the market of a later phase will move it) and the bag has a size.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');

settings.register('goods', {
  title: 'Goods and Items',
  icon: '📦',
  about: 'The bag, the value of goods and items, and selling to the realm',
  settings: {
    sellPct: { label: 'How much of its value the realm pays when you sell', def: 90, min: 1, max: 500, kind: 'float', unit: '%' },
    bagBase: { label: 'Bag size of a Commoner', def: 100, min: 10, max: 1000000, unit: 'units' },
    bagPerRank: { label: 'Extra bag size for every rank step', def: 50, min: 0, max: 1000000, unit: 'units' },
  },
});

const stuff = new Map();
const valueMods = []; // the market of a later phase adds a function (group, id) => multiplier

function define(def) {
  stuff.set(def.id, def);
  settings.extend('goods', `value_${def.id}`, { label: `Value of ${def.name}`, def: def.value, min: 0, max: 10000000, unit: 'Aurum' });
}
const addValueMod = (fn) => valueMods.push(fn);

define({ id: 'grain', name: 'Grain', icon: '🌾', value: 6, kind: 'good' });
define({ id: 'ore', name: 'Ore', icon: '⛏️', value: 10, kind: 'good' });
define({ id: 'iron', name: 'Iron', icon: '🔩', value: 32, kind: 'good' });
define({ id: 'wine', name: 'Wine', icon: '🍷', value: 36, kind: 'good' });
define({ id: 'cloth', name: 'Cloth', icon: '🧵', value: 18, kind: 'good' });

const get = (id) => stuff.get(id) || null;
const list = (kind) => [...stuff.values()].filter((s) => !kind || s.kind === kind);
const find = (text) => {
  const t = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  return list().find((s) => s.id === t || s.name.toLowerCase().replace(/[^a-z]/g, '') === t) || null;
};
const valueOf = (group, id) => Math.max(0, Math.round(settings.get(`goods.value_${id}`, group) * valueMods.reduce((m, fn) => m * (fn(group, id) || 1), 1)));
const sellPrice = (group, id) => Math.floor((valueOf(group, id) * settings.get('goods.sellPct', group)) / 100);

// ---- the bag of a citizen
const bag = (c) => c.inv || (c.inv = {});
const countOf = (group, jid, id) => bag(S.citizen(group, jid))[id] || 0;
const used = (group, jid) => Object.values(bag(S.citizen(group, jid))).reduce((t, n) => t + n, 0);
const bagSize = (group, jid) => settings.get('goods.bagBase', group) + A.rank(group, jid).index * settings.get('goods.bagPerRank', group);

// puts things in the bag. What does not fit is lost. Returns { added, lost }
function add(group, jid, id, n) {
  n = Math.round(n);
  if (!get(id) || !(n > 0)) return { added: 0, lost: 0 };
  const c = S.citizen(group, jid);
  const room = Math.max(0, bagSize(group, jid) - used(group, jid));
  const added = Math.min(n, room);
  if (added) bag(c)[id] = (bag(c)[id] || 0) + added;
  S.touch();
  return { added, lost: n - added };
}
function take(group, jid, id, n) {
  n = Math.round(n);
  const c = S.citizen(group, jid);
  if (!(n > 0) || (bag(c)[id] || 0) < n) return false;
  bag(c)[id] -= n;
  if (bag(c)[id] <= 0) delete bag(c)[id];
  S.touch();
  return true;
}
function setCount(group, jid, id, n) {
  const c = S.citizen(group, jid);
  if (n <= 0) delete bag(c)[id];
  else bag(c)[id] = Math.round(n);
  S.touch();
}

// sells to the realm at its price
function sell(group, jid, id, n) {
  const it = get(id);
  if (!it) return { ok: false, why: 'unknown' };
  const have = countOf(group, jid, id);
  if (n === -1) n = have;
  n = Math.round(n);
  if (!(n > 0)) return { ok: false, why: 'amount' };
  if (have < n) return { ok: false, why: 'few', have, item: it };
  const each = sellPrice(group, id);
  const total = each * n;
  take(group, jid, id, n);
  A.add(group, jid, total);
  return { ok: true, item: it, n, each, total };
}

// what is in the bag is part of the net worth (at the price the realm pays)
A.registerWorth((group, key) => {
  const c = S.js.data.citizens[S.slot(group, key)];
  if (!c || !c.inv) return 0;
  return Object.entries(c.inv).reduce((t, [id, n]) => t + (get(id) ? sellPrice(group, id) * n : 0), 0);
});

module.exports = { define, addValueMod, get, list, find, valueOf, sellPrice, bag, countOf, used, bagSize, add, take, setCount, sell };

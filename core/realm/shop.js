// The shop of the Empire. Items are registered (this file adds the first ones, later features add more).
//   kinds: 'timed' (works for some hours), 'permanent' (kept for good), 'title' (a name next to yours)
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');

const HOUR = 3600000;
settings.register('shop', {
  title: 'The Shop',
  icon: '🛍️',
  about: 'What citizens can buy: charms, satchels and titles',
  settings: {
    priceMult: { label: 'All shop prices (1 = normal, 0.5 = half)', def: 1, min: 0.1, max: 10, kind: 'float', unit: '×' },
    charmHours: { label: 'How long a Fortune Charm works', def: 24, min: 1, max: 720, unit: 'hours' },
    satchelBank: { label: 'Bank space a Merchant\'s Satchel adds', def: 20000, min: 0, max: 100000000, unit: 'Aurum' },
    satchelMax: { label: 'How many satchels a citizen can own', def: 3, min: 1, max: 100, unit: 'satchels' },
  },
});

const items = new Map();
const priceMods = []; // later features (a sale law, for example) add a function (group) => multiplier

function register(item) {
  items.set(item.id, item);
  settings.extend('shop', `price_${item.id}`, { label: `Price of ${item.name}`, def: item.price, min: 0, max: 1000000000, unit: 'Aurum' });
}
const addPriceMod = (fn) => priceMods.push(fn);

register({ id: 'charm', name: 'Fortune Charm', icon: '🍀', price: 600, kind: 'timed', about: (g) => `+${settings.get('core.charmPct', g)}% on your pay for ${settings.get('shop.charmHours', g)} hours` });
register({ id: 'satchel', name: "Merchant's Satchel", icon: '🎒', price: 2000, kind: 'permanent', about: (g) => `+${Number(settings.get('shop.satchelBank', g)).toLocaleString('en-US')} Aurum of bank space (up to ${settings.get('shop.satchelMax', g)})` });
register({ id: 'squire', name: 'Squire', icon: '🛡️', price: 1500, kind: 'title', about: () => 'a title next to your name' });
register({ id: 'knight', name: 'Knight', icon: '⚔️', price: 8000, kind: 'title', about: () => 'a finer title next to your name' });

const priceOf = (group, id) => {
  const it = items.get(id);
  if (!it) return 0;
  const base = settings.get(`shop.price_${id}`, group);
  return Math.max(0, Math.round(base * settings.get('shop.priceMult', group) * priceMods.reduce((m, fn) => m * (fn(group) || 1), 1)));
};
const aboutOf = (group, id) => items.get(id).about(group);
const list = () => [...items.values()];
const find = (text) => {
  const t = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  return list().find((i) => i.id === t || i.name.toLowerCase().replace(/[^a-z]/g, '') === t) || null;
};

function buy(group, jid, id, now = Date.now()) {
  const it = items.get(id);
  if (!it) return { ok: false, why: 'unknown' };
  const c = S.citizen(group, jid);
  if (it.kind === 'timed' && (c.items[id] || 0) > now) return { ok: false, why: 'active', item: it, left: c.items[id] - now };
  if (it.kind === 'title' && c.title === it.name) return { ok: false, why: 'owned', item: it };
  if (it.kind === 'permanent' && (c.satchels || 0) >= settings.get('shop.satchelMax', group)) return { ok: false, why: 'max', item: it, max: settings.get('shop.satchelMax', group) };
  if (it.kind === 'custom' && it.check) {
    const why = it.check(group, jid, c, now);
    if (why) return { ok: false, why: 'custom', message: why, item: it };
  }
  const price = priceOf(group, id);
  if (c.coins < price) return { ok: false, why: 'poor', item: it, price, need: price - c.coins };
  c.coins -= price;
  if (it.kind === 'timed') c.items[id] = now + settings.get('shop.charmHours', group) * HOUR;
  else if (it.kind === 'title') c.title = it.name;
  else if (it.kind === 'custom') it.apply(group, jid, c, now);
  else if (id === 'satchel') {
    c.satchels = (c.satchels || 0) + 1;
    c.bankBonus = (c.bankBonus || 0) + settings.get('shop.satchelBank', group);
  }
  A.treasuryAdd(group, 0);
  S.touch();
  return { ok: true, item: it, price };
}

module.exports = { register, addPriceMod, priceOf, aboutOf, list, find, buy };

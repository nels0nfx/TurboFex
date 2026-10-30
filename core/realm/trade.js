// Trading between citizens: one citizen offers goods or items to another for a price, the other accepts or says no.
// The goods are checked again when the offer is accepted, so nothing can be sold twice. The realm takes a small fee from the seller.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');

settings.register('trade', {
  title: 'Trading between citizens',
  icon: '🤝',
  about: 'Offers from one citizen to another, with a small fee for the treasury',
  settings: {
    fee: { label: 'Fee on a trade (taken from the seller, goes to the treasury)', def: 2, min: 0, max: 50, kind: 'float', unit: '%' },
    offerMinutes: { label: 'How long an offer waits for an answer', def: 5, min: 1, max: 1440, unit: 'minutes' },
    maxOffers: { label: 'Offers one citizen can have waiting', def: 3, min: 1, max: 50, unit: 'offers' },
  },
});
const get = (k, g) => settings.get(`trade.${k}`, g);

const list = (group) => S.realmOf(group).offers || (S.realmOf(group).offers = []);
const fresh = (group, now) => {
  const keep = list(group).filter((o) => now - o.at < get('offerMinutes', group) * 60000);
  if (keep.length !== list(group).length) {
    S.realmOf(group).offers = keep;
    S.touch();
  }
  return keep;
};
const tradable = (id) => {
  const it = stuff.get(id);
  return !!it && (it.kind === 'good' || it.kind === 'item');
};

function offer(group, from, to, id, qty, price, now = Date.now()) {
  if (S.keyOf(from) === S.keyOf(to)) return { ok: false, why: 'self' };
  if (!tradable(id)) return { ok: false, why: 'unknown' };
  qty = Math.round(qty);
  price = Math.round(price);
  if (!(qty >= 1) || !(price >= 1)) return { ok: false, why: 'amount' };
  if (stuff.countOf(group, from, id) < qty) return { ok: false, why: 'few', have: stuff.countOf(group, from, id), item: stuff.get(id) };
  const mine = fresh(group, now).filter((o) => o.from === S.keyOf(from));
  if (mine.length >= get('maxOffers', group)) return { ok: false, why: 'many', max: get('maxOffers', group) };
  const realm = S.realmOf(group);
  realm.offerSeq = (realm.offerSeq || 0) + 1;
  const o = { id: realm.offerSeq, from: S.keyOf(from), fromJid: from, to: S.keyOf(to), toJid: to, good: id, qty, price, at: now };
  list(group).push(o);
  S.touch();
  return { ok: true, offer: o, item: stuff.get(id), minutes: get('offerMinutes', group) };
}

// the offers waiting for a citizen / made by a citizen
const forMe = (group, jid, now = Date.now()) => fresh(group, now).filter((o) => o.to === S.keyOf(jid));
const fromMe = (group, jid, now = Date.now()) => fresh(group, now).filter((o) => o.from === S.keyOf(jid));
const pick = (offers, id) => (id ? offers.find((o) => o.id === id) : offers[offers.length - 1]);

function accept(group, jid, id = null, now = Date.now()) {
  const o = pick(forMe(group, jid, now), id);
  if (!o) return { ok: false, why: 'none' };
  const item = stuff.get(o.good);
  if (stuff.countOf(group, o.fromJid, o.good) < o.qty) {
    S.realmOf(group).offers = list(group).filter((x) => x.id !== o.id);
    S.touch();
    return { ok: false, why: 'gone', offer: o, item };
  }
  if (A.balance(group, jid) < o.price) return { ok: false, why: 'poor', offer: o, item, need: o.price - A.balance(group, jid) };
  if (stuff.bagSize(group, jid) - stuff.used(group, jid) < o.qty) return { ok: false, why: 'bag', offer: o, item };
  const fee = Math.floor((o.price * get('fee', group)) / 100);
  stuff.take(group, o.fromJid, o.good, o.qty);
  stuff.add(group, jid, o.good, o.qty);
  A.take(group, jid, o.price);
  A.add(group, o.fromJid, o.price - fee);
  A.treasuryAdd(group, fee);
  S.realmOf(group).offers = list(group).filter((x) => x.id !== o.id);
  S.touch();
  return { ok: true, offer: o, item, fee, got: o.price - fee };
}

// the buyer says no, or the seller takes the offer back
function remove(group, jid, side, id = null, now = Date.now()) {
  const o = pick(side === 'buyer' ? forMe(group, jid, now) : fromMe(group, jid, now), id);
  if (!o) return { ok: false, why: 'none' };
  S.realmOf(group).offers = list(group).filter((x) => x.id !== o.id);
  S.touch();
  return { ok: true, offer: o, item: stuff.get(o.good) };
}

module.exports = { offer, accept, remove, forMe, fromMe };

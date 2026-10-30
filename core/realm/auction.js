// Auctions: a citizen puts goods or items up for sale, the others bid. The best bid when the time is over wins; the realm keeps a cut.
// Bids are paid at once (and given back when somebody bids more), so a winner can always pay. The scheduler closes the auctions
// that are over and tells the group; a command also closes them when somebody looks.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');
const ticker = require('./ticker');

settings.register('auction', {
  title: 'Auctions',
  icon: '🔨',
  about: 'Goods and items sold to the best bid, with a cut for the treasury',
  settings: {
    hours: { label: 'How long an auction lasts (the default)', def: 6, min: 1, max: 72, unit: 'hours' },
    maxHours: { label: 'Longest an auction can be made to last', def: 24, min: 1, max: 720, unit: 'hours' },
    cut: { label: 'Cut of the winning bid that goes to the treasury', def: 5, min: 0, max: 50, kind: 'float', unit: '%' },
    minIncrement: { label: 'A new bid must be this much higher', def: 5, min: 0, max: 100, kind: 'float', unit: '%' },
    maxListings: { label: 'Auctions one citizen can have running', def: 3, min: 1, max: 50, unit: 'auctions' },
    minStart: { label: 'Lowest starting price', def: 10, min: 1, max: 1000000000, unit: 'Aurum' },
    antiSnipe: { label: 'A bid in the last minutes adds this many minutes (0 = off)', def: 2, min: 0, max: 60, unit: 'minutes' },
  },
});
const get = (k, g) => settings.get(`auction.${k}`, g);
const HOUR = 3600000;

const box = (group) => S.realmOf(group).auctions || (S.realmOf(group).auctions = { seq: 0, list: [] });
const tradable = (id) => {
  const it = stuff.get(id);
  return !!it && (it.kind === 'good' || it.kind === 'item');
};
// goods that come back to a citizen are never lost because the bag is full
const giveBack = (group, jid, id, qty) => stuff.setCount(group, jid, id, stuff.countOf(group, jid, id) + qty);

const active = (group, now = Date.now()) => box(group).list.filter((a) => a.ends > now);
const find = (group, id) => box(group).list.find((a) => a.id === id) || null;
const minBid = (group, a) => (a.bid ? Math.max(a.bid + 1, Math.ceil((a.bid * (100 + get('minIncrement', group))) / 100)) : a.start);

function create(group, jid, id, qty, start, hours = null, now = Date.now()) {
  if (!tradable(id)) return { ok: false, why: 'unknown' };
  qty = Math.round(qty);
  start = Math.round(start);
  if (!(qty >= 1)) return { ok: false, why: 'amount' };
  if (!(start >= get('minStart', group))) return { ok: false, why: 'start', min: get('minStart', group) };
  if (stuff.countOf(group, jid, id) < qty) return { ok: false, why: 'few', have: stuff.countOf(group, jid, id), item: stuff.get(id) };
  const mine = active(group, now).filter((a) => a.seller === S.keyOf(jid));
  if (mine.length >= get('maxListings', group)) return { ok: false, why: 'many', max: get('maxListings', group) };
  const h = Math.min(hours && hours > 0 ? hours : get('hours', group), get('maxHours', group));
  stuff.take(group, jid, id, qty);
  const b = box(group);
  b.seq += 1;
  const a = { id: b.seq, seller: S.keyOf(jid), sellerJid: jid, item: id, qty, start, bid: 0, bidder: null, bidderJid: null, ends: now + h * HOUR, at: now };
  b.list.push(a);
  S.touch();
  return { ok: true, auction: a, item: stuff.get(id), hours: h };
}

function bid(group, jid, id, amount, now = Date.now()) {
  const a = find(group, id);
  if (!a || a.ends <= now) return { ok: false, why: 'none' };
  if (a.seller === S.keyOf(jid)) return { ok: false, why: 'seller' };
  amount = Math.round(amount);
  const need = minBid(group, a);
  if (!(amount >= need)) return { ok: false, why: 'low', need, auction: a };
  const mine = a.bidder === S.keyOf(jid) ? a.bid : 0; // raising your own bid: the old one comes back first
  if (A.balance(group, jid) + mine < amount) return { ok: false, why: 'poor', need: amount - A.balance(group, jid) - mine };
  let outbid = null;
  if (a.bidder && a.bidder !== S.keyOf(jid)) {
    A.add(group, a.bidderJid, a.bid);
    outbid = a.bidderJid;
  } else if (mine) A.add(group, jid, mine);
  A.take(group, jid, amount);
  a.bid = amount;
  a.bidder = S.keyOf(jid);
  a.bidderJid = jid;
  const snipe = get('antiSnipe', group) * 60000;
  let extended = false;
  if (snipe && a.ends - now < snipe) {
    a.ends = now + snipe;
    extended = true;
  }
  S.touch();
  return { ok: true, auction: a, item: stuff.get(a.item), outbid, extended };
}

// the seller takes an auction back (only while nobody bid), or God ends it
function cancel(group, jid, id, force = false) {
  const a = find(group, id);
  if (!a) return { ok: false, why: 'none' };
  if (!force && a.seller !== S.keyOf(jid)) return { ok: false, why: 'notyours' };
  if (!force && a.bid) return { ok: false, why: 'bids' };
  if (a.bid) A.add(group, a.bidderJid, a.bid); // God cancels: the bidder gets the money back
  giveBack(group, a.sellerJid, a.item, a.qty);
  box(group).list = box(group).list.filter((x) => x.id !== id);
  S.touch();
  return { ok: true, auction: a, item: stuff.get(a.item) };
}

// closes the auctions that are over. force = a list of ids that end now (God). Returns what happened.
function resolve(group, now = Date.now(), force = []) {
  const b = box(group);
  const done = b.list.filter((a) => a.ends <= now || force.includes(a.id));
  const out = [];
  for (const a of done) {
    const item = stuff.get(a.item);
    if (a.bid) {
      const cut = Math.floor((a.bid * get('cut', group)) / 100);
      giveBack(group, a.bidderJid, a.item, a.qty);
      A.add(group, a.sellerJid, a.bid - cut);
      A.treasuryAdd(group, cut);
      out.push({ auction: a, item, sold: true, cut, got: a.bid - cut });
    } else {
      giveBack(group, a.sellerJid, a.item, a.qty);
      out.push({ auction: a, item, sold: false });
    }
  }
  if (done.length) {
    b.list = b.list.filter((a) => !done.includes(a));
    S.touch();
  }
  return out;
}

const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
// the message for the group when auctions end (the people are tagged for real: the jids are in the mentions list)
function message(results) {
  const mentions = new Set();
  const lines = ['🔨 *Auction closed*', ''];
  for (const r of results) {
    const a = r.auction;
    mentions.add(a.sellerJid);
    if (r.sold) {
      mentions.add(a.bidderJid);
      lines.push(`${r.item.icon} *${r.item.name}* ×${a.qty} → ${tagOf(a.bidderJid)} for *${Math.round(a.bid).toLocaleString('en-US')} Aurum*`, `   seller ${tagOf(a.sellerJid)} got ${r.got.toLocaleString('en-US')} _(cut ${r.cut.toLocaleString('en-US')})_`);
    } else lines.push(`${r.item.icon} *${r.item.name}* ×${a.qty} – no bids, back to ${tagOf(a.sellerJid)}`);
  }
  return { text: lines.join('\n'), mentions: [...mentions] };
}

async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    const b = S.js.data.realms[group].auctions;
    if (!b || !b.list.some((a) => a.ends <= now)) continue;
    if (!S.isOn(group) || !settings.featureOn('auction', group)) continue;
    const results = resolve(group, now);
    if (!results.length) continue;
    try {
      await post(group, message(results));
    } catch (err) {
      console.log(`The auction result could not be sent to ${group}: ${err.message}`);
    }
  }
}
ticker.register('realm-auctions', job);

module.exports = { create, bid, cancel, resolve, active, find, minBid, message, job, box };

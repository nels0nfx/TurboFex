// The Realm Market: the price of every good (Grain, Ore, Iron, Wine, Cloth) moves with what citizens buy and sell, with a pull back to the
// normal value, with a little randomness, and with events (a drought, a new seam...). Every realm has its own prices.
// Prices are worked out when somebody looks (and by the scheduler for realms with a Herald), so nothing runs for realms nobody uses.
// God changes every number. Later phases (laws, the Steward) change prices with shocks and fee changes.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');

const MIN = 60000;

settings.register('market', {
  title: 'The Realm Market',
  icon: '📈',
  about: 'Prices of goods that move with buying, selling, events and chance',
  settings: {
    tickMinutes: { label: 'Minutes between two price updates', def: 30, min: 5, max: 1440, unit: 'minutes' },
    volatility: { label: 'Random swing of a price in one update', def: 2, min: 0, max: 30, kind: 'float', unit: '%' },
    reversion: { label: 'How fast a price comes back to the normal value (per update)', def: 8, min: 0, max: 100, kind: 'float', unit: '%' },
    impact: { label: 'How far a price moves when as much as the liquidity is traded', def: 10, min: 0, max: 100, kind: 'float', unit: '%' },
    liquidity: { label: 'Units that move a price by the impact above', def: 200, min: 1, max: 1000000, unit: 'units' },
    floor: { label: 'Lowest a price can fall (of the normal value)', def: 25, min: 1, max: 100, kind: 'float', unit: '%' },
    ceil: { label: 'Highest a price can climb (of the normal value)', def: 400, min: 100, max: 10000, kind: 'float', unit: '%' },
    buyMarkup: { label: 'Extra a citizen pays when buying from the realm', def: 10, min: 0, max: 200, kind: 'float', unit: '%' },
    eventChance: { label: 'Chance of an event in one update', def: 12, min: 0, max: 100, kind: 'float', unit: '%' },
    eventStrength: { label: 'How strong events are (100 = normal)', def: 100, min: 0, max: 1000, kind: 'float', unit: '%' },
    catchUp: { label: 'Most updates worked out at once for a realm nobody looked at', def: 96, min: 1, max: 1000, unit: 'updates' },
  },
});
settings.register('herald', {
  title: 'The Realm Herald',
  icon: '📰',
  about: 'The news of the market, posted in the group (an admin switches it on with "herald on")',
  settings: {
    minMove: { label: 'A price that moved this much is in the news and its owners are tagged', def: 1.5, min: 0, max: 100, kind: 'float', unit: '%' },
    maxTags: { label: 'Most people tagged under one price', def: 6, min: 0, max: 30, unit: 'people' },
    minHold: { label: 'Units of a good that make a citizen an owner of it (for the tags)', def: 5, min: 1, max: 100000, unit: 'units' },
    quiet: { label: 'Skip the news when nothing moved and nothing happened', def: false, kind: 'bool' },
  },
});
const get = (k, g) => settings.get(`market.${k}`, g);
const hget = (k, g) => settings.get(`herald.${k}`, g);

// ---- the events of the market. shock = the price jumps now (%), drift = a push for the next updates (% per update)
const EVENTS = [
  { id: 'drought', text: 'A drought dries the fields', ids: ['grain'], shock: 22, drift: 1.2, ticks: 6 },
  { id: 'harvest', text: 'A bumper harvest fills the barns', ids: ['grain'], shock: -18, drift: -1, ticks: 6 },
  { id: 'collapse', text: 'A mine collapses and the miners are stuck', ids: ['ore'], shock: 22, drift: 1.2, ticks: 6 },
  { id: 'seam', text: 'Miners find a rich new seam', ids: ['ore'], shock: -18, drift: -1, ticks: 6 },
  { id: 'war', text: 'The army buys every blade it can find', ids: ['iron'], shock: 28, drift: 1.5, ticks: 6 },
  { id: 'peace', text: 'Peace is signed and the forges slow down', ids: ['iron'], shock: -15, drift: -1, ticks: 6 },
  { id: 'festival', text: 'A great festival: the taverns run dry', ids: ['wine'], shock: 28, drift: 1.5, ticks: 5 },
  { id: 'bumper', text: 'The vineyards have too much wine', ids: ['wine'], shock: -18, drift: -1, ticks: 6 },
  { id: 'fashion', text: 'The nobles demand fine clothes', ids: ['cloth'], shock: 28, drift: 1.2, ticks: 6 },
  { id: 'caravan', text: 'A caravan arrives with cheap cloth', ids: ['cloth'], shock: -20, drift: -1, ticks: 5 },
  { id: 'famine', text: 'Famine: every good is in short supply', ids: ['grain', 'ore', 'iron', 'wine', 'cloth'], shock: 9, drift: 0.8, ticks: 6 },
  { id: 'boom', text: 'The realm is rich and everybody buys', ids: ['grain', 'ore', 'iron', 'wine', 'cloth'], shock: 6, drift: 0.5, ticks: 6 },
  { id: 'slump', text: 'A slump: the traders stay at home', ids: ['grain', 'ore', 'iron', 'wine', 'cloth'], shock: -8, drift: -0.5, ticks: 6 },
];
const eventById = (id) => EVENTS.find((e) => e.id === id) || null;

const GOODS = () => stuff.list('good').map((g) => g.id);
const baseOf = (group, id) => settings.get(`goods.value_${id}`, group);
const on = (group) => settings.featureOn('market', group);

// the market of a realm (made when somebody first needs it)
function market(group, now = Date.now()) {
  const realm = S.realmOf(group);
  if (!realm.market) {
    const p = {};
    const h = {};
    for (const id of GOODS()) {
      p[id] = baseOf(group, id);
      h[id] = [p[id]];
    }
    realm.market = { p, h, at: now, fx: [], news: [], snap: { ...p }, posted: 0 };
    S.touch();
  }
  const m = realm.market;
  for (const id of GOODS()) if (m.p[id] === undefined) m.p[id] = baseOf(group, id), (m.h[id] = [m.p[id]]); // a good added later
  return m;
}

const round2 = (n) => Math.round(n * 100) / 100;
// a change outside the normal update (an event, a trade, God): the newest value of the history is replaced, or a value is added when
// the history has only the start value (so the change of the last day shows it)
function mark(m, id) {
  const h = m.h[id];
  if (h.length <= 1) h.push(m.p[id]);
  else h[h.length - 1] = m.p[id];
}
const clampPrice = (group, id, v) => {
  const base = baseOf(group, id);
  const lo = (base * get('floor', group)) / 100;
  const hi = (base * get('ceil', group)) / 100;
  return round2(Math.min(hi, Math.max(lo, v)));
};
const gauss = (rand) => (rand() + rand() + rand() + rand() - 2) * 1.7;

// ---- one price update
function step(group, m, rand = Math.random) {
  const happened = [];
  for (const id of GOODS()) {
    const base = baseOf(group, id);
    const pull = (get('reversion', group) / 100) * ((base - m.p[id]) / base) * 100; // % per update
    const push = (m.fx || []).filter((f) => f.id === id).reduce((t, f) => t + f.v, 0);
    const noise = gauss(rand) * get('volatility', group);
    m.p[id] = clampPrice(group, id, m.p[id] * (1 + (pull + push + noise) / 100));
    m.h[id].push(m.p[id]);
    if (m.h[id].length > 48) m.h[id].shift();
  }
  m.fx = (m.fx || []).map((f) => ({ ...f, left: f.left - 1 })).filter((f) => f.left > 0);
  if (rand() * 100 < get('eventChance', group)) {
    const e = fire(group, m, null, rand);
    if (e) happened.push(e);
  }
  return happened;
}

// an event happens now (God can choose which one). Returns { event, rows: [{ id, pct }] }
function fire(group, m, eventId = null, rand = Math.random) {
  const e = eventId ? eventById(eventId) : EVENTS[Math.floor(rand() * EVENTS.length)];
  if (!e) return null;
  const strength = get('eventStrength', group) / 100;
  const rows = [];
  for (const id of e.ids) {
    if (m.p[id] === undefined) continue;
    const before = m.p[id];
    m.p[id] = clampPrice(group, id, before * (1 + (e.shock * strength) / 100));
    mark(m, id);
    m.fx.push({ id, v: e.drift * strength, left: e.ticks });
    rows.push({ id, pct: (m.p[id] / before - 1) * 100 });
  }
  m.news.push({ id: e.id, text: e.text, rows, at: Date.now() });
  if (m.news.length > 10) m.news.shift();
  S.touch();
  return { event: e, rows };
}

// works out the updates that are due. Returns the events that happened
function advance(group, now = Date.now(), rand = Math.random) {
  const m = market(group, now);
  const tick = get('tickMinutes', group) * MIN;
  let steps = Math.floor((now - m.at) / tick);
  if (steps < 1) return { steps: 0, events: [] };
  const skipped = steps > get('catchUp', group);
  steps = Math.min(steps, get('catchUp', group));
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...step(group, m, rand));
  // the clock of the market moves on by whole updates; a realm nobody looked at for days skips the time it did not play
  m.at = skipped ? now - ((now - m.at) % tick) : m.at + steps * tick;
  S.touch();
  return { steps, events };
}

// ---- reading prices
function price(group, id, now = Date.now()) {
  if (!on(group) || !stuff.get(id) || stuff.get(id).kind !== 'good') return baseOf(group, id);
  advance(group, now);
  return market(group, now).p[id];
}
const multOf = (group, id) => {
  const it = stuff.get(id);
  if (!it || it.kind !== 'good' || !on(group)) return 1;
  const base = baseOf(group, id);
  return base > 0 ? price(group, id) / base : 1;
};
const change24 = (group, id) => {
  const h = market(group).h[id] || [];
  return h.length > 1 ? (h[h.length - 1] / h[0] - 1) * 100 : 0;
};
const sinceNews = (group, id) => {
  const m = market(group);
  return m.snap && m.snap[id] ? (m.p[id] / m.snap[id] - 1) * 100 : 0;
};
const history = (group, id) => [...((market(group).h || {})[id] || [])];

// ---- trading: every sale or purchase moves the price a little at once
function shift(group, id, n, dir) {
  const m = market(group);
  const pct = (n / get('liquidity', group)) * get('impact', group);
  m.p[id] = clampPrice(group, id, m.p[id] * (1 + (dir * pct) / 100));
  mark(m, id);
  S.touch();
}
stuff.addValueMod((group, id) => multOf(group, id));
stuff.onSell((group, id, n) => {
  const it = stuff.get(id);
  if (it && it.kind === 'good' && on(group)) shift(group, id, n, -1);
});

const buyPrice = (group, id) => Math.max(1, Math.round(stuff.valueOf(group, id) * (1 + get('buyMarkup', group) / 100)));

// a citizen buys from the realm at the market price plus the markup
function buy(group, jid, id, n) {
  const it = stuff.get(id);
  if (!it || it.kind !== 'good') return { ok: false, why: 'unknown' };
  n = Math.round(n);
  if (!(n > 0)) return { ok: false, why: 'amount' };
  advance(group);
  const each = buyPrice(group, id);
  const cost = each * n;
  const room = stuff.bagSize(group, jid) - stuff.used(group, jid);
  if (room < n) return { ok: false, why: 'bag', room: Math.max(0, room), item: it };
  const c = S.citizen(group, jid);
  if (c.coins < cost) return { ok: false, why: 'poor', cost, need: cost - c.coins, item: it };
  const fair = Math.round(stuff.valueOf(group, id) * n); // what it is worth at today's price, before the purchase moves the price
  c.coins -= cost;
  stuff.add(group, jid, id, n);
  shift(group, id, n, +1);
  if (cost > fair) A.treasuryAdd(group, cost - fair); // the markup is the realm's income
  return { ok: true, item: it, n, each, cost };
}

// God sets a price by hand
function setPrice(group, id, value) {
  const it = stuff.get(id);
  if (!it || it.kind !== 'good') return { ok: false };
  const m = market(group);
  const before = m.p[id];
  m.p[id] = clampPrice(group, id, Number(value));
  mark(m, id);
  S.touch();
  return { ok: true, before, price: m.p[id] };
}
// a law or another feature pushes a price (pct now, and per update for some updates)
function shock(group, id, pct, drift = 0, ticks = 0) {
  const m = market(group);
  if (m.p[id] === undefined) return false;
  m.p[id] = clampPrice(group, id, m.p[id] * (1 + pct / 100));
  mark(m, id);
  if (drift && ticks) m.fx.push({ id, v: drift, left: ticks });
  S.touch();
  return true;
}
function resetMarket(group) {
  delete S.realmOf(group).market;
  S.touch();
}

// ---- who is affected by a price: owners of the good in the bag, and owners of the estate that makes it
function owners(group, id) {
  const min = hget('minHold', group);
  const out = [];
  const makes = require('./estates').ESTATES.filter((e) => e.good === id).map((e) => e.id);
  for (const { key, c } of S.citizensOf(group)) {
    const holds = ((c.inv || {})[id] || 0) >= min;
    const farms = makes.some((e) => (c.estates || {})[e]);
    if (holds || farms) out.push(S.jidOf(key, c));
  }
  return out;
}

// ---- the Herald
const sign = (n, d = 1) => `${n >= 0 ? '▲ +' : '▼ −'}${Math.abs(n).toFixed(d)}%`;
const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
const heraldOn = (group) => !!S.realmOf(group).herald;
const setHerald = (group, v) => {
  S.realmOf(group).herald = !!v;
  S.touch();
};

// the edition: { text, mentions, quiet }. mark = true moves the "since the last news" mark forward
function edition(group, mark = false, prefix = '.') {
  advance(group);
  const m = market(group);
  const minMove = hget('minMove', group);
  const maxTags = hget('maxTags', group);
  const mentions = new Set();
  const lines = ['📰 *Realm Herald*', ''];
  const news = m.news.filter((n) => n.at > (m.posted || 0));
  for (const n of news) {
    lines.push(`⚡ *Breaking:* ${n.text}`);
    for (const r of n.rows) {
      const who = owners(group, r.id).slice(0, maxTags);
      who.forEach((j) => mentions.add(j));
      lines.push(`   ${stuff.get(r.id).icon} ${stuff.get(r.id).name} ${sign(r.pct, 0)}${who.length ? ` 👥 ${who.map(tagOf).join(' ')}` : ''}`);
    }
    lines.push('');
  }
  let moved = 0;
  lines.push('*Prices*');
  for (const id of GOODS()) {
    const it = stuff.get(id);
    const ch = sinceNews(group, id);
    const big = Math.abs(ch) >= minMove;
    let line = `${it.icon} *${it.name}* ${ui2(m.p[id])}${big ? ` ${sign(ch)}` : ' ▬'}`;
    if (big) {
      moved += 1;
      const who = owners(group, id).slice(0, maxTags);
      who.forEach((j) => mentions.add(j));
      if (who.length) line += ` 👥 ${who.map(tagOf).join(' ')}`;
    }
    lines.push(line);
  }
  // what to do: the cheapest and the dearest compared with the normal value
  const rel = GOODS().map((id) => ({ id, pct: (m.p[id] / baseOf(group, id) - 1) * 100 })).sort((a, b) => a.pct - b.pct);
  const cheap = rel[0];
  const dear = rel[rel.length - 1];
  lines.push('');
  if (cheap.pct <= -8) lines.push(`🟢 *Cheap:* ${stuff.get(cheap.id).name} (${cheap.pct.toFixed(0)}% under normal) – a good time to buy or to hold`);
  if (dear.pct >= 8) lines.push(`🔴 *Dear:* ${stuff.get(dear.id).name} (+${dear.pct.toFixed(0)}% over normal) – a good time to sell`);
  if (cheap.pct > -8 && dear.pct < 8) lines.push('⚪ _Prices are close to normal._');
  lines.push('', `▸ \`${prefix}market\` • \`${prefix}sell all\` • \`${prefix}market buy grain 10\``);
  const quiet = !news.length && !moved;
  if (mark) {
    m.snap = { ...m.p };
    m.posted = Date.now();
    S.touch();
  }
  return { text: lines.join('\n'), mentions: [...mentions], quiet };
}
const ui2 = (n) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, ''));

// the scheduler: every realm with a Herald gets its news after a price update
async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    const realm = S.js.data.realms[group];
    if (!realm.herald || !S.isOn(group) || !settings.featureOn('herald', group) || !on(group)) continue;
    const m = market(group, now);
    const due = now - (m.posted || m.at) >= get('tickMinutes', group) * MIN;
    const r = advance(group, now);
    if (!(due || r.events.length)) continue;
    if (!r.steps && !r.events.length) continue;
    const ed = edition(group, true);
    if (ed.quiet && hget('quiet', group)) continue;
    try {
      await post(group, { text: ed.text, mentions: ed.mentions });
    } catch (err) {
      console.log(`The Herald could not be sent to ${group}: ${err.message}`);
    }
  }
}
require('./ticker').register('realm-market', job);

module.exports = { EVENTS, eventById, market, advance, step, fire, price, multOf, change24, sinceNews, history, shift, buy, buyPrice, setPrice, shock, resetMarket, owners, edition, heraldOn, setHerald, baseOf, job, GOODS };

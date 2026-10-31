// Civic state shared by the government (phase 4) and society (phase 5): the things that touch money and pay everywhere.
// It sits at the bottom (it only needs the realm state), so aurum, careers, trade, auctions and estates can use it without loops.
//   - effects: timed changes of pay, fees and estate output (laws, festivals). mult(group, 'pay')
//   - income tax: the Treasurer's rate; tax(group, amount) puts the tax in the treasury
//   - jail: who is locked up and for how long
//   - the government's own log (what the rulers did)
const S = require('./state');
const config = require('../../config');

const MIN = 60000;

// the government record of a realm (made when needed)
function gov(group) {
  const r = S.realmOf(group);
  if (!r.gov) {
    r.gov = { sov: null, off: {}, tax: 0, terms: {}, lastSov: null, election: null, referendum: null, impeach: null, jail: {}, jailed: {}, salary: {}, spent: { day: -1, cap: 0, used: 0 }, log: [], decree: null, seq: 0, impeachBlock: 0 };
    S.touch();
  }
  return r.gov;
}

// ---- timed effects: [{ id, kind: 'pay' | 'fee' | 'output', mult, until, src }]
const fxList = (group) => S.realmOf(group).fx || (S.realmOf(group).fx = []);
function addEffect(group, fx) {
  const list = fxList(group);
  const old = list.findIndex((e) => e.id === fx.id);
  if (old >= 0) list.splice(old, 1);
  list.push(fx);
  S.touch();
}
function removeEffect(group, id) {
  const list = fxList(group);
  const at = list.findIndex((e) => e.id === id);
  if (at < 0) return false;
  list.splice(at, 1);
  S.touch();
  return true;
}
const effectsOf = (group, now = Date.now()) => fxList(group).filter((e) => e.until > now);
function mult(group, kind, now = Date.now()) {
  if (!group || !S.js.data.realms[group] || !S.js.data.realms[group].fx) return 1;
  return effectsOf(group, now).filter((e) => e.kind === kind).reduce((m, e) => m * e.mult, 1);
}
function purge(group, now = Date.now()) {
  const list = fxList(group);
  const gone = list.filter((e) => e.until <= now);
  if (gone.length) {
    S.realmOf(group).fx = list.filter((e) => e.until > now);
    S.touch();
  }
  return gone;
}

// extra pay from other features (nobility...): fn(group, jid, now) => a number like 0.02 (+2%)
const payHooks = [];
const onPay = (fn) => payHooks.push(fn);
const payBonus = (group, jid, now) => payHooks.reduce((t, fn) => t + (fn(group, jid, now) || 0), 0);

// ---- income tax (default 0: nothing changes until a Treasurer sets a rate)
const taxRate = (group) => (S.js.data.realms[group] && S.js.data.realms[group].gov ? S.js.data.realms[group].gov.tax || 0 : 0);
function tax(group, amount) {
  const rate = taxRate(group);
  if (!(rate > 0) || !(amount > 0)) return 0;
  const t = Math.min(Math.floor(amount), Math.floor((amount * rate) / 100));
  if (t < 1) return 0;
  S.realmOf(group).treasury = (S.realmOf(group).treasury || 0) + t;
  S.touch();
  return t;
}

// ---- jail
function jailLeft(group, jid, now = Date.now()) {
  const r = S.js.data.realms[group];
  if (!r || !r.gov) return 0;
  return Math.max(0, (r.gov.jail[S.keyOf(jid)] || 0) - now);
}
function jail(group, jid, minutes, now = Date.now()) {
  const g = gov(group);
  g.jail[S.keyOf(jid)] = now + minutes * MIN;
  g.jailed[S.keyOf(jid)] = jid;
  S.touch();
}
function free(group, jid) {
  const g = gov(group);
  const had = !!g.jail[S.keyOf(jid)];
  delete g.jail[S.keyOf(jid)];
  delete g.jailed[S.keyOf(jid)];
  S.touch();
  return had;
}
// everybody locked up now: [{ key, jid, left }]
function prisoners(group, now = Date.now()) {
  const r = S.js.data.realms[group];
  if (!r || !r.gov) return [];
  return Object.entries(r.gov.jail)
    .filter(([, until]) => until > now)
    .map(([key, until]) => ({ key, jid: r.gov.jailed[key] || `${key}@s.whatsapp.net`, left: until - now }));
}
function sweepJail(group, now = Date.now()) {
  const g = gov(group);
  for (const [key, until] of Object.entries(g.jail)) {
    if (until <= now) {
      delete g.jail[key];
      delete g.jailed[key];
    }
  }
}

// ---- God (the bot owner) is never taxed, jailed, tried or voted out
function isGod(jid) {
  const key = S.keyOf(jid);
  const owners = [config.ownerNumber, config.number].filter(Boolean).map((n) => S.keyOf(`${n}@s.whatsapp.net`));
  return owners.includes(key);
}

// ---- what the rulers did (newest last, the last 100 kept)
function log(group, text, now = Date.now()) {
  const g = gov(group);
  g.log.push({ at: now, text: String(text).slice(0, 160) });
  if (g.log.length > 100) g.log.splice(0, g.log.length - 100);
  S.touch();
}
const recentLog = (group, n = 10) => (S.js.data.realms[group] && S.js.data.realms[group].gov ? S.js.data.realms[group].gov.log.slice(-n).reverse() : []);

module.exports = { gov, addEffect, removeEffect, effectsOf, mult, purge, onPay, payBonus, taxRate, tax, jailLeft, jail, free, prisoners, sweepJail, isGod, log, recentLog };

// The Empire, phase 5: titles and nobility. The Sovereign makes citizens Knights, Barons, Counts and Dukes. A noble earns a
// little more, but the number of seats is limited and a title lasts a number of days (the Sovereign can renew it).
// The treasury pays the cost of the title. God sets the seats, the perk, the cost and the length, and can grant or strip a title.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const civic = require('./civic');

const DAY = 86400000;
const TITLES = [
  { id: 'knight', name: 'Knight', icon: '🛡️', seats: 8, perk: 1, cost: 300 },
  { id: 'baron', name: 'Baron', icon: '🏰', seats: 5, perk: 2, cost: 800 },
  { id: 'count', name: 'Count', icon: '🦅', seats: 3, perk: 3, cost: 2000 },
  { id: 'duke', name: 'Duke', icon: '⚜️', seats: 1, perk: 5, cost: 6000 },
];

settings.register('nobility', {
  title: 'Titles and Nobility',
  icon: '⚜️',
  about: 'The Sovereign makes Knights, Barons, Counts and Dukes. A noble earns a little more',
  settings: {
    days: { label: 'How long a title lasts', def: 30, min: 1, max: 3650, unit: 'days' },
  },
});
for (const t of TITLES) {
  settings.extend('nobility', `seats_${t.id}`, { label: `${t.name}: seats in a realm`, def: t.seats, min: 0, max: 1000, unit: 'seats' });
  settings.extend('nobility', `perk_${t.id}`, { label: `${t.name}: extra pay`, def: t.perk, min: 0, max: 100, kind: 'float', unit: '%' });
  settings.extend('nobility', `cost_${t.id}`, { label: `${t.name}: what the treasury pays for the title`, def: t.cost, min: 0, max: 1000000000, unit: 'Aurum' });
}
const get = (k, g) => settings.get(`nobility.${k}`, g);
const byId = (text) => {
  const t = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  return TITLES.find((x) => x.id === t || x.name.toLowerCase() === t) || null;
};
const box = (group) => {
  const r = S.realmOf(group);
  return r.nobles || (r.nobles = {});
};
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);

// the title a person holds now (or null)
function titleOf(group, jid, now = Date.now()) {
  const r = S.js.data.realms[group];
  if (!r || !r.nobles) return null;
  const n = r.nobles[S.keyOf(jid)];
  if (!n || n.until <= now) return null;
  return { ...TITLES.find((t) => t.id === n.title), until: n.until, since: n.since };
}
const holders = (group, id, now = Date.now()) => Object.values(box(group)).filter((n) => n.title === id && n.until > now);
const list = (group, now = Date.now()) =>
  Object.entries(box(group))
    .filter(([, n]) => n.until > now)
    .map(([key, n]) => ({ key, jid: n.jid, title: TITLES.find((t) => t.id === n.title), until: n.until }))
    .sort((a, b) => TITLES.indexOf(b.title) - TITLES.indexOf(a.title));
const perk = (group, id) => get(`perk_${id}`, group);

// by = who grants (the Sovereign), or null when God grants (God pays nothing and the seats do not count)
function grant(group, by, target, id, now = Date.now(), god = false) {
  const t = byId(id);
  if (!t) return { ok: false, why: 'unknown' };
  if (!god) {
    const gov = require('./gov');
    if (gov.officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
    if (keyEq(by, target)) return { ok: false, why: 'self' };
  }
  if (civic.isGod(target)) return { ok: false, why: 'god' };
  if (!S.citizen(group, target, false)) return { ok: false, why: 'stranger' };
  const had = titleOf(group, target, now);
  if (had && had.id === t.id) {
    // renewing: costs the same, does not need a free seat
  } else if (!god && holders(group, t.id, now).length >= get(`seats_${t.id}`, group)) {
    return { ok: false, why: 'full', title: t, seats: get(`seats_${t.id}`, group) };
  }
  const cost = god ? 0 : get(`cost_${t.id}`, group);
  if (cost > A.treasury(group)) return { ok: false, why: 'poor', title: t, cost, have: A.treasury(group) };
  if (cost > 0) A.treasuryAdd(group, -cost);
  box(group)[S.keyOf(target)] = { jid: target, title: t.id, since: had && had.id === t.id ? had.since : now, until: now + get('days', group) * DAY };
  S.touch();
  civic.log(group, `${t.name} title granted.`, now);
  return { ok: true, title: t, cost, renewed: !!(had && had.id === t.id), days: get('days', group) };
}
function strip(group, by, target, god = false) {
  if (!god) {
    const gov = require('./gov');
    if (gov.officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  }
  const had = titleOf(group, target);
  if (!had) return { ok: false, why: 'none' };
  delete box(group)[S.keyOf(target)];
  S.touch();
  civic.log(group, `${had.name} title taken.`, Date.now());
  return { ok: true, title: had };
}
// when a title runs out, it is removed from the list
function sweep(group, now = Date.now()) {
  const b = box(group);
  let n = 0;
  for (const [k, v] of Object.entries(b)) {
    if (v.until <= now) {
      delete b[k];
      n += 1;
    }
  }
  if (n) S.touch();
  return n;
}

civic.onPay((group, jid, now) => {
  if (!settings.featureOn('nobility', group)) return 0;
  const t = titleOf(group, jid, now);
  return t ? perk(group, t.id) / 100 : 0;
});

module.exports = { TITLES, byId, titleOf, holders, list, perk, grant, strip, sweep, get };

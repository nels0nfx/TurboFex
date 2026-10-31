// Aurum, the money of the Empire of Fex. Purse, bank, daily gift, ranks, gifts between citizens, chat income.
// Every function takes the realm (the group) first: every realm has its own citizens, its own money and its own treasury.
const settings = require('./settings');
const S = require('./state');
const civic = require('./civic'); // laws and festivals change pay; the Treasurer's income tax

const DAY = 86400000;

settings.register('core', {
  title: 'The Realm',
  icon: '⚜️',
  about: 'Aurum, the purse and the bank, the daily gift, ranks and gifts between citizens',
  settings: {
    startAurum: { label: 'Aurum a new citizen starts with', def: 0, min: 0, max: 1000000, unit: 'Aurum' },
    dailyBase: { label: 'Daily gift', def: 300, min: 0, max: 100000, unit: 'Aurum' },
    dailyStreakStep: { label: 'Extra daily gift for every day in a row', def: 25, min: 0, max: 10000, unit: 'Aurum' },
    dailyStreakMax: { label: 'Days in a row that still add to the gift', def: 14, min: 1, max: 365, unit: 'days' },
    bankCap: { label: 'How much a citizen can keep in the bank', def: 10000, min: 100, max: 100000000, unit: 'Aurum' },
    bankInterest: { label: 'Bank interest a day', def: 0.3, min: 0, max: 10, kind: 'float', unit: '%' },
    giveFee: { label: 'Fee on gifts between citizens (goes to the treasury)', def: 2, min: 0, max: 50, kind: 'float', unit: '%' },
    giveMin: { label: 'Smallest gift', def: 10, min: 1, max: 100000, unit: 'Aurum' },
    chatOn: { label: 'Chatting earns a little Aurum', def: true, kind: 'bool' },
    chatAurum: { label: 'Aurum for a chat message', def: 2, min: 0, max: 1000, unit: 'Aurum' },
    chatCooldown: { label: 'Seconds between two paid messages', def: 60, min: 5, max: 3600, unit: 'seconds' },
    chatDailyCap: { label: 'Most a citizen earns from chatting in a day', def: 300, min: 0, max: 100000, unit: 'Aurum' },
    rankCitizen: { label: 'Net worth to become a Citizen', def: 1000, min: 1, max: 1000000000, unit: 'Aurum' },
    rankMerchant: { label: 'Net worth to become a Merchant', def: 10000, min: 1, max: 1000000000, unit: 'Aurum' },
    rankNoble: { label: 'Net worth to become a Noble', def: 100000, min: 1, max: 1000000000, unit: 'Aurum' },
    rankLord: { label: 'Net worth to become a Lord', def: 1000000, min: 1, max: 1000000000, unit: 'Aurum' },
    charmPct: { label: 'Extra pay while a Fortune Charm works', def: 10, min: 0, max: 200, kind: 'float', unit: '%' },
    rankBonus: { label: 'Extra pay for every rank step', def: 5, min: 0, max: 100, kind: 'float', unit: '%' },
    rateMax: { label: 'Empire commands one person can send in the time below', def: 8, min: 1, max: 100, unit: 'commands' },
    rateWindow: { label: 'That time', def: 20, min: 5, max: 600, unit: 'seconds' },
    rateBlock: { label: 'How long a spammer must wait', def: 20, min: 5, max: 3600, unit: 'seconds' },
  },
});
const get = (k, g) => settings.get(`core.${k}`, g);

// ---- ranks: from the net worth (purse + bank + what later features add: estates, goods...)
const RANKS = [
  { id: 'commoner', name: 'Commoner', icon: '🧑', key: null },
  { id: 'citizen', name: 'Citizen', icon: '🏘️', key: 'rankCitizen' },
  { id: 'merchant', name: 'Merchant', icon: '🛒', key: 'rankMerchant' },
  { id: 'noble', name: 'Noble', icon: '🎩', key: 'rankNoble' },
  { id: 'lord', name: 'Lord', icon: '🏰', key: 'rankLord' },
];
const worthProviders = [];
const registerWorth = (fn) => worthProviders.push(fn);

function netWorth(group, jid) {
  const c = S.citizen(group, jid);
  return Math.round(c.coins + c.bank + worthProviders.reduce((t, fn) => t + (fn(group, S.keyOf(jid)) || 0), 0));
}
function rank(group, jid) {
  const c = S.citizen(group, jid);
  const worth = netWorth(group, jid);
  let i = 0;
  RANKS.forEach((r, n) => {
    if (r.key && worth >= get(r.key, group)) i = n;
  });
  if (Number.isInteger(c.rankLock) && c.rankLock >= 0 && c.rankLock < RANKS.length) i = c.rankLock; // God can set a rank by hand
  const next = RANKS[i + 1] || null;
  return { ...RANKS[i], index: i, worth, next, needed: next ? Math.max(0, get(next.key, group) - worth) : 0 };
}

// ---- items that change what a citizen earns (the shop and later features add them)
const charmLeft = (group, jid, now = Date.now()) => Math.max(0, ((S.citizen(group, jid).items || {}).charm || 0) - now);
const charmPct = (group) => get('charmPct', group);
// the pay of a citizen: rank step bonus + the charm + God's blessing or curse
function earnMult(group, jid, now = Date.now()) {
  const r = rank(group, jid);
  let m = 1 + (r.index * get('rankBonus', group)) / 100;
  if (charmLeft(group, jid, now) > 0) m += charmPct(group) / 100;
  const c = S.citizen(group, jid);
  if (c.fate && c.fate.until > now) m *= c.fate.mult;
  m *= civic.mult(group, 'pay', now) * (1 + civic.payBonus(group, jid, now)); // a law or festival that is on, and the perk of a noble title
  return m;
}

// ---- the purse
const balance = (group, jid) => S.citizen(group, jid).coins;
const bankOf = (group, jid) => {
  const c = S.citizen(group, jid);
  accrue(group, c);
  return c.bank;
};
const bankCap = (group, jid) => get('bankCap', group) + (S.citizen(group, jid).bankBonus || 0);

function add(group, jid, n) {
  if (!(n > 0)) return false;
  S.citizen(group, jid).coins += Math.round(n);
  S.touch();
  return true;
}
function take(group, jid, n) {
  const c = S.citizen(group, jid);
  n = Math.round(n);
  if (!(n > 0) || c.coins < n) return false;
  c.coins -= n;
  S.touch();
  return true;
}

// interest is added when somebody looks at the account (at most 7 days at a time)
function accrue(group, c, now = Date.now()) {
  if (!c.bank || c.bank < 1) {
    c.bt = now;
    return 0;
  }
  const days = Math.min(7, (now - (c.bt || now)) / DAY);
  const gain = Math.floor(Math.min(c.bank, get('bankCap', group) + (c.bankBonus || 0)) * (get('bankInterest', group) / 100) * days);
  if (gain < 1) {
    if (!c.bt) c.bt = now;
    return 0;
  }
  c.bank += gain;
  c.bt = now;
  S.touch();
  return gain;
}

function deposit(group, jid, n) {
  const c = S.citizen(group, jid);
  accrue(group, c);
  n = Math.round(n);
  if (!(n > 0)) return { ok: false, why: 'amount' };
  if (c.coins < n) return { ok: false, why: 'poor', have: c.coins };
  const room = bankCap(group, jid) - c.bank;
  if (room <= 0) return { ok: false, why: 'full', cap: bankCap(group, jid) };
  const put = Math.min(n, room);
  c.coins -= put;
  c.bank += put;
  S.touch();
  return { ok: true, put, capped: put < n, cap: bankCap(group, jid) };
}
function withdraw(group, jid, n) {
  const c = S.citizen(group, jid);
  accrue(group, c);
  n = Math.round(n);
  if (!(n > 0)) return { ok: false, why: 'amount' };
  if (c.bank < n) return { ok: false, why: 'poor', have: c.bank };
  c.bank -= n;
  c.coins += n;
  S.touch();
  return { ok: true, took: n };
}

// a gift: the fee goes to the realm's treasury. Returns { ok, sent, fee, got }
function give(group, from, to, n) {
  if (S.keyOf(from) === S.keyOf(to)) return { ok: false, why: 'self' };
  n = Math.round(n);
  const min = get('giveMin', group);
  if (!(n >= min)) return { ok: false, why: 'min', min };
  const a = S.citizen(group, from);
  if (a.coins < n) return { ok: false, why: 'poor', have: a.coins };
  const fee = Math.floor((n * get('giveFee', group) * civic.mult(group, 'fee')) / 100);
  a.coins -= n;
  S.citizen(group, to).coins += n - fee;
  treasuryAdd(group, fee);
  S.touch();
  return { ok: true, sent: n, fee, got: n - fee };
}

// the treasury of a realm (the government of a later phase spends it)
const treasury = (group) => S.realmOf(group).treasury || 0;
function treasuryAdd(group, n) {
  if (!n) return;
  S.realmOf(group).treasury = Math.max(0, (S.realmOf(group).treasury || 0) + Math.round(n));
  S.touch();
}

// ---- the daily gift
function daily(group, jid, now = Date.now()) {
  const c = S.citizen(group, jid);
  accrue(group, c, now);
  const since = now - c.lastDaily;
  if (c.lastDaily && since < DAY) return { ok: false, waitMs: DAY - since };
  c.streak = c.lastDaily && since < 2 * DAY ? c.streak + 1 : 1;
  const days = Math.min(c.streak, get('dailyStreakMax', group)) - 1;
  const base = get('dailyBase', group) + days * get('dailyStreakStep', group);
  const mult = earnMult(group, jid, now);
  const gross = Math.round(base * mult);
  const tax = civic.tax(group, gross); // the Treasurer's income tax (0 unless a rate is set)
  const amount = gross - tax;
  c.lastDaily = now;
  c.coins += amount;
  S.touch();
  try {
    require('./season').points(group, jid, 10, now); // the season counts the daily gift
  } catch (err) {
    // the season is not loaded
  }
  return { ok: true, amount, gross, tax, base, bonus: mult - 1, streak: c.streak, coins: c.coins };
}

// a waiting time that is used up when asked (name = what it is for)
function cooldown(group, jid, name, ms, now = Date.now()) {
  const c = S.citizen(group, jid);
  const last = c.cd[name] || 0;
  if (now - last < ms) return { ok: false, waitMs: ms - (now - last) };
  c.cd[name] = now;
  S.touch();
  return { ok: true };
}
const cooldownLeft = (group, jid, name, ms, now = Date.now()) => Math.max(0, ms - (now - ((S.citizen(group, jid).cd || {})[name] || 0)));

// ---- chatting: a small pay for talking (with a waiting time and a daily limit)
function chat(group, jid, now = Date.now()) {
  if (!S.isOn(group) || !get('chatOn', group)) return 0;
  const c = S.citizen(group, jid);
  if (now - (c.chatAt || 0) < get('chatCooldown', group) * 1000) return 0;
  const day = Math.floor(now / DAY);
  if (c.chatDay !== day) {
    c.chatDay = day;
    c.chatEarned = 0;
  }
  const room = get('chatDailyCap', group) - c.chatEarned;
  const n = Math.min(Math.round(get('chatAurum', group) * earnMult(group, jid, now)), room);
  c.chatAt = now;
  if (n < 1) return 0;
  c.chatEarned += n;
  c.coins += n;
  S.touch();
  return n;
}

// ---- boards
function richest(group, limit = 10) {
  return S.citizensOf(group)
    .map(({ key, c }) => ({ key, jid: S.jidOf(key, c), worth: netWorth(group, S.jidOf(key, c)), coins: c.coins, bank: c.bank, title: c.title }))
    .filter((r) => r.worth > 0)
    .sort((a, b) => b.worth - a.worth)
    .slice(0, limit);
}

module.exports = { RANKS, DAY, registerWorth, netWorth, rank, earnMult, charmLeft, balance, bankOf, bankCap, add, take, accrue, deposit, withdraw, give, treasury, treasuryAdd, daily, cooldown, cooldownLeft, chat, richest };

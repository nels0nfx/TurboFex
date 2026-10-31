// The Empire, phase 5: guilds. Citizens found a guild, others join, the members pay into the guild bank and the bank buys levels.
// A higher level means more room and a bigger pay bonus for every member. God sets the costs and limits, and can disband a guild,
// remove a member or give a guild some Aurum.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const civic = require('./civic');

settings.register('guild', {
  title: 'Guilds',
  icon: '🛡️',
  about: 'Citizens found guilds, fill the guild bank and level it up for a pay bonus',
  settings: {
    createCost: { label: 'Cost to found a guild (goes to the treasury)', def: 500, min: 0, max: 1000000000, unit: 'Aurum' },
    maxGuilds: { label: 'Most guilds in a realm', def: 20, min: 1, max: 1000, unit: 'guilds' },
    membersBase: { label: 'Members a level 1 guild can have', def: 5, min: 1, max: 1000, unit: 'members' },
    membersPerLevel: { label: 'Extra members for every level', def: 3, min: 0, max: 1000, unit: 'members' },
    maxLevel: { label: 'The highest guild level', def: 10, min: 1, max: 100, unit: 'levels' },
    upgradeBase: { label: 'Bank Aurum to reach level 2 (every next level costs this × the level)', def: 2000, min: 1, max: 1000000000, unit: 'Aurum' },
    bonusPerLevel: { label: 'Extra pay for every member, for each guild level', def: 1, min: 0, max: 50, kind: 'float', unit: '%' },
    depositTax: { label: 'Share of a deposit that goes to the treasury', def: 0, min: 0, max: 50, kind: 'float', unit: '%' },
    nameMax: { label: 'Longest guild name', def: 20, min: 3, max: 40, unit: 'letters' },
  },
});
const get = (k, g) => settings.get(`guild.${k}`, g);
const box = (group) => {
  const r = S.realmOf(group);
  return r.guilds || (r.guilds = { seq: 0, list: {} });
};
const all = (group) => Object.values(box(group).list);
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);
const cap = (group, g) => get('membersBase', group) + (g.level - 1) * get('membersPerLevel', group);
const upgradeCost = (group, g) => get('upgradeBase', group) * g.level;
const bonusOf = (group, g) => g.level * get('bonusPerLevel', group);
const sizeOf = (g) => Object.keys(g.members).length;
const guildOf = (group, jid) => {
  const k = S.keyOf(jid);
  return all(group).find((g) => g.members[k]) || null;
};
const find = (group, text) => {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/^#?\d+$/.test(t)) return box(group).list[t.replace('#', '')] || null;
  return all(group).find((g) => g.name.toLowerCase() === t) || all(group).find((g) => g.name.toLowerCase().startsWith(t)) || null;
};
const isLeader = (g, jid) => keyEq(g.leader, jid);
const clean = (name, group) => String(name || '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, get('nameMax', group));

function create(group, jid, name) {
  const b = box(group);
  const n = clean(name, group);
  if (n.length < 3) return { ok: false, why: 'name' };
  if (guildOf(group, jid)) return { ok: false, why: 'member' };
  if (all(group).some((g) => g.name.toLowerCase() === n.toLowerCase())) return { ok: false, why: 'taken' };
  if (all(group).length >= get('maxGuilds', group)) return { ok: false, why: 'full', max: get('maxGuilds', group) };
  const cost = get('createCost', group);
  if (cost > 0 && !A.take(group, jid, cost)) return { ok: false, why: 'poor', cost };
  if (cost > 0) A.treasuryAdd(group, cost);
  b.seq += 1;
  const g = { id: b.seq, name: n, leader: jid, level: 1, bank: 0, since: Date.now(), members: { [S.keyOf(jid)]: { jid, at: Date.now() } } };
  b.list[g.id] = g;
  S.touch();
  return { ok: true, guild: g, cost };
}
// joining is by the guild's own invitation list: a leader invites, the person accepts with join
function invite(group, leaderJid, target) {
  const g = guildOf(group, leaderJid);
  if (!g || !isLeader(g, leaderJid)) return { ok: false, why: 'rights' };
  if (!S.citizen(group, target, false)) return { ok: false, why: 'stranger' };
  if (guildOf(group, target)) return { ok: false, why: 'member' };
  if (sizeOf(g) >= cap(group, g)) return { ok: false, why: 'full', cap: cap(group, g) };
  g.invites = g.invites || {};
  g.invites[S.keyOf(target)] = Date.now() + 86400000;
  S.touch();
  return { ok: true, guild: g };
}
function join(group, jid, text) {
  if (guildOf(group, jid)) return { ok: false, why: 'member' };
  const g = find(group, text);
  if (!g) return { ok: false, why: 'unknown' };
  const k = S.keyOf(jid);
  if (!(g.invites && g.invites[k] > Date.now())) return { ok: false, why: 'invite', guild: g };
  if (sizeOf(g) >= cap(group, g)) return { ok: false, why: 'full', cap: cap(group, g) };
  delete g.invites[k];
  g.members[k] = { jid, at: Date.now() };
  S.touch();
  return { ok: true, guild: g };
}
function disband(group, g) {
  // the bank is shared out between the members
  const members = Object.values(g.members);
  const each = members.length ? Math.floor(g.bank / members.length) : 0;
  if (each > 0) for (const m of members) A.add(group, m.jid, each);
  delete box(group).list[g.id];
  S.touch();
  return { members, each };
}
function leave(group, jid) {
  const g = guildOf(group, jid);
  if (!g) return { ok: false, why: 'none' };
  const k = S.keyOf(jid);
  if (isLeader(g, jid)) {
    const heir = Object.values(g.members).find((m) => !keyEq(m.jid, jid));
    if (!heir) return { ok: true, guild: g, disbanded: true, ...disband(group, g) };
    g.leader = heir.jid;
    delete g.members[k];
    S.touch();
    return { ok: true, guild: g, newLeader: heir.jid };
  }
  delete g.members[k];
  S.touch();
  return { ok: true, guild: g };
}
function kick(group, leaderJid, target) {
  const g = guildOf(group, leaderJid);
  if (!g || !isLeader(g, leaderJid)) return { ok: false, why: 'rights' };
  if (keyEq(leaderJid, target)) return { ok: false, why: 'self' };
  if (!g.members[S.keyOf(target)]) return { ok: false, why: 'none' };
  delete g.members[S.keyOf(target)];
  S.touch();
  return { ok: true, guild: g };
}
function deposit(group, jid, amount) {
  const g = guildOf(group, jid);
  if (!g) return { ok: false, why: 'none' };
  amount = Math.floor(amount);
  if (!(amount >= 1)) return { ok: false, why: 'amount' };
  if (!A.take(group, jid, amount)) return { ok: false, why: 'poor' };
  const t = Math.floor((amount * get('depositTax', group)) / 100);
  if (t > 0) A.treasuryAdd(group, t);
  g.bank += amount - t;
  S.touch();
  try {
    require('./season').points(group, jid, Math.min(20, Math.floor(amount / 100)), Date.now());
  } catch (err) {
    // the season is not loaded
  }
  return { ok: true, guild: g, put: amount - t, tax: t };
}
function upgrade(group, jid) {
  const g = guildOf(group, jid);
  if (!g) return { ok: false, why: 'none' };
  if (!isLeader(g, jid)) return { ok: false, why: 'rights' };
  if (g.level >= get('maxLevel', group)) return { ok: false, why: 'max' };
  const cost = upgradeCost(group, g);
  if (g.bank < cost) return { ok: false, why: 'poor', cost, have: g.bank };
  g.bank -= cost;
  g.level += 1;
  S.touch();
  return { ok: true, guild: g, cost };
}
const top = (group, n = 10) => all(group).sort((a, b) => b.level - a.level || b.bank - a.bank || sizeOf(b) - sizeOf(a)).slice(0, n);

// God
function godDisband(group, g) {
  delete box(group).list[g.id];
  S.touch();
  return { ok: true };
}
function godLevel(group, g, level) {
  level = Math.round(level);
  if (!(level >= 1 && level <= 100)) return { ok: false };
  g.level = level;
  S.touch();
  return { ok: true, level };
}
function godBank(group, g, amount) {
  amount = Math.round(amount);
  if (!(amount >= 0 && amount <= 1e12)) return { ok: false };
  g.bank = amount;
  S.touch();
  return { ok: true, bank: amount };
}
function godRemoveMember(group, g, jid) {
  const k = S.keyOf(jid);
  if (!g.members[k]) return { ok: false };
  delete g.members[k];
  if (keyEq(g.leader, jid)) {
    const heir = Object.values(g.members)[0];
    if (!heir) return { ...godDisband(group, g), disbanded: true };
    g.leader = heir.jid;
  }
  S.touch();
  return { ok: true };
}

civic.onPay((group, jid) => {
  if (!settings.featureOn('guild', group)) return 0;
  const g = guildOf(group, jid);
  return g ? bonusOf(group, g) / 100 : 0;
});

module.exports = { all, guildOf, find, isLeader, cap, upgradeCost, bonusOf, sizeOf, create, invite, join, leave, kick, deposit, upgrade, disband, top, godDisband, godLevel, godBank, godRemoveMember, get, box };

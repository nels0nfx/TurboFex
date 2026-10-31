// God's hands in government and society (phases 4 and 5). God does not rule: God sets the limits (god settings) and can fix or
// change anything here. Every act is written in the Divine Ledger. The text around it is handle(), used by commands/god.js.
const ledger = require('./ledger');
const S = require('./state');
const A = require('./aurum');
const ui = require('./ui');
const civic = require('./civic');
const gov = require('./gov');
const court = require('./court');
const season = require('./season');
const festival = require('./festival');
const nobility = require('./nobility');
const guild = require('./guild');
const dungeon = require('./dungeon');

const log = (action, group, target, detail) => ledger.log({ action, realm: group, target, detail });
const key = (jid) => S.keyOf(jid);

// ---- government
function crown(group, jid) {
  if (!S.citizen(group, jid, false)) return { ok: false, why: 'stranger' };
  if (civic.isGod(jid)) return { ok: false, why: 'god' };
  gov.crown(group, jid, Date.now());
  const g = civic.gov(group);
  g.election = null;
  S.touch();
  log('crown', group, key(jid), 'made Sovereign');
  return { ok: true };
}
function dethrone(group) {
  const was = gov.dethrone(group);
  if (!was) return { ok: false };
  log('dethrone', group, key(was.jid), 'the throne is vacant');
  return { ok: true, was };
}
// office: 'treasurer' | 'marshal' | 'steward'; jid null = empty the office
function officer(group, office, jid) {
  const o = gov.OFFICES.find((x) => x.id === office);
  if (!o) return { ok: false, why: 'office' };
  const g = civic.gov(group);
  if (!jid) {
    delete g.off[o.id];
    S.touch();
    log('officer', group, o.id, 'emptied');
    return { ok: true, office: o, empty: true };
  }
  if (!S.citizen(group, jid, false)) return { ok: false, why: 'stranger' };
  if (civic.isGod(jid)) return { ok: false, why: 'god' };
  const has = gov.officeOf(group, jid);
  if (has && has !== o.id) return { ok: false, why: 'busy', has };
  g.off[o.id] = { key: key(jid), jid, since: Date.now() };
  S.touch();
  log('officer', group, key(jid), `made ${o.name}`);
  return { ok: true, office: o };
}
// 'start' (an election opens now, even with a Sovereign), 'end' (it is counted now), 'cancel'
function election(group, how, now = Date.now()) {
  const g = civic.gov(group);
  if (how === 'start') {
    const r = gov.startElection(group, null, now, true);
    if (r.ok) log('election', group, null, 'started');
    return r;
  }
  if (!g.election) return { ok: false, why: 'none' };
  if (how === 'cancel') {
    g.election = null;
    S.touch();
    log('election', group, null, 'cancelled');
    return { ok: true, cancelled: true };
  }
  g.election.endsAt = now - 1;
  const r = gov.resolveElection(group, now);
  log('election', group, null, 'closed now');
  return { ok: true, result: r };
}
// a law now at no cost to the treasury, or repealed
function law(group, id, on) {
  const base = gov.lawById(id);
  if (!base) return { ok: false, why: 'unknown' };
  if (!on) {
    const ok = gov.repealLaw(group, base.id);
    log('law', group, base.id, ok ? 'repealed' : 'was not in force');
    return { ok, law: base, repealed: true };
  }
  const view = gov.lawView(group, base);
  A.treasuryAdd(group, view.cost); // God's law is free: the treasury is refunded what the law takes
  const r = gov.enactLaw(group, null, base.id, Date.now(), true);
  if (!r.ok) A.treasuryAdd(group, -view.cost);
  else log('law', group, base.id, 'enacted by God');
  return r;
}
function jail(group, jid, minutes) {
  if (civic.isGod(jid)) return { ok: false, why: 'god' };
  if (!S.citizen(group, jid, false)) return { ok: false, why: 'stranger' };
  if (!(minutes >= 1 && minutes <= 525600)) return { ok: false, why: 'minutes' };
  civic.jail(group, jid, minutes);
  log('jail', group, key(jid), `${minutes} minutes`);
  return { ok: true };
}
function pardon(group, jid) {
  if (jid === 'all') {
    const all = civic.prisoners(group);
    for (const p of all) civic.free(group, p.jid);
    log('pardon', group, 'all', `${all.length} freed`);
    return { ok: true, count: all.length };
  }
  const ok = civic.free(group, jid);
  if (ok) log('pardon', group, key(jid), 'freed');
  return { ok, count: ok ? 1 : 0 };
}
function treasury(group, how, n) {
  n = Math.round(n);
  if (!(n >= 0 && n <= 1e12)) return { ok: false };
  const before = A.treasury(group);
  if (how === 'set') A.treasuryAdd(group, n - before);
  else if (how === 'add') A.treasuryAdd(group, n);
  else if (how === 'take') A.treasuryAdd(group, -Math.min(n, before));
  else return { ok: false };
  log('treasury', group, how, `${before} → ${A.treasury(group)}`);
  return { ok: true, before, now: A.treasury(group) };
}
function tax(group, pct) {
  if (!(pct >= 0 && pct <= 100)) return { ok: false };
  const g = civic.gov(group);
  const before = g.tax;
  g.tax = Math.round(pct * 100) / 100;
  S.touch();
  log('tax', group, null, `${before}% → ${g.tax}%`);
  return { ok: true, before, now: g.tax };
}
function courtEnd(group, id) {
  const r = court.endNow(group, id);
  if (r.ok) log('court', group, `#${id}`, `closed: ${r.result.verdict}`);
  return r;
}
function courtOverturn(group, id) {
  const r = court.overturn(group, id);
  if (r.ok) log('court', group, `#${id}`, 'verdict overturned');
  return r;
}
function courtClear(group, jid) {
  const n = court.clearRecord(group, jid);
  log('court', group, key(jid), `record cleared (${n} cases)`);
  return { ok: true, cases: n };
}

// ---- society
function title(group, jid, id) {
  if (id === null) {
    const r = nobility.strip(group, null, jid, true);
    if (r.ok) log('title', group, key(jid), `${r.title.name} taken`);
    return r;
  }
  const r = nobility.grant(group, null, jid, id, Date.now(), true);
  if (r.ok) log('title', group, key(jid), `${r.title.name} given by God`);
  return r;
}
function festivalNow(group, on) {
  if (on) {
    const r = festival.start(group, Date.now());
    log('festival', group, null, `${r.name} started`);
    return r;
  }
  const r = festival.stop(group);
  if (r.ok) log('festival', group, null, 'stopped');
  return r;
}
function seasonEnd(group) {
  season.current(group);
  const r = season.finish(group, Date.now());
  log('season', group, `#${r.n}`, 'ended now');
  return { ok: true, result: r };
}
function seasonPoints(group, jid, pts) {
  const r = season.setPoints(group, jid, pts);
  if (r.ok) log('season points', group, key(jid), String(pts));
  return r;
}
function seasonDays(group, days) {
  const r = season.setEnd(group, days);
  if (r.ok) log('season', group, null, `ends in ${days} days`);
  return r;
}
function guildDo(group, how, g, a, b) {
  let r;
  if (how === 'disband') r = guild.godDisband(group, g);
  else if (how === 'level') r = guild.godLevel(group, g, a);
  else if (how === 'bank') r = guild.godBank(group, g, a);
  else if (how === 'kick') r = guild.godRemoveMember(group, g, a);
  else if (how === 'leader') {
    if (!g.members[key(a)]) return { ok: false };
    g.leader = g.members[key(a)].jid;
    S.touch();
    r = { ok: true };
  } else return { ok: false };
  if (r.ok) log('guild', group, `#${g.id} ${g.name}`, `${how}${a !== undefined && typeof a !== 'object' ? ` ${a}` : ''}`);
  return r;
}
function dungeonCall(group, id) {
  const r = dungeon.call(group, id);
  if (r.ok) log('dungeon', group, `#${id}`, 'called off, fees returned');
  return r;
}
// a part of the realm that has gone wrong: puts the state of a feature back to empty
function reset(group, what) {
  const r = S.realmOf(group);
  const had = r[what] !== undefined;
  if (what === 'gov') {
    const g = civic.gov(group);
    g.sov = null; g.off = {}; g.tax = 0; g.election = null; g.referendum = null; g.impeach = null; g.jail = {}; g.jailed = {}; g.decree = null;
  } else if (what === 'court') {
    civic.gov(group).court = { seq: 0, cases: [] };
  } else if (['season', 'fest', 'nobles', 'guilds', 'dungeon'].includes(what)) delete r[what];
  else return { ok: false };
  if (what === 'gov' || what === 'fest' || what === 'season') civic.removeEffect(group, 'law:festival'), civic.removeEffect(group, 'festival:auto'), civic.removeEffect(group, 'season:weather');
  S.touch();
  log('reset', group, what, 'state cleared');
  return { ok: true, had };
}
const RESETS = { government: 'gov', court: 'court', season: 'season', festival: 'fest', nobility: 'nobles', guild: 'guilds', dungeon: 'dungeon' };

module.exports = { crown, dethrone, officer, election, law, jail, pardon, treasury, tax, courtEnd, courtOverturn, courtClear, title, festivalNow, seasonEnd, seasonPoints, seasonDays, guildDo, dungeonCall, reset, RESETS };

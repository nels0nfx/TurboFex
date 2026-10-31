// The Empire, phase 4: the government of a realm.
//   God sets the limits (every number below is a setting) -> the Sovereign (elected) -> three officers -> citizens.
//   Sovereign: appoints officers, makes decrees and laws, calls referendums, pardons, draws a salary.
//   Treasurer: sets the income tax (inside God's cap) and spends the treasury (inside a daily cap).
//   Marshal: jails people. Steward: runs trade and building laws (trade holiday, harvest, festival).
//   Citizens: vote, stand for election, sign a petition to remove the Sovereign.
// Everything takes the realm (the group) first and "now" last, so it can be tested. The scheduler job at the bottom closes
// elections and votes and tells the group.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const civic = require('./civic');
const ticker = require('./ticker');

const HOUR = 3600000;
const DAY = 86400000;
const OFFICES = [
  { id: 'treasurer', name: 'Treasurer', icon: '💰', about: 'sets the tax and spends the treasury' },
  { id: 'marshal', name: 'Marshal', icon: '🛡️', about: 'keeps the law and jails people' },
  { id: 'steward', name: 'Steward', icon: '🏗️', about: 'runs trade and building laws' },
];

settings.register('government', {
  title: 'Government',
  icon: '🏛️',
  about: 'Elections, the Sovereign and three officers, taxes, the treasury, laws, referendums and impeachment',
  settings: {
    termDays: { label: 'How long a Sovereign rules', def: 7, min: 1, max: 90, unit: 'days' },
    electionHours: { label: 'How long an election lasts', def: 12, min: 1, max: 168, unit: 'hours' },
    votesNeeded: { label: 'Votes the winner needs at least', def: 3, min: 1, max: 1000, unit: 'votes' },
    candidacyFee: { label: 'Fee to stand for election (goes to the treasury)', def: 200, min: 0, max: 1000000, unit: 'Aurum' },
    maxCandidates: { label: 'Most candidates in one election', def: 10, min: 2, max: 50, unit: 'people' },
    termLimit: { label: 'Terms in a row one person can rule', def: 2, min: 1, max: 50, unit: 'terms' },
    autoElection: { label: 'An election starts by itself when a term ends', def: true, kind: 'bool' },
    maxTax: { label: 'Highest income tax the Treasurer can set', def: 10, min: 0, max: 50, kind: 'float', unit: '%' },
    spendCap: { label: 'Most of the treasury the Treasurer can spend in a day', def: 20, min: 1, max: 100, kind: 'float', unit: '%' },
    reliefMax: { label: 'Most people a relief payment is shared between', def: 20, min: 1, max: 200, unit: 'people' },
    maxLawHours: { label: 'Longest a law can stay in force', def: 24, min: 1, max: 720, unit: 'hours' },
    salarySov: { label: "The Sovereign's salary a day (paid from the treasury)", def: 150, min: 0, max: 1000000, unit: 'Aurum' },
    salaryOff: { label: "An officer's salary a day (paid from the treasury)", def: 75, min: 0, max: 1000000, unit: 'Aurum' },
    refHours: { label: 'How long a referendum lasts', def: 6, min: 1, max: 168, unit: 'hours' },
    refPass: { label: 'Share of yes votes a referendum needs', def: 50, min: 1, max: 100, kind: 'float', unit: '%' },
    refQuorum: { label: 'Votes a referendum needs at least', def: 3, min: 1, max: 1000, unit: 'votes' },
    impeachSigns: { label: 'Signatures that start an impeachment vote', def: 3, min: 1, max: 1000, unit: 'people' },
    impeachPetitionHours: { label: 'How long a petition collects signatures', def: 24, min: 1, max: 168, unit: 'hours' },
    impeachHours: { label: 'How long an impeachment vote lasts', def: 6, min: 1, max: 168, unit: 'hours' },
    impeachPct: { label: 'Share of yes votes that removes the Sovereign', def: 60, min: 1, max: 100, kind: 'float', unit: '%' },
    impeachQuorum: { label: 'Votes an impeachment needs at least', def: 3, min: 1, max: 1000, unit: 'votes' },
    impeachCooldown: { label: 'Wait after a failed impeachment', def: 24, min: 0, max: 720, unit: 'hours' },
    maxJailMinutes: { label: 'Longest the Marshal can jail somebody', def: 120, min: 1, max: 10080, unit: 'minutes' },
    jailCooldown: { label: 'Wait before the same person can be jailed again', def: 60, min: 0, max: 10080, unit: 'minutes' },
  },
});
const get = (k, g) => settings.get(`government.${k}`, g);

// ---- the laws. big = needs a referendum. kind: pay | fee | output (a timed effect), or an instant act
const LAWS = [
  { id: 'festival', name: 'Festival', icon: '🎉', kind: 'pay', by: ['sovereign', 'steward'], big: false, cost: 500, hours: 12, pct: 15, about: (p) => `everybody earns +${p}% while it lasts` },
  { id: 'trade_holiday', name: 'Trade Holiday', icon: '🤝', kind: 'fee', by: ['sovereign', 'steward'], big: false, cost: 400, hours: 12, pct: 50, about: (p) => `fees on trades, auctions and gifts are ${p}% lower` },
  { id: 'harvest', name: 'Harvest Decree', icon: '🌾', kind: 'output', by: ['sovereign', 'steward'], big: false, cost: 500, hours: 12, pct: 20, about: (p) => `estates make +${p}% while it lasts` },
  { id: 'prosperity', name: 'Age of Prosperity', icon: '👑', kind: 'pay', by: ['sovereign'], big: true, cost: 3000, hours: 24, pct: 30, about: (p) => `everybody earns +${p}% for a whole day (needs a referendum)` },
  { id: 'levy', name: 'Royal Levy', icon: '🏛️', kind: 'levy', by: ['sovereign'], big: true, cost: 0, hours: 0, pct: 5, about: (p) => `every citizen pays ${p}% of the purse into the treasury, once (needs a referendum)` },
  { id: 'amnesty', name: 'Amnesty', icon: '🕊️', kind: 'amnesty', by: ['sovereign'], big: false, cost: 200, hours: 0, pct: 0, about: () => 'everybody in jail is set free' },
];
for (const l of LAWS) {
  settings.extend('government', `lawCost_${l.id}`, { label: `${l.name}: what it costs the treasury`, def: l.cost, min: 0, max: 1000000000, unit: 'Aurum' });
  if (l.hours) settings.extend('government', `lawHours_${l.id}`, { label: `${l.name}: how long it lasts`, def: l.hours, min: 1, max: 720, unit: 'hours' });
  if (l.pct) settings.extend('government', `lawPower_${l.id}`, { label: `${l.name}: its strength`, def: l.pct, min: 1, max: 500, kind: 'float', unit: '%' });
  settings.extend('government', `lawBig_${l.id}`, { label: `${l.name}: needs a referendum`, def: l.big, kind: 'bool' });
}
const lawById = (id) => LAWS.find((l) => l.id === String(id || '').toLowerCase().replace(/[^a-z_]/g, '_').replace(/^_+|_+$/g, '')) || LAWS.find((l) => l.name.toLowerCase().replace(/[^a-z]/g, '') === String(id || '').toLowerCase().replace(/[^a-z]/g, '')) || null;
const lawView = (group, l) => ({ ...l, cost: get(`lawCost_${l.id}`, group), hours: l.hours ? Math.min(get(`lawHours_${l.id}`, group), get('maxLawHours', group)) : 0, pct: l.pct ? get(`lawPower_${l.id}`, group) : 0, big: get(`lawBig_${l.id}`, group) });

// ---- who is who
const g_ = (group) => civic.gov(group);
const sovereign = (group, now = Date.now()) => {
  const s = S.js.data.realms[group] && S.js.data.realms[group].gov ? S.js.data.realms[group].gov.sov : null;
  return s || null;
};
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);
function officeOf(group, jid) {
  const g = g_(group);
  if (g.sov && keyEq(g.sov.jid, jid)) return 'sovereign';
  for (const o of OFFICES) if (g.off[o.id] && keyEq(g.off[o.id].jid, jid)) return o.id;
  return null;
}
const officer = (group, id) => g_(group).off[id] || null;
const lawRights = (group, jid, law) => {
  const o = officeOf(group, jid);
  return !!o && law.by.includes(o);
};

// ---- elections
function startElection(group, by, now = Date.now(), force = false) {
  const g = g_(group);
  if (g.election) return { ok: false, why: 'running', election: g.election };
  if (g.sov && g.sov.until > now && !force) return { ok: false, why: 'seated', until: g.sov.until };
  g.seq += 1;
  g.election = { id: g.seq, startedAt: now, endsAt: now + get('electionHours', group) * HOUR, by: by ? S.keyOf(by) : null, cands: {}, voters: {} };
  S.touch();
  civic.log(group, 'An election began.', now);
  return { ok: true, election: g.election };
}
function stand(group, jid, now = Date.now()) {
  const g = g_(group);
  const e = g.election;
  if (!e || e.endsAt <= now) return { ok: false, why: 'none' };
  const key = S.keyOf(jid);
  if (e.cands[key]) return { ok: false, why: 'already' };
  if (civic.isGod(jid)) return { ok: false, why: 'god' };
  if (g.lastSov === key && (g.terms[key] || 0) >= get('termLimit', group)) return { ok: false, why: 'limit', limit: get('termLimit', group) };
  if (Object.keys(e.cands).length >= get('maxCandidates', group)) return { ok: false, why: 'full' };
  const fee = get('candidacyFee', group);
  if (fee > 0 && !A.take(group, jid, fee)) return { ok: false, why: 'poor', fee };
  if (fee > 0) A.treasuryAdd(group, fee);
  e.cands[key] = { jid, at: now };
  S.touch();
  return { ok: true, fee };
}
function castVote(group, voter, candidate, now = Date.now()) {
  const e = g_(group).election;
  if (!e || e.endsAt <= now) return { ok: false, why: 'none' };
  const ck = S.keyOf(candidate);
  if (!e.cands[ck]) return { ok: false, why: 'nocandidate' };
  const vk = S.keyOf(voter);
  if (e.voters[vk]) return { ok: false, why: 'voted' };
  e.voters[vk] = ck;
  S.touch();
  return { ok: true };
}
function tally(e) {
  const votes = {};
  for (const c of Object.values(e.voters)) votes[c] = (votes[c] || 0) + 1;
  return Object.entries(e.cands)
    .map(([key, c]) => ({ key, jid: c.jid, votes: votes[key] || 0, at: c.at }))
    .sort((a, b) => b.votes - a.votes || a.at - b.at);
}
function crown(group, jid, now = Date.now()) {
  const g = g_(group);
  const key = S.keyOf(jid);
  const again = g.lastSov === key;
  g.terms = again ? { [key]: (g.terms[key] || 0) + 1 } : { [key]: 1 };
  g.lastSov = key;
  g.sov = { key, jid, since: now, until: now + get('termDays', group) * DAY };
  g.off = {}; // a new Sovereign appoints their own officers
  g.tax = 0;
  g.impeach = null;
  S.touch();
}
function dethrone(group, now = Date.now()) {
  const g = g_(group);
  const was = g.sov;
  g.sov = null;
  g.off = {};
  g.tax = 0;
  g.impeach = null;
  S.touch();
  return was;
}
function resolveElection(group, now = Date.now()) {
  const g = g_(group);
  const e = g.election;
  if (!e || e.endsAt > now) return null;
  g.election = null;
  const rows = tally(e);
  const top = rows[0];
  const total = Object.keys(e.voters).length;
  let winner = null;
  if (top && top.votes >= get('votesNeeded', group)) {
    winner = top;
    crown(group, top.jid, now);
    civic.log(group, `A new Sovereign was elected (${top.votes} votes).`, now);
  } else {
    if (g.sov) dethrone(group, now); // the old term is over and nobody won: the seat is vacant
    civic.log(group, 'The election had no winner. The seat is vacant.', now);
  }
  S.touch();
  return { winner, rows, total, needed: get('votesNeeded', group) };
}

// ---- the officers
function appoint(group, by, office, target, now = Date.now()) {
  const g = g_(group);
  if (officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  const o = OFFICES.find((x) => x.id === office);
  if (!o) return { ok: false, why: 'office' };
  if (keyEq(by, target)) return { ok: false, why: 'self' };
  if (civic.isGod(target)) return { ok: false, why: 'god' };
  if (!S.citizen(group, target, false)) return { ok: false, why: 'stranger' };
  const has = officeOf(group, target);
  if (has && has !== office) return { ok: false, why: 'busy', has };
  g.off[office] = { key: S.keyOf(target), jid: target, since: now };
  S.touch();
  civic.log(group, `${o.name} appointed.`, now);
  return { ok: true, office: o };
}
function dismiss(group, by, office, now = Date.now()) {
  const g = g_(group);
  if (officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  const o = OFFICES.find((x) => x.id === office);
  if (!o) return { ok: false, why: 'office' };
  if (!g.off[o.id]) return { ok: false, why: 'empty' };
  const was = g.off[o.id];
  delete g.off[o.id];
  S.touch();
  civic.log(group, `${o.name} dismissed.`, now);
  return { ok: true, office: o, was };
}
function decree(group, by, text, now = Date.now()) {
  if (officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  const t = String(text || '').trim().slice(0, 240);
  if (t.length < 3) return { ok: false, why: 'short' };
  g_(group).decree = { text: t, at: now };
  S.touch();
  civic.log(group, 'The Sovereign made a decree.', now);
  return { ok: true, text: t };
}
function salary(group, jid, now = Date.now()) {
  const g = g_(group);
  const o = officeOf(group, jid);
  if (!o) return { ok: false, why: 'none' };
  const key = S.keyOf(jid);
  const last = g.salary[key] || 0;
  if (now - last < DAY) return { ok: false, why: 'wait', waitMs: DAY - (now - last) };
  const want = o === 'sovereign' ? get('salarySov', group) : get('salaryOff', group);
  const pay = Math.min(want, A.treasury(group));
  if (!(pay > 0)) return { ok: false, why: 'empty', want };
  A.treasuryAdd(group, -pay);
  A.add(group, jid, pay);
  g.salary[key] = now;
  S.touch();
  civic.log(group, `Salary paid (${pay}).`, now);
  return { ok: true, pay, want, office: o };
}

// ---- tax and the treasury
function setTax(group, by, pct, now = Date.now()) {
  if (officeOf(group, by) !== 'treasurer') return { ok: false, why: 'rights' };
  const max = get('maxTax', group);
  if (!(pct >= 0) || pct > max) return { ok: false, why: 'cap', max };
  g_(group).tax = Math.round(pct * 100) / 100;
  S.touch();
  civic.log(group, `Income tax set to ${g_(group).tax}%.`, now);
  return { ok: true, pct: g_(group).tax };
}
function capLeft(group, now = Date.now()) {
  const sp = g_(group).spent;
  const day = Math.floor(now / DAY);
  if (sp.day !== day) {
    sp.day = day;
    sp.cap = Math.floor((A.treasury(group) * get('spendCap', group)) / 100);
    sp.used = 0;
    S.touch();
  }
  return Math.max(0, sp.cap - sp.used);
}
// kind 'grant' (to one citizen) or 'relief' (shared between the poorest citizens)
function spend(group, by, kind, amount, target = null, now = Date.now()) {
  if (officeOf(group, by) !== 'treasurer') return { ok: false, why: 'rights' };
  amount = Math.round(amount);
  if (!(amount >= 1)) return { ok: false, why: 'amount' };
  if (amount > A.treasury(group)) return { ok: false, why: 'poor', have: A.treasury(group) };
  const left = capLeft(group, now);
  if (amount > left) return { ok: false, why: 'cap', left };
  const sp = g_(group).spent;
  if (kind === 'grant') {
    if (!target) return { ok: false, why: 'target' };
    if (!S.citizen(group, target, false)) return { ok: false, why: 'stranger' };
    A.treasuryAdd(group, -amount);
    A.add(group, target, amount);
    sp.used += amount;
    S.touch();
    civic.log(group, `Grant of ${amount} Aurum.`, now);
    return { ok: true, kind, amount, to: [{ jid: target, got: amount }] };
  }
  const limit = settings.get('core.rankCitizen', group);
  const poor = S.citizensOf(group)
    .map(({ key, c }) => ({ jid: S.jidOf(key, c), worth: A.netWorth(group, S.jidOf(key, c)) }))
    .filter((p) => p.worth < limit)
    .sort((a, b) => a.worth - b.worth)
    .slice(0, get('reliefMax', group));
  if (!poor.length) return { ok: false, why: 'nobody' };
  const each = Math.floor(amount / poor.length);
  if (each < 1) return { ok: false, why: 'small', people: poor.length };
  for (const p of poor) A.add(group, p.jid, each);
  const total = each * poor.length;
  A.treasuryAdd(group, -total);
  sp.used += total;
  S.touch();
  civic.log(group, `Relief of ${total} Aurum for ${poor.length} citizens.`, now);
  return { ok: true, kind: 'relief', amount: total, each, to: poor.map((p) => ({ jid: p.jid, got: each })) };
}

// ---- laws
const activeLaws = (group, now = Date.now()) => civic.effectsOf(group, now).filter((e) => e.src === 'law');
function enactLaw(group, by, id, now = Date.now(), viaReferendum = false) {
  const base = lawById(id);
  if (!base) return { ok: false, why: 'unknown' };
  const law = lawView(group, base);
  if (!viaReferendum) {
    if (!lawRights(group, by, law)) return { ok: false, why: 'rights', law };
    if (law.big) return { ok: false, why: 'referendum', law };
  }
  if (law.hours && activeLaws(group, now).some((e) => e.id === `law:${law.id}`)) return { ok: false, why: 'active', law };
  if (law.cost > A.treasury(group)) return { ok: false, why: 'poor', law, have: A.treasury(group) };
  if (law.cost > 0) A.treasuryAdd(group, -law.cost);
  const out = { ok: true, law };
  if (law.kind === 'pay' || law.kind === 'fee' || law.kind === 'output') {
    const m = law.kind === 'fee' ? Math.max(0, 1 - law.pct / 100) : 1 + law.pct / 100;
    civic.addEffect(group, { id: `law:${law.id}`, kind: law.kind, mult: m, until: now + law.hours * HOUR, src: 'law', name: law.name, icon: law.icon });
    out.until = now + law.hours * HOUR;
  } else if (law.kind === 'levy') {
    let total = 0;
    for (const { key, c } of S.citizensOf(group)) {
      if (civic.isGod(S.jidOf(key, c))) continue;
      const t = Math.floor((c.coins * law.pct) / 100);
      if (t > 0) {
        c.coins -= t;
        total += t;
      }
    }
    A.treasuryAdd(group, total);
    out.collected = total;
  } else if (law.kind === 'amnesty') {
    const freed = civic.prisoners(group, now);
    for (const p of freed) civic.free(group, p.jid);
    out.freed = freed.length;
  }
  S.touch();
  civic.log(group, `${law.name} became law.`, now);
  return out;
}
function repealLaw(group, id) {
  const ok = civic.removeEffect(group, `law:${String(id).replace(/^law:/, '')}`);
  return ok;
}

// ---- referendums: the Sovereign asks the citizens about a law
function callReferendum(group, by, id, now = Date.now()) {
  const g = g_(group);
  if (officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  const base = lawById(id);
  if (!base) return { ok: false, why: 'unknown' };
  if (g.referendum) return { ok: false, why: 'running', referendum: g.referendum };
  const law = lawView(group, base);
  if (law.hours && activeLaws(group, now).some((e) => e.id === `law:${law.id}`)) return { ok: false, why: 'active', law };
  g.seq += 1;
  g.referendum = { id: g.seq, law: law.id, endsAt: now + get('refHours', group) * HOUR, yes: {}, no: {} };
  S.touch();
  civic.log(group, `Referendum on ${law.name}.`, now);
  return { ok: true, referendum: g.referendum, law };
}
function refVote(group, jid, yes, now = Date.now()) {
  const r = g_(group).referendum;
  if (!r || r.endsAt <= now) return { ok: false, why: 'none' };
  const k = S.keyOf(jid);
  if (r.yes[k] || r.no[k]) return { ok: false, why: 'voted' };
  (yes ? r.yes : r.no)[k] = 1;
  S.touch();
  return { ok: true };
}
function resolveReferendum(group, now = Date.now()) {
  const g = g_(group);
  const r = g.referendum;
  if (!r || r.endsAt > now) return null;
  g.referendum = null;
  const yes = Object.keys(r.yes).length;
  const no = Object.keys(r.no).length;
  const votes = yes + no;
  const base = lawById(r.law);
  const law = lawView(group, base);
  const pass = votes >= get('refQuorum', group) && (yes * 100) / votes >= get('refPass', group);
  let enacted = null;
  if (pass) enacted = enactLaw(group, null, law.id, now, true);
  S.touch();
  return { law, yes, no, votes, passed: pass && enacted.ok, enacted, quorum: get('refQuorum', group), pctNeeded: get('refPass', group) };
}

// ---- impeachment: signatures first, then a vote
function impeachStatus(group, now = Date.now()) {
  const i = g_(group).impeach;
  return i && (i.stage === 'vote' ? i.endsAt > now : i.expires > now) ? i : null;
}
function petition(group, jid, now = Date.now()) {
  const g = g_(group);
  if (!g.sov) return { ok: false, why: 'vacant' };
  if (keyEq(g.sov.jid, jid)) return { ok: false, why: 'self' };
  if (g.impeachBlock > now) return { ok: false, why: 'blocked', waitMs: g.impeachBlock - now };
  let i = impeachStatus(group, now);
  if (i && i.stage === 'vote') return { ok: false, why: 'voting' };
  if (!i) {
    i = g.impeach = { stage: 'petition', signers: {}, expires: now + get('impeachPetitionHours', group) * HOUR };
  }
  const k = S.keyOf(jid);
  if (i.signers[k]) return { ok: false, why: 'signed', count: Object.keys(i.signers).length };
  i.signers[k] = jid;
  const count = Object.keys(i.signers).length;
  let opened = false;
  if (count >= get('impeachSigns', group)) {
    g.impeach = { stage: 'vote', signers: i.signers, endsAt: now + get('impeachHours', group) * HOUR, yes: {}, no: {} };
    opened = true;
    civic.log(group, 'An impeachment vote opened.', now);
  }
  S.touch();
  return { ok: true, count, needed: get('impeachSigns', group), opened };
}
function impeachVote(group, jid, yes, now = Date.now()) {
  const i = impeachStatus(group, now);
  if (!i || i.stage !== 'vote') return { ok: false, why: 'none' };
  const k = S.keyOf(jid);
  if (i.yes[k] || i.no[k]) return { ok: false, why: 'voted' };
  (yes ? i.yes : i.no)[k] = 1;
  S.touch();
  return { ok: true };
}
function resolveImpeachment(group, now = Date.now()) {
  const g = g_(group);
  const i = g.impeach;
  if (!i) return null;
  if (i.stage === 'petition') {
    if (i.expires > now) return null;
    g.impeach = null;
    S.touch();
    return { stage: 'petition', expired: true };
  }
  if (i.endsAt > now) return null;
  g.impeach = null;
  const yes = Object.keys(i.yes).length;
  const no = Object.keys(i.no).length;
  const votes = yes + no;
  const removed = votes >= get('impeachQuorum', group) && (yes * 100) / votes >= get('impeachPct', group);
  const was = g.sov;
  if (removed) {
    dethrone(group, now);
    civic.log(group, 'The Sovereign was impeached.', now);
  } else g.impeachBlock = now + get('impeachCooldown', group) * HOUR;
  S.touch();
  return { stage: 'vote', yes, no, votes, removed, was };
}

// ---- justice: the Marshal jails (the court is in court.js)
function jailPerson(group, by, target, minutes, now = Date.now()) {
  const g = g_(group);
  if (officeOf(group, by) !== 'marshal') return { ok: false, why: 'rights' };
  if (civic.isGod(target)) return { ok: false, why: 'god' };
  if (keyEq(by, target)) return { ok: false, why: 'self' };
  if (g.sov && keyEq(g.sov.jid, target)) return { ok: false, why: 'sovereign' };
  if (!S.citizen(group, target, false)) return { ok: false, why: 'stranger' };
  minutes = Math.round(minutes);
  const max = get('maxJailMinutes', group);
  if (!(minutes >= 1) || minutes > max) return { ok: false, why: 'minutes', max };
  if (civic.jailLeft(group, target, now) > 0) return { ok: false, why: 'already' };
  const last = (g.jailAt || {})[S.keyOf(target)] || 0;
  const wait = get('jailCooldown', group) * 60000 - (now - last);
  if (wait > 0) return { ok: false, why: 'cooldown', waitMs: wait };
  civic.jail(group, target, minutes, now);
  g.jailAt = g.jailAt || {};
  g.jailAt[S.keyOf(target)] = now;
  civic.log(group, `Somebody was jailed for ${minutes} minutes.`, now);
  return { ok: true, minutes };
}
function pardon(group, by, target, now = Date.now()) {
  if (by && officeOf(group, by) !== 'sovereign') return { ok: false, why: 'rights' };
  if (!civic.free(group, target)) return { ok: false, why: 'free' };
  civic.log(group, 'A pardon was given.', now);
  return { ok: true };
}

// ---- the picture of the government now
function overview(group, now = Date.now()) {
  const g = g_(group);
  return {
    sovereign: g.sov,
    officers: OFFICES.map((o) => ({ ...o, holder: g.off[o.id] || null })),
    tax: g.tax,
    maxTax: get('maxTax', group),
    treasury: A.treasury(group),
    capLeft: capLeft(group, now),
    laws: activeLaws(group, now),
    election: g.election,
    referendum: g.referendum,
    impeach: impeachStatus(group, now),
    decree: g.decree,
    prisoners: civic.prisoners(group, now),
  };
}

// ---- the scheduler: closes elections and votes, ends laws, starts the next election, and tells the group
const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    const realm = S.js.data.realms[group];
    if (!realm.gov && !(realm.fx && realm.fx.length)) continue;
    if (!S.isOn(group) || !settings.featureOn('government', group)) continue;
    const say = async (text, mentions = []) => {
      try {
        await post(group, { text, mentions });
      } catch (err) {
        console.log(`The government news could not be sent to ${group}: ${err.message}`);
      }
    };
    civic.purge(group, now);
    if (!realm.gov) continue;
    civic.sweepJail(group, now);

    const el = resolveElection(group, now);
    if (el) {
      if (el.winner) {
        await say(`🏛️ *The election is over*\n\n👑 ${tagOf(el.winner.jid)} is the new *Sovereign* with *${el.winner.votes}* vote${el.winner.votes === 1 ? '' : 's'}.\n_The term lasts ${get('termDays', group)} days._\n\n▸ \`appoint treasurer @user\` • \`appoint marshal @user\` • \`appoint steward @user\``, [el.winner.jid]);
      } else {
        await say(`🏛️ *The election is over*\n\nNobody won (at least ${el.needed} vote${el.needed === 1 ? '' : 's'} are needed, ${el.total} vote${el.total === 1 ? ' was' : 's were'} cast). The seat is *vacant*.\n\n▸ \`election start\` – begin a new one`);
      }
    }
    const ref = resolveReferendum(group, now);
    if (ref) {
      const why = ref.passed ? '' : ref.votes < ref.quorum ? `Not enough votes (${ref.quorum} needed).` : ref.enacted && !ref.enacted.ok ? 'The treasury could not pay for it.' : `Not enough yes votes (${ref.pctNeeded}% needed).`;
      await say(`🗳️ *Referendum: ${ref.law.icon} ${ref.law.name}*\n\n${ref.passed ? '✅ *It passed* and is now law.' : '❌ *It did not pass.*'} ${why}\n*Yes:* ${ref.yes} • *No:* ${ref.no}${ref.passed && ref.enacted.collected !== undefined ? `\n*Collected:* ${ref.enacted.collected.toLocaleString('en-US')} Aurum` : ''}`);
    }
    const imp = resolveImpeachment(group, now);
    if (imp && imp.stage === 'vote') {
      await say(`⚖️ *Impeachment vote ended*\n\n${imp.removed ? `❌ The Sovereign ${imp.was ? tagOf(imp.was.jid) : ''} was *removed*. The seat is vacant.` : '✅ The Sovereign *stays*.'}\n*Yes:* ${imp.yes} • *No:* ${imp.no}`, imp.removed && imp.was ? [imp.was.jid] : []);
    }
    // the term is over: the next election starts by itself
    const g = realm.gov;
    if (g.sov && g.sov.until <= now && !g.election && get('autoElection', group)) {
      const r = startElection(group, null, now, true);
      if (r.ok) await say(`🏛️ *The term of the Sovereign has ended*\n\nAn election is open for *${get('electionHours', group)} hours*.\n\n▸ \`stand\` – stand as a candidate (${get('candidacyFee', group).toLocaleString('en-US')} Aurum)\n▸ \`vote @user\` – vote`, g.sov ? [g.sov.jid] : []);
    }
  }
}
ticker.register('realm-government', job);

module.exports = { OFFICES, LAWS, lawById, lawView, get, officeOf, officer, sovereign, startElection, stand, castVote, tally, resolveElection, crown, dethrone, appoint, dismiss, decree, salary, setTax, capLeft, spend, activeLaws, enactLaw, repealLaw, callReferendum, refVote, resolveReferendum, impeachStatus, petition, impeachVote, resolveImpeachment, jailPerson, pardon, overview, job };

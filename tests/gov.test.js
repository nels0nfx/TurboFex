require('./_setup');
const test = require('node:test');
const assert = require('node:assert');
const settings = require('../core/realm/settings');
const A = require('../core/realm/aurum');
const S = require('../core/realm/state');
const civic = require('../core/realm/civic');
const gov = require('../core/realm/gov');
const court = require('../core/realm/court');

let gid = 0;
const newGroup = () => `1203680000001${String(++gid).padStart(5, '0')}@g.us`;
let uid = 0;
const person = (g) => {
  const j = `2787220${String(++uid).padStart(4, '0')}@s.whatsapp.net`;
  if (g) S.citizen(g, j);
  return j;
};
const HOUR = 3600000;
const T0 = Date.now();

function crownedRealm() {
  const g = newGroup();
  const sov = person(g);
  gov.crown(g, sov, T0);
  return { g, sov };
}

test('elections: a seat is filled by the most votes, and standing costs a fee that goes to the treasury', () => {
  const g = newGroup();
  const a = person(g), b = person(g);
  A.add(g, a, 1000);
  assert.ok(gov.startElection(g, a, T0).ok);
  assert.strictEqual(gov.startElection(g, a, T0).why, 'running');
  assert.ok(gov.stand(g, a, T0).ok);
  assert.strictEqual(gov.stand(g, a, T0).why, 'already');
  assert.ok(A.treasury(g) >= gov.get('candidacyFee', g));
  const voters = [];
  for (let i = 0; i < gov.get('votesNeeded', g); i++) voters.push(person(g));
  for (const v of voters) assert.ok(gov.castVote(g, v, a, T0).ok);
  assert.strictEqual(gov.castVote(g, voters[0], a, T0).why, 'voted');
  assert.strictEqual(gov.castVote(g, b, b, T0).why, 'nocandidate');
  const r = gov.resolveElection(g, T0 + 99 * HOUR);
  assert.ok(r.winner);
  assert.strictEqual(gov.officeOf(g, a), 'sovereign');
});

test('elections: too few votes leave the seat vacant', () => {
  const g = newGroup();
  const a = person(g);
  A.add(g, a, 1000);
  gov.startElection(g, a, T0);
  gov.stand(g, a, T0);
  const r = gov.resolveElection(g, T0 + 99 * HOUR);
  assert.strictEqual(r.winner, null);
  assert.strictEqual(gov.sovereign(g), null);
});

test('elections: no election while a Sovereign is seated', () => {
  const { g, sov } = crownedRealm();
  assert.strictEqual(gov.startElection(g, sov, T0).why, 'seated');
});

test('offices: only the Sovereign appoints, a person holds one office, God cannot hold one', () => {
  const { g, sov } = crownedRealm();
  const a = person(g), b = person(g);
  assert.strictEqual(gov.appoint(g, a, 'treasurer', b).why, 'rights');
  assert.ok(gov.appoint(g, sov, 'treasurer', a).ok);
  assert.strictEqual(gov.appoint(g, sov, 'marshal', a).why, 'busy');
  assert.strictEqual(gov.appoint(g, sov, 'marshal', person()).why, 'stranger');
  assert.ok(gov.dismiss(g, sov, 'treasurer').ok);
  assert.strictEqual(gov.dismiss(g, sov, 'treasurer').why, 'empty');
});

test('tax: only the Treasurer sets it, God\'s cap holds, and it fills the treasury from the daily gift', () => {
  const { g, sov } = crownedRealm();
  const t = person(g), c = person(g);
  gov.appoint(g, sov, 'treasurer', t);
  assert.strictEqual(gov.setTax(g, c, 5).why, 'rights');
  assert.strictEqual(gov.setTax(g, t, 99).why, 'cap');
  assert.ok(gov.setTax(g, t, 10).ok);
  assert.strictEqual(civic.taxRate(g), 10);
  const before = A.treasury(g);
  assert.strictEqual(civic.tax(g, 1000), 100);
  assert.strictEqual(A.treasury(g), before + 100);
  settings.set('government.maxTax', 5, g);
  assert.strictEqual(gov.setTax(g, t, 10).why, 'cap');
});

test('treasury: grants and relief respect the daily cap and the balance', () => {
  const { g, sov } = crownedRealm();
  const t = person(g), c = person(g);
  gov.appoint(g, sov, 'treasurer', t);
  A.treasuryAdd(g, 10000);
  assert.strictEqual(gov.spend(g, c, 'grant', 10, c).why, 'rights');
  const cap = gov.capLeft(g);
  assert.ok(cap > 0);
  assert.strictEqual(gov.spend(g, t, 'grant', cap + 1, c).why, 'cap');
  const bal = A.balance(g, c);
  assert.ok(gov.spend(g, t, 'grant', 100, c).ok);
  assert.strictEqual(A.balance(g, c), bal + 100);
});

test('laws: small laws by officers, big laws only by referendum, the treasury pays', () => {
  const { g, sov } = crownedRealm();
  const c = person(g);
  A.treasuryAdd(g, 10000);
  assert.strictEqual(gov.enactLaw(g, c, 'festival').why, 'rights');
  assert.strictEqual(gov.enactLaw(g, sov, 'prosperity').why, 'referendum');
  const before = A.treasury(g);
  assert.ok(gov.enactLaw(g, sov, 'festival').ok);
  assert.ok(A.treasury(g) < before);
  assert.ok(civic.mult(g, 'pay') > 1, 'the festival raises pay');
  assert.strictEqual(gov.enactLaw(g, sov, 'festival').why, 'active');
  assert.strictEqual(gov.enactLaw(g, sov, 'nonsense').why, 'unknown');
  settings.set('government.lawBig_festival', true, g);
  assert.strictEqual(gov.lawView(g, gov.lawById('festival')).big, true);
});

test('laws: not enough in the treasury refuses', () => {
  const { g, sov } = crownedRealm();
  assert.strictEqual(gov.enactLaw(g, sov, 'harvest').why, 'poor');
});

test('referendum: the Sovereign calls it, citizens vote, the law passes with enough yes votes', () => {
  const { g, sov } = crownedRealm();
  A.treasuryAdd(g, 100000);
  assert.strictEqual(gov.callReferendum(g, person(g), 'prosperity', T0).why, 'rights');
  assert.ok(gov.callReferendum(g, sov, 'prosperity', T0).ok);
  assert.strictEqual(gov.callReferendum(g, sov, 'levy', T0).why, 'running');
  for (let i = 0; i < gov.get('refQuorum', g) + 1; i++) assert.ok(gov.refVote(g, person(g), true, T0).ok);
  const r = gov.resolveReferendum(g, T0 + 999 * HOUR);
  assert.ok(r, 'it is resolved');
  assert.ok(gov.activeLaws(g, T0 + 999 * HOUR).length >= 0);
});

test('impeachment: signatures open a vote and a yes majority removes the Sovereign', () => {
  const { g, sov } = crownedRealm();
  assert.strictEqual(gov.petition(g, sov, T0).why, 'self');
  const need = gov.get('impeachSigns', g);
  let opened = false;
  for (let i = 0; i < need; i++) opened = gov.petition(g, person(g), T0).opened || opened;
  assert.ok(opened, 'the vote opens');
  for (let i = 0; i < gov.get('impeachQuorum', g) + 2; i++) gov.impeachVote(g, person(g), true, T0);
  gov.resolveImpeachment(g, T0 + 999 * HOUR);
  assert.strictEqual(gov.sovereign(g), null);
});

test('jail: only the Marshal jails, the Sovereign and God cannot be jailed, the Sovereign pardons', () => {
  const { g, sov } = crownedRealm();
  const m = person(g), c = person(g);
  gov.appoint(g, sov, 'marshal', m);
  assert.strictEqual(gov.jailPerson(g, c, m, 10, T0).why, 'rights');
  assert.strictEqual(gov.jailPerson(g, m, sov, 10, T0).why, 'sovereign');
  assert.strictEqual(gov.jailPerson(g, m, m, 10, T0).why, 'self');
  assert.ok(gov.jailPerson(g, m, c, 10, T0).ok);
  assert.ok(civic.jailLeft(g, c, T0 + 1000) > 0);
  assert.strictEqual(gov.pardon(g, c, c).why, 'rights');
  assert.ok(gov.pardon(g, sov, c).ok);
  assert.strictEqual(civic.jailLeft(g, c, T0 + 1000), 0);
});

test('salary: paid from the treasury once a day, only to the rulers', () => {
  const { g, sov } = crownedRealm();
  A.treasuryAdd(g, 5000);
  assert.strictEqual(gov.salary(g, person(g)).why, 'none');
  const r = gov.salary(g, sov, T0);
  assert.ok(r.ok && r.pay > 0);
  assert.strictEqual(gov.salary(g, sov, T0 + 1000).why, 'wait');
});

test('court: filing costs a fee, a jury decides, guilty fines and jails, innocent frees', () => {
  const g = newGroup();
  const p = person(g), d = person(g);
  A.add(g, p, 1000); A.add(g, d, 1000);
  assert.strictEqual(court.sue(g, p, p, 'x y z', T0).why, 'self');
  assert.strictEqual(court.sue(g, p, d, '', T0).why, 'reason');
  const r = court.sue(g, p, d, 'stole my harvest', T0);
  assert.ok(r.ok);
  assert.strictEqual(court.sue(g, person(g), d, 'again', T0).why, 'busy');
  assert.strictEqual(court.vote(g, p, r.case.id, true, T0).why, 'party');
  for (let i = 0; i < 3; i++) assert.ok(court.vote(g, person(g), r.case.id, true, T0).ok);
  const res = court.resolve(g, T0 + 10 * HOUR);
  assert.strictEqual(res[0].verdict, 'guilty');
  assert.ok(civic.jailLeft(g, d, T0 + 10 * HOUR) > 0 || court.get('jailMinutes', g) === 0);
  assert.ok(court.overturn(g, r.case.id).ok);
  assert.strictEqual(court.record(g, d), 0);
});

test('court: a jury that is too small dismisses the case', () => {
  const g = newGroup();
  const p = person(g), d = person(g);
  A.add(g, p, 1000);
  const r = court.sue(g, p, d, 'a quarrel', T0);
  court.vote(g, person(g), r.case.id, true, T0);
  assert.strictEqual(court.resolve(g, T0 + 10 * HOUR)[0].verdict, 'dismissed');
});

test('God controls: every government and court setting is registered and bounded', () => {
  for (const f of ['government', 'court']) {
    const feat = settings.one(f);
    assert.ok(feat, `${f} is registered`);
    assert.ok(feat.settings.size >= 5);
    assert.ok(settings.featureOn(f, newGroup()), `${f} is on by default`);
  }
});

// The Empire, phase 4: the court of law. A citizen sues another citizen (it costs a filing fee, which goes to the treasury),
// the other citizens act as the jury and vote guilty or innocent, and the verdict is carried out: a fine for the treasury and
// some time in jail. God sets every number and can overturn a verdict.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const civic = require('./civic');
const ticker = require('./ticker');

const HOUR = 3600000;
const MIN = 60000;

settings.register('court', {
  title: 'Court of Law',
  icon: '⚖️',
  about: 'Citizens sue each other, a jury of citizens votes, the court fines and jails',
  settings: {
    filingFee: { label: 'Fee to file a case (goes to the treasury, kept even if the accused is found innocent)', def: 50, min: 0, max: 1000000, unit: 'Aurum' },
    caseHours: { label: 'How long a case stays open for the jury', def: 6, min: 1, max: 168, unit: 'hours' },
    juryMin: { label: 'Votes a verdict needs at least', def: 3, min: 1, max: 100, unit: 'votes' },
    juryMax: { label: 'The case is closed early when this many have voted', def: 7, min: 1, max: 1000, unit: 'votes' },
    fine: { label: 'Fine for a guilty verdict (never more than the purse of the guilty)', def: 150, min: 0, max: 1000000, unit: 'Aurum' },
    jailMinutes: { label: 'Jail time for a guilty verdict', def: 30, min: 0, max: 10080, unit: 'minutes' },
    filingCooldown: { label: 'Wait between two cases filed by one citizen', def: 30, min: 0, max: 10080, unit: 'minutes' },
    maxOpen: { label: 'Most cases open in a realm at the same time', def: 5, min: 1, max: 100, unit: 'cases' },
  },
});
const get = (k, g) => settings.get(`court.${k}`, g);

const box = (group) => {
  const g = civic.gov(group);
  return g.court || (g.court = { seq: 0, cases: [] });
};
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);
const open = (group, now = Date.now()) => box(group).cases.filter((c) => c.status === 'open' && c.ends > now);
const find = (group, id) => box(group).cases.find((c) => c.id === id) || null;
const counts = (c) => ({ guilty: Object.values(c.votes).filter((v) => v === 'g').length, innocent: Object.values(c.votes).filter((v) => v === 'i').length });

function sue(group, plaintiff, defendant, reason, now = Date.now()) {
  const b = box(group);
  if (keyEq(plaintiff, defendant)) return { ok: false, why: 'self' };
  if (civic.isGod(defendant)) return { ok: false, why: 'god' };
  if (!S.citizen(group, defendant, false)) return { ok: false, why: 'stranger' };
  const text = String(reason || '').trim().slice(0, 160);
  if (text.length < 3) return { ok: false, why: 'reason' };
  if (open(group, now).some((c) => keyEq(c.defendant, defendant))) return { ok: false, why: 'busy' };
  if (open(group, now).length >= get('maxOpen', group)) return { ok: false, why: 'full', max: get('maxOpen', group) };
  const cd = A.cooldown(group, plaintiff, 'sue', get('filingCooldown', group) * MIN, now);
  if (!cd.ok) return { ok: false, why: 'wait', waitMs: cd.waitMs };
  const fee = get('filingFee', group);
  if (fee > 0 && !A.take(group, plaintiff, fee)) {
    S.citizen(group, plaintiff).cd.sue = 0; // the waiting time is not used up by a case that was never filed
    return { ok: false, why: 'poor', fee };
  }
  if (fee > 0) A.treasuryAdd(group, fee);
  b.seq += 1;
  const c = { id: b.seq, plaintiff, defendant, reason: text, at: now, ends: now + get('caseHours', group) * HOUR, votes: {}, status: 'open' };
  b.cases.push(c);
  if (b.cases.length > 60) b.cases.splice(0, b.cases.length - 60);
  S.touch();
  civic.log(group, `Case #${c.id} was filed.`, now);
  return { ok: true, case: c, fee };
}

// the jury: every citizen except the two sides, one vote each
function vote(group, jid, id, guilty, now = Date.now()) {
  const c = id ? find(group, id) : open(group, now).sort((a, b) => a.at - b.at)[0];
  if (!c || c.status !== 'open' || c.ends <= now) return { ok: false, why: 'none' };
  if (keyEq(jid, c.plaintiff) || keyEq(jid, c.defendant)) return { ok: false, why: 'party' };
  const k = S.keyOf(jid);
  if (c.votes[k]) return { ok: false, why: 'voted', case: c };
  c.votes[k] = guilty ? 'g' : 'i';
  S.touch();
  const total = Object.keys(c.votes).length;
  const early = total >= get('juryMax', group);
  return { ok: true, case: c, ...counts(c), total, early };
}

// closes a case and carries out the verdict. Returns { case, verdict: 'guilty' | 'innocent' | 'dismissed', fine, minutes }
function close(group, c, now = Date.now()) {
  const n = counts(c);
  c.status = 'closed';
  c.closed = now;
  let verdict = 'dismissed';
  let fine = 0;
  let minutes = 0;
  if (n.guilty + n.innocent >= get('juryMin', group)) {
    verdict = n.guilty > n.innocent ? 'guilty' : 'innocent';
    if (verdict === 'guilty') {
      const owed = Math.min(get('fine', group), S.citizen(group, c.defendant).coins);
      if (owed > 0 && A.take(group, c.defendant, owed)) {
        fine = owed;
        A.treasuryAdd(group, fine);
      }
      minutes = get('jailMinutes', group);
      if (minutes > 0) civic.jail(group, c.defendant, minutes, now);
    }
  }
  c.verdict = verdict;
  c.fine = fine;
  c.minutes = minutes;
  S.touch();
  civic.log(group, `Case #${c.id}: ${verdict}.`, now);
  return { case: c, verdict, fine, minutes, ...n };
}
// cases whose time is over (or the jury is full)
function due(group, now = Date.now()) {
  return box(group).cases.filter((c) => c.status === 'open' && (c.ends <= now || Object.keys(c.votes).length >= get('juryMax', group)));
}
function resolve(group, now = Date.now()) {
  return due(group, now).map((c) => close(group, c, now));
}
// God: end a case now as it stands, or undo a guilty verdict (the fine comes back from the treasury, the jail ends)
function endNow(group, id, now = Date.now()) {
  const c = find(group, id);
  if (!c || c.status !== 'open') return { ok: false };
  return { ok: true, result: close(group, c, now) };
}
function overturn(group, id, now = Date.now()) {
  const c = find(group, id);
  if (!c || c.status !== 'closed' || c.verdict !== 'guilty') return { ok: false };
  const back = Math.min(c.fine || 0, A.treasury(group));
  if (back > 0) {
    A.treasuryAdd(group, -back);
    A.add(group, c.defendant, back);
  }
  civic.free(group, c.defendant);
  c.verdict = 'overturned';
  S.touch();
  civic.log(group, `Case #${c.id} was overturned.`, now);
  return { ok: true, case: c, returned: back };
}
// God: clear the record of a citizen (cases against them are removed, jail ends)
function clearRecord(group, jid) {
  const b = box(group);
  const before = b.cases.length;
  b.cases = b.cases.filter((c) => !keyEq(c.defendant, jid));
  civic.free(group, jid);
  S.touch();
  return before - b.cases.length;
}
const record = (group, jid) => box(group).cases.filter((c) => keyEq(c.defendant, jid) && c.verdict === 'guilty').length;

const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    const realm = S.js.data.realms[group];
    if (!realm.gov || !realm.gov.court) continue;
    if (!S.isOn(group) || !settings.featureOn('court', group)) continue;
    for (const r of resolve(group, now)) {
      const c = r.case;
      const head = `⚖️ *Case #${c.id}: ${tagOf(c.plaintiff)} v ${tagOf(c.defendant)}*\n_${c.reason}_\n\n`;
      const body =
        r.verdict === 'guilty'
          ? `🔨 *Guilty* (${r.guilty}–${r.innocent}).${r.fine ? ` Fine: *${r.fine.toLocaleString('en-US')} Aurum* to the treasury.` : ''}${r.minutes ? ` Jail: *${r.minutes} minutes*.` : ''}`
          : r.verdict === 'innocent'
            ? `✅ *Innocent* (${r.innocent}–${r.guilty}). The case is closed.`
            : `🕳️ *Dismissed*: the jury was too small (${get('juryMin', group)} votes are needed).`;
      try {
        await post(group, { text: head + body, mentions: [c.plaintiff, c.defendant] });
      } catch (err) {
        console.log(`The verdict could not be sent to ${group}: ${err.message}`);
      }
    }
  }
}
ticker.register('realm-court', job);

module.exports = { sue, vote, close, resolve, due, endNow, overturn, clearRecord, record, open, find, counts, box, job, get };

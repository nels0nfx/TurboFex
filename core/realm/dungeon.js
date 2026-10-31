// The Empire, phase 5: dungeons. A citizen opens an expedition into a dungeon, others join during a short gathering time, and when
// the time is up the party goes in. A bigger party has better odds. A win shares loot (Aurum and goods) between the party; a loss
// costs the entry fee and a rest. God sets the fee, the odds, the loot and the rests, and can call an expedition off or settle it.
const settings = require('./settings');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');
const civic = require('./civic');
const ticker = require('./ticker');

const MIN = 60000;
const DUNGEONS = [
  { id: 'cellar', name: 'Old Cellar', icon: '🕯️', fee: 50, odds: 70, loot: 300, good: 'grain', min: 1 },
  { id: 'crypt', name: 'Forgotten Crypt', icon: '⚰️', fee: 200, odds: 55, loot: 1200, good: 'ore', min: 2 },
  { id: 'lair', name: 'Dragon\'s Lair', icon: '🐉', fee: 800, odds: 35, loot: 6000, good: 'iron', min: 3 },
];

settings.register('dungeon', {
  title: 'Dungeons',
  icon: '🐉',
  about: 'Parties go into dungeons for loot: a bigger party has better odds',
  settings: {
    gatherMinutes: { label: 'How long an expedition waits for the party before it goes in', def: 10, min: 1, max: 1440, unit: 'minutes' },
    partyMax: { label: 'Largest party', def: 6, min: 1, max: 50, unit: 'people' },
    partyOddsPct: { label: 'Extra chance for every extra party member', def: 5, min: 0, max: 50, kind: 'float', unit: '%' },
    oddsMax: { label: 'The highest chance of winning', def: 95, min: 1, max: 100, kind: 'float', unit: '%' },
    restMinutes: { label: 'Rest after an expedition before the next one', def: 60, min: 0, max: 10080, unit: 'minutes' },
    maxOpen: { label: 'Expeditions that can be open at the same time in a realm', def: 3, min: 1, max: 50, unit: 'expeditions' },
    lootGoodMin: { label: 'Goods in the loot, per party member, at the least', def: 2, min: 0, max: 1000, unit: 'units' },
    lootGoodMax: { label: 'Goods in the loot, per party member, at the most', def: 8, min: 0, max: 1000, unit: 'units' },
  },
});
for (const d of DUNGEONS) {
  settings.extend('dungeon', `fee_${d.id}`, { label: `${d.name}: entry fee for every member (goes to the treasury)`, def: d.fee, min: 0, max: 1000000000, unit: 'Aurum' });
  settings.extend('dungeon', `odds_${d.id}`, { label: `${d.name}: base chance of winning`, def: d.odds, min: 1, max: 100, kind: 'float', unit: '%' });
  settings.extend('dungeon', `loot_${d.id}`, { label: `${d.name}: Aurum loot (shared by the party)`, def: d.loot, min: 0, max: 1000000000, unit: 'Aurum' });
  settings.extend('dungeon', `min_${d.id}`, { label: `${d.name}: the smallest party that can go in`, def: d.min, min: 1, max: 50, unit: 'people' });
}
const get = (k, g) => settings.get(`dungeon.${k}`, g);
const byId = (text) => {
  const t = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  return DUNGEONS.find((d) => d.id === t || d.name.toLowerCase().replace(/[^a-z]/g, '') === t) || DUNGEONS.find((d) => d.id.startsWith(t) && t.length >= 3) || null;
};
const box = (group) => {
  const r = S.realmOf(group);
  return r.dungeon || (r.dungeon = { seq: 0, runs: [] });
};
const keyEq = (a, b) => !!a && !!b && S.keyOf(a) === S.keyOf(b);
const open = (group) => box(group).runs.filter((r) => r.status === 'open');
const runOf = (group, jid) => open(group).find((r) => r.party[S.keyOf(jid)]) || null;
const odds = (group, run) => {
  const d = byId(run.dungeon);
  const size = Object.keys(run.party).length;
  return Math.min(get('oddsMax', group), get(`odds_${d.id}`, group) + (size - 1) * get('partyOddsPct', group));
};

function openRun(group, jid, id, now = Date.now()) {
  const d = byId(id);
  if (!d) return { ok: false, why: 'unknown' };
  if (runOf(group, jid)) return { ok: false, why: 'busy' };
  if (open(group).length >= get('maxOpen', group)) return { ok: false, why: 'full', max: get('maxOpen', group) };
  const rest = A.cooldown(group, jid, 'dungeon', get('restMinutes', group) * MIN, now);
  if (!rest.ok) return { ok: false, why: 'rest', waitMs: rest.waitMs };
  const fee = get(`fee_${d.id}`, group);
  if (fee > 0 && !A.take(group, jid, fee)) {
    S.citizen(group, jid).cd.dungeon = 0;
    return { ok: false, why: 'poor', fee };
  }
  if (fee > 0) A.treasuryAdd(group, fee);
  const b = box(group);
  b.seq += 1;
  const run = { id: b.seq, dungeon: d.id, leader: jid, party: { [S.keyOf(jid)]: jid }, goes: now + get('gatherMinutes', group) * MIN, status: 'open', at: now };
  b.runs.push(run);
  if (b.runs.length > 40) b.runs.splice(0, b.runs.length - 40);
  S.touch();
  return { ok: true, run, dungeon: d, fee };
}
function joinRun(group, jid, id, now = Date.now()) {
  if (runOf(group, jid)) return { ok: false, why: 'busy' };
  const run = open(group).find((r) => r.id === id) || (id ? null : open(group)[0]);
  if (!run) return { ok: false, why: 'none' };
  if (Object.keys(run.party).length >= get('partyMax', group)) return { ok: false, why: 'full', max: get('partyMax', group) };
  const rest = A.cooldown(group, jid, 'dungeon', get('restMinutes', group) * MIN, now);
  if (!rest.ok) return { ok: false, why: 'rest', waitMs: rest.waitMs };
  const d = byId(run.dungeon);
  const fee = get(`fee_${d.id}`, group);
  if (fee > 0 && !A.take(group, jid, fee)) {
    S.citizen(group, jid).cd.dungeon = 0;
    return { ok: false, why: 'poor', fee };
  }
  if (fee > 0) A.treasuryAdd(group, fee);
  run.party[S.keyOf(jid)] = jid;
  S.touch();
  return { ok: true, run, dungeon: d, fee, size: Object.keys(run.party).length, odds: odds(group, run) };
}
function leaveRun(group, jid) {
  const run = runOf(group, jid);
  if (!run) return { ok: false, why: 'none' };
  const d = byId(run.dungeon);
  const fee = get(`fee_${d.id}`, group);
  delete run.party[S.keyOf(jid)];
  // the fee is paid back from the treasury (what is there)
  const back = Math.min(fee, A.treasury(group));
  if (back > 0) {
    A.treasuryAdd(group, -back);
    A.add(group, jid, back);
  }
  S.citizen(group, jid).cd.dungeon = 0;
  if (!Object.keys(run.party).length) run.status = 'cancelled';
  else if (keyEq(run.leader, jid)) run.leader = Object.values(run.party)[0];
  S.touch();
  return { ok: true, run, back };
}

// the party goes in. rng for tests. Returns { run, dungeon, win, size, odds, loot, each, goods }
function settle(group, run, now = Date.now(), rng = Math.random) {
  const d = byId(run.dungeon);
  const members = Object.values(run.party);
  const size = members.length;
  const chance = odds(group, run);
  const enough = size >= get(`min_${d.id}`, group);
  const win = enough && rng() * 100 < chance;
  run.status = 'done';
  run.win = win;
  const out = { run, dungeon: d, win, size, odds: chance, enough, need: get(`min_${d.id}`, group), loot: 0, each: 0, goods: {} };
  if (win) {
    const total = get(`loot_${d.id}`, group);
    out.each = Math.floor(total / size);
    out.loot = out.each * size;
    const lo = get('lootGoodMin', group);
    const hi = Math.max(lo, get('lootGoodMax', group));
    for (const m of members) {
      A.add(group, m, out.each);
      const n = lo + Math.floor(rng() * (hi - lo + 1));
      if (n > 0) stuff.add(group, m, d.good, n);
      out.goods[S.keyOf(m)] = n;
      try {
        require('./season').points(group, m, 8, now);
      } catch (err) {
        // the season is not loaded
      }
    }
  }
  for (const m of members) S.citizen(group, m).cd.dungeon = now; // the rest starts
  S.touch();
  civic.log(group, `Expedition #${run.id}: ${win ? 'won' : 'lost'}.`, now);
  return out;
}
const due = (group, now = Date.now()) => open(group).filter((r) => r.goes <= now);
const call = (group, id) => {
  const run = open(group).find((r) => r.id === id);
  if (!run) return { ok: false };
  const d = byId(run.dungeon);
  const fee = get(`fee_${d.id}`, group);
  for (const m of Object.values(run.party)) {
    const back = Math.min(fee, A.treasury(group));
    if (back > 0) {
      A.treasuryAdd(group, -back);
      A.add(group, m, back);
    }
    S.citizen(group, m).cd.dungeon = 0;
  }
  run.status = 'cancelled';
  S.touch();
  return { ok: true, run };
};

const tagOf = (jid) => `@${String(jid).split('@')[0].split(':')[0]}`;
async function job(post, now = Date.now()) {
  for (const group of Object.keys(S.js.data.realms)) {
    const r = S.js.data.realms[group];
    if (!r.dungeon || !S.isOn(group) || !settings.featureOn('dungeon', group)) continue;
    for (const run of due(group, now)) {
      const o = settle(group, run, now);
      const members = Object.values(run.party);
      const head = `${o.dungeon.icon} *Expedition #${run.id}: ${o.dungeon.name}*\n${members.map(tagOf).join(' ')}\n\n`;
      const body = !o.enough
        ? `🚪 The party was too small (*${o.size}* of the *${o.need}* needed). They turned back, and lost the entry fee.`
        : o.win
          ? `🏆 *Victory!* (${o.odds.toFixed(0)}% chance)\nLoot: *${o.loot.toLocaleString('en-US')} Aurum* – ${o.each.toLocaleString('en-US')} each, and some ${stuff.get(o.dungeon.good).icon} ${stuff.get(o.dungeon.good).name}.`
          : `💀 *Defeat.* (${o.odds.toFixed(0)}% chance) The party fled with nothing and lost the entry fee.`;
      try {
        await post(group, { text: `${head}${body}\n_The party rests for ${get('restMinutes', group)} minutes._`, mentions: members });
      } catch (err) {
        console.log(`The expedition result could not be sent to ${group}: ${err.message}`);
      }
    }
  }
}
ticker.register('realm-dungeon', job);

module.exports = { DUNGEONS, byId, open, runOf, odds, openRun, joinRun, leaveRun, settle, due, call, job, get, box };

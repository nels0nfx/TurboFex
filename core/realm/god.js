// What God can do (God = the main bot owner). God does not play the ruler: God sets the limits and can change anything that exists.
// Every function writes to the Divine Ledger. The "god" command (commands/god.js) is only the text around these.
const settings = require('./settings');
const ledger = require('./ledger');
const S = require('./state');
const A = require('./aurum');
const stuff = require('./stuff');
const estates = require('./estates');
const careers = require('./careers');

settings.register('god', {
  title: 'God',
  icon: '☀️',
  about: 'How God acts',
  defaultOn: true,
  settings: {
    announce: { label: 'Tell the realm when God does something big ("the heavens have spoken")', def: true, kind: 'bool' },
  },
});

// the realm God works on while in a private chat (chosen with "god realm")
const selected = () => S.js.data.god.realm || null;
function select(group) {
  S.js.data.god.realm = group;
  S.touch();
}

// ---- settings
function setSetting(full, text, group = null) {
  const r = settings.set(full, text, group);
  if (r.ok) ledger.log({ action: 'set', realm: group, target: full, detail: `${r.before} → ${r.value}${group ? ' (this realm)' : ' (all realms)'}` });
  return r;
}
function resetSetting(full, group = null) {
  const r = settings.reset(full, group);
  if (r.ok) ledger.log({ action: 'reset', realm: group, target: full, detail: `${r.before} → ${r.value}` });
  return r;
}

// ---- the realm
function realmSwitch(group, on) {
  S.setOn(group, on);
  ledger.log({ action: on ? 'realm on' : 'realm off', realm: group });
}

// ---- citizens
function give(group, jid, n) {
  n = Math.round(n);
  if (!(n > 0)) return { ok: false };
  A.add(group, jid, n);
  ledger.log({ action: 'give', realm: group, target: S.keyOf(jid), detail: `+${n} Aurum` });
  return { ok: true, coins: A.balance(group, jid) };
}
function take(group, jid, n) {
  n = Math.round(n);
  const c = S.citizen(group, jid);
  const took = Math.min(c.coins, n);
  if (!(took > 0)) return { ok: false };
  c.coins -= took;
  S.touch();
  ledger.log({ action: 'take', realm: group, target: S.keyOf(jid), detail: `−${took} Aurum` });
  return { ok: true, took, coins: c.coins };
}
function setPurse(group, jid, n) {
  n = Math.round(n);
  if (!(n >= 0 && n <= 1e12)) return { ok: false };
  const c = S.citizen(group, jid);
  const before = c.coins;
  c.coins = n;
  S.touch();
  ledger.log({ action: 'set purse', realm: group, target: S.keyOf(jid), detail: `${before} → ${n}` });
  return { ok: true, before, coins: n };
}
// index of A.RANKS, or null to go back to the rank the net worth gives
function setRank(group, jid, index) {
  const c = S.citizen(group, jid);
  if (index === null) delete c.rankLock;
  else if (Number.isInteger(index) && index >= 0 && index < A.RANKS.length) c.rankLock = index;
  else return { ok: false };
  S.touch();
  ledger.log({ action: 'set rank', realm: group, target: S.keyOf(jid), detail: index === null ? 'back to normal' : A.RANKS[index].name });
  return { ok: true, rank: A.rank(group, jid) };
}
// a blessing (more pay) or a curse (less pay) for some hours
function fate(group, jid, pct, hours) {
  const c = S.citizen(group, jid);
  if (!pct) {
    delete c.fate;
    S.touch();
    ledger.log({ action: 'fate cleared', realm: group, target: S.keyOf(jid) });
    return { ok: true, cleared: true };
  }
  if (!(pct >= -90 && pct <= 500) || !(hours >= 1 && hours <= 720)) return { ok: false };
  c.fate = { mult: 1 + pct / 100, pct, until: Date.now() + hours * 3600000 };
  S.touch();
  ledger.log({ action: pct > 0 ? 'blessing' : 'curse', realm: group, target: S.keyOf(jid), detail: `${pct > 0 ? '+' : ''}${pct}% for ${hours}h` });
  return { ok: true, pct, hours };
}
function wipeCitizen(group, jid) {
  const id = S.slot(group, S.keyOf(jid));
  if (!S.js.data.citizens[id]) return { ok: false };
  delete S.js.data.citizens[id];
  S.touch();
  ledger.log({ action: 'wipe citizen', realm: group, target: S.keyOf(jid) });
  return { ok: true };
}
function wipeRealm(group) {
  let n = 0;
  for (const id of Object.keys(S.js.data.citizens)) {
    if (id.startsWith(`${group}|`)) {
      delete S.js.data.citizens[id];
      n += 1;
    }
  }
  delete S.js.data.realms[group];
  settings.resetRealm(group);
  S.touch();
  ledger.log({ action: 'wipe realm', realm: group, detail: `${n} citizens` });
  return { ok: true, citizens: n };
}


// ---- goods, estates and careers
// n > 0 puts it in the bag, n < 0 takes it out. Returns { ok, item, now }
function giveStuff(group, jid, id, n) {
  const it = stuff.get(id);
  n = Math.round(n);
  if (!it || !n) return { ok: false };
  if (n > 0) stuff.add(group, jid, id, n);
  else stuff.setCount(group, jid, id, Math.max(0, stuff.countOf(group, jid, id) + n));
  ledger.log({ action: 'item', realm: group, target: S.keyOf(jid), detail: `${n > 0 ? '+' : ''}${n} ${it.name}` });
  return { ok: true, item: it, now: stuff.countOf(group, jid, id) };
}
// level 0 removes the estate
function setEstate(group, jid, id, level) {
  const e = estates.byId(id);
  level = Math.round(level);
  if (!e || !(level >= 0 && level <= 50)) return { ok: false };
  const c = S.citizen(group, jid);
  c.estates = c.estates || {};
  if (level === 0) delete c.estates[id];
  else c.estates[id] = { lv: level, at: Date.now(), spent: c.estates[id] ? c.estates[id].spent : 0 };
  S.touch();
  ledger.log({ action: 'estate', realm: group, target: S.keyOf(jid), detail: `${e.name} → level ${level}` });
  return { ok: true, estate: e, level };
}
// id = a career id, or null for none
function setCareer(group, jid, id) {
  const c = S.citizen(group, jid);
  if (id === null) c.career = null;
  else {
    const cr = careers.byId(id);
    if (!cr) return { ok: false };
    c.career = cr.id;
  }
  c.careerAt = 0;
  S.touch();
  ledger.log({ action: 'career', realm: group, target: S.keyOf(jid), detail: id || 'none' });
  return { ok: true, career: id ? careers.byId(id) : null };
}
// the goods the realm keeps from the estate tax (the government of a later phase spends them)
const realmStock = (group) => ({ ...(S.realmOf(group).stock || {}) });

// ---- moving the progress of citizens from one realm to another (who = a key, or null for everybody)
function moveRealm(from, to, who = null, mode = 'move') {
  const moved = [];
  for (const { key, c } of S.citizensOf(from)) {
    if (who && key !== who) continue;
    const d = S.citizen(to, S.jidOf(key, c));
    d.coins += c.coins || 0;
    d.bank = (d.bank || 0) + (c.bank || 0);
    d.streak = Math.max(d.streak || 0, c.streak || 0);
    d.lastDaily = Math.max(d.lastDaily || 0, c.lastDaily || 0);
    d.title = d.title || c.title;
    d.satchels = Math.max(d.satchels || 0, c.satchels || 0);
    d.bankBonus = Math.max(d.bankBonus || 0, c.bankBonus || 0);
    for (const [id, until] of Object.entries(c.items || {})) d.items[id] = Math.max(d.items[id] || 0, until);
    for (const [id, n] of Object.entries(c.inv || {})) {
      d.inv = d.inv || {};
      d.inv[id] = (d.inv[id] || 0) + n;
    }
    for (const [id, st] of Object.entries(c.estates || {})) {
      d.estates = d.estates || {};
      if (!d.estates[id] || d.estates[id].lv < st.lv) d.estates[id] = { ...st };
    }
    for (const [id, u] of Object.entries(c.tools || {})) (d.tools = d.tools || {})[id] = Math.max((d.tools || {})[id] || 0, u);
    if (c.career && !d.career) d.career = c.career;
    for (const [id, xp] of Object.entries(c.cx || {})) (d.cx = d.cx || {})[id] = Math.max((d.cx || {})[id] || 0, xp);
    moved.push({ key, worth: (c.coins || 0) + (c.bank || 0) });
    if (mode === 'move') delete S.js.data.citizens[S.slot(from, key)];
  }
  if (!who && mode === 'move' && moved.length) {
    const t = A.treasury(from);
    if (t) {
      A.treasuryAdd(to, t);
      A.treasuryAdd(from, -t);
    }
  }
  S.touch();
  ledger.log({ action: mode === 'move' ? 'move data' : 'copy data', realm: from, target: to, detail: `${moved.length} citizens${who ? ` (${who})` : ''}` });
  return moved;
}
// the realms that have citizens: Map(group -> number)
function realmsWithData() {
  const out = new Map();
  for (const id of Object.keys(S.js.data.citizens)) {
    const at = id.indexOf('|');
    if (at > 0) out.set(id.slice(0, at), (out.get(id.slice(0, at)) || 0) + 1);
  }
  return out;
}

module.exports = { giveStuff, setEstate, setCareer, realmStock, selected, select, setSetting, resetSetting, realmSwitch, give, take, setPurse, setRank, fate, wipeCitizen, wipeRealm, moveRealm, realmsWithData };

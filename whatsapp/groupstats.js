// Counters for every group (v1.0.7):
//   - messages per day, per member and per hour of the day (groupstats, weeklyrecap),
//   - the swear jar (swearjar): a count of rude words per member, only when an admin switched it on,
//   - "catchup": the last messages of the chat, kept IN MEMORY ONLY (never on disk, 12 hours at most) and only when an admin
//     switched it on, so the AI can say what you missed,
//   - the welcome message sent privately to new members (welcomedm).
// Only numbers are saved to disk (data/groupstats.json). The text of messages is never saved.
const jsonstore = require('../core/jsonstore');
const clock = require('../core/clock');
const levels = require('./levels');

const js = jsonstore.open('groupstats', { groups: {} }, { delay: 5000 });
const KEEP_DAYS = 35;
const CATCHUP_MAX = 200;
const CATCHUP_TTL_MS = 12 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

function grp(group) {
  if (!js.data.groups || typeof js.data.groups !== 'object') js.data.groups = {};
  const g = js.data.groups[group] || (js.data.groups[group] = {});
  if (!g.days || typeof g.days !== 'object') g.days = {};
  if (!g.jar || typeof g.jar !== 'object') g.jar = { on: false, counts: {}, since: 0 };
  if (!g.jar.counts) g.jar.counts = {};
  if (!g.welcomeDm || typeof g.welcomeDm !== 'object') g.welcomeDm = { on: false, text: '' };
  return g;
}

const pad = (n) => String(n).padStart(2, '0');
function dayKey(ts) {
  const p = clock.parts(new Date(ts));
  return `${p.y}-${pad(p.mo)}-${pad(p.dom)}`;
}
const hourOf = (ts) => Number(clock.parts(new Date(ts)).hhmm.slice(0, 2));

// ---- counting messages
function count(group, sender, ts = Date.now()) {
  const key = levels.keyOf(sender);
  if (!group || !key) return;
  const g = grp(group);
  const k = dayKey(ts);
  const d = g.days[k] || (g.days[k] = { n: 0, m: {}, h: Array(24).fill(0) });
  d.n += 1;
  d.m[key] = (d.m[key] || 0) + 1;
  d.h[hourOf(ts)] += 1;
  const keys = Object.keys(g.days);
  if (keys.length > KEEP_DAYS) for (const old of keys.sort().slice(0, keys.length - KEEP_DAYS)) delete g.days[old];
  js.touch();
}

// the last `days` days (today included), or the `days` days before those when offset is 1 (for "compared with last week")
function summary(group, days = 7, offset = 0, now = Date.now()) {
  const g = grp(group);
  const first = dayKey(now - ((offset + 1) * days - 1) * DAY_MS);
  const last = dayKey(now - offset * days * DAY_MS);
  const out = { total: 0, members: {}, hours: Array(24).fill(0), perDay: [], from: first, to: last };
  for (let i = (offset + 1) * days - 1; i >= offset * days; i--) {
    const k = dayKey(now - i * DAY_MS);
    const d = g.days[k];
    out.perDay.push({ date: k, n: d ? d.n : 0 });
    if (!d) continue;
    out.total += d.n;
    for (const [m, n] of Object.entries(d.m)) out.members[m] = (out.members[m] || 0) + n;
    d.h.forEach((n, h) => (out.hours[h] += n));
  }
  out.top = Object.entries(out.members).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
  const best = out.perDay.reduce((a, b) => (b.n > a.n ? b : a), { date: '', n: 0 });
  out.bestDay = best.n ? best : null;
  const peak = out.hours.reduce((a, n, h) => (n > a.n ? { h, n } : a), { h: -1, n: 0 });
  out.peakHour = peak.n ? peak.h : null;
  return out;
}

// when the counters began (the oldest day kept), or null
function since(group) {
  const keys = Object.keys(grp(group).days).sort();
  return keys[0] || null;
}

// ---- the swear jar
const BUILTIN = new Set(['damn', 'shit', 'fuck', 'fucking', 'fucker', 'bitch', 'asshole', 'bastard', 'crap', 'dick', 'piss', 'bullshit', 'motherfucker', 'dumbass', 'jackass']);
const jarOn = (group) => !!grp(group).jar.on;
function setJar(group, on) {
  const g = grp(group);
  g.jar.on = !!on;
  if (on && !g.jar.since) g.jar.since = Date.now();
  js.touch();
}
function resetJar(group) {
  const g = grp(group);
  g.jar.counts = {};
  g.jar.since = g.jar.on ? Date.now() : 0;
  js.touch();
}
// counts the rude words of one message (at most 3 for one message, so one angry rant cannot run away with the jar)
function jarCount(group, sender, text, extraWords = []) {
  const g = grp(group);
  if (!g.jar.on || !text) return 0;
  const key = levels.keyOf(sender);
  if (!key) return 0;
  const set = new Set([...BUILTIN, ...extraWords.map((w) => String(w).toLowerCase()).filter((w) => /^[\p{L}\p{N}']+$/u.test(w))]);
  const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  const n = Math.min(3, tokens.filter((t) => set.has(t)).length);
  if (n) {
    g.jar.counts[key] = (g.jar.counts[key] || 0) + n;
    js.touch();
  }
  return n;
}
const jarTop = (group, limit = 10) =>
  Object.entries(grp(group).jar.counts).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, limit);
const jarTotal = (group) => Object.values(grp(group).jar.counts).reduce((a, b) => a + b, 0);
const jarSince = (group) => grp(group).jar.since || 0;

// ---- catchup (memory only)
const live = new Map(); // group -> [{ at, who, text }]
const catchupOn = (group) => !!grp(group).catchup;
function setCatchup(group, on) {
  grp(group).catchup = !!on;
  if (!on) live.delete(group);
  js.touch();
}
function remember(group, who, text, at = Date.now()) {
  if (!catchupOn(group)) return;
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return;
  const list = live.get(group) || [];
  list.push({ at, who: String(who || '?').slice(0, 30), text: t });
  while (list.length > CATCHUP_MAX) list.shift();
  live.set(group, list);
  if (live.size > 300) live.delete(live.keys().next().value);
}
function recent(group, limit = 100, now = Date.now()) {
  const list = (live.get(group) || []).filter((m) => now - m.at <= CATCHUP_TTL_MS);
  live.set(group, list);
  return list.slice(-limit);
}

// ---- welcome message in private (welcomedm)
const welcomeDm = (group) => grp(group).welcomeDm;
function setWelcomeDm(group, patch) {
  Object.assign(grp(group).welcomeDm, patch);
  js.touch();
}
const sentDm = new Map(); // group -> [times], at most 20 private messages an hour for one group
function dmAllowed(group, now = Date.now()) {
  const list = (sentDm.get(group) || []).filter((t) => now - t < 3600 * 1000);
  if (list.length >= 20) {
    sentDm.set(group, list);
    return false;
  }
  list.push(now);
  sentDm.set(group, list);
  return true;
}

// what the handler calls for every normal group message
function onMessage(group, sender, text, { name = '', isCommand = false, extraWords = [], now = Date.now() } = {}) {
  count(group, sender, now);
  if (isCommand || !text) return;
  jarCount(group, sender, text, extraWords);
  remember(group, name || `+${String(sender).split('@')[0].split(':')[0].slice(-4)}`, text, now);
}

module.exports = {
  count, summary, since, dayKey, onMessage,
  jarOn, setJar, resetJar, jarCount, jarTop, jarTotal, jarSince, BUILTIN,
  catchupOn, setCatchup, remember, recent, CATCHUP_MAX,
  welcomeDm, setWelcomeDm, dmAllowed,
};

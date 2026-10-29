// Usage statistics for the owner: which commands are used, how busy the groups are, and the last errors.
const jsonstore = require('../core/jsonstore');

const js = jsonstore.open('stats', () => ({ since: Date.now(), commands: 0, errors: 0, byCommand: {}, byDay: {}, byGroup: {}, lastErrors: [] }));
const d = () => js.data;
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

function record({ name, jid, outcome }) {
  const s = d();
  s.commands += 1;
  s.byCommand[name] = (s.byCommand[name] || 0) + 1;
  s.byDay[day()] = (s.byDay[day()] || 0) + 1;
  if (String(jid).endsWith('@g.us')) s.byGroup[jid] = (s.byGroup[jid] || 0) + 1;
  if (outcome === 'fail') s.errors += 1;
  const days = Object.keys(s.byDay).sort();
  for (const old of days.slice(0, Math.max(0, days.length - 60))) delete s.byDay[old]; // two months of days are kept
  const groups = Object.entries(s.byGroup);
  if (groups.length > 300) {
    s.byGroup = Object.fromEntries(groups.sort((a, b) => b[1] - a[1]).slice(0, 200));
  }
  js.touch();
}

function error(name, message) {
  const s = d();
  s.lastErrors.push({ at: Date.now(), name, message: String(message).slice(0, 160) });
  if (s.lastErrors.length > 20) s.lastErrors.shift();
  js.touch();
}

function summary() {
  const s = d();
  const now = Date.now();
  const lastDays = (n) => Array.from({ length: n }, (_, i) => s.byDay[day(now - i * 86400000)] || 0).reduce((a, b) => a + b, 0);
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  return { since: s.since, total: s.commands, errors: s.errors, today: lastDays(1), week: lastDays(7), topCommands: top(s.byCommand, 5), topGroups: top(s.byGroup, 3), lastErrors: s.lastErrors.slice(-10) };
}

function reset() {
  const s = d();
  Object.assign(s, { since: Date.now(), commands: 0, errors: 0, byCommand: {}, byDay: {}, byGroup: {}, lastErrors: [] });
  js.touch();
}

module.exports = { record, error, summary, reset };
